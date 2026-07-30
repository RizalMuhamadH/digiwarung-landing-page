export function onResponse(req, res) {
    let headers;
    try {
        headers = res.headers;
        headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
        headers.set('X-Content-Type-Options', 'nosniff');
        headers.set('X-Frame-Options', 'SAMEORIGIN');
        headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
        headers.set('X-XSS-Protection', '1; mode=block');
        headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), interest-cohort=()');
        return res;
    } catch {
        headers = new Headers(res.headers);
        headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
        headers.set('X-Content-Type-Options', 'nosniff');
        headers.set('X-Frame-Options', 'SAMEORIGIN');
        headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
        headers.set('X-XSS-Protection', '1; mode=block');
        headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), interest-cohort=()');
        return new Response(res.body, {
            status: res.status,
            statusText: res.statusText,
            headers
        });
    }
}
