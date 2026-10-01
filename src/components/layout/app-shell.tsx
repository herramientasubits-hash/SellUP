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
      {/* Sidebar — riel de iconos de Thema (SidebarIconRail): 64px, superficie
          clara con borde, no un bloque navy. Aloja navegación, cuenta,
          notificaciones y tema (no hay header superior en escritorio). */}
      <aside className="hidden w-16 shrink-0 overflow-hidden border-r border-border/60 bg-sidebar md:flex md:flex-col">
        <AppSidebar user={user} initialUnreadCount={initialUnreadCount} navAccess={navAccess} />
      </aside>

      {/* Right column — header only on mobile (sidebar is hidden there),
          main content fills the rest. Main is a flex column that fills the
          viewport so pages can opt into fill-height layouts via
          <DataTablePage> (page header + metrics fixed, table scrolls). */}
      <div className="page-atmosphere flex min-w-0 min-h-0 flex-1 flex-col">
        <div className="md:hidden">
          <AppHeader user={user} initialUnreadCount={initialUnreadCount} navAccess={navAccess} />
        </div>
        <main className={cn("flex flex-1 min-h-0 min-w-0 overflow-hidden flex-col", className)}>
          {/* overflow-y-auto aquí habilita scroll en páginas estándar (space-y-8).
              DataTablePage sigue funcionando porque flex-1 min-h-0 en sus hijos
              satura el contenedor y la tabla scrollea internamente. */}
          <div className="flex flex-1 min-h-0 overflow-y-auto flex-col mx-auto max-w-[1600px] w-full px-4 py-6 sm:px-6 lg:px-8 lg:py-8 animate-su-fade-in">
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
