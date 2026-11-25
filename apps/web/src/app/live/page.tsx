import type { Metadata } from "next";
import { LiveConversation } from "@/components/LiveConversation";
import { isLiveEnabled } from "@/lib/liveConfig";
import styles from "./live.module.css";

// /live 서버 컴포넌트. 기능이 꺼져 있으면 안내와 첫 화면 링크만 보인다. 설계서 4.1절.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "음성 도우미 - LightHouse",
};

export default function LivePage() {
  if (!isLiveEnabled()) {
    return (
      <main className={styles.unavailable}>
        <h1>음성 도우미</h1>
        <p>지금은 음성 도우미를 쓸 수 없어요.</p>
        <a href="/">처음 화면</a>
      </main>
    );
  }
  return <LiveConversation />;
}
