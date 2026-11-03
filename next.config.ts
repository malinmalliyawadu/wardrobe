import type { NextConfig } from 'next'

const config: NextConfig = {
  // Cache Components: data is dynamic by default and the static shell is
  // prerendered, so anything that reads Postgres sits behind Suspense or
  // awaits connection(). See src/lib/health.ts for the pattern.
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  experimental: {
    serverActions: {
      // Photo uploads go through a Server Action. Phone photos run 3 to 12 MB.
      bodySizeLimit: '25mb',
    },
  },
  turbopack: {
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
}

export default config
