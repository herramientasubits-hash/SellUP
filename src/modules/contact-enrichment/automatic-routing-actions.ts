'use server';

// Agente 2A — Automatic Routing Request Action (Hito 17B.4X.7C.5C)
//
// Wires the automatic Apollo→Lusha fallback orchestrator (17B.4X.7C.5B) to a
// new, explicit server action — WITHOUT touching the existing manual
// per-provider actions in actions.ts (runContactEnrichmentApolloForRequestAction /
// runContactEnrichmentLushaForRequestAction stay exactly as they were).
//
// LIVE WIRING (corrected by AGENT2A-LOCAL-REVIEWABLE-CANDIDATE-REUSE-1). The original
// 17B.4X.7C.5C header said this action was not imported by any UI and that the
// wizard kept calling the manual per-provider actions. AGENT2-ROUTING-WIRE-1
// reversed that: the contact-enrichment wizard CTA now calls
// runAutomaticContactEnrichmentForRequestAction and no longer lets the user
// pick a provider (locked by automatic-routing-wiring-static.test.ts). What is
// still true is the flag gate: with ENABLE_CONTACT_ENRICHMENT_AUTOMATIC_ROUTING
// unset/false — the CODE default when the env var is absent, which is NOT a
// claim about the value Production currently sets — this resolves to a pure
// no-op via the orchestrator's own flag check
// (contact-enrichment-routing-orchestrator.ts): no attempt is created, no
// provider is called, no telemetry is written.

import { createClient } from '@/lib/supabase/server';
import { requireActiveUserForEnrichment } from './actions';
import { canSeeContactEnrichmentRequest } from './candidate-scope.server';
import { completeContactSearch } from './contact-search-follow-up.server';
import {
  runAutomaticContactEnrichmentForRequestCore,
  type RunAutomaticContactEnrichmentForRequestResult,
} from './automatic-routing-action-core';

export async function runAutomaticContactEnrichmentForRequestAction(
  requestId: unknown,
): Promise<RunAutomaticContactEnrichmentForRequestResult> {
  const { internalUserId } = await requireActiveUserForEnrichment();
  // Alcance comercial: una solicitud ajena se trata como id inválido — el núcleo corta antes de
  // crear intentos o llamar proveedores, así que no gasta créditos.
  const allowed = await canSeeContactEnrichmentRequest(await createClient(), requestId);
  const result = await runAutomaticContactEnrichmentForRequestCore(
    allowed ? requestId : null,
    internalUserId,
    new Date().toISOString(),
  );
  // Contactos de HubSpot completos → Contactos; conteo de «Por revisar» anterior (Bryan 29-10).
  return allowed && typeof requestId === 'string' ? completeContactSearch(requestId.trim(), result) : result;
}
