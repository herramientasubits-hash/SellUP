// Agente 2A — «Traer» un contacto de HubSpot = candidato de HubSpot aprobado al instante
// (AGENT2A-HUBSPOT-IMPORT-APPROVED-CANDIDATE, Bryan 17-11).
//
// Núcleo PURO (sin red, sin Supabase, sin sesión). Antes «Traer» insertaba el contacto directo
// en `contacts` y no quedaba ningún candidato detrás: sin `metadata.source_candidate_id` la ficha
// no podía ofrecer «Revelar teléfono», «Revelar correo» ni «Revelar LinkedIn», y lo revelado no
// tenía cómo llegar a HubSpot. Ahora «Traer» pasa por el MISMO camino que un candidato de
// «Primero HubSpot»: se crea el candidato y se aprueba con la aprobación de siempre (RPC 116).
//
// Orden de decisión (se detiene en el primero que aplica):
//   1. Ya hay en «Por revisar» un candidato de HubSpot de ESA empresa con ese ID de HubSpot →
//      se aprueba ESE (no se aprueba dos veces la misma persona).
//   2. La empresa ya tiene un contacto que la aprobación marcaría duplicado (correo, LinkedIn o,
//      sin ninguno de los dos, nombre) → camino de antes: se le pone el vínculo (o se crea).
//   3. Si no, corrida interna «Traído de HubSpot» (oculta en el historial de búsquedas) +
//      candidato + aprobación. Si algo falla, se borra el candidato a medio hacer y se usa el
//      camino de antes: «Traer» nunca queda peor que hoy.

import { findDuplicateContact, type ExistingContactForDedup } from './candidate-review-core';

/** `summary.entry_mode` de la corrida interna. No es una búsqueda: no sale en el historial. */
export const HUBSPOT_LOOKUP_IMPORT_ENTRY_MODE = 'hubspot_lookup_import' as const;
export const HUBSPOT_LOOKUP_IMPORT_HITO = 'AGENT2A-HUBSPOT-IMPORT-APPROVED-CANDIDATE' as const;

/** ¿Es la corrida interna de «Traer»? Se lee de `contact_enrichment_runs.summary`. */
export function isHubSpotLookupImportRunSummary(summary: unknown): boolean {
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return false;
  return (summary as Record<string, unknown>).entry_mode === HUBSPOT_LOOKUP_IMPORT_ENTRY_MODE;
}

/** Quita las corridas internas de «Traer» de una lista de corridas (historial, señales). */
export function withoutHubSpotLookupImportRuns<T extends { summary?: unknown }>(rows: readonly T[]): T[] {
  return rows.filter((row) => !isHubSpotLookupImportRunSummary(row.summary));
}

export interface HubSpotContactToImport {
  hubspotContactId: string;
  firstName: string | null;
  lastName: string | null;
  fullName: string;
  email: string | null;
  linkedinUrl: string | null;
  jobTitle: string | null;
}

export interface HubSpotImportAccount {
  id: string;
  name: string;
  domain: string | null;
  countryCode: string | null;
  hubspotCompanyId: string | null;
}

function clean(value: string | null | undefined): string | null {
  const v = typeof value === 'string' ? value.trim() : '';
  return v ? v : null;
}

/** Fila de la corrida interna (sin request: es una fila «legacy» válida para el CHECK de la 086). */
export function buildHubSpotLookupImportRunRow(input: {
  account: HubSpotImportAccount;
  triggeredBy: string;
  hubspotContactId: string;
}) {
  return {
    account_id: input.account.id,
    company_name: input.account.name,
    company_domain: clean(input.account.domain),
    company_country_code: clean(input.account.countryCode),
    hubspot_company_id: clean(input.account.hubspotCompanyId),
    status: 'completed' as const,
    triggered_by: input.triggeredBy,
    providers_used: [] as string[],
    summary: {
      entry_mode: HUBSPOT_LOOKUP_IMPORT_ENTRY_MODE,
      hubspot_contact_id: input.hubspotContactId,
      totalCandidates: 1,
      candidates_created: 1,
      hito: HUBSPOT_LOOKUP_IMPORT_HITO,
    },
  };
}

/**
 * El candidato, con la misma forma que los de «Primero HubSpot» (`hubspot-first-core.ts`).
 * Sin teléfono a propósito, igual que el «Traer» de antes: un número de HubSpot no tiene
 * procedencia de proveedor en SellUp; se sigue viendo en la pestaña HubSpot.
 */
export function buildHubSpotLookupImportCandidateRow(contact: HubSpotContactToImport, runId: string) {
  return {
    enrichment_run_id: runId,
    first_name: clean(contact.firstName),
    last_name: clean(contact.lastName),
    full_name: contact.fullName.trim(),
    title: clean(contact.jobTitle),
    seniority: null,
    department: null,
    country: null,
    linkedin_url: clean(contact.linkedinUrl),
    email: clean(contact.email)?.toLowerCase() ?? null,
    phone: null,
    source: 'hubspot' as const,
    source_contact_id: contact.hubspotContactId,
    matched_hubspot_contact_id: contact.hubspotContactId,
    // Es un registro real de HubSpot, no una inferencia de un proveedor.
    confidence: 1,
    status: 'pending_review' as const,
    duplicate_status: 'no_match' as const,
    enrichment_metadata: {
      hubspot_contact_id: contact.hubspotContactId,
      hubspot_lookup_import: true,
      hito: HUBSPOT_LOOKUP_IMPORT_HITO,
    },
  };
}

export interface ApproveOutcome {
  ok: boolean;
  contactId?: string;
  error?: string;
  duplicate?: boolean;
  code?: string;
}

export type HubSpotContactImportVia =
  | 'pending_candidate_approved'
  | 'new_candidate_approved'
  | 'existing_contact_linked'
  | 'legacy_direct';

export type HubSpotContactImportResult =
  | { ok: true; contactId: string; created: boolean; via: HubSpotContactImportVia; candidateId: string | null }
  | { ok: false; error: string };

export interface HubSpotContactImportDeps {
  /** Candidatos de HubSpot «Por revisar» de esta empresa con este ID de HubSpot (el más reciente primero). */
  findPendingCandidateIds: (accountId: string, hubspotContactId: string) => Promise<string[]>;
  loadAccountContacts: (accountId: string) => Promise<ExistingContactForDedup[]>;
  loadAccount: (accountId: string) => Promise<HubSpotImportAccount | null>;
  createRun: (row: ReturnType<typeof buildHubSpotLookupImportRunRow>) => Promise<string | null>;
  insertCandidate: (row: ReturnType<typeof buildHubSpotLookupImportCandidateRow>) => Promise<string | null>;
  /** La aprobación de siempre (`approveContactCandidate`). */
  approveCandidate: (candidateId: string) => Promise<ApproveOutcome>;
  /** Borra lo que se creó a medias (candidato y corrida) para que no aparezca en ninguna cola. */
  discardHalfDone: (input: { runId: string | null; candidateId: string | null }) => Promise<void>;
  /** El «Traer» de antes (`createOrLinkContactFromHubSpot`). */
  legacyCreateOrLink: () => Promise<{ success: true; id: string; created: boolean } | { success: false; error: string }>;
  log?: (event: string, detail: Record<string, unknown>) => void;
}

export const CONTACT_NOT_CREATED = 'Trajimos la empresa, pero no pudimos crear el contacto. Vuelve a intentarlo.';

const PENDING_NEEDS_REVIEW =
  'Este contacto está en «Por revisar» y necesita que lo revises antes de aprobarlo. Ábrelo desde «Por revisar».';

async function legacy(
  deps: HubSpotContactImportDeps,
  via: Extract<HubSpotContactImportVia, 'existing_contact_linked' | 'legacy_direct'>,
): Promise<HubSpotContactImportResult> {
  const saved = await deps.legacyCreateOrLink();
  if (!saved.success) {
    deps.log?.('legacy_failed', { error: saved.error });
    return { ok: false, error: CONTACT_NOT_CREATED };
  }
  return { ok: true, contactId: saved.id, created: saved.created, via, candidateId: null };
}

export async function runHubSpotContactImport(
  input: { accountId: string; triggeredBy: string; contact: HubSpotContactToImport },
  deps: HubSpotContactImportDeps,
): Promise<HubSpotContactImportResult> {
  const { accountId, contact } = input;
  const log = deps.log ?? (() => {});

  // 1. Ya esperaba revisión: se aprueba ese (la misma persona no se aprueba dos veces).
  const pending = await deps.findPendingCandidateIds(accountId, contact.hubspotContactId).catch(() => []);
  for (const candidateId of pending) {
    const approved = await deps.approveCandidate(candidateId);
    if (approved.ok && approved.contactId) {
      return { ok: true, contactId: approved.contactId, created: true, via: 'pending_candidate_approved', candidateId };
    }
    // Choca con un contacto que ya existe: la aprobación lo dejó como duplicado (sale de «Por
    // revisar»). Se sigue con el camino de antes, que vincula ese contacto.
    if (approved.duplicate) return legacy(deps, 'existing_contact_linked');
    // Necesita una decisión humana (identidad en duda): no se salta la revisión.
    if (approved.code === 'IDENTITY_MISMATCH_REQUIRES_REVIEW' || approved.code === 'IDENTITY_OVERRIDE_REASON_REQUIRED') {
      return { ok: false, error: PENDING_NEEDS_REVIEW };
    }
    log('pending_approve_failed', { candidateId, error: approved.error ?? null });
    return { ok: false, error: approved.error ?? 'No pudimos aprobar el contacto que estaba en «Por revisar».' };
  }

  // 2. La aprobación lo marcaría duplicado: se usa (y se vincula) el contacto que ya está.
  const existing = await deps.loadAccountContacts(accountId);
  const duplicate = findDuplicateContact(
    { email: contact.email, linkedin_url: contact.linkedinUrl, full_name: contact.fullName },
    existing,
  );
  if (duplicate) return legacy(deps, duplicate.matchedBy === 'email' ? 'existing_contact_linked' : 'legacy_direct');

  // 3. Corrida interna + candidato + la aprobación de siempre.
  const account = await deps.loadAccount(accountId);
  if (!account) return legacy(deps, 'legacy_direct');
  let runId: string | null = null;
  let candidateId: string | null = null;
  try {
    runId = await deps.createRun(
      buildHubSpotLookupImportRunRow({ account, triggeredBy: input.triggeredBy, hubspotContactId: contact.hubspotContactId }),
    );
    if (runId) candidateId = await deps.insertCandidate(buildHubSpotLookupImportCandidateRow(contact, runId));
    if (runId && candidateId) {
      const approved = await deps.approveCandidate(candidateId);
      if (approved.ok && approved.contactId) {
        return { ok: true, contactId: approved.contactId, created: true, via: 'new_candidate_approved', candidateId };
      }
      log('new_approve_failed', { candidateId, error: approved.error ?? null, duplicate: approved.duplicate === true });
    } else {
      log('create_failed', { runId, candidateId });
    }
  } catch (err) {
    log('create_threw', { error: err instanceof Error ? err.message : String(err) });
  }
  await deps.discardHalfDone({ runId, candidateId }).catch(() => {});
  return legacy(deps, 'legacy_direct');
}

/** Lo que le falta al contacto traído, para el aviso («Le faltan: correo · teléfono»). */
export function missingChannelsLabel(contact: { email: string | null; linkedinUrl: string | null; hasPhone: boolean }): string | null {
  const missing = [
    !clean(contact.email) ? 'correo' : null,
    !clean(contact.linkedinUrl) ? 'LinkedIn' : null,
    !contact.hasPhone ? 'teléfono' : null,
  ].filter((v): v is string => v !== null);
  return missing.length > 0 ? missing.join(' · ') : null;
}
