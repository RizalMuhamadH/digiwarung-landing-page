import { createApp } from 'astro/app/entrypoint';
import { join, relative, dirname, resolve } from 'path';
import { createBrotliCompress, brotliCompress, gzip } from 'zlib';
import { Readable } from 'stream';
import { readdirSync, statSync, writeFileSync, mkdirSync } from 'fs';
import config from './config.json';

const requestMiddlewares = [];
const responseMiddlewares = [];

const logger = {
    info: (msg, data = {}) => {
        console.log(JSON.stringify({
            time: new Date().toISOString(),
            level: 'info',
            source: '@bun-adapter',
            msg,
            ...data
        }));
    },
    error: (msg, data = {}) => {
        console.error(JSON.stringify({
            time: new Date().toISOString(),
            level: 'error',
            source: '@bun-adapter',
            msg,
            ...data
        }));
    }
};

function getClientIP(req, server) {
    const xForwardedFor = req.headers.get('x-forwarded-for');
    if (xForwardedFor) {
        const ips = xForwardedFor.split(',').map(ip => ip.trim());
        if (ips[0]) return ips[0];
    }
    const xRealIp = req.headers.get('x-real-ip');
    if (xRealIp) return xRealIp;

    if (server) {
        try {
            const ipInfo = server.requestIP(req);
            if (ipInfo && ipInfo.address) {
                return ipInfo.address;
            }
        } catch {}
    }
    return '127.0.0.1';
}

const clientDir = join(process.cwd(), 'dist', 'client');
const publicDir = join(process.cwd(), 'public');

// Direktori untuk menyimpan file pre-compressed.
// Bisa dikonfigurasi via env COMPRESS_CACHE_DIR jika dist/client/ tidak bisa ditulis.
// Set DISABLE_COMPRESS_CACHE=true untuk menonaktifkan pre-compression ke disk sama sekali.
const compressCacheDir = process.env.COMPRESS_CACHE_DIR
    ? join(process.env.COMPRESS_CACHE_DIR)
    : clientDir;
const disableCompressCache = process.env.DISABLE_COMPRESS_CACHE === 'true';

const staticFiles = new Set();

function registerStaticFiles(dir, baseDir) {
    try {
        const files = readdirSync(dir);
        for (const file of files) {
            const fullPath = join(dir, file);
            if (statSync(fullPath).isDirectory()) {
                registerStaticFiles(fullPath, baseDir);
            } else {
                const rel = relative(baseDir, fullPath);
                const pathName = '/' + rel.replace(/\\/g, '/');
                staticFiles.add(pathName);
            }
        }
    } catch (e) {
        // Directory may not exist yet during build/startup
    }
}

registerStaticFiles(publicDir, publicDir);
registerStaticFiles(clientDir, clientDir);

function generateETag(filePath) {
    try {
        const stats = statSync(filePath);
        return `W/"${stats.size}-${stats.mtimeMs}"`;
    } catch {
        return null;
    }
}

function getMimeType(filePath) {
    const ext = filePath.split('.').pop()?.toLowerCase();
    const mimeTypes = {
        'css': 'text/css;charset=utf-8',
        'js': 'application/javascript;charset=utf-8',
        'mjs': 'application/javascript;charset=utf-8',
        'json': 'application/json;charset=utf-8',
        'webmanifest': 'application/manifest+json;charset=utf-8',
        'html': 'text/html;charset=utf-8',
        'xml': 'application/xml;charset=utf-8',
        'svg': 'image/svg+xml;charset=utf-8',
        'png': 'image/png',
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'gif': 'image/gif',
        'webp': 'image/webp',
        'ico': 'image/x-icon',
        'woff': 'font/woff',
        'woff2': 'font/woff2',
        'otf': 'font/otf',
        'ttf': 'font/ttf'
    };
    return mimeTypes[ext] || 'application/octet-stream';
}

/**
 * Compresses a source file and saves it to `destPath`.
 * When source is from `public/`, pass a destPath pointing to `dist/client/`
 * so that compressed artifacts stay out of the public/ source tree.
 */
const compressingFiles = new Set();

function saveCompressedVersion(filePath, encoding, destPath = null) {
    if (disableCompressCache) return;

    const ext = encoding === 'br' ? '.br' : (encoding === 'gzip' ? '.gz' : '.zst');
    const target = destPath ?? (filePath + ext);

    // Cegah kompresi paralel jika file yang sama sedang diproses
    if (compressingFiles.has(target)) {
        return;
    }
    compressingFiles.add(target);

    Bun.file(filePath).arrayBuffer().then(buffer => {
        // Ensure the parent directory exists (e.g. for public/ files whose dist/client/ dir
        // may not have been created by the Astro build yet)
        try {
            mkdirSync(dirname(target), { recursive: true });
        } catch { /* ignore — directory already exists */ }

        const releaseLock = () => {
            compressingFiles.delete(target);
        };

        if (encoding === 'br') {
            brotliCompress(Buffer.from(buffer), (err, compressed) => {
                if (err) {
                    logger.error(`Failed to Brotli compress: ${filePath}`, { error: err.message });
                    releaseLock();
                    return;
                }
                try {
                    writeFileSync(target, compressed);
                    logger.info(`Saved pre-compressed Brotli version: ${target}`);
                } catch (writeErr) {
                    logger.error(`Failed to write Brotli file to disk: ${target}`, { error: writeErr.message });
                } finally {
                    releaseLock();
                }
            });
        } else if (encoding === 'gzip') {
            gzip(Buffer.from(buffer), (err, compressed) => {
                if (err) {
                    logger.error(`Failed to Gzip compress: ${filePath}`, { error: err.message });
                    releaseLock();
                    return;
                }
                try {
                    writeFileSync(target, compressed);
                    logger.info(`Saved pre-compressed Gzip version: ${target}`);
                } catch (writeErr) {
                    logger.error(`Failed to write Gzip file to disk: ${target}`, { error: writeErr.message });
                } finally {
                    releaseLock();
                }
            });
        } else if (encoding === 'zstd') {
            Bun.zstdCompress(Buffer.from(buffer)).then(compressed => {
                try {
                    writeFileSync(target, compressed);
                    logger.info(`Saved pre-compressed Zstd version: ${target}`);
                } catch (writeErr) {
                    logger.error(`Failed to write Zstd file to disk: ${target}`, { error: writeErr.message });
                } finally {
                    releaseLock();
                }
            }).catch(zstdErr => {
                logger.error(`Failed to compress Zstd: ${filePath}`, { error: zstdErr.message });
                releaseLock();
            });
        }
    }).catch(err => {
        logger.error(`Error loading file buffer for compression ${filePath}: ${err.message}`);
        compressingFiles.delete(target);
    });
}

async function compressResponse(req, res) {
    if (!res.body || res.headers.has('Content-Encoding')) {
        return res;
    }

    const contentType = res.headers.get('Content-Type') || '';
    const isCompressible = /json|text|javascript|css|xml|svg|html/.test(contentType);

    if (!isCompressible) {
        return res;
    }

    const acceptEncoding = req.headers.get('Accept-Encoding') || '';
    let encoding = '';
    let body = res.body;

    try {
        if (acceptEncoding.includes('zstd')) {
            const contentLength = res.headers.get('Content-Length');
            const size = contentLength ? parseInt(contentLength, 10) : 0;
            // Compress with zstd only if the size is known and small (< 100KB)
            if (size > 0 && size < 102400) {
                encoding = 'zstd';
                const buffer = await res.arrayBuffer();
                body = await Bun.zstdCompress(Buffer.from(buffer));
            }
        }
        
        if (!encoding) {
            if (acceptEncoding.includes('br')) {
                encoding = 'br';
                const brotli = createBrotliCompress();
                body = Readable.toWeb(Readable.fromWeb(body).pipe(brotli));
            } else if (acceptEncoding.includes('gzip')) {
                encoding = 'gzip';
                body = body.pipeThrough(new CompressionStream('gzip'));
            } else if (acceptEncoding.includes('deflate')) {
                encoding = 'deflate';
                body = body.pipeThrough(new CompressionStream('deflate'));
            }
        }
    } catch (e) {
        logger.error(`Compression Error: ${e.message}`, { error: e.stack });
        return res;
    }

    if (encoding) {
        const headers = new Headers(res.headers);
        headers.set('Content-Encoding', encoding);
        headers.delete('Content-Length');
        headers.append('Vary', 'Accept-Encoding');

        return new Response(body, {
            status: res.status,
            statusText: res.statusText,
            headers,
        });
    }

    return res;
}

// Initialize the Astro application using Astro 6 standard
const ssrApp = createApp();

/**
 * The core fetch handler that handles SSR, static files, and compression.
 * This is reused by both the standalone Bun.serve and the Elysia/Fastify wrappers.
 */
export async function handleRequest(req, server = null) {
    const startTime = performance.now();
    const reqId = crypto.randomUUID();
    let finalReq = req;
    const url = new URL(req.url);

    const forwardedProto = req.headers.get('x-forwarded-proto');
    const forwardedHost = req.headers.get('x-forwarded-host');

    if (forwardedProto || forwardedHost) {
        const newUrl = new URL(req.url);
        if (forwardedProto) newUrl.protocol = forwardedProto + ':';
        if (forwardedHost) newUrl.host = forwardedHost;
        finalReq = new Request(newUrl.toString(), req);
    }

    // Run modular request middlewares
    for (const middleware of requestMiddlewares) {
        try {
            const earlyResponse = await middleware(finalReq);
            if (earlyResponse) {
                let response = earlyResponse;
                for (const respMiddleware of responseMiddlewares) {
                    try {
                        response = await respMiddleware(finalReq, response);
                    } catch (err) {
                        logger.error(`Response middleware error in early return`, { error: err.message });
                    }
                }
                return response;
            }
        } catch (err) {
            logger.error(`Request middleware error`, { error: err.message });
        }
    }

    const pathName = url.pathname;
    const method = finalReq.method;
    const userAgent = finalReq.headers.get('user-agent') || 'Unknown';
    const hostHeader = finalReq.headers.get('host') || url.host;
    const referer = finalReq.headers.get('referer') || '-';

    /**
     * Determines the appropriate Cache-Control header for a given file path.
     */
    function getCacheControl(pathName) {
        const isHashed = /\.[a-f0-9]{8,}\./.test(pathName) || pathName.includes('/_app/');
        const ext = pathName.split('.').pop()?.toLowerCase();

        if (isHashed) {
            return 'public, max-age=31536000, immutable';
        }

        if (ext === 'json' || ext === 'webmanifest' || pathName.includes('sw.js')) {
            return 'no-cache';
        }

        if (['css', 'js', 'mjs', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'woff', 'woff2', 'otf', 'ttf'].includes(ext)) {
            return 'public, max-age=86400, must-revalidate';
        }

        return 'public, max-age=0, must-revalidate';
    }

    let response;
    let type = 'SSR';

    try {
        const isKnownStatic = staticFiles.has(pathName);
        const hasExtension = pathName.includes('.') && pathName.lastIndexOf('.') > pathName.lastIndexOf('/');

        // Fast in-memory check or fallback check for dynamic files containing an extension
        if ((isKnownStatic || hasExtension) && (method === 'GET' || method === 'HEAD')) {
            let filePath = '';
            let resolvedType = '';

            const clientPath = join(clientDir, pathName);
            const publicPath = join(publicDir, pathName);

            // Path Traversal Protection: verify resolved target is strictly inside base directories.
            // public/ is checked FIRST so it always overrides dist/client/ — this ensures that
            // assets updated via `bun run css:bun` (written to public/) are served immediately
            // without requiring a full Astro rebuild.
            if (publicPath.startsWith(publicDir + '/') || publicPath === publicDir) {
                const publicFile = Bun.file(publicPath);
                if (await publicFile.exists() && publicPath !== publicDir) {
                    filePath = publicPath;
                    resolvedType = 'STATIC (PUBLIC)';
                }
            }

            if (!filePath && (clientPath.startsWith(clientDir + '/') || clientPath === clientDir)) {
                const clientFile = Bun.file(clientPath);
                if (await clientFile.exists() && clientPath !== clientDir) {
                    filePath = clientPath;
                    resolvedType = 'STATIC (CLIENT)';
                }
            }

            if (filePath) {
                // Dynamically register the file if it wasn't registered during startup (e.g. added after boot)
                if (!isKnownStatic) {
                    staticFiles.add(pathName);
                }

                const acceptEncoding = finalReq.headers.get('Accept-Encoding') || '';

                // Compressed files disimpan di compressCacheDir (default: dist/client/).
                // Bisa diubah via env COMPRESS_CACHE_DIR jika dist/client/ tidak writable di prod.
                const compressedBase = join(compressCacheDir, pathName);
                const zstPath = compressedBase + '.zst';
                const brPath  = compressedBase + '.br';
                const gzPath  = compressedBase + '.gz';

                let encoding = '';
                let servePath = filePath;

                // Check for pre-compressed files in dist/client/ first
                if (acceptEncoding.includes('zstd') && await Bun.file(zstPath).exists()) {
                    servePath = zstPath;
                    encoding = 'zstd';
                    resolvedType += ' (PRE-COMPRESSED ZSTD)';
                } else if (acceptEncoding.includes('br') && await Bun.file(brPath).exists()) {
                    servePath = brPath;
                    encoding = 'br';
                    resolvedType += ' (PRE-COMPRESSED BR)';
                } else if (acceptEncoding.includes('gzip') && await Bun.file(gzPath).exists()) {
                    servePath = gzPath;
                    encoding = 'gzip';
                    resolvedType += ' (PRE-COMPRESSED GZIP)';
                } else {
                    // Trigger background pre-compression; destPath always points to dist/client/
                    if (acceptEncoding.includes('zstd')) {
                        saveCompressedVersion(filePath, 'zstd', zstPath);
                    } else if (acceptEncoding.includes('br')) {
                        saveCompressedVersion(filePath, 'br', brPath);
                    } else if (acceptEncoding.includes('gzip')) {
                        saveCompressedVersion(filePath, 'gzip', gzPath);
                    }
                }

                if (!response) {
                    const file = Bun.file(servePath);
                    const headers = new Headers({
                        'Cache-Control': getCacheControl(pathName),
                        'Content-Type': getMimeType(filePath)
                    });
                    if (encoding) {
                        headers.set('Content-Encoding', encoding);
                    }
                    response = new Response(file, { headers });
                    type = resolvedType;
                }
            }
        }

        if (!response) {
            const options = { addCookieHeader: true };
            response = await ssrApp.render(finalReq, options);
        }
    } catch (e) {
        type = 'ERROR';
        logger.error(`Fetch Error [${method} ${pathName}]`, {
            method,
            path: pathName,
            error: e.stack || e.message
        });
        response = new Response('Internal Server Error', { status: 500 });
    }

    response = await compressResponse(req, response);

    // Apply modular response middlewares
    for (const respMiddleware of responseMiddlewares) {
        try {
            response = await respMiddleware(req, response);
        } catch (err) {
            logger.error(`Response middleware error`, { error: err.message });
        }
    }

    // Set Trace ID on final response headers
    let finalResponse = response;
    try {
        response.headers.set('X-Request-Id', reqId);
    } catch {
        const newHeaders = new Headers(response.headers);
        newHeaders.set('X-Request-Id', reqId);
        finalResponse = new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: newHeaders
        });
    }

    const duration = (performance.now() - startTime).toFixed(2);
    const status = finalResponse.status;
    const contentLength = finalResponse.headers.get('content-length');
    const bytesSent = contentLength ? parseInt(contentLength, 10) : 0;

    const logData = {
        req_id: reqId,
        ip: getClientIP(finalReq, server),
        host: hostHeader,
        method,
        path: pathName,
        status,
        bytes_sent: bytesSent,
        duration: `${duration}ms`,
        type: finalResponse.status === 304 ? `${type} (304)` : type,
        referer,
        userAgent
    };

    if (status >= 500) {
        logger.error(`${method} ${pathName} (${status})`, logData);
    } else {
        logger.info(`${method} ${pathName} (${status})`, logData);
    }

    return finalResponse;
}

export async function start() {
    createHandler(); // Node-style handler

    // Expose the web-style handler globally for direct calls
    globalThis._astro_fetch_handler = handleRequest;

    // Dynamically load modular plugins if configured in config.json
    if (config.plugins && config.plugins.length > 0) {
        for (const pluginPath of config.plugins) {
            try {
                const resolvedPath = pluginPath.startsWith('.') 
                    ? resolve(process.cwd(), pluginPath)
                    : pluginPath;
                
                logger.info(`Loading modular plugin from: ${resolvedPath}`);
                const pluginModule = await import(resolvedPath);
                if (pluginModule.onRequest) {
                    requestMiddlewares.push(pluginModule.onRequest);
                }
                if (pluginModule.onResponse) {
                    responseMiddlewares.push(pluginModule.onResponse);
                }
            } catch (err) {
                logger.error(`Failed to load modular plugin: ${pluginPath}`, { error: err.stack || err.message });
            }
        }
    }

    if (process.env.ASTRO_SKIP_SERVER) {
        logger.info(`SSR App initialized (Server skipped)`);
        return;
    }

    const host = process.env.HOST || '0.0.0.0';
    const port = Number(process.env.PORT) || 4321;

    logger.info(`Initializing native Bun.serve server on http://${host}:${port}...`);

    // Global Error Handlers
    process.on('uncaughtException', (err) => {
        logger.error(`CRITICAL UNCAUGHT EXCEPTION: ${err.stack || err.message}`, { error: err.stack });
    });

    process.on('unhandledRejection', (reason, promise) => {
        const error = reason instanceof Error ? reason : new Error(String(reason));
        logger.error(`CRITICAL UNHANDLED REJECTION: ${error.message}`, { 
            reason: String(reason),
            error: error.stack 
        });
    });

    const server = Bun.serve({
        hostname: host,
        port: port,
        fetch: async (req, serverInstance) => {
            return await handleRequest(req, serverInstance);
        }
    });

    logger.info(`Native Bun.serve server listening on http://${host}:${port}`, { host, port });

    // Graceful Shutdown Handlers
    const shutdown = (signal) => {
        logger.info(`Received ${signal}. Shutting down gracefully...`);
        server.stop();
        process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    return server;
}

export function createHandler() {
    const handler = async (req, res) => {
        if (!ssrApp) {
            res.statusCode = 503;
            res.end('Server Initializing...');
            return;
        }

        try {
            const protocol = req.headers['x-forwarded-proto'] || (req.connection?.encrypted ? 'https' : 'http');
            const host = req.headers['host'];
            const url = new URL(req.url, `${protocol}://${host}`);

            const webReq = new Request(url.toString(), {
                method: req.method,
                headers: req.headers,
                body: req.method !== 'GET' && req.method !== 'HEAD' ? req : undefined,
            });

            const response = await handleRequest(webReq, {
                requestIP() {
                    return { address: req.socket?.remoteAddress || req.connection?.remoteAddress };
                }
            });

            res.statusCode = response.status;
            res.statusMessage = response.statusText;

            response.headers.forEach((value, key) => {
                res.setHeader(key, value);
            });

            if (response.body) {
                for await (const chunk of response.body) {
                    res.write(chunk);
                }
            }
            res.end();
        } catch (e) {
            logger.error('Handler Error', { error: e.stack || e.message });
            res.statusCode = 500;
            res.end('Internal Server Error');
        }
    };

    // Expose it globally for wrappers like run-server.mjs
    globalThis._astro_handler = handler;
    return handler;
}

// In Astro 6 with entrypointResolution: "auto", 
// we should call the start function to ensure the server runs when entry.mjs is executed.
if (config.mode !== 'middleware') {
    start();
}
