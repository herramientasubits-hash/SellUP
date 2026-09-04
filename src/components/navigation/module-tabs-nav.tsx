"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { TabsNav, type Tab } from "@/components/navigation/tabs-nav";
import {
  ACCOUNTS_ROUTE,
  PROSPECTOS_TAB_ROUTE,
  PROSPECTOS_DISCARDED_TAB_ROUTE,
} from "@/config/navigation";

/**
 * Module-level pill switcher for the unified "Empresas" module.
 *
 * Empresas (`/accounts`), Prospectos (`/accounts?tab=prospectos`) y Descartadas
 * (`/accounts?tab=prospectos&view=descartadas`) son pills hermanas dentro de un
 * único módulo: cambiar de pestaña se queda en `/accounts` vía query params en
 * vez de navegar a una ruta distinta. Sus flujos de datos siguen desacoplados
 * (cada pestaña renderiza su propio panel de servidor), así que deep links,
 * filtros y el flujo de Agente 1 quedan intactos.
 *
 * AGENT1-DISCARDED-TAB-PARITY-1 — "Descartadas" era una sub-pestaña DENTRO de
 * Prospectos (una segunda fila de pills bajo la primera). Se promovió a este
 * mismo nivel: una sola fila de pestañas, sin pestañas dentro de pestañas. La
 * ruta no cambió (`view=descartadas`), así que los deep links existentes siguen
 * funcionando.
 *
 * Reuses the shared <TabsNav> pill styling (Foundation § design tokens) — no
 * custom visual styles introduced.
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
   * Conteo mostrado sobre la pill "Descartadas". Sólo lo pasa el panel que ya
   * tiene el total en memoria (la propia pestaña Descartadas): ninguna otra
   * pantalla paga una query extra sólo para pintar un badge.
   */
  discardedCount?: number;
}

export function ModuleTabsNav({ active, discardedCount }: ModuleTabsNavProps) {
  const router = useRouter();

  const tabs: Tab[] = [
    { id: "empresas", label: "Prospectos aprobados" },
    { id: "prospectos", label: "Candidatos por revisar" },
    { id: "descartadas", label: "Descartadas", count: discardedCount },
  ];

  return (
    <TabsNav
      tabs={tabs}
      activeTabId={active}
      onTabChange={(id) => router.push(TAB_ROUTES[id as ModuleTabId] ?? TAB_ROUTES.empresas)}
      className="bg-transparent px-0 py-0"
    />
  );
}
