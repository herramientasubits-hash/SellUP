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
    <div className="flex h-screen flex-col bg-background overflow-hidden">
      <AppHeader user={user} initialUnreadCount={initialUnreadCount} />
      <div className="flex flex-1 min-h-0">
        {/* Sidebar — deepest layer for visual depth */}
        <aside
          className={cn(
            "hidden shrink-0 border-r border-border/30 bg-sidebar md:flex md:flex-col",
            "transition-[width] duration-300 ease-[var(--ease-spring)] overflow-hidden",
            collapsed ? "w-[52px]" : "w-[220px]",
          )}
        >
          <AppSidebar />
        </aside>

        {/* Main content area */}
        <main className={cn("flex-1 min-h-0 min-w-0 overflow-y-auto", className)}>
          <div className="mx-auto max-w-6xl h-full p-5 md:p-8 animate-su-fade-in">
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
