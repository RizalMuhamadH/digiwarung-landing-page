export function onRequest(req) {
    if (req.method === 'OPTIONS') {
        return new Response(null, {
            status: 204,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, DELETE, OPTIONS',
                'Access-Control-Allow-Headers': '*',
                'Access-Control-Max-Age': '86400',
            }
        });
    }
}

export function onResponse(req, res) {
    try {
        res.headers.set('Access-Control-Allow-Origin', '*');
        res.headers.set('Access-Control-Allow-Methods', 'GET, HEAD, POST, PUT, DELETE, OPTIONS');
        res.headers.set('Access-Control-Allow-Headers', '*');
        res.headers.set('Access-Control-Max-Age', '86400');
        return res;
    } catch {
        const newHeaders = new Headers(res.headers);
        newHeaders.set('Access-Control-Allow-Origin', '*');
        newHeaders.set('Access-Control-Allow-Methods', 'GET, HEAD, POST, PUT, DELETE, OPTIONS');
        newHeaders.set('Access-Control-Allow-Headers', '*');
        newHeaders.set('Access-Control-Max-Age', '86400');
        return new Response(res.body, {
            status: res.status,
            statusText: res.statusText,
            headers: newHeaders
        });
    }
}
