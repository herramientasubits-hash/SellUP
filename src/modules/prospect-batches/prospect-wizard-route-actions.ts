'use server';

/**
 * READ-ONLY dry-route verifier action — Q3F-5BB.10C3-FIX-1 (P1-3)
 *
 * Resolves — server-side, through the CANONICAL flag parsers — which provider
 * the "Generar con IA" wizard WOULD use for the given criteria, and whether that
 * path could reach Apollo. It runs NO provider, NO wizard execution, NO Lusha
 * search, and performs NO database write.
 *
 * Sole purpose: a pre-QA gate. It lets an operator confirm, without opening the
 * wizard in production, that a Lusha-eligible search with ENABLE_LUSHA_PREVIEW
 * off resolves to `blocked_lusha_disabled` / `wouldUseApollo: false` — the exact
 * invariant whose absence caused the 10C3 incident.
 *
 * Import discipline (proven by prospect-wizard-route-static.test.ts): this file
 * imports the pure route resolver, the canonical flag helpers, the auth gate,
 * and the read-only catalog loader — and NOTHING that can spend: no execution
 * action, no Lusha/Apollo/Tavily client, no DB-write helper. Its only reads are
 * the authenticated user (auth) and the active industry catalog (needed to map
 * industria → Lusha sector).
 */

import {
  isLushaPreviewEnabled,
  isProspectChatWizardExecutionEnabled,
} from '@/lib/feature-flags.server';
import { loadActiveCatalog } from '@/modules/industry-catalog/loader';
import { requireActiveUser } from '@/modules/prospect-batches/actions';
import {
  resolveProspectWizardRoute,
  type ProspectWizardRoute,
} from '@/modules/prospect-batches/prospect-wizard-route';
import type { WizardLushaCriteriaState } from '@/modules/prospect-batches/wizard-lusha-criteria';

export interface ResolveProspectWizardRouteActionInput {
  countryCode: string | null;
  industryId: string | null;
  subindustryIds: string[];
  additionalCriteriaRaw: string | null;
}

export type ResolveProspectWizardRouteActionResult =
  | { ok: true; route: ProspectWizardRoute }
  | { ok: false; code: 'UNAUTHORIZED' | 'CATALOG_UNAVAILABLE' };

export async function resolveProspectWizardRouteAction(
  input: ResolveProspectWizardRouteActionInput,
): Promise<ResolveProspectWizardRouteActionResult> {
  try {
    await requireActiveUser();
  } catch {
    return { ok: false, code: 'UNAUTHORIZED' };
  }

  let catalog;
  try {
    catalog = await loadActiveCatalog();
  } catch {
    return { ok: false, code: 'CATALOG_UNAVAILABLE' };
  }

  const criteria: WizardLushaCriteriaState = {
    countryCode: input.countryCode,
    industryId: input.industryId,
    subindustryIds: input.subindustryIds,
    additionalCriteriaRaw: input.additionalCriteriaRaw,
  };

  const route = resolveProspectWizardRoute({
    criteria,
    catalog,
    lushaPreviewEnabled: isLushaPreviewEnabled(),
    executionEnabled: isProspectChatWizardExecutionEnabled(),
  });

  return { ok: true, route };
}
