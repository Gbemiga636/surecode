import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SureCode — SportyBet sure codes of the day",
  description:
    "High-confidence SportyBet booking codes, AI predictions, expert picks, and a demo wallet — open codes in one tap.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
