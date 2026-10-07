/**
 * known-company-guard.ts — antes de que el rescate admita una empresa de
 * Descartadas con la web que Claude le encontró: ¿SellUp ya la tiene?
 *
 * AGENT1-RESCUE-KNOWN-COMPANY-GUARD-1. Prod 07-10, Ecuador × Retail (b899ce30):
 * Tavily trajo «Pycca» (pycca.com) y quedó duplicada (ya está en HubSpot). La
 * capa gratuita trajo «PYCCA S.A.»; Claude le encontró OTRA web (polipapel.com) y
 * el control de duplicados por esa web la dio por nueva: la misma empresa entró a
 * revisión. El control por web no ve lo que SellUp ya sabe por otro camino:
 *
 *   1. una candidata del MISMO lote con el mismo nombre base («Pycca» = «PYCCA
 *      S.A.»), en cualquier estado: si ya se descartó como duplicada, ésta también
 *      lo es;
 *   2. una candidata VIVA de cualquier lote con el mismo número fiscal.
 *
 * Puro: sin env, sin I/O. La lectura vive en `rescue-batch.server.ts`.
 */

import {
  BOLIVIA_LEGAL_FORMS,
  CENTRAL_AMERICA_LEGAL_FORMS,
  CHILE_LEGAL_FORMS,
  COLOMBIA_LEGAL_FORMS,
  COSTA_RICA_LEGAL_FORMS,
  MEXICO_LEGAL_FORMS,
  normalizeCompanyNameCore,
  PERU_LEGAL_FORMS,
  SPAIN_LEGAL_FORMS,
  URUGUAY_LEGAL_FORMS,
  US_LEGAL_FORMS,
} from '@/server/source-catalog/company-name-core';
import { EC_LEGAL_FORMS } from '@/server/source-catalog/connectors/ec-scvs/ec-company-name-core';
import type { DomainDuplicateCheck } from './domain-search';

/** Todas las formas societarias conocidas, las más largas primero («S A DE C V» antes que «S A»). */
const ALL_LEGAL_FORMS: readonly string[] = [
  ...new Set([
    ...CENTRAL_AMERICA_LEGAL_FORMS,
    ...PERU_LEGAL_FORMS,
    ...MEXICO_LEGAL_FORMS,
    ...COLOMBIA_LEGAL_FORMS,
    ...URUGUAY_LEGAL_FORMS,
    ...US_LEGAL_FORMS,
    ...SPAIN_LEGAL_FORMS,
    ...CHILE_LEGAL_FORMS,
    ...COSTA_RICA_LEGAL_FORMS,
    ...BOLIVIA_LEGAL_FORMS,
    ...EC_LEGAL_FORMS,
  ]),
].sort((a, b) => b.length - a.length);

/** Un nombre base demasiado corto («SA», «GM») no identifica a nadie. */
const MIN_NAME_CORE_LENGTH = 4;

/** Nombre base para comparar empresas: sin tildes, signos ni forma societaria. */
export function companyNameCoreForDuplicates(name: string | null | undefined): string {
  return normalizeCompanyNameCore(name, ALL_LEGAL_FORMS);
}

export type KnownCompanyRow = { name: string | null; tax_identifier: string | null; status: string | null };

/**
 * La coincidencia que hace a la empresa YA CONOCIDA, o `null` si sigue siendo nueva.
 * `batchRows`: candidatas del mismo lote (cualquier estado). `taxRows`: candidatas
 * vivas de cualquier lote con ese número fiscal.
 */
export function findKnownCompanyMatch(input: {
  names: readonly (string | null | undefined)[];
  taxId: string | null;
  batchRows: readonly KnownCompanyRow[];
  taxRows: readonly KnownCompanyRow[];
}): DomainDuplicateCheck | null {
  const taxId = input.taxId?.trim() || null;
  if (taxId) {
    const sameTax = input.taxRows.find((row) => row.tax_identifier?.trim() === taxId);
    if (sameTax) {
      return {
        status: 'existing_in_sellup',
        summary: `Ya existe en SellUp una candidata con el mismo número fiscal (${taxId}): «${sameTax.name ?? ''}».`,
      };
    }
  }
  const cores = new Set(
    input.names.map(companyNameCoreForDuplicates).filter((core) => core.length >= MIN_NAME_CORE_LENGTH),
  );
  if (cores.size === 0) return null;
  const sibling = input.batchRows.find((row) => cores.has(companyNameCoreForDuplicates(row.name)));
  if (!sibling) return null;
  return {
    status: 'existing_in_sellup',
    summary: `En esta misma búsqueda ya está «${sibling.name ?? ''}» (${sibling.status ?? 'sin estado'}): es la misma empresa.`,
  };
}
