"use client";

/**
 * A quién se le cotiza: la empresa de HubSpot (Rubén Candia, 24-11: «que busque
 * la empresa de HS; al final es esa la que se cotiza»).
 *
 * Se escribe el nombre y se elige la empresa de HubSpot. Si esa empresa ya está
 * en SellUp y la persona la puede ver, la cotización queda ligada también a la
 * empresa de SellUp. Si no aparece en HubSpot, lo escrito queda como nombre del
 * cliente. Usa la consulta de HubSpot de solo lectura (`/api/hubspot-lookup`).
 */

import { useEffect, useState } from "react";
import { Search, X } from "@/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { HubSpotCompanyHit, HubSpotSearchResult } from "@/modules/hubspot-lookup/types";

export interface QuoteClientRef {
  name: string;
  /** Empresa de HubSpot elegida (`null` = nombre escrito a mano). */
  hubspotCompanyId: string | null;
  /** La misma empresa en SellUp, si la persona la puede ver. */
  accountId: string | null;
}

export const EMPTY_CLIENT: QuoteClientRef = { name: "", hubspotCompanyId: null, accountId: null };

const MIN_QUERY = 2;

function detailOf(company: HubSpotCompanyHit): string {
  return [company.domain, company.country, company.ownerName ? `de ${company.ownerName}` : null].filter(Boolean).join(" · ");
}

export function QuoteClientPicker({ value, onChange }: { value: QuoteClientRef; onChange: (value: QuoteClientRef) => void }) {
  const [results, setResults] = useState<HubSpotCompanyHit[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "unavailable">("idle");
  const [open, setOpen] = useState(false);
  const searching = !value.hubspotCompanyId && value.name.trim().length >= MIN_QUERY;
  const shown = searching ? results : [];

  useEffect(() => {
    if (!searching) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setStatus("loading");
      try {
        const response = await fetch(`/api/hubspot-lookup?op=search&q=${encodeURIComponent(value.name.trim())}`, {
          signal: controller.signal,
        });
        const data = (await response.json()) as HubSpotSearchResult;
        if (data.status === "ok") {
          setResults(data.companies.slice(0, 8));
          setStatus("idle");
        } else {
          setResults([]);
          setStatus("unavailable");
        }
      } catch {
        if (!controller.signal.aborted) setStatus("unavailable");
      }
    }, 300);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [value.name, searching]);

  if (value.hubspotCompanyId) {
    return (
      <div className="flex h-10 items-center justify-between gap-2 rounded-lg border border-border px-3 text-sm">
        <span className="min-w-0 truncate text-foreground">
          {value.name}
          <span className="ml-2 text-xs text-muted-foreground">HubSpot{value.accountId ? " · en SellUp" : ""}</span>
        </span>
        <Button variant="ghost" size="icon-sm" onClick={() => onChange(EMPTY_CLIENT)} aria-label="Cambiar la empresa">
          <X />
        </Button>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          value={value.name}
          onChange={(event) => {
            setOpen(true);
            onChange({ name: event.target.value, hubspotCompanyId: null, accountId: null });
          }}
          onFocus={() => setOpen(true)}
          // Se cierra un instante después: si se pulsa un resultado, el clic llega primero.
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(event) => event.key === "Escape" && setOpen(false)}
          placeholder="Buscar la empresa en HubSpot"
          aria-label="Cliente: empresa en HubSpot"
        />
      </div>
      {open && searching && (shown.length > 0 || status !== "idle") && (
        <ul className="absolute inset-x-0 top-full z-10 mt-1 max-h-60 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-card">
          {status === "loading" && shown.length === 0 && <li className="px-2 py-1.5 text-sm text-muted-foreground">Buscando en HubSpot…</li>}
          {status === "unavailable" && (
            <li className="px-2 py-1.5 text-sm text-muted-foreground">HubSpot no responde ahora: queda el nombre que escribiste.</li>
          )}
          {shown.map((company) => (
            <li key={company.id}>
              <button
                type="button"
                className="w-full rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-muted focus-visible:bg-muted"
                onClick={() =>
                  onChange({
                    name: company.name,
                    hubspotCompanyId: company.id,
                    accountId: company.sellup.status === "visible" ? company.sellup.id : null,
                  })
                }
              >
                <span className="block text-foreground">{company.name}</span>
                {detailOf(company) && <span className="block text-xs text-muted-foreground">{detailOf(company)}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
