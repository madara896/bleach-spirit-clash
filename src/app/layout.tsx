import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin", "latin-ext"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin", "latin-ext"],
});

export const metadata: Metadata = {
  title: "BLEACH Spirit Clash — 2D Fighting",
  description:
    "Ichigo va Aizen orasidagi 2D fight o'yin. Mortal Kombat uslubidagi " +
    "mexanikalar, Bankai, Hadō va onlayn 1v1.",
  keywords: ["fighting game", "2d", "bleach", "ichigo", "aizen", "mortal kombat"],
};

export const viewport: Viewport = {
  themeColor: "#0B0912",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="uz"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-[#0B0912]">{children}</body>
    </html>
  );
}
