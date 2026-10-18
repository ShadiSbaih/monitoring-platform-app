"use client";

import Link from "next/link";
import {
  CreditCard,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  Settings,
} from "lucide-react";
import { OrganizationSwitcher, useClerk, useUser } from "@clerk/nextjs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import Logo from "../common/logo";

const dashboardUrl = process.env.NEXT_PUBLIC_DASHBOARD_URL || "http://localhost:3001";

export function ClerkLandingHeader() {
  const { user, isLoaded, isSignedIn } = useUser();
  const { signOut } = useClerk();

  if (!isLoaded) return null;

  const initials = [user?.firstName?.[0], user?.lastName?.[0]]
    .filter(Boolean)
    .join("") || user?.primaryEmailAddress?.emailAddress?.[0]?.toUpperCase() || "U";
  const fullName = user?.fullName || user?.primaryEmailAddress?.emailAddress || "User";

  return (
    <header className="sticky top-0 z-50 w-full border-b border-slate-900/80 bg-slate-950/80 backdrop-blur-sm">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
        <Link href="/#" aria-label="OneMinute Logs home" className="flex items-center gap-1">
          <Logo />
        </Link>
        <nav aria-label="Main navigation" className="hidden items-center gap-8 text-base text-slate-400 md:flex">
          <Link href="/#story" className="transition-colors hover:text-slate-50">Why us?</Link>
          <Link href="/#features" className="transition-colors hover:text-slate-50">Features</Link>
          <Link href="/#integrations" className="transition-colors hover:text-slate-50">Integrations</Link>
          <Link href="/#pricing" className="transition-colors hover:text-slate-50">Pricing</Link>
          <Link href="/#" className="transition-colors hover:text-slate-50">Docs</Link>
        </nav>

        <div className="flex items-center gap-3">
          {isSignedIn ? (
            <>
              <OrganizationSwitcher
                afterCreateOrganizationUrl="/"
                afterSelectOrganizationUrl="/"
                appearance={{
                  elements: {
                    rootBox: "hidden sm:block",
                    organizationSwitcherTrigger:
                      "border border-slate-800 bg-slate-900/60 text-slate-200 hover:bg-slate-800",
                  },
                }}
              />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    aria-label={`Open account menu for ${fullName}`}
                    className="h-9 w-9 rounded-full p-0"
                  >
                    <Avatar className="h-9 w-9">
                      {user?.imageUrl && <AvatarImage src={user.imageUrl} alt={fullName} />}
                      <AvatarFallback className="border border-sky-500/40 bg-sky-500/10 font-medium text-sky-200">
                        {initials}
                      </AvatarFallback>
                    </Avatar>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-56 border-slate-800 bg-slate-900" align="end">
                  <DropdownMenuItem asChild className="text-slate-200 focus:bg-slate-800 focus:text-white">
                    <Link href={dashboardUrl} target="_blank" rel="noreferrer">
                      <LayoutDashboard className="mr-2 h-4 w-4" />Dashboard
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild className="text-slate-200 focus:bg-slate-800 focus:text-white">
                    <Link href={`${dashboardUrl}/settings`}>
                      <CreditCard className="mr-2 h-4 w-4" />Billing
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild className="text-slate-200 focus:bg-slate-800 focus:text-white">
                    <Link href={`${dashboardUrl}/settings`} target="_blank" rel="noreferrer">
                      <Settings className="mr-2 h-4 w-4" />Settings
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild className="text-slate-200 focus:bg-slate-800 focus:text-white">
                    <Link href="mailto:contact@oneminutelogs.com">
                      <LifeBuoy className="mr-2 h-4 w-4" />Support
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="bg-slate-800" />
                  <DropdownMenuItem
                    className="text-red-400 focus:bg-red-500/10 focus:text-red-300"
                    onSelect={() => void signOut()}
                  >
                    <LogOut className="mr-2 h-4 w-4" />Logout
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            <>
              <Link href="/sign-in" className="hidden items-center rounded-sm border border-slate-800 bg-slate-900/60 px-3 py-1.5 text-xs font-medium text-slate-100 transition-colors hover:border-slate-600 hover:bg-slate-900 sm:inline-flex">
                Login
              </Link>
              <Link href="/sign-up" className="inline-flex items-center rounded-sm bg-sky-500/90 px-3.5 py-1.5 text-xs font-semibold text-slate-950 shadow-sm transition-colors hover:bg-sky-400">
                Get Started
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
