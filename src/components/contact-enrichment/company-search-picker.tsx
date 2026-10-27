'use client';

/**
 * Buscador de empresa compartido (SellUp + HubSpot).
 *
 * Es la búsqueda de «Reasignar empresa» (#602) separada del diálogo para reutilizarla también al
 * asociar el contacto encontrado por LinkedIn (F2). Busca por la ruta con tiempo límite
 * (`resolveCompanyViaRoute`) con la misma entrada que el AGENTE IA (`buildResolveInput`): un
 * HubSpot Company ID va por el camino de #587, un dominio o un nombre por el de siempre.
 *
 * Sólo se pueden elegir empresas reales de SellUp o HubSpot, nunca una «manual».
 */

import * as React from 'react';
import { Building2, Globe } from '@/icons';
import { OptionTile } from '@/components/selection/option-tile';
import { resolveCompanyViaRoute } from '@/modules/contact-enrichment/resolve-company-client';
import type { CompanyCandidate } from '@/modules/contact-enrichment/types';
import { buildResolveInput } from './contact-enrichment-chat-reducer';

/** Clave estable de una empresa en la lista de resultados (null = no se puede elegir). */
export function companyOptionKey(company: CompanyCandidate): string | null {
  if (company.source === 'sellup' && company.sellupAccountId) {
    return `sellup:${company.sellupAccountId}`;
  }
  if (company.source === 'hubspot' && company.hubspotCompanyId) {
    return `hubspot:${company.hubspotCompanyId}`;
  }
  return null;
}

function optionDescription(company: CompanyCandidate): string | undefined {
  const parts = [
    company.domain,
    company.country,
    company.hubspotCompanyId ? `HS: ${company.hubspotCompanyId}` : undefined,
  ].filter((p): p is string => Boolean(p));
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

export interface CompanySearchState {
  searching: boolean;
  searched: boolean;
  results: CompanyCandidate[];
  hubspotSkipped: boolean;
  error: string | null;
  selectedKey: string | null;
  selected: CompanyCandidate | null;
  setSelectedKey: (key: string | null) => void;
  setError: (error: string | null) => void;
  /** Busca `query` (o la entrada ya armada) y deja elegida la única coincidencia. */
  search: (query: string, input?: Record<string, string>) => Promise<void>;
  reset: () => void;
}

export function useCompanySearch(): CompanySearchState {
  const [searching, setSearching] = React.useState(false);
  const [searched, setSearched] = React.useState(false);
  const [results, setResults] = React.useState<CompanyCandidate[]>([]);
  const [hubspotSkipped, setHubspotSkipped] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [selectedKey, setSelectedKey] = React.useState<string | null>(null);

  async function search(query: string, input?: Record<string, string>) {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setError(null);
    setSelectedKey(null);
    try {
      const res = await resolveCompanyViaRoute(input ?? { ...buildResolveInput(q) });
      if (!res.success || !res.data) {
        setResults([]);
        setError(res.error ?? 'No fue posible buscar la empresa.');
      } else {
        const selectable = res.data.candidates.filter((c) => companyOptionKey(c) !== null);
        setResults(selectable);
        setHubspotSkipped(res.data.skippedHubSpot);
        if (selectable.length === 1) setSelectedKey(companyOptionKey(selectable[0]));
      }
    } catch {
      setResults([]);
      setError('No fue posible buscar la empresa. Intenta de nuevo.');
    } finally {
      setSearched(true);
      setSearching(false);
    }
  }

  function reset() {
    setSearched(false);
    setResults([]);
    setHubspotSkipped(false);
    setError(null);
    setSelectedKey(null);
  }

  const selected = results.find((c) => companyOptionKey(c) === selectedKey) ?? null;
  return { searching, searched, results, hubspotSkipped, error, selectedKey, selected, setSelectedKey, setError, search, reset };
}

interface CompanySearchResultsProps {
  state: CompanySearchState;
  query: string;
  disabled?: boolean;
  /** Qué pasa con una empresa de HubSpot sin cuenta en SellUp («al reasignar», «al crear»…). */
  hubspotSelectionNote: string;
}

/** Lista de resultados, avisos de «sin resultados» y de HubSpot caído. */
export function CompanySearchResults({ state, query, disabled, hubspotSelectionNote }: CompanySearchResultsProps) {
  const { searching, searched, results, hubspotSkipped, error, selectedKey, setSelectedKey } = state;
  return (
    <>
      {searching && <p className="text-xs text-muted-foreground">Buscando en SellUp y HubSpot…</p>}

      {!searching && results.length > 0 && (
        <div role="radiogroup" aria-label="Empresas encontradas" className="flex max-h-72 flex-col gap-1.5 overflow-y-auto">
          {results.map((company) => {
            const key = companyOptionKey(company) as string;
            return (
              <OptionTile
                key={key}
                option={{
                  value: key,
                  label: company.name,
                  description: optionDescription(company),
                  badge: company.source === 'sellup' ? 'SellUp' : 'HubSpot',
                  icon: company.source === 'sellup' ? Building2 : Globe,
                }}
                selected={selectedKey === key}
                disabled={disabled}
                onSelect={setSelectedKey}
              />
            );
          })}
        </div>
      )}

      {!searching && searched && results.length === 0 && !error && (
        <p className="text-xs text-muted-foreground">
          No encontramos empresas con «{query.trim()}» en SellUp ni en HubSpot. Prueba con el dominio o el
          HubSpot ID.
        </p>
      )}

      {!searching && searched && hubspotSkipped && (
        <p className="text-xs text-muted-foreground">
          HubSpot no respondió en esta búsqueda: solo se muestran resultados de SellUp.
        </p>
      )}

      {selectedKey?.startsWith('hubspot:') && <p className="text-xs text-muted-foreground">{hubspotSelectionNote}</p>}
    </>
  );
}
