// Agente 2A — Contact Deduplicator
// Hito 17A.3A — Deduplica candidatos Apollo contra el snapshot existente
// y contra otros candidatos del mismo run. Función pura: sin red, sin DB.

import type { ContactDuplicateStatus } from '@/modules/contact-enrichment/types';
import type { NormalizedApolloContact } from './contact-normalizer';

// ── Snapshot de deduplicación ──────────────────────────────────
// Subconjunto del summary.existing_contacts_snapshot.combined.

export interface DeduplicationSnapshot {
  existingEmails: string[];
  existingLinkedinUrls: string[];
  existingContactNames: string[];
}

export interface DeduplicatedContact extends NormalizedApolloContact {
  duplicateStatus: ContactDuplicateStatus;
}

export interface DeduplicationResult {
  /** Candidatos a insertar: no_match + possible_duplicate. */
  toInsert: DeduplicatedContact[];
  /** Candidatos exact_duplicate (se omiten de la inserción). */
  exactDuplicates: DeduplicatedContact[];
  noMatchCount: number;
  possibleDuplicateCount: number;
  exactDuplicateCount: number;
}

// ── Normalización de claves ────────────────────────────────────

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
    .replace(/\p{Diacritic}/gu, '') // quita acentos para comparar nombres
    .replace(/\s+/g, ' ');
  return k.length > 0 ? k : null;
}

function buildSet(values: string[], normalizer: (v: string) => string | null): Set<string> {
  const set = new Set<string>();
  for (const value of values) {
    const key = normalizer(value);
    if (key) set.add(key);
  }
  return set;
}

/**
 * Clasifica cada candidato como exact_duplicate, possible_duplicate o no_match
 * contra el snapshot existente y contra los candidatos ya vistos en este run.
 *
 * Reglas:
 *  - Email igual normalizado            → exact_duplicate
 *  - LinkedIn URL igual normalizada     → exact_duplicate
 *  - Nombre completo igual normalizado  → possible_duplicate
 *  - Sin match                          → no_match
 *  - Duplicado por email/LinkedIn dentro del mismo lote → exact_duplicate
 *  - Duplicado por nombre dentro del mismo lote          → possible_duplicate
 *
 * exact_duplicate NO se inserta; possible_duplicate y no_match sí.
 */
export function deduplicateContacts(
  candidates: NormalizedApolloContact[],
  snapshot: DeduplicationSnapshot,
): DeduplicationResult {
  const existingEmails = buildSet(snapshot.existingEmails ?? [], emailKey);
  const existingLinkedins = buildSet(snapshot.existingLinkedinUrls ?? [], linkedinKey);
  const existingNames = buildSet(snapshot.existingContactNames ?? [], nameKey);

  // Claves vistas en candidatos ya procesados del mismo run.
  const seenEmails = new Set<string>();
  const seenLinkedins = new Set<string>();
  const seenNames = new Set<string>();

  const toInsert: DeduplicatedContact[] = [];
  const exactDuplicates: DeduplicatedContact[] = [];
  let noMatchCount = 0;
  let possibleDuplicateCount = 0;
  let exactDuplicateCount = 0;

  for (const candidate of candidates) {
    const eKey = emailKey(candidate.email);
    const lKey = linkedinKey(candidate.linkedinUrl);
    const nKey = nameKey(candidate.fullName);

    const isExactByEmail = !!eKey && (existingEmails.has(eKey) || seenEmails.has(eKey));
    const isExactByLinkedin = !!lKey && (existingLinkedins.has(lKey) || seenLinkedins.has(lKey));
    const isPossibleByName = !!nKey && (existingNames.has(nKey) || seenNames.has(nKey));

    let duplicateStatus: ContactDuplicateStatus;
    if (isExactByEmail || isExactByLinkedin) {
      duplicateStatus = 'exact_duplicate';
    } else if (isPossibleByName) {
      duplicateStatus = 'possible_duplicate';
    } else {
      duplicateStatus = 'no_match';
    }

    // Registrar claves de este candidato para dedup intra-run de los siguientes.
    if (eKey) seenEmails.add(eKey);
    if (lKey) seenLinkedins.add(lKey);
    if (nKey) seenNames.add(nKey);

    const tagged: DeduplicatedContact = { ...candidate, duplicateStatus };

    if (duplicateStatus === 'exact_duplicate') {
      exactDuplicateCount += 1;
      exactDuplicates.push(tagged);
    } else {
      if (duplicateStatus === 'possible_duplicate') possibleDuplicateCount += 1;
      else noMatchCount += 1;
      toInsert.push(tagged);
    }
  }

  return {
    toInsert,
    exactDuplicates,
    noMatchCount,
    possibleDuplicateCount,
    exactDuplicateCount,
  };
}
