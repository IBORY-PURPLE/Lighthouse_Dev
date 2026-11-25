/** 번짐 배경(Figma 배경 번짐 SVG). 대화로 넘어가면 아래쪽 옅은 번짐으로 바뀐다. 장식이다. */
export function HeroBackdrop({ variant }: { variant: "hero" | "chat" }) {
  return <div className={`vc-backdrop vc-backdrop--${variant}`} aria-hidden="true" />;
}
