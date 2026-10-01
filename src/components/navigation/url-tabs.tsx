"use client";

import * as React from "react";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export interface UrlTab {
  id: string;
  label: string;
  /** Cuántos registros hay dentro; se pinta junto al nombre si es mayor que 0. */
  count?: number;
}

export interface UrlTabsProps {
  tabs: readonly UrlTab[];
  /** Lo que venga en la URL. Si no coincide con ninguna pestaña, gana la primera. */
  initialTab?: string;
  /** Nombre del parámetro de la URL donde vive la pestaña. */
  paramName?: string;
  /** Cómo se anuncia el grupo de pestañas a un lector de pantalla. */
  ariaLabel: string;
  /** Los `TabsContent`, uno por pestaña. */
  children: React.ReactNode;
  className?: string;
}

function resolveTab(tabs: readonly UrlTab[], candidate: string | undefined): string {
  const fallback = tabs[0]?.id ?? "";
  return tabs.some((tab) => tab.id === candidate) ? (candidate as string) : fallback;
}

/**
 * UrlTabs — las pestañas del sistema (`Tabs`) con la pestaña puesta guardada en
 * la URL, para que un enlace compartido o una recarga abran la misma vista.
 *
 * Cambiar de pestaña es instantáneo: no navega ni vuelve a pedir datos, solo
 * reescribe el parámetro con `history.replaceState` (Next lo sincroniza con
 * `useSearchParams`, así que los filtros que escriben en la URL lo conservan).
 * La primera pestaña es la de por defecto y no ensucia la URL.
 *
 * @example
 * <UrlTabs ariaLabel="Secciones" initialTab={params.tab} tabs={[{ id: "resumen", label: "Resumen" }]}>
 *   <TabsContent value="resumen">…</TabsContent>
 * </UrlTabs>
 */
export function UrlTabs({
  tabs,
  initialTab,
  paramName = "tab",
  ariaLabel,
  children,
  className,
}: UrlTabsProps) {
  const [active, setActive] = React.useState(() => resolveTab(tabs, initialTab));
  const defaultTab = tabs[0]?.id ?? "";

  // Un enlace de la propia página (`?tab=contactos`) llega como un `initialTab`
  // nuevo: se adopta al cambiar, sin pisar lo que la persona eligió a mano.
  const [adoptedInitialTab, setAdoptedInitialTab] = React.useState(initialTab);
  if (adoptedInitialTab !== initialTab) {
    setAdoptedInitialTab(initialTab);
    setActive(resolveTab(tabs, initialTab));
  }

  const handleChange = React.useCallback(
    (value: unknown) => {
      const next = resolveTab(tabs, typeof value === "string" ? value : undefined);
      setActive(next);

      const url = new URL(window.location.href);
      if (next === defaultTab) {
        url.searchParams.delete(paramName);
      } else {
        url.searchParams.set(paramName, next);
      }
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    },
    [tabs, defaultTab, paramName],
  );

  return (
    <Tabs value={active} onValueChange={handleChange} className={className}>
      <TabsList aria-label={ariaLabel} className="mb-4">
        {tabs.map((tab) => (
          <TabsTrigger key={tab.id} value={tab.id}>
            {tab.label}
            {tab.count !== undefined && tab.count > 0 && (
              <span className="rounded-full bg-surface-muted px-1.5 text-xs font-semibold tabular-nums text-muted-foreground">
                {tab.count}
              </span>
            )}
          </TabsTrigger>
        ))}
      </TabsList>
      {children}
    </Tabs>
  );
}
