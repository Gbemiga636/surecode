import type { Metadata } from "next";
import "./exbot.css";

export const metadata: Metadata = {
  title: "exbot",
  robots: { index: false, follow: false, nocache: true },
};

export default function ExbotLayout({ children }: { children: React.ReactNode }) {
  return <div className="exbot">{children}</div>;
}
