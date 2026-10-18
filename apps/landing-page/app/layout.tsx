import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import localFont from "next/font/local";
import { ClerkProvider } from "@clerk/nextjs";
import { ui } from "@clerk/ui";
import { DemoAuthProvider } from "@/components/auth/demo-auth-provider";
import { clerkConfigured } from "@/lib/clerk-config";

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

export const metadata: Metadata = {
  title: "OneMinute Logs",
  description: "Production-ready logs in under a minute.",
};

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
        {clerkConfigured ? (
          <ClerkProvider ui={ui}>{children}</ClerkProvider>
        ) : (
          <DemoAuthProvider>{children}</DemoAuthProvider>
        )}
      </body>
    </html>
  );
}
