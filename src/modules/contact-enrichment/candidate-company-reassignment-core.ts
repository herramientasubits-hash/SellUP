// Agente 2A — Reasignar la empresa de un candidato (AGENT2A-CANDIDATE-COMPANY-REASSIGN-1)
//
// Problema que resuelve: un candidato cuyo run no quedó vinculado a ninguna cuenta SellUp ni a
// una empresa de HubSpot (p. ej. `juvenal.lavin@pizzapizza.cl` en «Pizza Pizza», sin cuenta) no
// se podía aprobar — `runApproveCandidate` devuelve `MSG.noAccount` y no había salida en la UI.
//
// Decisión de diseño: la reasignación es POR CANDIDATO y vive en
// `enrichment_metadata.company_reassignment`. NO se toca `contact_enrichment_runs`:
//  - un run puede tener varios candidatos y mover la empresa del run movería a todos;
//  - no hace falta migración (la columna jsonb ya existe).
// Las proyecciones de revisión y de aprobación aplican el override con
// `applyCandidateCompanyReassignment`, de modo que la aprobación encuentra `account_id` y
// sigue su camino normal (dedupe por cuenta + transacción atómica 4O-H3).
//
// Este archivo es PURO: sin red, sin DB, sin auth. Las server actions inyectan las deps.

import { checkCompanyConsistency } from '@/server/agents/contact-enrichment-toolkit/company-consistency-checker';
import type { CompanyCandidate, ContactCandidateCompanyConsistency } from './types';

export const CANDIDATE_COMPANY_REASSIGNMENT_KEY = 'company_reassignment' as const;

/** El contexto de empresa que un candidato hereda de su run. */
export interface CandidateCompanyContext {
  account_id: string | null;
  hubspot_company_id: string | null;
  company_name: string | null;
  company_domain: string | null;
  country_code?: string | null;
}

export type CompanyReassignmentSelectedSource = 'sellup' | 'hubspot';

/** Lo que queda escrito en `enrichment_metadata.company_reassignment`. */
export interface CandidateCompanyReassignmentV1 {
  version: 1;
  /** Siempre resuelto: la reasignación nunca deja un candidato sin cuenta SellUp. */
  account_id: string;
  hubspot_company_id: string | null;
  company_name: string;
  company_domain: string | null;
  country_code: string | null;
  /** De dónde salió la empresa elegida en la búsqueda. */
  selected_source: CompanyReassignmentSelectedSource;
  /**
   * Cómo se obtuvo la cuenta: `selected_sellup_account` cuando se eligió una cuenta SellUp, o
   * el `outcome` de `resolveOrCreateAccountForHubSpotCandidate` (existing_by_hubspot,
   * existing_by_domain, existing_by_domain_linked, created) cuando se eligió en HubSpot.
   */
  account_resolution: string;
  reassigned_by: string;
  reassigned_at: string;
  /** Contexto del run ANTES de la primera reasignación. No se pisa en reasignaciones sucesivas. */
  original: {
    account_id: string | null;
    hubspot_company_id: string | null;
    company_name: string | null;
    company_domain: string | null;
  };
  /** Consistencia de empresa antes de la primera reasignación (para auditoría). */
  original_company_consistency: ContactCandidateCompanyConsistency | null;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function optString(v: unknown): string | null {
  return isNonEmptyString(v) ? v.trim() : null;
}

/**
 * Lee la reasignación persistida. Fail-closed: cualquier forma inesperada ⇒ `null`, es decir,
 * el candidato se comporta exactamente como antes de este hito.
 */
export function readCandidateCompanyReassignment(
  metadata: unknown,
): CandidateCompanyReassignmentV1 | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const raw = (metadata as Record<string, unknown>)[CANDIDATE_COMPANY_REASSIGNMENT_KEY];
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.version !== 1) return null;
  if (!isNonEmptyString(r.account_id) || !isNonEmptyString(r.company_name)) return null;
  const source: CompanyReassignmentSelectedSource =
    r.selected_source === 'hubspot' ? 'hubspot' : 'sellup';
  const original = (r.original && typeof r.original === 'object'
    ? r.original
    : {}) as Record<string, unknown>;
  return {
    version: 1,
    account_id: r.account_id.trim(),
    hubspot_company_id: optString(r.hubspot_company_id),
    company_name: r.company_name.trim(),
    company_domain: optString(r.company_domain),
    country_code: optString(r.country_code),
    selected_source: source,
    account_resolution: optString(r.account_resolution) ?? 'unknown',
    reassigned_by: optString(r.reassigned_by) ?? 'unknown',
    reassigned_at: optString(r.reassigned_at) ?? '',
    original: {
      account_id: optString(original.account_id),
      hubspot_company_id: optString(original.hubspot_company_id),
      company_name: optString(original.company_name),
      company_domain: optString(original.company_domain),
    },
    original_company_consistency:
      (r.original_company_consistency as ContactCandidateCompanyConsistency | null | undefined) ??
      null,
  };
}

/**
 * Aplica la reasignación (si existe) sobre el contexto de empresa heredado del run. Devuelve el
 * MISMO objeto si no hay reasignación válida. `country_code` sólo se sobrescribe cuando la
 * proyección lo trae y la reasignación tiene uno.
 */
export function applyCandidateCompanyReassignment<T extends CandidateCompanyContext>(
  base: T,
  metadata: unknown,
): T {
  const reassignment = readCandidateCompanyReassignment(metadata);
  if (!reassignment) return base;
  const next: T = {
    ...base,
    account_id: reassignment.account_id,
    hubspot_company_id: reassignment.hubspot_company_id,
    company_name: reassignment.company_name,
    company_domain: reassignment.company_domain,
  };
  if ('country_code' in base && reassignment.country_code) {
    next.country_code = reassignment.country_code;
  }
  return next;
}

// ── Selección que llega del cliente ─────────────────────────────

/**
 * Lo ÚNICO que se acepta del navegador: qué empresa se eligió, por su id. Nombre, dominio y
 * país se vuelven a leer en el servidor — nunca se confía en lo que pinta el cliente.
 */
export type CompanyReassignmentSelection =
  | { source: 'sellup'; sellupAccountId: string }
  | { source: 'hubspot'; hubspotCompanyId: string };

export function parseCompanyReassignmentSelection(
  raw: unknown,
): CompanyReassignmentSelection | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.source === 'sellup' && isNonEmptyString(r.sellupAccountId)) {
    return { source: 'sellup', sellupAccountId: r.sellupAccountId.trim() };
  }
  if (r.source === 'hubspot' && isNonEmptyString(r.hubspotCompanyId)) {
    const id = r.hubspotCompanyId.trim();
    if (!/^\d+$/.test(id)) return null;
    return { source: 'hubspot', hubspotCompanyId: id };
  }
  return null;
}

/**
 * Elige, entre los resultados de la re-resolución en el servidor, la empresa que corresponde a
 * la selección. Para HubSpot se prefiere una cuenta SellUp ya vinculada a ese id (evita crear
 * una cuenta duplicada).
 */
export function pickReassignmentCompany(
  selection: CompanyReassignmentSelection,
  candidates: readonly CompanyCandidate[],
): CompanyCandidate | null {
  if (selection.source === 'sellup') {
    return (
      candidates.find(
        (c) => c.source === 'sellup' && c.sellupAccountId === selection.sellupAccountId,
      ) ?? null
    );
  }
  const linked = candidates.find(
    (c) =>
      c.source === 'sellup' &&
      isNonEmptyString(c.sellupAccountId) &&
      c.hubspotCompanyId === selection.hubspotCompanyId,
  );
  if (linked) return linked;
  return (
    candidates.find(
      (c) => c.source === 'hubspot' && c.hubspotCompanyId === selection.hubspotCompanyId,
    ) ?? null
  );
}

// ── Orquestación ────────────────────────────────────────────────

export interface ReassignableCandidate {
  id: string;
  status: string;
  email: string | null;
  enrichment_metadata: Record<string, unknown>;
  /** Contexto de empresa del RUN, sin aplicar ninguna reasignación previa. */
  run: CandidateCompanyContext;
}

export interface ReassignCandidateCompanyDeps {
  actorId: string;
  nowIso: string;
  loadCandidate: (id: string) => Promise<ReassignableCandidate | null>;
  /** Re-resolución autoritativa en el servidor (SellUp y, si aplica, HubSpot — sólo lectura). */
  resolveCompany: (selection: CompanyReassignmentSelection) => Promise<CompanyCandidate | null>;
  /** Busca/vincula/crea la cuenta SellUp para una empresa que sólo existe en HubSpot. */
  resolveOrCreateAccount: (args: {
    hubspot_company_id: string;
    company_name: string | null;
    company_domain: string | null;
    country_code: string | null;
  }) => Promise<{ accountId: string; outcome: string } | { error: string }>;
  /**
   * Escribe la metadata nueva SÓLO si el candidato sigue en `pending_review`. Devuelve
   * `updated: false` si otra decisión ganó la carrera.
   */
  writeCandidateMetadata: (
    candidateId: string,
    metadata: Record<string, unknown>,
  ) => Promise<{ updated: boolean; error?: string }>;
}

export type ReassignCandidateCompanyErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'NOT_PENDING'
  | 'COMPANY_NOT_FOUND'
  | 'ACCOUNT_RESOLUTION_FAILED'
  | 'WRITE_FAILED';

export type ReassignCandidateCompanyResult =
  | { ok: true; reassignment: CandidateCompanyReassignmentV1; unchanged: boolean }
  | { ok: false; code: ReassignCandidateCompanyErrorCode; error: string };

export const REASSIGN_MSG: Record<ReassignCandidateCompanyErrorCode, string> = {
  INVALID_INPUT: 'Selecciona una empresa de SellUp o HubSpot para reasignar.',
  NOT_FOUND: 'No encontramos este candidato.',
  NOT_PENDING: 'Solo se puede reasignar la empresa de un candidato pendiente de revisión.',
  COMPANY_NOT_FOUND:
    'No pudimos confirmar la empresa seleccionada en SellUp ni en HubSpot. Vuelve a buscarla.',
  ACCOUNT_RESOLUTION_FAILED: 'No fue posible vincular la empresa a una cuenta SellUp.',
  WRITE_FAILED: 'No fue posible guardar la nueva empresa del candidato.',
};

function fail(code: ReassignCandidateCompanyErrorCode, error?: string): ReassignCandidateCompanyResult {
  return { ok: false, code, error: error ?? REASSIGN_MSG[code] };
}

/**
 * Recalcula la consistencia de empresa contra la NUEVA empresa, conservando la evidencia de
 * organización del proveedor que ya teníamos (no se llama a ningún proveedor).
 */
export function recomputeCompanyConsistency(args: {
  email: string | null;
  previous: ContactCandidateCompanyConsistency | null;
  companyName: string;
  companyDomain: string | null;
}): ContactCandidateCompanyConsistency {
  return checkCompanyConsistency({
    email: args.email,
    apolloOrganizationName: args.previous?.organization_name ?? null,
    apolloOrganizationWebsiteUrl: args.previous?.organization_domain ?? null,
    companyDomain: args.companyDomain,
    companyName: args.companyName,
  });
}

export async function runReassignCandidateCompany(
  candidateId: unknown,
  rawSelection: unknown,
  deps: ReassignCandidateCompanyDeps,
): Promise<ReassignCandidateCompanyResult> {
  if (!isNonEmptyString(candidateId)) return fail('INVALID_INPUT');
  const selection = parseCompanyReassignmentSelection(rawSelection);
  if (!selection) return fail('INVALID_INPUT');

  const candidate = await deps.loadCandidate(candidateId.trim());
  if (!candidate) return fail('NOT_FOUND');
  if (candidate.status !== 'pending_review') return fail('NOT_PENDING');

  const company = await deps.resolveCompany(selection);
  if (!company || !isNonEmptyString(company.name)) return fail('COMPANY_NOT_FOUND');

  let accountId: string;
  let accountResolution: string;
  if (company.source === 'sellup' && isNonEmptyString(company.sellupAccountId)) {
    accountId = company.sellupAccountId;
    accountResolution = 'selected_sellup_account';
  } else if (company.source === 'hubspot' && isNonEmptyString(company.hubspotCompanyId)) {
    const resolved = await deps.resolveOrCreateAccount({
      hubspot_company_id: company.hubspotCompanyId,
      company_name: company.name,
      company_domain: company.domain ?? null,
      country_code: company.countryCode ?? null,
    });
    if ('error' in resolved) return fail('ACCOUNT_RESOLUTION_FAILED', resolved.error);
    accountId = resolved.accountId;
    accountResolution = resolved.outcome;
  } else {
    return fail('COMPANY_NOT_FOUND');
  }

  const metadata = candidate.enrichment_metadata ?? {};
  const previous = readCandidateCompanyReassignment(metadata);
  const effective = applyCandidateCompanyReassignment(candidate.run, metadata);
  const unchanged = effective.account_id === accountId;

  const currentConsistency =
    (metadata.company_consistency as ContactCandidateCompanyConsistency | null | undefined) ?? null;
  const originalConsistency = previous
    ? previous.original_company_consistency
    : currentConsistency;

  const reassignment: CandidateCompanyReassignmentV1 = {
    version: 1,
    account_id: accountId,
    hubspot_company_id: optString(company.hubspotCompanyId),
    company_name: company.name.trim(),
    company_domain: optString(company.domain),
    country_code: optString(company.countryCode),
    selected_source: selection.source,
    account_resolution: accountResolution,
    reassigned_by: deps.actorId,
    reassigned_at: deps.nowIso,
    original: previous
      ? previous.original
      : {
          account_id: candidate.run.account_id,
          hubspot_company_id: candidate.run.hubspot_company_id,
          company_name: candidate.run.company_name,
          company_domain: candidate.run.company_domain,
        },
    original_company_consistency: originalConsistency,
  };

  const nextMetadata: Record<string, unknown> = {
    ...metadata,
    company_consistency: recomputeCompanyConsistency({
      email: candidate.email,
      previous: originalConsistency,
      companyName: reassignment.company_name,
      companyDomain: reassignment.company_domain,
    }),
    [CANDIDATE_COMPANY_REASSIGNMENT_KEY]: reassignment,
  };

  const written = await deps.writeCandidateMetadata(candidate.id, nextMetadata);
  if (written.error) return fail('WRITE_FAILED');
  if (!written.updated) return fail('NOT_PENDING');

  return { ok: true, reassignment, unchanged };
}
