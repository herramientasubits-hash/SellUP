// Agente 1 — «Contactos de otras fuentes» en la ficha de la empresa (Bryan 25-11).
//
// La pestaña «Contactos» de una empresa mostraba los aprobados y los de HubSpot que faltan, pero no
// lo que Apollo, Lusha y las demás fuentes trajeron y sigue esperando una decisión en el Agente 2A.
// Este bloque los lista para decidir desde la empresa:
//  - «Por revisar» (`pending_review`): Aprobar o Rechazar;
//  - «Posibles duplicados» (`duplicate`): Fusionar con el contacto existente o Rechazar.
// Los de fuente HubSpot NO salen aquí: tienen su propio bloque, «Contactos en HubSpot».
//
// La empresa de un candidato es la de su búsqueda (`run.account_id`), salvo que se haya
// reasignado a mano (`enrichment_metadata.company_reassignment`): esa manda. La server action
// ya aplica la reasignación al mapear; aquí sólo se compara con la empresa abierta.
//
// Módulo PURO: sin red ni DB. La server action hace las lecturas y llama a estas funciones.

import { isContactRunInScope, type ContactRunScopeFacts } from './candidate-scope';
import { isOpenCompanyChangeCandidate } from './official-contact-review-core';
import type { ContactCandidateStatus, PendingContactCandidate } from './types';

/** Estados que el bloque lista, en el orden en que se muestran. */
export const ACCOUNT_OTHER_SOURCES_STATUSES = ['pending_review', 'duplicate'] as const satisfies readonly ContactCandidateStatus[];

export type AccountOtherSourcesStatus = (typeof ACCOUNT_OTHER_SOURCES_STATUSES)[number];

/** Fuente que tiene su propio bloque en la ficha («Contactos en HubSpot»). */
export const ACCOUNT_OTHER_SOURCES_EXCLUDED_SOURCE = 'hubspot';

/** Tope por empresa: una empresa no debería acumular más; si pasa, se ven los más recientes. */
export const ACCOUNT_OTHER_SOURCES_LIMIT = 200;

/** El contacto aprobado con el que coincide un duplicado. */
export interface AccountOtherSourcesMatchedContact {
  id: string;
  fullName: string | null;
}

export interface AccountOtherSourceCandidate extends PendingContactCandidate {
  /** Sólo en duplicados (cuando la detección lo dejó escrito): con quién coincide. */
  matched_contact: AccountOtherSourcesMatchedContact | null;
}

/** Una fila ya mapeada, con lo necesario para decidir si se muestra. */
export interface AccountOtherSourcesRow {
  /** Proyección de revisión, con la reasignación de empresa ya aplicada. */
  candidate: PendingContactCandidate;
  /** Quién lanzó la búsqueda y de quién es su empresa (regla de alcance del 2A). */
  scopeFacts: ContactRunScopeFacts | null;
  /** `matched_contacts_id` del candidato. */
  matchedContactId: string | null;
}

function isListedStatus(status: ContactCandidateStatus): status is AccountOtherSourcesStatus {
  return (ACCOUNT_OTHER_SOURCES_STATUSES as readonly ContactCandidateStatus[]).includes(status);
}

function clean(value: string | null | undefined): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * ¿Lo puede ver quien mira? La MISMA regla que el acceso por id (`canSeeContactCandidate`): la
 * búsqueda la lanzó alguien de su alcance o la empresa de la búsqueda es de alguien de su alcance;
 * un cambio de empresa abierto lo ven todos mientras siga por revisar.
 */
export function isAccountOtherSourcesRowVisible(row: AccountOtherSourcesRow, scopeIds: readonly string[] | null): boolean {
  if (row.candidate.status === 'pending_review' && isOpenCompanyChangeCandidate(row.candidate.enrichment_metadata)) {
    return true;
  }
  return isContactRunInScope(row.scopeFacts, scopeIds);
}

/**
 * Los candidatos que el bloque muestra para `accountId`: de esa empresa (con la reasignación
 * aplicada), por revisar o duplicados, de cualquier fuente menos HubSpot y visibles para quien
 * mira. Sin repetidos (las dos lecturas, por búsqueda y por reasignación, se pueden solapar).
 * Primero «Por revisar» y después «Posibles duplicados»; dentro de cada grupo, el más reciente
 * primero.
 */
export function selectAccountOtherSourceCandidates(
  rows: readonly AccountOtherSourcesRow[],
  accountId: string,
  scopeIds: readonly string[] | null,
  matchedContactNames: ReadonlyMap<string, string | null> = new Map(),
  limit: number = ACCOUNT_OTHER_SOURCES_LIMIT,
): AccountOtherSourceCandidate[] {
  const targetAccountId = clean(accountId);
  if (!targetAccountId) return [];

  const seen = new Set<string>();
  const kept: AccountOtherSourceCandidate[] = [];
  for (const row of rows) {
    const candidate = row.candidate;
    if (!candidate?.id || seen.has(candidate.id)) continue;
    if (clean(candidate.account_id) !== targetAccountId) continue;
    if (!isListedStatus(candidate.status)) continue;
    if (candidate.source === ACCOUNT_OTHER_SOURCES_EXCLUDED_SOURCE) continue;
    if (!isAccountOtherSourcesRowVisible(row, scopeIds)) continue;
    seen.add(candidate.id);
    const matchedId = candidate.status === 'duplicate' ? clean(row.matchedContactId) : null;
    kept.push({
      ...candidate,
      matched_contact: matchedId ? { id: matchedId, fullName: clean(matchedContactNames.get(matchedId)) } : null,
    });
  }

  const statusRank = (status: ContactCandidateStatus) =>
    (ACCOUNT_OTHER_SOURCES_STATUSES as readonly ContactCandidateStatus[]).indexOf(status);
  kept.sort((a, b) => {
    const byStatus = statusRank(a.status) - statusRank(b.status);
    if (byStatus !== 0) return byStatus;
    return (b.created_at ?? '').localeCompare(a.created_at ?? '');
  });
  return kept.slice(0, Math.max(0, limit));
}

/** Los dos grupos del bloque, ya ordenados. */
export function groupAccountOtherSourceCandidates(candidates: readonly AccountOtherSourceCandidate[]): {
  pending: AccountOtherSourceCandidate[];
  duplicates: AccountOtherSourceCandidate[];
} {
  return {
    pending: candidates.filter((candidate) => candidate.status === 'pending_review'),
    duplicates: candidates.filter((candidate) => candidate.status === 'duplicate'),
  };
}

/** Los `matched_contacts_id` de los duplicados (para leer sus nombres de una vez). */
export function collectMatchedContactIds(rows: readonly AccountOtherSourcesRow[]): string[] {
  return Array.from(
    new Set(
      rows
        .filter((row) => row.candidate.status === 'duplicate')
        .map((row) => clean(row.matchedContactId))
        .filter((id): id is string => id !== null),
    ),
  );
}

// ── Qué hacer con el resultado de «Aprobar» desde la fila ────────────────────────

/** Lo que devuelve `approveContactCandidate`, reducido a lo que decide la fila. */
export interface AccountOtherSourcesApproveOutcomeInput {
  ok: boolean;
  duplicate?: boolean;
  code?: string;
}

/**
 * Aprobar desde la fila es de un clic, igual que «Traer» (Bryan 25-11). Sólo cuando el servidor
 * pide una decisión humana (discrepancia de identidad) se abre la ficha del candidato:
 *  - `approved`: quedó como contacto aprobado;
 *  - `duplicate`: el servidor lo marcó duplicado; pasa al grupo de duplicados del mismo bloque;
 *  - `needs_review`: hay que revisarlo en su ficha antes de aprobar;
 *  - `failed`: cualquier otro error (se avisa y la fila queda igual).
 */
export type AccountOtherSourcesApproveOutcome = 'approved' | 'duplicate' | 'needs_review' | 'failed';

export function classifyAccountOtherSourcesApprove(
  result: AccountOtherSourcesApproveOutcomeInput,
): AccountOtherSourcesApproveOutcome {
  if (result.ok) return 'approved';
  if (result.duplicate) return 'duplicate';
  if (result.code === 'IDENTITY_MISMATCH_REQUIRES_REVIEW' || result.code === 'IDENTITY_OVERRIDE_REASON_REQUIRED') {
    return 'needs_review';
  }
  return 'failed';
}
