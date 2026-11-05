import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      // public/ 폴더는 index.html을 자동으로 찾지 않는다.
      { source: "/speech-probe", destination: "/speech-probe/index.html" },
    ];
  },
};

export default nextConfig;
