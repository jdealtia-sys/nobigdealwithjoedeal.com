import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  experimental: {
    // Enable React 19 features
    reactCompiler: true,
  },
  // Cloudflare Pages compatibility
  // output: 'export', // Enable for static Cloudflare Pages deploy — uncomment when wiring CF
  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
}

export default nextConfig
