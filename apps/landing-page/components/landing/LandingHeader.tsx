import { clerkConfigured } from "@/lib/clerk-config";
import { ClerkLandingHeader } from "./clerk-landing-header";
import { DemoLandingHeader } from "./demo-landing-header";

export function LandingHeader() {
  return clerkConfigured ? <ClerkLandingHeader /> : <DemoLandingHeader />;
}
