"use client";

import { cn } from "@/lib/utils";
import { AppHeader } from "@/components/layout/app-header";
import { AppSidebar } from "@/components/layout/app-sidebar";

interface AppShellProps {
  children: React.ReactNode;
  className?: string;
}

export function AppShell({ children, className }: AppShellProps) {
  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader />
      <div className="flex flex-1">
        <aside className="hidden w-64 border-r bg-background md:block">
          <AppSidebar />
        </aside>
        <main className={cn("flex-1 p-6", className)}>{children}</main>
      </div>
    </div>
  );
}
