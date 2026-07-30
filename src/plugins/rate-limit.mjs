const ipRequestCounts = new Map();
const requestMetadata = new WeakMap();

// Pembersihan background Map setiap 1 menit (60000 ms) untuk mencegah memory leak
setInterval(() => {
    const now = Date.now();
    for (const [ip, data] of ipRequestCounts.entries()) {
        if (now > data.resetTime) {
            ipRequestCounts.delete(ip);
        }
    }
}, 60000);

export function onRequest(req) {
    const url = new URL(req.url);
    const pathName = url.pathname;
    
    // Check if it is a static file request
    const ext = pathName.split('.').pop()?.toLowerCase();
    const isHashed = /\.[a-f0-9]{8,}\./.test(pathName) || pathName.includes('/_app/');
    const isStatic = (ext && ['css', 'js', 'mjs', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'woff', 'woff2', 'otf', 'ttf', 'json', 'webmanifest'].includes(ext)) || isHashed;

    // Rate limit only SSR (non-static) requests, excluding preflight OPTIONS
    if (isStatic || req.method === 'OPTIONS') {
        return;
    }

    // Ekstraksi IP klien utama di balik proxy
    const rawIp = req.headers.get('x-forwarded-for') || '127.0.0.1';
    const ip = rawIp.split(',')[0].trim();
    const now = Date.now();
    
    let rateData = ipRequestCounts.get(ip);
    if (!rateData || now > rateData.resetTime) {
        rateData = {
            count: 0,
            resetTime: now + 60000 // 1 minute window
        };
    }
    
    rateData.count++;
    ipRequestCounts.set(ip, rateData);
    
    // Proteksi kapasitas Map: Jika terlalu banyak IP unik (di atas 10.000), bersihkan entri yang kedaluwarsa atau tertua
    if (ipRequestCounts.size > 10000) {
        let evicted = 0;
        for (const [key, data] of ipRequestCounts.entries()) {
            if (now > data.resetTime) {
                ipRequestCounts.delete(key);
                evicted++;
            }
        }
        // Jika masih terlalu besar, hapus paksa entri tertua (FIFO) agar kapasitas kembali ke batas aman
        if (ipRequestCounts.size > 10000) {
            const keysIterator = ipRequestCounts.keys();
            while (ipRequestCounts.size > 8000) {
                const nextKey = keysIterator.next().value;
                if (nextKey === undefined) break;
                ipRequestCounts.delete(nextKey);
            }
        }
    }
    
    const remaining = Math.max(0, 100 - rateData.count);
    const resetSeconds = Math.ceil((rateData.resetTime - now) / 1000);

    const rateLimitInfo = {
        limit: 100,
        remaining,
        reset: resetSeconds
    };

    // Store in WeakMap to retrieve in onResponse
    requestMetadata.set(req, { rateLimit: rateLimitInfo });

    if (rateData.count > 100) {
        const isApi = pathName.startsWith('/api/');
        const acceptHeader = req.headers.get('accept') || '';
        const expectsJson = isApi || acceptHeader.includes('application/json');

        if (expectsJson) {
            return new Response(JSON.stringify({
                error: 'Too Many Requests',
                message: 'Terlalu banyak permintaan dari IP Anda. Silakan coba lagi nanti.'
            }), {
                status: 429,
                headers: {
                    'Content-Type': 'application/json;charset=utf-8',
                    'RateLimit-Limit': '100',
                    'RateLimit-Remaining': String(remaining),
                    'RateLimit-Reset': String(resetSeconds)
                }
            });
        }

        return new Response('Terlalu banyak permintaan dari IP Anda. Silakan coba lagi nanti.', {
            status: 429,
            headers: {
                'Content-Type': 'text/plain;charset=utf-8',
                'RateLimit-Limit': '100',
                'RateLimit-Remaining': String(remaining),
                'RateLimit-Reset': String(resetSeconds)
            }
        });
    }
}

export function onResponse(req, res) {
    const meta = requestMetadata.get(req);
    if (meta && meta.rateLimit) {
        const { limit, remaining, reset } = meta.rateLimit;
        try {
            res.headers.set('RateLimit-Limit', String(limit));
            res.headers.set('RateLimit-Remaining', String(remaining));
            res.headers.set('RateLimit-Reset', String(reset));
            return res;
        } catch {
            const newHeaders = new Headers(res.headers);
            newHeaders.set('RateLimit-Limit', String(limit));
            newHeaders.set('RateLimit-Remaining', String(remaining));
            newHeaders.set('RateLimit-Reset', String(reset));
            return new Response(res.body, {
                status: res.status,
                statusText: res.statusText,
                headers: newHeaders
            });
        }
    }
    return res;
}
