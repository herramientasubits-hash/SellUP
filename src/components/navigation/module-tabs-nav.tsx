"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { TabsNav, type Tab } from "@/components/navigation/tabs-nav";
import { ACCOUNTS_ROUTE, PROSPECTOS_TAB_ROUTE } from "@/config/navigation";

/**
 * Module-level pill switcher for the unified "Empresas" module.
 *
 * Empresas (`/accounts`) and Prospectos (`/accounts?tab=prospectos`) are sibling
 * pills inside a single module: switching tabs stays within `/accounts` via a
 * query param instead of navigating to a separate route. Their data flows remain
 * decoupled (each tab renders its own server panel), so deep links, filters, and
 * the Agente 1 flow stay intact.
 *
 * Reuses the shared <TabsNav> pill styling (Foundation § design tokens) — no
 * custom visual styles introduced.
 */
const MODULE_TABS: Tab[] = [
  { id: "empresas", label: "Empresas" },
  { id: "prospectos", label: "Prospectos" },
];

const TAB_ROUTES: Record<string, string> = {
  empresas: ACCOUNTS_ROUTE,
  prospectos: PROSPECTOS_TAB_ROUTE,
};

export type ModuleTabId = "empresas" | "prospectos";

interface ModuleTabsNavProps {
  active: ModuleTabId;
}

export function ModuleTabsNav({ active }: ModuleTabsNavProps) {
  const router = useRouter();

  return (
    <TabsNav
      tabs={MODULE_TABS}
      activeTabId={active}
      onTabChange={(id) => router.push(TAB_ROUTES[id] ?? TAB_ROUTES.empresas)}
      className="bg-transparent px-0 py-0"
    />
  );
}
