import type { Metadata, Viewport } from "next";

import { PwaRuntime } from "@/components/pwa-runtime";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Turn Rotation",
    template: "%s · Turn Rotation",
  },
  description:
    "A transparent employee turn-rotation system for nail and hair salons.",
  applicationName: "Turn Rotation",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Turn Rotation",
  },
};

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#163c35",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-canvas text-ink antialiased">
        <PwaRuntime />
        {children}
      </body>
    </html>
  );
}
