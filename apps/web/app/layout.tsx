import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import type { ReactNode } from "react";
import "lenis/dist/lenis.css";
import "./globals.css";

import { MotionProvider } from "./_components/motion-provider";

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const mono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Cutout | STRK20 shield preflight",
  description: "A deterministic signing decision for a single STRK20 deposit.",
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${mono.variable}`}>
      <body><MotionProvider>{children}</MotionProvider></body>
    </html>
  );
}
