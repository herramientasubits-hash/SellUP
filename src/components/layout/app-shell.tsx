"use client";

import type { User } from "@supabase/supabase-js";
import { cn } from "@/lib/utils";
import { AppHeader } from "@/components/layout/app-header";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { SidebarProvider } from "@/components/layout/sidebar-context";
import type { NavAccessContext } from "@/config/navigation";

interface AppShellProps {
  children: React.ReactNode;
  className?: string;
  user: User;
  initialUnreadCount?: number;
  navAccess: NavAccessContext;
}

function ShellLayout({ children, className, user, initialUnreadCount = 0, navAccess }: AppShellProps) {
  return (
    <div className="flex h-screen w-full bg-background overflow-hidden">
      {/* Sidebar — fixed icon-rail (80px), matching plantilla-proyectos-shadcn.
          Now hosts nav + user menu + notifications + theme toggle (no top header). */}
      <aside className="hidden shrink-0 md:flex md:flex-col w-20 bg-sidebar border-r border-sidebar-border/40 overflow-hidden">
        <AppSidebar user={user} initialUnreadCount={initialUnreadCount} navAccess={navAccess} />
      </aside>

      {/* Right column — header only on mobile (sidebar is hidden there),
          main content fills the rest. Main is a flex column that fills the
          viewport so pages can opt into fill-height layouts via
          <DataTablePage> (page header + metrics fixed, table scrolls). */}
      <div className="flex min-w-0 min-h-0 flex-1 flex-col">
        <div className="md:hidden">
          <AppHeader user={user} initialUnreadCount={initialUnreadCount} navAccess={navAccess} />
        </div>
        <main className={cn("flex flex-1 min-h-0 min-w-0 overflow-hidden flex-col", className)}>
          {/* overflow-y-auto aquí habilita scroll en páginas estándar (space-y-8).
              DataTablePage sigue funcionando porque flex-1 min-h-0 en sus hijos
              satura el contenedor y la tabla scrollea internamente. */}
          <div className="flex flex-1 min-h-0 overflow-y-auto flex-col mx-auto max-w-[1600px] w-full px-5 py-8 md:px-8 md:py-12 animate-su-fade-in">
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
