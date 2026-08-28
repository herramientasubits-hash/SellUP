// Agente 2A — Núcleo puro: resolver la revisión humana de un match HubSpot pendiente
// (AGENT2A-HUBSPOT-CONTACT-APPROVAL-AUTOSYNC, Task B5)
//
// Cuando el orquestador de Task B3 clasifica una empresa HubSpot como
// `possible_match_requires_review`, guarda el candidato en `metadata.hubspot_pending_match`
// (Task B2, `buildPendingMatchReviewMetadata`) y deja la cuenta sin `hubspot_company_id`. Un
// humano debe decidir: "sí, es la misma" (vincular el pendiente) o "no, es otra" (crear una
// empresa nueva en HubSpot). Reusa `buildResolvedCompanyMetadata` (la MISMA función de Task B2
// que usa el orquestador) para no duplicar la forma de la metadata — nunca reconstruye a mano
// el borrado de `hubspot_pending_match` ni las claves de `hubspot_sync_status`.

import { readPendingHubSpotMatch, buildResolvedCompanyMetadata } from './hubspot-company-resolution-state';

export interface ResolveHubSpotCompanyMatchDeps {
  loadAccount: (
    accountId: string,
  ) => Promise<{ id: string; metadata: Record<string, unknown> | null } | null>;
  updateAccount: (
    accountId: string,
    patch: { hubspot_company_id: string; metadata: Record<string, unknown> },
  ) => Promise<void>;
  createCompany: (
    accountId: string,
  ) => Promise<{ ok: true; hubspotCompanyId: string } | { ok: false; error: string }>;
  nowIso: string;
  /** Contactos `approved` de la cuenta cuyo sync a HubSpot esperaba esta resolución. */
  loadWaitingContacts: (accountId: string) => Promise<string[]>;
  /** Dispara el sync YA existente (Task E1) para un contacto — no reimplementa nada. */
  syncContact: (contactId: string) => Promise<void>;
}

export type ResolveHubSpotCompanyMatchDecision = 'same' | 'different';

export interface ResolveHubSpotCompanyMatchResult {
  ok: boolean;
  hubspotCompanyId: string | null;
}

export async function runResolveHubSpotCompanyMatch(
  input: { accountId: string; decision: ResolveHubSpotCompanyMatchDecision },
  deps: ResolveHubSpotCompanyMatchDeps,
): Promise<ResolveHubSpotCompanyMatchResult> {
  const account = await deps.loadAccount(input.accountId);
  if (!account) return { ok: false, hubspotCompanyId: null };

  const pending = readPendingHubSpotMatch(account.metadata);
  if (!pending) return { ok: false, hubspotCompanyId: null };

  let hubspotCompanyId: string;
  if (input.decision === 'same') {
    hubspotCompanyId = pending.hubspotCompanyId;
  } else {
    const created = await deps.createCompany(input.accountId);
    if (!created.ok) return { ok: false, hubspotCompanyId: null };
    hubspotCompanyId = created.hubspotCompanyId;
  }

  const metadata = {
    ...buildResolvedCompanyMetadata({ existing: account.metadata, nowIso: deps.nowIso }),
    hubspot_sync_source: 'contact_approval_review',
  };
  await deps.updateAccount(input.accountId, {
    hubspot_company_id: hubspotCompanyId,
    metadata,
  });

  const waitingContactIds = await deps.loadWaitingContacts(input.accountId);
  for (const contactId of waitingContactIds) {
    // Secuencial y no en paralelo: cada sync es una llamada real a HubSpot, y el orden no
    // importa pero saturar la API sí. Un fallo individual NO detiene el resto — cada llamada
    // ya es best-effort por sí misma (Task E1 nunca lanza, salvo el rechazo documentado de
    // `createSupabaseAdminClient()` — ver la nota de manejo de errores más abajo en este
    // archivo, en la server action).
    await deps.syncContact(contactId);
  }

  return { ok: true, hubspotCompanyId };
}
