import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 로컬 개발에서 휴대폰(같은 와이파이)이 dev 서버를 열 수 있게 할 주소. 배포에는 영향 없다(dev 전용 설정).
  allowedDevOrigins: process.env.LH_DEV_LAN_HOSTS?.split(",").filter(Boolean) ?? [],
  async headers() {
    return [
      {
        // 웹 푸시 서비스 워커(A13): 늘 새로 받게 하고, 사이트 전체(/)를 맡는다.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        // 휴대폰 사진 페이지: 링크 토큰이 주소(#t=)에 있으므로 저장·전달·검색 노출을 막는다(design.md 3.3).
        source: "/volunteer/photo",
        headers: [
          { key: "Cache-Control", value: "no-store" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
    ];
  },
  async rewrites() {
    return [
      // public/ 폴더는 index.html을 자동으로 찾지 않는다.
      { source: "/speech-probe", destination: "/speech-probe/index.html" },
      // 이용자 홈과 요청 목록은 정적 페이지다. 새 요청은 /live에서 시작한다.
      { source: "/", destination: "/voice/index.html" },
    ];
  },
};

export default nextConfig;
