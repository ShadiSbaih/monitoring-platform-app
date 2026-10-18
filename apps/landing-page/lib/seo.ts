import type { Metadata } from "next";

const host = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
export const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || (host ? `https://${host}` : "http://localhost:3000");
export const brand = "Tracebloom";
export const defaultDescription = "See your application logs take shape. Free live logs, search, and webhook alerts.";

export const defaultMetadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: brand, template: `%s | ${brand}` },
  applicationName: brand,
  description: defaultDescription,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website", url: siteUrl, title: brand, siteName: brand, description: defaultDescription,
  },
  twitter: { card: "summary", title: brand, description: defaultDescription },
  robots: { index: true, follow: true },
  icons: { icon: "/favicon.ico" },
  keywords: ["log management", "application logs", "developer tools", "observability", "monitoring"],
};

type PageMetaInput = { title: string; description?: string; path?: string };
export function makePageMetadata({ title, description = defaultDescription, path = "/" }: PageMetaInput): Metadata {
  const canonical = new URL(path, siteUrl).toString();
  return {
    title, description, alternates: { canonical },
    openGraph: { ...defaultMetadata.openGraph, title, description, url: canonical },
    twitter: { ...defaultMetadata.twitter, title, description },
  };
}
export const organizationJsonLd = () => ({
  "@context": "https://schema.org", "@type": "Organization", name: brand, url: siteUrl,
});
