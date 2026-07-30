import { join } from 'node:path';
import { statSync } from 'node:fs';

const clientDir = join(process.cwd(), 'dist', 'client');
const publicDir = join(process.cwd(), 'public');

function getFilePath(pathName) {
    const clientPath = join(clientDir, pathName);
    const publicPath = join(publicDir, pathName);

    // Path traversal protection & file check
    if (publicPath.startsWith(publicDir + '/') || publicPath === publicDir) {
        try {
            const stat = statSync(publicPath);
            if (stat.isFile()) return { path: publicPath, stat };
        } catch {}
    }
    if (clientPath.startsWith(clientDir + '/') || clientPath === clientDir) {
        try {
            const stat = statSync(clientPath);
            if (stat.isFile()) return { path: clientPath, stat };
        } catch {}
    }
    return null;
}

export function onResponse(req, res) {
    // Only handle GET/HEAD requests with status 200 or 304
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        return res;
    }

    if (res.status !== 200 && res.status !== 304) {
        return res;
    }

    const url = new URL(req.url);
    const pathName = url.pathname;

    const fileInfo = getFilePath(pathName);
    if (!fileInfo) {
        return res;
    }

    const { stat } = fileInfo;
    const etag = `W/"${stat.size}-${stat.mtimeMs}"`;

    // Check If-None-Match
    const ifNoneMatch = req.headers.get('If-None-Match');
    const isNotModified = ifNoneMatch === etag;

    // Prepare response headers
    const newHeaders = new Headers(res.headers);
    if (!newHeaders.has('ETag')) {
        newHeaders.set('ETag', etag);
    }

    if (isNotModified) {
        // Return 304 Not Modified
        return new Response(null, {
            status: 304,
            headers: newHeaders
        });
    }

    // Return the response with updated headers
    if (res.status === 200) {
        try {
            res.headers.set('ETag', etag);
            return res;
        } catch {
            return new Response(res.body, {
                status: res.status,
                statusText: res.statusText,
                headers: newHeaders
            });
        }
    }

    return res;
}
