'use server';

// Agente 2A — Automatic Routing Request Action (Hito 17B.4X.7C.5C)
//
// Wires the automatic Apollo→Lusha fallback orchestrator (17B.4X.7C.5B) to a
// new, explicit server action — WITHOUT touching the existing manual
// per-provider actions in actions.ts (runContactEnrichmentApolloForRequestAction /
// runContactEnrichmentLushaForRequestAction stay exactly as they were).
//
// LIVE WIRING (corrected by AGENT2A-LUSHA-LOCAL-REUSE-GATE-1). The original
// 17B.4X.7C.5C header said this action was not imported by any UI and that the
// wizard kept calling the manual per-provider actions. AGENT2-ROUTING-WIRE-1
// reversed that: the contact-enrichment wizard CTA now calls
// runAutomaticContactEnrichmentForRequestAction and no longer lets the user
// pick a provider (locked by automatic-routing-wiring-static.test.ts). What is
// still true is the flag gate: with ENABLE_CONTACT_ENRICHMENT_AUTOMATIC_ROUTING
// unset/false (the production default), this resolves to a pure no-op via the
// orchestrator's own flag check (contact-enrichment-routing-orchestrator.ts):
// no attempt is created, no provider is called, no telemetry is written.

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
