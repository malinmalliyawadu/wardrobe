import type { NextConfig } from 'next'

const config: NextConfig = {
  // Cache Components: data is dynamic by default and the static shell is
  // prerendered, so anything that reads Postgres sits behind Suspense or
  // awaits connection(). See src/lib/health.ts for the pattern.
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
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
