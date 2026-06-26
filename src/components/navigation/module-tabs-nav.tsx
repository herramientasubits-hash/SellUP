"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { TabsNav, type Tab } from "@/components/navigation/tabs-nav";

/**
 * Module-level pill switcher for the "Empresas" module.
 *
 * Surfaces the validated Empresas (`/accounts`) and Prospectos (`/prospects`)
 * experiences as sibling tabs without coupling their data flows: each tab is a
 * real route, so deep links, filters, and the Agente 1 flow stay intact.
 *
 * Reuses the shared <TabsNav> pill styling (Foundation § design tokens) — no
 * custom visual styles introduced.
 */
const MODULE_TABS: Tab[] = [
  { id: "empresas", label: "Empresas" },
  { id: "prospectos", label: "Prospectos" },
];

const TAB_ROUTES: Record<string, string> = {
  empresas: "/accounts",
  prospectos: "/prospects",
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
