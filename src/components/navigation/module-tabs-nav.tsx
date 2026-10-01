"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Archive, Building2, ClipboardCheck } from "@/icons";
import { TabsNav, type Tab } from "@/components/navigation/tabs-nav";
import {
  ACCOUNTS_ROUTE,
  PROSPECTOS_TAB_ROUTE,
  PROSPECTOS_DISCARDED_TAB_ROUTE,
} from "@/config/navigation";

/**
 * Las pestañas del módulo «Empresas».
 *
 * El módulo tiene una sola voz —«Empresas»— y tres vistas de la misma cosa
 * según dónde está cada empresa en su camino:
 *
 * - **Empresas** (`/accounts`): las ya aprobadas, que son cuentas de trabajo.
 * - **Por revisar** (`/accounts?tab=prospectos`): candidatas generadas o
 *   importadas que esperan una decisión.
 * - **Descartadas** (`/accounts?tab=prospectos&view=descartadas`): las que se
 *   quedaron fuera, por si hay que rescatar alguna.
 *
 * Antes se llamaban «Prospectos aprobados / Candidatos por revisar /
 * Descartadas» y el título de la página cambiaba a «Prospectos» según la
 * pestaña: tres nombres para el mismo módulo. Las rutas NO cambiaron — siguen
 * siendo query params sobre `/accounts`, así que los enlaces profundos, los
 * filtros y el flujo del Agente 1 quedan intactos.
 *
 * AGENT1-DISCARDED-TAB-PARITY-1 — «Descartadas» es hermana de las otras dos:
 * una sola fila de pestañas, sin pestañas dentro de pestañas.
 */
export type ModuleTabId = "empresas" | "prospectos" | "descartadas";

const TAB_ROUTES: Record<ModuleTabId, string> = {
  empresas: ACCOUNTS_ROUTE,
  prospectos: PROSPECTOS_TAB_ROUTE,
  descartadas: PROSPECTOS_DISCARDED_TAB_ROUTE,
};

interface ModuleTabsNavProps {
  active: ModuleTabId;
  /**
   * Cuántos registros hay en cada pestaña. Solo lo pasa la pantalla que ya
   * tiene el total en memoria (normalmente, el de su propia pestaña): ninguna
   * paga una consulta extra para pintar el contador de otra.
   */
  counts?: Partial<Record<ModuleTabId, number>>;
  /** Atajo histórico de `counts.descartadas`. */
  discardedCount?: number;
}

export function ModuleTabsNav({ active, counts, discardedCount }: ModuleTabsNavProps) {
  const router = useRouter();

  const tabs: Tab[] = [
    { id: "empresas", label: "Empresas", icon: Building2, count: counts?.empresas },
    { id: "prospectos", label: "Por revisar", icon: ClipboardCheck, count: counts?.prospectos },
    {
      id: "descartadas",
      label: "Descartadas",
      icon: Archive,
      count: counts?.descartadas ?? discardedCount,
    },
  ];

  return (
    <TabsNav
      aria-label="Vistas de empresas"
      role="navigation"
      tabs={tabs}
      activeTabId={active}
      onTabChange={(id) => router.push(TAB_ROUTES[id as ModuleTabId] ?? TAB_ROUTES.empresas)}
    />
  );
}
