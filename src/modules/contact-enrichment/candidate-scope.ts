// Alcance comercial de «Por revisar», «Duplicados» y «Contactos rechazados».
//
// Un candidato nace de una búsqueda (`contact_enrichment_runs.triggered_by`). Con el alcance
// comercial encendido, cada quien ve los candidatos de las búsquedas que lanzó él o alguien de
// su alcance (un líder: su equipo; un admin: todo). Mismo contrato de ids que Empresas y
// Contactos: `null` = sin restricción, `[]` = nada, `[ids]` = búsquedas de esos usuarios.
//
// Módulo PURO: sin red ni DB, para poder probarlo con `node --test`.

import type { PendingContactCandidate } from './types';

/** Embebido del run en la proyección de candidatos (lo que la tabla necesita del run). */
export const CANDIDATE_RUN_EMBED_COLUMNS =
  'company_name, company_domain, account_id, hubspot_company_id';

/**
 * Embebido del run según el alcance. Con alcance se usa `!inner` y se trae `triggered_by`
 * para que el filtro `.in('run.triggered_by', ids)` descarte el candidato (no sólo vacíe el
 * run embebido, que es lo que hace PostgREST sin `!inner`).
 */
export function candidateRunEmbed(scoped: boolean): string {
  return scoped
    ? `run:contact_enrichment_runs!inner ( ${CANDIDATE_RUN_EMBED_COLUMNS}, triggered_by )`
    : `run:contact_enrichment_runs ( ${CANDIDATE_RUN_EMBED_COLUMNS} )`;
}

/** ¿Este candidato entra en el alcance? `scopeIds === null` ⇒ sin restricción. */
export function isCandidateRunInScope(
  triggeredBy: string | null | undefined,
  scopeIds: readonly string[] | null,
): boolean {
  if (scopeIds === null) return true;
  if (!triggeredBy) return false;
  return scopeIds.includes(triggeredBy);
}

function clean(value: string | null | undefined): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * País que muestra la tabla: el del contacto (lo trae Apollo, a veces Lusha) y, si falta, el de
 * su empresa. HubSpot no trae el país de la persona, así que ahí siempre sale el de la empresa.
 */
export function resolveCandidateCountry(
  candidate: Pick<PendingContactCandidate, 'contact_country' | 'account_country'>,
): { country: string | null; fromCompany: boolean } {
  const own = clean(candidate.contact_country);
  if (own) return { country: own, fromCompany: false };
  const company = clean(candidate.account_country);
  return { country: company, fromCompany: company !== null };
}

/** Lo que decide si una corrida de contactos es visible: quién la lanzó y de quién es la empresa. */
export interface ContactRunScopeFacts {
  triggered_by: string | null;
  account_owner_id: string | null;
  account_created_by: string | null;
}

/**
 * Acceso POR ID a una corrida (o a un candidato de esa corrida): visible si la lanzó alguien del
 * alcance o si su empresa es de alguien del alcance (misma regla que Empresas), para que el
 * dueño de una empresa vea las búsquedas que otros hicieron sobre ella. `null` ⇒ sin restricción.
 */
export function isContactRunInScope(
  facts: ContactRunScopeFacts | null,
  scopeIds: readonly string[] | null,
): boolean {
  if (scopeIds === null) return true;
  if (!facts) return false;
  return [facts.triggered_by, facts.account_owner_id, facts.account_created_by].some(
    (id) => id != null && scopeIds.includes(id),
  );
}
