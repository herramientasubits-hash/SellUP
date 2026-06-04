"use client";

import type { User } from "@supabase/supabase-js";
import { cn } from "@/lib/utils";
import { AppHeader } from "@/components/layout/app-header";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { SidebarProvider } from "@/components/layout/sidebar-context";

interface AppShellProps {
  children: React.ReactNode;
  className?: string;
  user: User;
  initialUnreadCount?: number;
}

function ShellLayout({ children, className, user, initialUnreadCount = 0 }: AppShellProps) {
  return (
    <div className="flex h-screen w-full bg-background overflow-hidden">
      {/* Sidebar — fixed icon-rail (80px), matching plantilla-proyectos-shadcn.
          Now hosts nav + user menu + notifications + theme toggle (no top header). */}
      <aside className="hidden shrink-0 md:flex md:flex-col w-20 bg-sidebar border-r border-sidebar-border/40 overflow-hidden">
        <AppSidebar user={user} initialUnreadCount={initialUnreadCount} />
      </aside>

      {/* Right column — header only on mobile (sidebar is hidden there),
          main content fills the rest. Extra vertical padding for breathing room. */}
      <div className="flex min-w-0 min-h-0 flex-1 flex-col">
        <div className="md:hidden">
          <AppHeader user={user} initialUnreadCount={initialUnreadCount} />
        </div>
        <main className={cn("flex-1 min-h-0 min-w-0 overflow-y-auto", className)}>
          <div className="mx-auto max-w-[1600px] px-5 py-8 md:px-8 md:py-12 animate-su-fade-in">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

export function AppShell(props: AppShellProps) {
  return (
    <SidebarProvider>
      <ShellLayout {...props} />
    </SidebarProvider>
  );
}
