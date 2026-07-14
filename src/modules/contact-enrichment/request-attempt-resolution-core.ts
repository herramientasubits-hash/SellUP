// Agente 2A — Request Attempt Resolution Core (Hito 17B.4X.7C.2)
//
// Pure decision logic for request-level provider actions: resolves which
// attemptId a runContactEnrichment{Apollo,Lusha}ForRequestAction should
// execute against. Creates attempt_order=1 via the injected creator; on
// already_exists, reuses the existing attempt ONLY when it has the SAME
// intended_provider and is NOT in a terminal status.
//
// This core MUST NOT create attempt_order=2, MUST NOT evaluate routing
// policy, MUST NOT call a provider, and MUST NOT write HubSpot. No
// Supabase, no network — persistence is injected so this stays testable
// without a database.

import type { AttemptCreationResult, IntendedProvider } from './request-attempt-types';
import type { ContactEnrichmentRunStatus } from './types';

export type ResolveAttemptForRequestRejectionReason =
  | 'invalid_request'
  | 'invalid_provider'
  | 'attempt_provider_mismatch'
  | 'attempt_terminal'
  | 'lookup_failed'
  | 'creation_failed';

export type ResolveAttemptForRequestOutcome =
  | { outcome: 'execute'; attemptId: string }
  | { outcome: 'rejected'; reason: ResolveAttemptForRequestRejectionReason; message: string };

export interface ExistingAttemptProviderAndStatus {
  intendedProvider: IntendedProvider | null;
  status: ContactEnrichmentRunStatus;
}

/**
 * Statuses an attempt cannot advance past — reusing one of these would be
 * indistinguishable from silently starting a new run under the old
 * attemptId. attempt_order=2 is the only sanctioned way to retry a
 * terminal attempt, and this core never creates one.
 */
const TERMINAL_ATTEMPT_STATUSES: ReadonlySet<ContactEnrichmentRunStatus> = new Set([
  'ready_for_review',
  'completed',
  'failed',
  'superseded',
]);

export interface ResolveAttemptForRequestDeps {
  createAttempt: (
    requestId: string,
    provider: IntendedProvider,
    triggeredBy: string,
  ) => Promise<AttemptCreationResult>;
  loadExistingAttempt: (attemptId: string) => Promise<ExistingAttemptProviderAndStatus | null>;
}

export async function resolveAttemptForRequestProvider(
  requestId: string,
  provider: IntendedProvider,
  triggeredBy: string,
  deps: ResolveAttemptForRequestDeps,
): Promise<ResolveAttemptForRequestOutcome> {
  const creation = await deps.createAttempt(requestId, provider, triggeredBy);

  if (creation.status === 'created') {
    if (!creation.attemptId) {
      return { outcome: 'rejected', reason: 'creation_failed', message: 'El intento se creó sin attemptId' };
    }
    return { outcome: 'execute', attemptId: creation.attemptId };
  }

  if (creation.status === 'invalid_request') {
    return { outcome: 'rejected', reason: 'invalid_request', message: 'La request de enriquecimiento no existe' };
  }

  if (creation.status === 'invalid_provider' || creation.status === 'invalid_attempt_order') {
    return {
      outcome: 'rejected',
      reason: 'invalid_provider',
      message: `Proveedor o orden de intento inválido (${creation.status})`,
    };
  }

  if (creation.status === 'rpc_error') {
    return {
      outcome: 'rejected',
      reason: 'creation_failed',
      message: creation.reason ?? 'Error creando el intento de enriquecimiento',
    };
  }

  // status === 'already_exists' — reuse only if same provider AND non-terminal.
  if (!creation.attemptId) {
    return { outcome: 'rejected', reason: 'creation_failed', message: 'El intento existente no tiene attemptId' };
  }

  const existing = await deps.loadExistingAttempt(creation.attemptId);
  if (!existing) {
    return { outcome: 'rejected', reason: 'lookup_failed', message: 'No se pudo leer el intento existente' };
  }

  if (existing.intendedProvider !== provider) {
    return {
      outcome: 'rejected',
      reason: 'attempt_provider_mismatch',
      message: `El intento 1 de esta request ya está asignado a ${existing.intendedProvider ?? 'otro proveedor'}`,
    };
  }

  if (TERMINAL_ATTEMPT_STATUSES.has(existing.status)) {
    return {
      outcome: 'rejected',
      reason: 'attempt_terminal',
      message: `El intento ya finalizó (estado: ${existing.status}); no se crea un segundo intento`,
    };
  }

  return { outcome: 'execute', attemptId: creation.attemptId };
}
