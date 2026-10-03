import { Geist, Geist_Mono } from "next/font/google";

export const geist = Geist({ subsets: ["latin"], variable: "--mk-sans", display: "swap" });
export const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--mk-mono", display: "swap" });

export const marketingFonts = `${geist.variable} ${geistMono.variable}`;
