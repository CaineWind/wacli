import { fileURLToPath, URL } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
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
    plugins: [react()],
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
