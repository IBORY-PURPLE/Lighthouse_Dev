import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "시연: 봉사자 화면 - LightHouse",
};

export default function VolunteerDemoLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
