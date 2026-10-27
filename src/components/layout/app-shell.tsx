"use client";

import * as React from "react";
import type { User } from "@supabase/supabase-js";
import { cn } from "@/lib/utils";
import { AppHeader } from "@/components/layout/app-header";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { SidebarProvider, useSidebar } from "@/components/layout/sidebar-context";
import { ShellAgentPanelSlotProvider } from "@/components/layout/shell-agent-panel-slot";
import { NavAccessProvider } from "@/components/layout/nav-access-context";
import { AgentRunsProcessCenter } from "@/components/prospect-batches/agent-runs-tray/agent-runs-tray";
import type { NavAccessContext } from "@/config/navigation";

/**
 * Paso del menú al riel, como en el playground de UX: el hueco del menú y el
 * panel viajan juntos (ancho y posición) en 300ms con la curva del cajón, así
 * el contenido se corre sin brincos.
 */
const SIDEBAR_MOTION =
  "transition-[width,left] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none";

interface AppShellProps {
  children: React.ReactNode;
  className?: string;
  user: User;
  initialUnreadCount?: number;
  navAccess: NavAccessContext;
}

function ShellLayout({ children, className, user, initialUnreadCount = 0, navAccess }: AppShellProps) {
  const { collapsed } = useSidebar();
  // El ancla del panel del Agente IA. Es estado y no una ref: quien se porta a
  // ella tiene que volver a pintarse cuando el nodo exista.
  const [agentPanelSlot, setAgentPanelSlot] = React.useState<HTMLDivElement | null>(null);
  return (
    <ShellAgentPanelSlotProvider value={agentPanelSlot}>
      <div className="flex h-dvh w-full overflow-hidden bg-background">
        {/* Menú lateral — anatomía del playground de UX: panel de 288px que se
            pliega a un riel de iconos de 72px. Plegado, el hueco reserva los 72px
            del riel y el panel queda escondido justo detrás de él (su borde
            derecho en 72px); al abrir sale desde ahí y se estira hasta 288px. */}
        <div
          data-slot="sidebar-gap"
          className={cn("relative hidden shrink-0 md:block", SIDEBAR_MOTION, collapsed ? "w-18" : "w-72")}
        >
          <aside
            data-slot="sidebar-container"
            data-state={collapsed ? "collapsed" : "expanded"}
            className={cn(
              "absolute inset-y-0 flex w-72 flex-col border-r border-sidebar-border bg-sidebar",
              SIDEBAR_MOTION,
              collapsed ? "-left-54" : "left-0",
            )}
          >
            <AppSidebar navAccess={navAccess} />
          </aside>
        </div>

        {/* Columna derecha. Main es una columna flex que llena el alto: las
            páginas pueden optar por <DataTablePage> (cabecera y métricas fijas,
            la tabla desplaza). */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <AppHeader
            user={user}
            initialUnreadCount={initialUnreadCount}
            navAccess={navAccess}
            // Centro de procesos: las búsquedas del Agente IA viven en la
            // cabecera del shell para sobrevivir al chat (AGENT1-PARALLEL-RUNS-TRAY-1).
            processCenter={<AgentRunsProcessCenter className="max-sm:hidden" />}
          />
          <main className={cn("flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden", className)}>
            {/* overflow-y-auto habilita scroll en páginas estándar, en la caja de
                todo el ancho (la barra de scroll queda en el borde, no en medio).
                Dentro, el contenido mide como mucho 1440px y se centra. DataTablePage
                sigue funcionando porque flex-1 min-h-0 en sus hijos satura el
                contenedor y la tabla desplaza por dentro.

                El aire inferior es un espaciador y no un padding: esta caja mide
                lo que la ventana (min-h-0, para que la tabla pueda llenarla), así
                que en una página larga el contenido la desborda y un padding-bottom
                se quedaba a media página. La última tarjeta tocaba el borde. Como
                último hijo, el espaciador va siempre detrás del contenido. */}
            <div className="flex min-h-0 w-full flex-1 flex-col overflow-y-auto">
              {/* 24px de aire alrededor del contenido, como el marco del playground. */}
              <div className="mx-auto flex min-h-0 w-full max-w-360 flex-1 flex-col px-4 pt-6 sm:px-6 animate-su-fade-in">
                {children}
                <div aria-hidden className="h-6 shrink-0" />
              </div>
            </div>
          </main>
        </div>

        {/* Ranura del panel del Agente IA (Thema · `ShellAgentPanelSlot`). Es
            hermana de la columna de contenido: el panel que se porta aquí trae su
            propio ancho, así que montarlo ESTRECHA la página en vez de taparla.
            Vacía no ocupa nada. */}
        <div
          ref={setAgentPanelSlot}
          data-slot="shell-agent-panel"
          className="relative z-[51] flex h-full shrink-0 empty:hidden"
        />
      </div>
    </ShellAgentPanelSlotProvider>
  );
}

export function AppShell(props: AppShellProps) {
  return (
    <NavAccessProvider value={props.navAccess}>
      <SidebarProvider>
        <ShellLayout {...props} />
      </SidebarProvider>
    </NavAccessProvider>
  );
}
