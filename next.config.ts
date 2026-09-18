import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: [
    "38.49.212.111",
    "38.49.212.111:3000",
    "preview.razael-fox.my.id",
    "*.razael-fox.my.id",
    "razael-fox.my.id",
    "localhost",
    "localhost:3000",
    "127.0.0.1",
    "127.0.0.1:3000",
  ],
};

export default nextConfig;
