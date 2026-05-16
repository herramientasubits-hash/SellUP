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
}

function ShellLayout({ children, className, user }: AppShellProps) {
  const { collapsed } = useSidebar();

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <AppHeader user={user} />
      <div className="flex flex-1">
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
        <main className={cn("flex-1 min-w-0 p-5 md:p-8", className)}>
          <div className="mx-auto max-w-6xl animate-su-fade-in">
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
