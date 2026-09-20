import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: [
    "localhost",
    "localhost:3000",
    "localhost:8080",
    "127.0.0.1",
    "127.0.0.1:3000",
    "127.0.0.1:8080",
    "cosmos.razael-fox.my.id",
    "*.razael-fox.my.id",
    ...(process.env.APP_DOMAIN ? [process.env.APP_DOMAIN, process.env.APP_DOMAIN.split(':')[0]] : []),
    ...(process.env.DEV_ALLOWED_ORIGINS ? process.env.DEV_ALLOWED_ORIGINS.split(',').map((s) => s.trim()) : [])
  ].filter(Boolean),
  async rewrites() {
    const apiTarget = process.env.INTERNAL_API_URL || 'http://api:4000';
    return [
      {
        source: '/api/v1/:path*',
        destination: `${apiTarget}/api/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
