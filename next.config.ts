import type {NextConfig} from 'next';
import {withSentryConfig} from '@sentry/nextjs';

const nextConfig: NextConfig = {
  eslint: { ignoreDuringBuilds: true },
  typescript: { tsconfigPath: './tsconfig.json' },
  productionBrowserSourceMaps: false,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'placehold.co',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**',
      },
    ],
  },
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  // Keep build logs quiet unless running in CI.
  silent: !process.env.CI,
  // Only upload source maps when an auth token is available (prod deploy).
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
  // Trim the client bundle: we capture errors only (no session replay/tracing),
  // so tree-shake all replay-related code out of the mobile bundle.
  bundleSizeOptimizations: {
    excludeDebugStatements: true,
    excludeReplayShadowDom: true,
    excludeReplayIframe: true,
    excludeReplayWorker: true,
  },
});
