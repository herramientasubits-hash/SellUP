"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ClipboardCheck, UserCheck } from "@/icons";
import { TabsNav, type Tab } from "@/components/navigation/tabs-nav";
import {
  CONTACTS_ROUTE,
  CONTACTS_CANDIDATES_ROUTE,
  CONTACTS_DUPLICATES_ROUTE,
} from "@/config/navigation";

/**
 * Las pestañas del módulo «Contactos» (Hito 17A.4A).
 *
 * Una sola voz —«Contactos»— y dos vistas: **Contactos** (`/contacts`, la tabla
 * oficial `contacts`) y **Por revisar** (`/contacts?tab=candidates`,
 * `contact_enrichment_candidates` en `pending_review`). Antes se llamaban
 * «Contactos aprobados» y "Candidatos por revisar"; la tabla de la segunda
 * vista conserva ese título. Cambiar de pestaña se queda en `/contacts` vía
 * query param, sin entrada propia en el menú lateral, y cada una pinta su panel
 * de servidor: los flujos de datos siguen desacoplados.
 *
 * La cola de duplicados (`?tab=duplicates`) conserva su ruta pero no tiene
 * pestaña: se llega a ella por enlace.
 */
export type ContactsTabId = "approved" | "candidates" | "duplicates";

const TAB_ROUTES: Record<ContactsTabId, string> = {
  approved: CONTACTS_ROUTE,
  candidates: CONTACTS_CANDIDATES_ROUTE,
  duplicates: CONTACTS_DUPLICATES_ROUTE,
};

interface ContactsModuleTabsNavProps {
  active: ContactsTabId;
  /**
   * Cuántos registros hay en cada pestaña. Solo lo pasa la pantalla que ya
   * tiene el total en memoria: el contador de la otra pestaña exigiría una
   * consulta extra y por eso no se pinta.
   */
  counts?: Partial<Record<ContactsTabId, number>>;
}

export function ContactsModuleTabsNav({ active, counts }: ContactsModuleTabsNavProps) {
  const router = useRouter();

  const tabs: Tab[] = [
    { id: "approved", label: "Contactos", icon: UserCheck, count: counts?.approved },
    { id: "candidates", label: "Por revisar", icon: ClipboardCheck, count: counts?.candidates },
  ];

  return (
    <TabsNav
      aria-label="Vistas de contactos"
      role="navigation"
      tabs={tabs}
      activeTabId={active}
      onTabChange={(id) =>
        router.push(TAB_ROUTES[id as ContactsTabId] ?? CONTACTS_ROUTE)
      }
    />
  );
}
