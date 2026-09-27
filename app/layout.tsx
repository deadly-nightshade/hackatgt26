import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

/** The one font for all text. It has a single weight: bold is faked in globals.css. */
const lilac = localFont({ src: "./fonts/LILAC.otf", variable: "--font-app", display: "swap" });

export const metadata: Metadata = {
  title: "Seaside Market — Onboarding",
  description: "Tell us about yourself and become a resident of the beach.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1f6f8b",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={lilac.variable}>
      <body>{children}</body>
    </html>
  );
}
