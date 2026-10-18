"use client";
import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/providers/auth-provider";
import DashboardSidebar from "./SidebarNav";
import TopBar from "./TopBar";
import { SidebarInset } from "@/components/ui/sidebar";
const publicPaths = [
  "/sign-in",
  "/sign-up",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
];
export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const auth = useAuth();
  const isPublic = publicPaths.includes(path);
  useEffect(() => {
    if (!isPublic && auth.isLoaded && !auth.isSignedIn && !auth.error)
      router.replace("/sign-in");
  }, [auth.isLoaded, auth.isSignedIn, auth.error, isPublic, router]);
  if (isPublic) return children;
  if (auth.error) return <main className="grid min-h-screen place-items-center p-8"><div role="alert"><p>{auth.error}</p><button className="mt-4 text-teal-400" onClick={() => void auth.refresh()}>Try again</button></div></main>;
  if (!auth.isLoaded || !auth.isSignedIn)
    return (
      <main className="grid min-h-screen place-items-center" role="status">
        Loading your account...
      </main>
    );
  return (
    <DashboardSidebar>
      <SidebarInset>
        <TopBar />
        <div className="py-4 pr-4">
          <div className="mx-auto max-w-7xl">{children}</div>
        </div>
      </SidebarInset>
    </DashboardSidebar>
  );
}
