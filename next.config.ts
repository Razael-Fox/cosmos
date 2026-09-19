import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: [
    "38.49.212.111",
    "38.49.212.111:1377",
    "38.49.212.111:1434",
    "38.49.212.111:1623",
    "38.49.212.111:3000",
    "38.49.212.111:8080",
    "192.168.11.86",
    "192.168.11.86:1377",
    "192.168.11.86:1434",
    "192.168.11.86:1623",
    "192.168.11.86:3000",
    "192.168.11.86:4000",
    "192.168.11.86:8080",
    "preview.razael-fox.my.id",
    "*.razael-fox.my.id",
    "cosmos.razael-fox.my.id",
    "razael-fox.my.id",
    "localhost",
    "localhost:3000",
    "localhost:8080",
    "127.0.0.1",
    "127.0.0.1:3000",
    "127.0.0.1:8080",
  ],
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
