"use client";

import type { User } from "@supabase/supabase-js";
import { cn } from "@/lib/utils";
import { AppHeader } from "@/components/layout/app-header";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { SidebarProvider, useSidebar } from "@/components/layout/sidebar-context";

interface AppShellProps {
  children: React.ReactNode;
  className?: string;
  user: User;
  initialUnreadCount?: number;
}

function ShellLayout({ children, className, user, initialUnreadCount = 0 }: AppShellProps) {
  const { collapsed } = useSidebar();

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden">
      {/* Sidebar — full-height column, independent of the header */}
      <aside
        className={cn(
          "hidden shrink-0 bg-sidebar md:flex md:flex-col",
          "border-r border-sidebar-border/40",
          "transition-[width] duration-300 ease-[var(--ease-spring)] overflow-hidden",
          collapsed ? "w-[72px]" : "w-[256px]",
        )}
      >
        <AppSidebar user={user} />
      </aside>

      {/* Right column — header on top, main content below */}
      <div className="flex min-w-0 min-h-0 flex-1 flex-col">
        <AppHeader user={user} initialUnreadCount={initialUnreadCount} />
        <main className={cn("flex-1 min-h-0 min-w-0 overflow-y-auto", className)}>
          <div className="mx-auto h-full max-w-6xl p-5 md:p-8 animate-su-fade-in">
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
