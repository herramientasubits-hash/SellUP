'use client';

import * as React from 'react';
import { Landmark } from '@/icons';
import { LATAM_COUNTRIES } from '@/modules/prospect-batches/types';
import { getFlagEmoji } from '@/components/accounts/account-form-helpers';
import type { SupplierReferenceSuggestion } from '@/server/prospect-batches/supplier-search/reference-suggestions';

/**
 * AGENT1-SUPPLIER-REFERENCE-SUGGEST-1 — entidades públicas sugeridas mientras se escribe
 * la referencia de «Proveedores de una empresa». Al elegir una, el nombre y el país
 * coinciden con lo que la búsqueda en compras públicas reconoce.
 */

/** Pausa al escribir antes de preguntar. */
const SUGGEST_DEBOUNCE_MS = 250;
const SUGGEST_MIN_CHARS = 3;

type SuggestState =
  | { status: 'idle'; items: readonly SupplierReferenceSuggestion[] }
  | { status: 'loading'; items: readonly SupplierReferenceSuggestion[] }
  | { status: 'ready'; items: readonly SupplierReferenceSuggestion[] };

/** Las sugerencias para lo escrito (vacío con menos de 3 letras o si la lectura falla). */
export function useSupplierReferenceSuggestions(text: string): SuggestState {
  // La última respuesta y para qué texto era; el estado visible se deriva de ella.
  const [answer, setAnswer] = React.useState<{ query: string; items: readonly SupplierReferenceSuggestion[] }>({
    query: '',
    items: [],
  });
  const query = text.trim();
  const active = query.length >= SUGGEST_MIN_CHARS;

  React.useEffect(() => {
    if (!active) return undefined;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetch(`/api/prospect-batches/supplier-reference-suggestions?q=${encodeURIComponent(query)}`, {
        signal: controller.signal,
        cache: 'no-store',
      })
        .then((response) => (response.ok ? response.json() : { suggestions: [] }))
        .then((body: { suggestions?: SupplierReferenceSuggestion[] }) => {
          setAnswer({ query, items: Array.isArray(body.suggestions) ? body.suggestions : [] });
        })
        .catch(() => {
          // Abortada por la siguiente tecla, o sin red: escribir el nombre sigue funcionando.
          if (!controller.signal.aborted) setAnswer({ query, items: [] });
        });
    }, SUGGEST_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [active, query]);

  if (!active) return { status: 'idle', items: [] };
  // Mientras llega la respuesta nueva se siguen viendo las anteriores (no parpadea).
  return answer.query === query ? { status: 'ready', items: answer.items } : { status: 'loading', items: answer.items };
}

const COUNTRY_NAMES = new Map(LATAM_COUNTRIES.map((country) => [country.code, country.name]));
const COUNT = new Intl.NumberFormat('es-CO');

function describeSuggestion(item: SupplierReferenceSuggestion): string {
  const country = COUNTRY_NAMES.get(item.countryCode) ?? item.countryCode;
  if (item.supplierCount === null) return `${country} · proveedores en vivo de SECOP II`;
  const suppliers = item.supplierCount === 1 ? '1 proveedor' : `${COUNT.format(item.supplierCount)} proveedores`;
  return `${country} · ${suppliers} en compras públicas`;
}

export function SupplierReferenceSuggestions({
  state,
  onPick,
}: {
  state: SuggestState;
  onPick: (item: SupplierReferenceSuggestion) => void;
}) {
  if (state.items.length === 0) {
    return state.status === 'loading' ? (
      <p className="text-xs text-muted-foreground" aria-live="polite">
        Buscando entidades públicas…
      </p>
    ) : null;
  }
  return (
    <div className="flex flex-col gap-1.5" data-testid="supplier-reference-suggestions">
      <p className="text-xs text-muted-foreground">
        Entidades públicas: sus proveedores salen gratis de las compras públicas, con el contrato como prueba.
      </p>
      <ul aria-label="Entidades públicas sugeridas" className="flex flex-col gap-1">
        {state.items.map((item) => (
          <li key={`${item.countryCode}:${item.name}`}>
            <button
              type="button"
              onClick={() => onPick(item)}
              className="flex w-full items-center gap-2.5 rounded-lg border border-border/60 bg-background px-2.5 py-2 text-left transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Landmark className="size-3.5" aria-hidden />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="line-clamp-2 break-words text-sm font-medium text-foreground" title={item.name}>
                  {item.name}
                </span>
                <span className="text-xs text-muted-foreground">
                  <span aria-hidden>{getFlagEmoji(item.countryCode)} </span>
                  {describeSuggestion(item)}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
