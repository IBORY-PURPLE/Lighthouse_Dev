import type { Metadata } from "next";
import "./volunteer.css";

export const metadata: Metadata = {
  title: "봉사자 - LightHouse",
};

export default function VolunteerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
