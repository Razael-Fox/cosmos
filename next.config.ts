import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: [
    "preview.razael-fox.my.id",
    "*.razael-fox.my.id",
    "razael-fox.my.id",
    "localhost:3000",
    "127.0.0.1:3000",
  ],
};

export default nextConfig;
