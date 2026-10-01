"use client";

import type { User } from "@supabase/supabase-js";
import { cn } from "@/lib/utils";
import { AppHeader } from "@/components/layout/app-header";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { SidebarProvider, useSidebar } from "@/components/layout/sidebar-context";
import type { NavAccessContext } from "@/config/navigation";

interface AppShellProps {
  children: React.ReactNode;
  className?: string;
  user: User;
  initialUnreadCount?: number;
  navAccess: NavAccessContext;
}

function ShellLayout({ children, className, user, initialUnreadCount = 0, navAccess }: AppShellProps) {
  const { collapsed } = useSidebar();
  return (
    <div className="flex h-dvh w-full overflow-hidden bg-background">
      {/* Menú lateral — anatomía de Thema: panel de 240px con marca y nombres,
          que se contrae a un riel de iconos de 64px. Superficie clara con borde. */}
      <aside
        className={cn(
          "hidden shrink-0 overflow-hidden border-r border-border/60 bg-sidebar md:flex md:flex-col",
          collapsed ? "w-16" : "w-60",
        )}
      >
        <AppSidebar navAccess={navAccess} />
      </aside>

      {/* Columna derecha — la atmósfera cubre cabecera y contenido, para que el
          halo del tema baje desde arriba sin un escalón donde acaba la cabecera.
          Main es una columna flex que llena el alto: las páginas pueden optar por
          <DataTablePage> (cabecera y métricas fijas, la tabla desplaza). */}
      <div className="page-atmosphere flex min-h-0 min-w-0 flex-1 flex-col">
        <AppHeader user={user} initialUnreadCount={initialUnreadCount} navAccess={navAccess} />
        <main className={cn("flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden", className)}>
          {/* overflow-y-auto habilita scroll en páginas estándar. DataTablePage
              sigue funcionando porque flex-1 min-h-0 en sus hijos satura el
              contenedor y la tabla desplaza por dentro. */}
          <div className="mx-auto flex min-h-0 w-full max-w-[1600px] flex-1 flex-col overflow-y-auto px-4 py-6 sm:px-6 lg:px-8 lg:py-8 animate-su-fade-in">
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
