import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Allow large video file uploads
  serverExternalPackages: ['openai', 'better-sqlite3'],

  experimental: {
    serverActions: {
      bodySizeLimit: '100mb',
    },
  },
}

export default nextConfig
