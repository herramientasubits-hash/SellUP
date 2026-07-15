'use server';

// Agente 2A — Automatic Routing Request Action (Hito 17B.4X.7C.5C)
//
// Wires the automatic Apollo→Lusha fallback orchestrator (17B.4X.7C.5B) to a
// new, explicit server action — WITHOUT touching the existing manual
// per-provider actions in actions.ts (runContactEnrichmentApolloForRequestAction /
// runContactEnrichmentLushaForRequestAction stay exactly as they were).
//
// runAutomaticContactEnrichmentForRequestAction is not imported by any UI in
// this hito — the wizard and provider selector keep calling only the manual
// actions. With ENABLE_CONTACT_ENRICHMENT_AUTOMATIC_ROUTING unset/false (the
// production default), this resolves to a pure no-op via the orchestrator's
// own flag check (contact-enrichment-routing-orchestrator.ts): no attempt is
// created, no provider is called, no telemetry is written.

import { requireActiveUserForEnrichment } from './actions';
import {
  runAutomaticContactEnrichmentForRequestCore,
  type RunAutomaticContactEnrichmentForRequestResult,
} from './automatic-routing-action-core';

export async function runAutomaticContactEnrichmentForRequestAction(
  requestId: unknown,
): Promise<RunAutomaticContactEnrichmentForRequestResult> {
  const { internalUserId } = await requireActiveUserForEnrichment();
  return runAutomaticContactEnrichmentForRequestCore(requestId, internalUserId, new Date().toISOString());
}
