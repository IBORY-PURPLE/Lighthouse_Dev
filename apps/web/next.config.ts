import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      // public/ 폴더는 index.html을 자동으로 찾지 않는다.
      { source: "/speech-probe", destination: "/speech-probe/index.html" },
      // 이용자 화면(/)은 apps/user-voice-ui의 화면(음성 대화)이다. 고정 질문 3개 화면은 /classic으로 옮겼다.
      { source: "/", destination: "/voice/index.html" },
    ];
  },
};

export default nextConfig;
