"use client";

import Link from "next/link";
import {
  Check,
  CreditCard,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  Plus,
  Settings,
} from "lucide-react";
import { useDemoAuth } from "@/components/auth/demo-auth-provider";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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

export function DemoLandingHeader() {
  const { user, isLoaded, signOut, createOrganization, selectOrganization } = useDemoAuth();

  if (!isLoaded) return null;

  const initials = user?.name
    .split(/\s+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const addOrganization = () => {
    const name = window.prompt("Organization name");
    if (name) createOrganization(name);
  };

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
          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  aria-label={`Open account menu for ${user.name}`}
                  className="h-9 w-9 rounded-full p-0"
                >
                  <Avatar className="h-9 w-9">
                    <AvatarFallback className="border border-sky-500/40 bg-sky-500/10 font-medium text-sky-200">
                      {initials || "DU"}
                    </AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-64 border-slate-800 bg-slate-900" align="end">
                <div className="px-2 py-2">
                  <p className="truncate text-sm font-medium text-white">{user.name}</p>
                  <p className="truncate text-xs text-slate-400">{user.email}</p>
                </div>
                <DropdownMenuSeparator className="bg-slate-800" />
                <div className="px-2 py-1.5">
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Organization</p>
                  {user.organizations.map((organization) => (
                    <DropdownMenuItem
                      key={organization}
                      onSelect={() => selectOrganization(organization)}
                      className="text-slate-200 focus:bg-slate-800 focus:text-white"
                    >
                      <span className="truncate">{organization}</span>
                      {user.activeOrganization === organization && <Check className="ml-auto h-4 w-4 text-emerald-300" />}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuItem onSelect={addOrganization} className="text-slate-300 focus:bg-slate-800 focus:text-white">
                    <Plus className="mr-2 h-4 w-4" />Create organization
                  </DropdownMenuItem>
                </div>
                <DropdownMenuSeparator className="bg-slate-800" />
                <DropdownMenuItem asChild className="text-slate-200 focus:bg-slate-800 focus:text-white">
                  <Link href={dashboardUrl} target="_blank" rel="noreferrer"><LayoutDashboard className="mr-2 h-4 w-4" />Dashboard</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild className="text-slate-200 focus:bg-slate-800 focus:text-white">
                  <Link href={`${dashboardUrl}/settings`}><CreditCard className="mr-2 h-4 w-4" />Billing</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild className="text-slate-200 focus:bg-slate-800 focus:text-white">
                  <Link href={`${dashboardUrl}/settings`} target="_blank" rel="noreferrer"><Settings className="mr-2 h-4 w-4" />Settings</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild className="text-slate-200 focus:bg-slate-800 focus:text-white">
                  <Link href="mailto:contact@oneminutelogs.com"><LifeBuoy className="mr-2 h-4 w-4" />Support</Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator className="bg-slate-800" />
                <DropdownMenuItem onSelect={signOut} className="text-red-400 focus:bg-red-500/10 focus:text-red-300">
                  <LogOut className="mr-2 h-4 w-4" />Logout
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <>
              <Link href="/sign-in" className="hidden items-center rounded-sm border border-slate-800 bg-slate-900/60 px-3 py-1.5 text-xs font-medium text-slate-100 transition-colors hover:border-slate-600 hover:bg-slate-900 sm:inline-flex">Login</Link>
              <Link href="/sign-up" className="inline-flex items-center rounded-sm bg-sky-500/90 px-3.5 py-1.5 text-xs font-semibold text-slate-950 shadow-sm transition-colors hover:bg-sky-400">Get Started</Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
