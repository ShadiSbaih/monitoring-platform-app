import { LegacyAuthCleanup } from "@/components/auth/legacy-auth-cleanup";
import { defaultMetadata } from "@/lib/seo";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import localFont from "next/font/local";





const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const satoshi = localFont({
  src: "../assets/fonts/Satoshi-Bold.otf",
  variable: "--font-satoshi",
  weight: "700",
});

export const metadata = defaultMetadata;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${satoshi.variable} antialiased`}
        suppressHydrationWarning
      >
        <LegacyAuthCleanup />
        {children}
      </body>
    </html>
  );
}
