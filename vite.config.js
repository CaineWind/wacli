import { fileURLToPath, URL } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { getConnectableHost, normalizeLoopbackHost } from './shared/networkHosts.js'

const packageGroups = [
  {
    name: 'vendor-react',
    packages: ['react', 'react-dom', 'react-router', 'react-router-dom', 'scheduler'],
  },
  {
    name: 'vendor-markdown',
    packages: [
      'react-markdown',
      'react-syntax-highlighter',
      'refractor',
      'prismjs',
      'remark-',
      'rehype-',
      'micromark',
      'mdast-',
      'hast-',
      'unist-',
      'unified',
      'vfile',
      'property-information',
    ],
  },
  {
    name: 'vendor-ui',
    packages: ['@radix-ui/', 'cmdk', 'lucide-react', 'react-dropzone', 'react-remove-scroll'],
  },
  {
    name: 'vendor-i18n',
    packages: ['i18next', 'react-i18next'],
  },
  {
    name: 'vendor-data',
    packages: ['dompurify', 'fuse.js', 'gray-matter', 'jszip', 'yaml'],
  },
]

const getManualChunk = (id) => {
  const normalizedId = id.replace(/\\/g, '/')
  const featureChunk = [
    ['/src/components/chat/', 'feature-chat'],
    ['/src/components/sidebar/', 'feature-workspace'],
    ['/src/components/settings/', 'feature-workspace'],
    ['/src/components/mcp/', 'feature-workspace'],
    ['/src/components/skills/', 'feature-workspace'],
    ['/src/components/plugins/', 'feature-workspace'],
  ].find(([path]) => normalizedId.includes(path))
  if (featureChunk) {
    return featureChunk[1]
  }

  const nodeModulesPath = normalizedId.split('/node_modules/').at(-1)
  if (!nodeModulesPath) {
    return undefined
  }

  const segments = nodeModulesPath.split('/')
  const packageName = segments[0].startsWith('@') ? segments.slice(0, 2).join('/') : segments[0]

  return packageGroups.find(({ packages }) =>
    packages.some((candidate) =>
      candidate.endsWith('/') || candidate.endsWith('-')
        ? packageName.startsWith(candidate)
        : packageName === candidate,
    ),
  )?.name
}

export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  const env = loadEnv(mode, process.cwd(), '')

  const configuredHost = env.HOST || '0.0.0.0'
  // if the host is not a loopback address, it should be used directly. 
  // This allows the vite server to EXPOSE all interfaces when the host 
  // is set to '0.0.0.0' or '::', while still using 'localhost' for browser 
  // URLs and proxy targets.
  const host = normalizeLoopbackHost(configuredHost)
  
  const proxyHost = getConnectableHost(configuredHost)
  // TODO: Remove support for legacy PORT variables in all locations in a future major release, leaving only SERVER_PORT.
  const serverPort = env.SERVER_PORT || env.PORT || 3001

  return {
    plugins: [
      react(),
      VitePWA({
        registerType: 'prompt',
        includeAssets: ['favicon.svg', 'favicon.png', 'logo-128.png', 'logo-256.png'],
        manifest: {
          id: '.',
          name: 'WindCli',
          short_name: 'WindCli',
          description: 'A local-first web interface for AI coding agents.',
          start_url: '.',
          scope: '.',
          display: 'standalone',
          display_override: ['window-controls-overlay', 'standalone', 'minimal-ui'],
          background_color: '#111111',
          theme_color: '#111111',
          orientation: 'any',
          categories: ['developer', 'productivity', 'utilities'],
          icons: [
            { src: 'icons/icon-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: 'icons/icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: 'icons/icon-maskable-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
            { src: 'icons/icon-maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
          screenshots: [
            {
              src: 'screenshots/setup-screen.png',
              sizes: '4096x1593',
              type: 'image/png',
              form_factor: 'wide',
              label: 'WindCli desktop setup',
            },
            {
              src: 'screenshots/setup-screen-mobile.png',
              sizes: '390x844',
              type: 'image/png',
              form_factor: 'narrow',
              label: 'WindCli mobile setup',
            },
          ],
        },
        workbox: {
          clientsClaim: true,
          cleanupOutdatedCaches: true,
          globIgnores: ['**/screenshots/**', 'api-docs.html', 'clear-cache.html'],
          importScripts: ['push-sw.js'],
          navigateFallback: 'index.html',
          navigateFallbackDenylist: [/^\/(?:api|ws|shell|plugin-ws)(?:\/|$)/],
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: 'windcli-google-fonts-stylesheets',
                cacheableResponse: { statuses: [0, 200] },
                expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 30 },
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'windcli-google-fonts-webfonts',
                cacheableResponse: { statuses: [0, 200] },
                expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
              },
            },
          ],
        },
      }),
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url))
      }
    },
    server: {
      host,
      port: parseInt(env.VITE_PORT) || 5210,
      strictPort: true,
      proxy: {
        '/api': `http://${proxyHost}:${serverPort}`,
        '/ws': {
          target: `ws://${proxyHost}:${serverPort}`,
          ws: true
        },
        '/shell': {
          target: `ws://${proxyHost}:${serverPort}`,
          ws: true
        },
        '/plugin-ws': {
          target: `ws://${proxyHost}:${serverPort}`,
          ws: true
        }
      }
    },
    build: {
      outDir: 'dist',
      chunkSizeWarningLimit: 1000,
      rollupOptions: {
        output: {
          manualChunks: getManualChunk,
        }
      }
    }
  }
})
