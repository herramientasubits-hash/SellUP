// Agente 2A — Pending Candidate Cross-Run Duplicate Check
// Hito 17B.4X.7C.3H.3 — evita insertar un candidato pending_review duplicado
// de otro candidato ya pendiente de un run ANTERIOR de la misma cuenta.
//
// Bug corregido: el dedup existente (contact-deduplicator.ts) solo compara
// contra contacts oficiales (SellUp + HubSpot) y contra otros candidatos del
// MISMO run — nunca contra contact_enrichment_candidates pending_review de
// runs previos. Esto permitía que la misma persona quedara duplicada como
// pending_review dos veces (ver caso live Siesa / Camila Fino Morales).
//
// Señales de match (cualquiera basta, en este orden de prioridad):
//  A. email normalizado igual, si ambos candidatos tienen email.
//  B. linkedin_url normalizado igual, si ambos tienen LinkedIn.
//  C. source_contact_id igual + mismo proveedor (source).
//  D. full_name normalizado igual + title compatible (fallback prudente).
//     El scoping "misma cuenta" ya lo aplica el query de lectura (V1: solo
//     cuentas con account_id — ver readPendingCandidatesForSameAccount).
//
// Alcance V1: solo empresas con account_id (cuentas SellUp). Empresas
// HubSpot-only o manuales (sin account_id) quedan fuera de este check en
// este hito — ver recomendación de seguimiento en el reporte 17B.4X.7C.3H.3.
//
// Este módulo NO aprueba candidatos, NO crea contactos oficiales, NO escribe
// HubSpot, NO revela teléfonos, y NO modifica las filas pending_review
// existentes — solo evita insertar una fila nueva cuando ya hay una
// coincidencia pendiente.

import { createClient as createAdminClient, type SupabaseClient } from '@supabase/supabase-js';

export interface PendingCandidateRecord {
  id: string;
  email: string | null;
  linkedinUrl: string | null;
  sourceContactId: string | null;
  source: string;
  fullName: string;
  title: string | null;
}

export type PendingCandidateMatchReason =
  | 'email'
  | 'linkedin_url'
  | 'source_contact_id'
  | 'full_name_same_account';

export interface PendingCandidateMatch {
  candidateId: string;
  matchedBy: PendingCandidateMatchReason;
}

export interface CandidateForPendingCheck {
  email: string | null;
  linkedinUrl: string | null;
  sourceContactId: string | null;
  source: string;
  fullName: string;
  title: string | null;
}

// ── Normalización de claves (misma convención que contact-deduplicator.ts) ──

function emailKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const k = value.trim().toLowerCase();
  return k.length > 0 ? k : null;
}

function linkedinKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const k = value.trim().toLowerCase().replace(/\/+$/, '');
  return k.length > 0 ? k : null;
}

function nameKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const k = value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ');
  return k.length > 0 ? k : null;
}

function titleKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const k = value.trim().toLowerCase();
  return k.length > 0 ? k : null;
}

/**
 * Compara un candidato nuevo contra candidatos pending_review ya existentes
 * (de otros runs, ya filtrados por cuenta por el caller). Función pura.
 * Retorna el primer match encontrado, o null si no hay coincidencia.
 */
export function findMatchingPendingCandidate(
  candidate: CandidateForPendingCheck,
  existingPending: PendingCandidateRecord[],
): PendingCandidateMatch | null {
  if (existingPending.length === 0) return null;

  const eKey = emailKey(candidate.email);
  const lKey = linkedinKey(candidate.linkedinUrl);
  const nKey = nameKey(candidate.fullName);
  const tKey = titleKey(candidate.title);

  // A. Email normalizado igual.
  if (eKey) {
    const match = existingPending.find((existing) => emailKey(existing.email) === eKey);
    if (match) return { candidateId: match.id, matchedBy: 'email' };
  }

  // B. LinkedIn URL normalizada igual.
  if (lKey) {
    const match = existingPending.find((existing) => linkedinKey(existing.linkedinUrl) === lKey);
    if (match) return { candidateId: match.id, matchedBy: 'linkedin_url' };
  }

  // C. source_contact_id igual + mismo proveedor.
  if (candidate.sourceContactId) {
    const match = existingPending.find(
      (existing) =>
        existing.sourceContactId === candidate.sourceContactId && existing.source === candidate.source,
    );
    if (match) return { candidateId: match.id, matchedBy: 'source_contact_id' };
  }

  // D. Nombre completo igual + title compatible (fallback prudente).
  //    "Compatible" = coinciden, o al menos uno de los dos no tiene title
  //    registrado. Si ambos tienen title y son distintos, se asume que
  //    podrían ser personas homónimas distintas y NO se marca como match.
  if (nKey) {
    const match = existingPending.find((existing) => {
      if (nameKey(existing.fullName) !== nKey) return false;
      const existingTitleKey = titleKey(existing.title);
      return !tKey || !existingTitleKey || tKey === existingTitleKey;
    });
    if (match) return { candidateId: match.id, matchedBy: 'full_name_same_account' };
  }

  return null;
}

// ── DB reader (scoped a la misma cuenta) ────────────────────────

function getAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service credentials not configured');
  return createAdminClient(url, key);
}

interface PendingCandidateRow {
  id: string;
  email: string | null;
  linkedin_url: string | null;
  source_contact_id: string | null;
  source: string;
  full_name: string;
  title: string | null;
}

/**
 * Lee candidatos pending_review de OTROS runs (enrichment_run_id distinto al
 * actual) que pertenecen a la MISMA cuenta (account_id), vía join contra
 * contact_enrichment_runs. Alcance V1: si accountId es null (empresa
 * HubSpot-only o manual), retorna [] — no hay forma segura de acotar el
 * scope sin inventar una regla no solicitada en este hito.
 */
export async function readPendingCandidatesForSameAccount(
  accountId: string | null,
  excludeRunId: string,
): Promise<PendingCandidateRecord[]> {
  if (!accountId) return [];

  const admin = getAdminClient();
  const { data, error } = await admin
    .from('contact_enrichment_candidates')
    .select(
      'id, email, linkedin_url, source_contact_id, source, full_name, title, contact_enrichment_runs!inner(account_id)',
    )
    .eq('status', 'pending_review')
    .eq('contact_enrichment_runs.account_id', accountId)
    .neq('enrichment_run_id', excludeRunId);

  if (error || !data) return [];

  return (data as unknown as PendingCandidateRow[]).map((row) => ({
    id: row.id,
    email: row.email,
    linkedinUrl: row.linkedin_url,
    sourceContactId: row.source_contact_id,
    source: row.source,
    fullName: row.full_name,
    title: row.title,
  }));
}
