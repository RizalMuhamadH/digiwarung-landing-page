import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';

function getAdapter(args) {
    return {
        name: 'bun-adapter',
        serverEntrypoint: fileURLToPath(new URL('./runtime.mjs', import.meta.url)),
        entrypointResolution: 'auto',
        args,
        supportedAstroFeatures: {
            i18nDomains: "experimental",
            hybridOutput: 'stable',
            staticOutput: 'stable',
            serverOutput: 'stable',
            sharpImageService: 'stable',
            envGetSecret: 'stable',
            assets: {
                supportKind: 'stable',
                isDefaultService: true,
            },
        },
    };
}

export default function bunAdapter(options = {}) {
    return {
        name: 'bun-integration',
        hooks: {
            'astro:config:setup': ({ updateConfig }) => {
                updateConfig({
                    output: 'server',
                });

                // Write user options to config.json so runtime.mjs can access it during build
                const configPath = fileURLToPath(new URL('./config.json', import.meta.url));
                const mode = options.mode || 'standalone';
                const plugins = options.plugins || [];
                writeFileSync(configPath, JSON.stringify({ mode, plugins }, null, 2), 'utf-8');
            },
            'astro:config:done': ({ setAdapter, config }) => {
                setAdapter(getAdapter({
                    host: config.server.host,
                    port: config.server.port,
                }));
            },
        },
    };
}
