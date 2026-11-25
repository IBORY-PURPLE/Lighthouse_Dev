import Image from "next/image";

// Figma D안에서 내려받은 아이콘(public/research/*.svg). 장식이라 낭독기에서 숨긴다.
const SIZES = { back: 24, plus: 22, send: 22, sparkle: 20, check: 20, headset: 44, dot: 8 } as const;

export type IconName = keyof typeof SIZES;

export function Icon({ name, size, className }: { name: IconName; size?: number; className?: string }) {
  const px = size ?? SIZES[name];
  return (
    <Image
      src={`/research/${name}.svg`}
      alt=""
      aria-hidden="true"
      width={px}
      height={px}
      unoptimized
      className={className}
    />
  );
}
