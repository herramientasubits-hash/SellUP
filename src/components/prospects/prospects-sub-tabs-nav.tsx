"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { TabsNav, type Tab } from "@/components/navigation/tabs-nav";
import { PROSPECTOS_TAB_ROUTE, PROSPECTOS_DISCARDED_TAB_ROUTE } from "@/config/navigation";

/**
 * AGENT1-DISCARDED-PROSPECTS-REVIEW-1 — sub-tab pill switcher inside
 * Prospectos: "Por revisar" (default queue) ⇄ "Descartadas" (issue #389).
 * Same pattern as <ContactsModuleTabsNav>: query-param routing via the
 * shared <TabsNav>, no new visual styling.
 */
export type ProspectsSubTabId = "por_revisar" | "descartadas";

const SUB_TAB_ROUTES: Record<ProspectsSubTabId, string> = {
  por_revisar: PROSPECTOS_TAB_ROUTE,
  descartadas: PROSPECTOS_DISCARDED_TAB_ROUTE,
};

interface ProspectsSubTabsNavProps {
  active: ProspectsSubTabId;
  discardedCount?: number;
}

export function ProspectsSubTabsNav({ active, discardedCount }: ProspectsSubTabsNavProps) {
  const router = useRouter();

  const tabs: Tab[] = [
    { id: "por_revisar", label: "Por revisar" },
    { id: "descartadas", label: "Descartadas", count: discardedCount },
  ];

  return (
    <TabsNav
      tabs={tabs}
      activeTabId={active}
      onTabChange={(id) =>
        router.push(SUB_TAB_ROUTES[id as ProspectsSubTabId] ?? PROSPECTOS_TAB_ROUTE)
      }
      className="bg-transparent px-0 py-0"
    />
  );
}
