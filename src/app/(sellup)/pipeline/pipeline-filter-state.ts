"use client";

import * as React from "react";
import {
  PIPELINE_FILTER_PARAMS,
  serializePipelineFilters,
  type PipelineFilters,
} from "@/modules/pipeline/pipeline-filters";

/** Escribe los filtros en la URL de la pantalla, sin tocar lo demás (`view`, `account`). */
export type ReplaceFilterUrl = (filters: PipelineFilters) => void;

/** La URL actual con estos filtros en lugar de los que tuviera. */
export function urlWithFilters(href: string, filters: PipelineFilters): string {
  const url = new URL(href);
  for (const key of PIPELINE_FILTER_PARAMS) url.searchParams.delete(key);
  for (const [key, value] of Object.entries(serializePipelineFilters(filters))) url.searchParams.set(key, value);
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * Filtrar es instantáneo: no navega ni vuelve a pedir datos, solo reescribe los
 * parámetros con `history.replaceState` (Next lo sincroniza con sus
 * `searchParams`, como hace `UrlTabs`).
 */
const replaceInHistory: ReplaceFilterUrl = (filters) => {
  window.history.replaceState(null, "", urlWithFilters(window.location.href, filters));
};

/**
 * Los filtros del Pipeline con su copia en la URL, para compartir la vista y
 * que sobrevivan a recargar y a elegir empresa. Arrancan de lo que el servidor
 * leyó de la URL; cada cambio se aplica al momento y se escribe en ella.
 */
export function usePipelineUrlFilters(
  initial: PipelineFilters,
  replaceUrl: ReplaceFilterUrl = replaceInHistory,
): readonly [PipelineFilters, (next: PipelineFilters) => void] {
  const [filters, setFilters] = React.useState(initial);

  const update = React.useCallback(
    (next: PipelineFilters) => {
      setFilters(next);
      replaceUrl(next);
    },
    [replaceUrl],
  );

  return [filters, update] as const;
}
