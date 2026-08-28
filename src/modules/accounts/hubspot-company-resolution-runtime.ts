// Agente 2A — Orquestación: resolver la empresa HubSpot de una cuenta
// (AGENT2A-HUBSPOT-CONTACT-APPROVAL-AUTOSYNC)
//
// Sin red propia: todo lo que toca HubSpot o Supabase entra por `deps`. Delega la DECISIÓN en
// `classifyHubSpotCompanyResolution` (núcleo puro) y el ESTADO durable en
// `buildPendingMatchReviewMetadata`/`buildResolvedCompanyMetadata` — las MISMAS funciones de
// Task B2, nunca una segunda copia de sus claves. No busca por su cuenta: usa
// `deps.checkCompanyMatch`, que en producción ES `checkHubSpotCompanyCommercialStatus` sin
// cambios — la MISMA función que ya usa el flujo de prospectos.

import { classifyHubSpotCompanyResolution } from './hubspot-company-resolution-core';
import {
  buildPendingMatchReviewMetadata,
  buildResolvedCompanyMetadata,
} from './hubspot-company-resolution-state';
import type { HubspotMatchStatus } from '@/server/agents/prospecting-toolkit/structured-candidate-types';

export interface AccountForHubSpotResolution {
  id: string;
  name: string;
  domain: string | null;
  country: string | null;
  countryCode: string | null;
  city: string | null;
  region: string | null;
  taxIdentifier: string | null;
  legalName: string | null;
  companySize: string | null;
  hubspotCompanyId: string | null;
  metadata: Record<string, unknown> | null;
}

export interface HubSpotCompanyMatchCheck {
  hubspotMatchStatus: HubspotMatchStatus;
  match: {
    hubspotCompanyId: string;
    name: string | null;
    domain: string | null;
    matchMethod: string;
    confidence: number;
    reason: string;
  } | null;
}

export interface HubSpotCompanyResolutionDeps {
  loadAccount: (accountId: string) => Promise<AccountForHubSpotResolution | null>;
  checkCompanyMatch: (account: AccountForHubSpotResolution) => Promise<HubSpotCompanyMatchCheck>;
  createCompany: (
    account: AccountForHubSpotResolution,
  ) => Promise<{ ok: true; hubspotCompanyId: string } | { ok: false; error: string }>;
  updateAccount: (
    accountId: string,
    patch: { hubspot_company_id?: string; metadata: Record<string, unknown> },
  ) => Promise<void>;
  nowIso: string;
}

export type HubSpotCompanyResolutionOutcome =
  | { status: 'ready'; hubspotCompanyId: string }
  | { status: 'blocked' }
  | { status: 'pending_review' }
  | { status: 'failed'; reason: string }
  | { status: 'account_unavailable' };

export async function resolveAccountHubSpotCompany(
  accountId: string,
  deps: HubSpotCompanyResolutionDeps,
): Promise<HubSpotCompanyResolutionOutcome> {
  const account = await deps.loadAccount(accountId);
  if (!account) return { status: 'account_unavailable' };

  if (account.hubspotCompanyId) {
    return { status: 'ready', hubspotCompanyId: account.hubspotCompanyId };
  }

  const check = await deps.checkCompanyMatch(account);
  const classification = classifyHubSpotCompanyResolution({
    hubspotMatchStatus: check.hubspotMatchStatus,
  });

  if (classification.action === 'block_silent') return { status: 'blocked' };

  if (classification.action === 'pending_review') {
    // Defensivo: el clasificador dice `pending_review` basándose únicamente en
    // `hubspotMatchStatus`, pero el detalle del match viene de un campo separado
    // (`check.match`) que en teoría podría faltar si el checker está inconsistente consigo
    // mismo. No debería pasar en la práctica -- `checkHubSpotCompanyCommercialStatus` siempre
    // acompaña `possible_match_requires_review` con un `match` -- pero sin este resguardo
    // escribiríamos un `hubspot_pending_match` con datos ausentes en vez de fallar limpio.
    if (!check.match) return { status: 'blocked' };
    await deps.updateAccount(accountId, {
      metadata: buildPendingMatchReviewMetadata({
        existing: account.metadata,
        match: check.match,
        nowIso: deps.nowIso,
      }),
    });
    return { status: 'pending_review' };
  }

  // classification.action === 'create'
  const createResult = await deps.createCompany(account);
  if (!createResult.ok) return { status: 'failed', reason: createResult.error };

  await deps.updateAccount(accountId, {
    hubspot_company_id: createResult.hubspotCompanyId,
    metadata: {
      ...buildResolvedCompanyMetadata({ existing: account.metadata, nowIso: deps.nowIso }),
      hubspot_sync_source: 'contact_approval',
    },
  });
  return { status: 'ready', hubspotCompanyId: createResult.hubspotCompanyId };
}
