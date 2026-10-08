// Contexto de la empresa asociada a cada candidato EN ESTE MOMENTO.
//
// El run guarda nombre, dominio y HubSpot ID de la empresa tal como estaban al buscar. La tabla
// de revisión ahora ofrece además la página web, que sólo vive en la cuenta SellUp, y la cuenta
// puede haber ganado dominio o HubSpot ID después del run (sincronización, reasignación). Aquí
// se mezclan las dos fuentes: lo que trae el candidato manda y la cuenta sólo llena lo vacío.
//
// Módulo PURO: sin red ni DB. La server action hace la lectura y llama a esta función.

import type { PendingContactCandidate } from './types';

export interface CandidateAccountContextRow {
  id: string;
  website: string | null;
  domain: string | null;
  hubspot_company_id: string | null;
}

function clean(value: string | null | undefined): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed.length > 0 ? trimmed : null;
}

/** Los `account_id` distintos y no vacíos de una lista de candidatos. */
export function collectCandidateAccountIds(candidates: readonly PendingContactCandidate[]): string[] {
  return Array.from(
    new Set(candidates.map((candidate) => clean(candidate.account_id)).filter((id): id is string => id !== null)),
  );
}

export function mergeCandidateAccountContext(
  candidates: readonly PendingContactCandidate[],
  accounts: readonly CandidateAccountContextRow[],
): PendingContactCandidate[] {
  const byId = new Map(accounts.map((account) => [account.id, account]));
  return candidates.map((candidate) => {
    const account = candidate.account_id ? byId.get(candidate.account_id) : undefined;
    if (!account) return { ...candidate, company_website: clean(candidate.company_website) };
    return {
      ...candidate,
      company_domain: clean(candidate.company_domain) ?? clean(account.domain),
      hubspot_company_id: clean(candidate.hubspot_company_id) ?? clean(account.hubspot_company_id),
      company_website: clean(candidate.company_website) ?? clean(account.website),
    };
  });
}
