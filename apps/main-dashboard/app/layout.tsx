import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import localFont from "next/font/local";

import { TooltipProvider } from "@/components/ui/tooltip";




import { QueryProvider } from "@/providers/query-provider";
import { AuthProvider } from "@/providers/auth-provider";
import { AppShell } from "@/components/dashboard/AppShell";
import { Toaster } from "sonner";

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
  title: "Tracebloom",
  description: "Free application logs, live search, and webhook alerts.",
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
          <QueryProvider>
            <Toaster position="top-right" richColors />
            <TooltipProvider>
              <AuthProvider><AppShell>{children}</AppShell></AuthProvider>
            </TooltipProvider>
          </QueryProvider>
        </body>
      </html>

  );
}
