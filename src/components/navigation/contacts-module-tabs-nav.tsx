"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { TabsNav, type Tab } from "@/components/navigation/tabs-nav";
import { CONTACTS_ROUTE, CONTACTS_CANDIDATES_ROUTE } from "@/config/navigation";

/**
 * Module-level pill switcher for the unified "Contactos" module (Hito 17A.4A).
 *
 * "Contactos aprobados" (`/contacts`, the official `contacts` table) and
 * "Candidatos por revisar" (`/contacts?tab=candidates`,
 * `contact_enrichment_candidates` en `pending_review`) son pills hermanas dentro
 * de un único módulo: cambiar de tab se queda en `/contacts` vía query param, sin
 * agregar item al sidebar. Cada tab renderiza su propio panel server, así que los
 * flujos de datos quedan desacoplados y el wizard conversacional permanece intacto.
 *
 * Reutiliza el styling de pills compartido <TabsNav> (Foundation § tokens) — sin
 * estilos visuales nuevos. Mismo patrón que <ModuleTabsNav> de Empresas/Prospectos.
 */
export type ContactsTabId = "approved" | "candidates";

const TAB_ROUTES: Record<ContactsTabId, string> = {
  approved: CONTACTS_ROUTE,
  candidates: CONTACTS_CANDIDATES_ROUTE,
};

interface ContactsModuleTabsNavProps {
  active: ContactsTabId;
}

export function ContactsModuleTabsNav({
  active,
}: ContactsModuleTabsNavProps) {
  const router = useRouter();

  // Pills limpias, sin badge de conteo (ajuste posterior a 17A.4A): el número
  // de candidatos generaba ruido visual y forzaba una query extra en el tab
  // por defecto. Las labels quedan simples; el routing por tab no cambia.
  const tabs: Tab[] = [
    { id: "approved", label: "Contactos aprobados" },
    { id: "candidates", label: "Candidatos por revisar" },
  ];

  return (
    <TabsNav
      tabs={tabs}
      activeTabId={active}
      onTabChange={(id) =>
        router.push(TAB_ROUTES[id as ContactsTabId] ?? CONTACTS_ROUTE)
      }
      className="bg-transparent px-0 py-0"
    />
  );
}
