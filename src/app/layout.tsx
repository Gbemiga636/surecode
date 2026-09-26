import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SureCode — SportyBet sure codes",
  description:
    "Trained Sure AI books high-hit SportyBet codes across sports. Safe singles, larger sure slips, picks desk, and a demo wallet.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
