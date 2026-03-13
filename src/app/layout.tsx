import type { Metadata } from "next";
import { Caveat, Playfair_Display, Press_Start_2P } from "next/font/google";
import { GeistMono } from "geist/font/mono";
import { GeistPixelSquare } from "geist/font/pixel";
import { GeistSans } from "geist/font/sans";
import { Toaster } from "@/components/ui/sonner";
import { Providers } from "@/components/providers";
import { isPublicDemoEnabled } from "@/lib/demo/config";
import "./globals.css";

const caveat = Caveat({
  variable: "--font-caveat",
  subsets: ["latin"],
});

const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
});

const ghostPixel = Press_Start_2P({
  variable: "--font-ghost-pixel",
  weight: "400",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "SeqDesk",
    template: "%s | SeqDesk",
  },
  description:
    "Metadata collection and management system for microbiome sequencing facilities",
  keywords: [
    "microbiome",
    "sequencing",
    "metadata",
    "ENA",
    "MIxS",
    "bioinformatics",
  ],
  robots: isPublicDemoEnabled()
    ? {
        index: false,
        follow: false,
      }
    : undefined,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${GeistSans.variable} ${GeistMono.variable} ${caveat.variable} ${playfair.variable} ${ghostPixel.variable} ${GeistPixelSquare.variable} font-sans antialiased min-h-screen bg-background`}
      >
        <Providers>
          {children}
          <Toaster position="top-right" />
        </Providers>
      </body>
    </html>
  );
}
