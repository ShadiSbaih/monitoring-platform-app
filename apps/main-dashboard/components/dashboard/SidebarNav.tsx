"use client";
import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Activity, Bell, Home, Key, LogOut, Plug, Search, Settings } from 'lucide-react';
import { useAuth } from '@/providers/auth-provider';
import { SidebarProvider, Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarMenu,
  SidebarMenuItem, SidebarMenuButton, SidebarTrigger, SidebarRail } from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import Logo from '../common/logo';
export function DashboardSidebar({ children }: { children: ReactNode }) {
  const path = usePathname(); const { user, signOut } = useAuth();
  const items = [
    { label: 'Overview', href: '/', Icon: Home }, { label: 'Live Logs', href: '/live-logs', Icon: Activity },
    { label: 'Queries', href: '/queries', Icon: Search }, { label: 'Alerts', href: '/alerts', Icon: Bell },
    { label: 'Integrations', href: '/integrations', Icon: Plug }, { label: 'API Keys', href: '/api-keys', Icon: Key },
    { label: 'Settings', href: '/settings', Icon: Settings },
  ];
  return <SidebarProvider defaultOpen style={{ '--sidebar-width': '270px', '--sidebar-width-icon': '80px' } as React.CSSProperties}>
    <Sidebar collapsible="icon" className="border-r border-white/5 bg-background">
      <SidebarHeader><Link href="/" className="p-3"><Logo className="h-7 w-7" textClassName="text-xl" /></Link></SidebarHeader>
      <SidebarContent><SidebarMenu className="gap-3 px-3 py-5">{items.map(({ label, href, Icon }) =>
        <SidebarMenuItem key={href}><SidebarMenuButton asChild isActive={path === href} tooltip={label}>
          <Link href={href}><Icon className="h-4 w-4" /><span>{label}</span></Link>
        </SidebarMenuButton></SidebarMenuItem>)}</SidebarMenu></SidebarContent>
      <SidebarFooter><div className="space-y-2 p-3 group-data-[collapsible=icon]:hidden">
        <p className="text-xs font-medium text-teal-400">Free personal account</p>
        <p className="truncate text-sm">{user?.name}</p><p className="truncate text-xs text-muted-foreground">{user?.email}</p>
        <Button variant="ghost" size="sm" onClick={() => void signOut().catch(() => alert('Sign out failed. Please retry.'))}><LogOut className="mr-2 h-4 w-4" />Sign out</Button>
      </div><SidebarTrigger /></SidebarFooter><SidebarRail />
    </Sidebar>{children}
  </SidebarProvider>;
}
export default DashboardSidebar;
