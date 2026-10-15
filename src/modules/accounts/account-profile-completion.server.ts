// ACCOUNT-PROFILE-COMPLETION-1 — Completar país e industria de una empresa y sincronizar con HubSpot
//
// Cada vez que una empresa nace de HubSpot (o se vincula a una), se intenta completar lo que
// le falta: el país (gratis, de lo que ya tiene o del dominio) y la industria (Claude lee el
// sitio oficial; tiene costo y respeta el tope de «Presupuesto y créditos»). Lo completado se
// escribe también en HubSpot, sólo en los campos que allá estén vacíos, para que ambos lados
// queden iguales. Nunca lanza: la aprobación o la búsqueda de contactos ya terminó.

import { after } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { checkProviderQuotaAvailable } from '@/modules/budgets/budget-resolution';
import { resolveMacroIndustryByDisplayName } from '@/modules/macro-industry-catalog/macro-industries';
import { logProviderUsage } from '@/modules/usage-tracking/logging';
import { mapCountryToCode } from '@/server/agents/contact-enrichment-toolkit/company-resolver-core';
import {
  classifyCompanyLive,
  loadClassifierCatalog,
  resolveActiveAnthropicModel,
} from '@/server/agents/prospecting-toolkit/claude-classifier/classify-batch-candidates.server';
import {
  CLAUDE_CLASSIFIER_OPERATION_KEY,
  CLAUDE_CLASSIFIER_PROVIDER_KEY,
  type CompanyClassificationResult,
} from '@/server/agents/prospecting-toolkit/claude-classifier/types';
import { getCountryNameFromCode, readHubSpotCompanyProperties } from '@/server/integrations/hubspot-company-create';
import { updateHubSpotCompanyProperties } from '@/server/integrations/hubspot-company-update';
import {
  buildHubSpotFillProperties,
  cleanCountryLabel,
  missingProfileFields,
  planCountryCompletion,
} from './account-profile-completion';

/** Una consulta a Claude por empresa cada 30 días: si no encontró nada, no se repite a diario. */
const INDUSTRY_RETRY_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

const EXTRA_COUNTRY_NAMES: Record<string, string> = { US: 'Estados Unidos', ES: 'España' };

function countryNameFromCode(code: string | null): string | null {
  if (!code) return null;
  return getCountryNameFromCode(code) ?? EXTRA_COUNTRY_NAMES[code.toUpperCase()] ?? null;
}

type AccountRow = {
  id: string;
  name: string;
  domain: string | null;
  website: string | null;
  country: string | null;
  country_code: string | null;
  industry: string | null;
  hubspot_company_id: string | null;
  metadata: Record<string, unknown> | null;
};

export interface CompleteAccountProfileResult {
  status: 'complete' | 'updated' | 'nothing_found' | 'account_unavailable';
  filled: Array<'country' | 'industry'>;
  hubspot: { status: 'not_linked' | 'nothing_to_write' | 'written' | 'failed'; written: string[] };
  /** Lo que sigue vacío después del intento. */
  stillMissing: Array<'country' | 'industry'>;
}

function recentIndustryAttempt(metadata: Record<string, unknown> | null, nowMs: number): boolean {
  const completion = metadata?.profile_completion as { industry_attempted_at?: unknown } | undefined;
  const at = typeof completion?.industry_attempted_at === 'string' ? Date.parse(completion.industry_attempted_at) : NaN;
  return Number.isFinite(at) && nowMs - at < INDUSTRY_RETRY_AFTER_MS;
}

async function classifyIndustry(
  admin: SupabaseClient,
  account: AccountRow,
  countryCode: string | null,
  countryName: string | null,
  actorUserId: string | null,
  nowIso: string,
): Promise<{ industry: string | null; attempted: boolean }> {
  const websiteOrDomain = account.website ?? account.domain;
  if (!websiteOrDomain) return { industry: null, attempted: false };

  const active = await resolveActiveAnthropicModel();
  if ('error' in active) return { industry: null, attempted: false };
  const quota = await checkProviderQuotaAvailable(CLAUDE_CLASSIFIER_PROVIDER_KEY);
  if (!quota.allowed) return { industry: null, attempted: false };
  const catalog = await loadClassifierCatalog(admin);
  if (catalog.length === 0) return { industry: null, attempted: false };

  const result: CompanyClassificationResult = await classifyCompanyLive(
    {
      candidateId: account.id,
      name: account.name,
      websiteOrDomain,
      countryCode,
      countryName,
      currentIndustryId: null,
      currentIndustryName: null,
    },
    catalog,
    active,
  );

  if (result.usage) {
    await logProviderUsage({
      usage_key: `account_profile_completion:${account.id}:${nowIso}`,
      provider_key: CLAUDE_CLASSIFIER_PROVIDER_KEY,
      operation_key: CLAUDE_CLASSIFIER_OPERATION_KEY,
      model: result.usage.model,
      input_tokens: result.usage.inputTokens,
      output_tokens: result.usage.outputTokens,
      results_returned: result.sector ? 1 : 0,
      estimated_cost_usd: result.usage.estimatedCostUsd,
      status: result.outcome === 'model_error' ? 'error' : 'success',
      error_code: result.errorCode ?? undefined,
      duration_ms: result.durationMs,
      triggered_by: actorUserId ?? undefined,
      metadata: { purpose: 'account_profile_completion', account_id: account.id, outcome: result.outcome },
    });
  }

  // Sólo una macro del catálogo vigente: lo demás no se escribe en ningún lado.
  const macro = result.sector ? resolveMacroIndustryByDisplayName(result.sector.industryName) : null;
  return { industry: macro?.displayName ?? null, attempted: true };
}

export async function completeAccountProfile(
  admin: SupabaseClient,
  input: { accountId: string; actorUserId: string | null; nowIso: string; useClaude?: boolean },
): Promise<CompleteAccountProfileResult> {
  const unavailable: CompleteAccountProfileResult = {
    status: 'account_unavailable',
    filled: [],
    hubspot: { status: 'not_linked', written: [] },
    stillMissing: [],
  };
  const { data, error } = await admin
    .from('accounts')
    .select('id, name, domain, website, country, country_code, industry, hubspot_company_id, metadata')
    .eq('id', input.accountId)
    .is('archived_at', null)
    .maybeSingle();
  if (error || !data) return unavailable;
  const account = data as unknown as AccountRow;

  const missing = missingProfileFields(account);
  if (missing.length === 0) {
    return { status: 'complete', filled: [], hubspot: { status: 'nothing_to_write', written: [] }, stillMissing: [] };
  }

  const patch: Record<string, string> = {};
  const filled: Array<'country' | 'industry'> = [];
  let countryCompletion: ReturnType<typeof planCountryCompletion> = null;

  if (missing.includes('country')) {
    countryCompletion = planCountryCompletion(account, {
      nameToCode: (name) => mapCountryToCode(name),
      codeToName: countryNameFromCode,
    });
    if (countryCompletion) {
      patch.country = countryCompletion.country;
      patch.country_code = countryCompletion.country_code;
      filled.push('country');
    }
  }

  let industryAttempted = false;
  if (missing.includes('industry') && input.useClaude !== false && !recentIndustryAttempt(account.metadata, Date.now())) {
    const code = patch.country_code ?? account.country_code;
    const name = patch.country ?? cleanCountryLabel(account.country);
    const outcome = await classifyIndustry(admin, account, code, name, input.actorUserId, input.nowIso);
    industryAttempted = outcome.attempted;
    if (outcome.industry) {
      patch.industry = outcome.industry;
      filled.push('industry');
    }
  }

  if (filled.length === 0 && !industryAttempted) {
    return { status: 'nothing_found', filled, hubspot: { status: 'nothing_to_write', written: [] }, stillMissing: missing };
  }

  const stillMissing = missing.filter((field) => !filled.includes(field));
  // Claude tarda: se relee `metadata` justo antes de escribir para no pisar lo que otro
  // proceso (p. ej. el completado con fuentes oficiales) haya guardado mientras tanto.
  const fresh = await admin.from('accounts').select('metadata').eq('id', input.accountId).maybeSingle();
  const currentMetadata = ((fresh.data?.metadata as Record<string, unknown> | null | undefined) ?? account.metadata ?? {});
  const previous = (currentMetadata.profile_completion ?? {}) as Record<string, unknown>;
  const { error: updateError } = await admin
    .from('accounts')
    .update({
      ...patch,
      ...(input.actorUserId ? { updated_by: input.actorUserId } : {}),
      metadata: {
        ...currentMetadata,
        profile_completion: {
          ...previous,
          completed_at: input.nowIso,
          filled_columns: filled,
          country_source: countryCompletion?.source ?? previous.country_source ?? null,
          ...(industryAttempted ? { industry_attempted_at: input.nowIso } : {}),
        },
      },
    })
    .eq('id', input.accountId);
  if (updateError) {
    console.error('[account-profile-completion] update failed', { accountId: input.accountId, error: updateError.message });
    return unavailable;
  }

  const hubspot = await writeBackToHubSpot(account, patch.country ?? null, patch.industry ?? null);
  return {
    status: filled.length > 0 ? 'updated' : 'nothing_found',
    filled,
    hubspot,
    stillMissing,
  };
}

async function writeBackToHubSpot(
  account: AccountRow,
  country: string | null,
  industry: string | null,
): Promise<CompleteAccountProfileResult['hubspot']> {
  if (!account.hubspot_company_id) return { status: 'not_linked', written: [] };
  if (!country && !industry) return { status: 'nothing_to_write', written: [] };

  const current = await readHubSpotCompanyProperties(account.hubspot_company_id, ['pais', 'country', 'industriaespecifica']);
  if (!current.ok || !current.properties) return { status: 'failed', written: [] };
  const properties = buildHubSpotFillProperties({
    current: {
      pais: current.properties.pais ?? null,
      country: current.properties.country ?? null,
      industriaespecifica: current.properties.industriaespecifica ?? null,
    },
    country,
    industry,
  });
  if (Object.keys(properties).length === 0) return { status: 'nothing_to_write', written: [] };

  const result = await updateHubSpotCompanyProperties(account.hubspot_company_id, properties);
  if (!result.ok) {
    console.error('[account-profile-completion] HubSpot write-back failed', {
      accountId: account.id,
      error: result.error ?? null,
      rejected: result.rejected,
    });
  }
  return { status: result.written.length > 0 ? 'written' : 'failed', written: result.written };
}

/**
 * Programa el completado para cuando la respuesta ya salió (`after()` de Next). Nunca lanza.
 */
export function scheduleAccountProfileCompletion(accountId: string, actorUserId: string | null): void {
  try {
    after(async () => {
      try {
        await completeAccountProfile(createSupabaseAdminClient(), {
          accountId,
          actorUserId,
          nowIso: new Date().toISOString(),
        });
      } catch (err) {
        console.error('[account-profile-completion] background run failed:', err instanceof Error ? err.message : err);
      }
    });
  } catch (err) {
    console.error('[account-profile-completion] could not schedule:', err instanceof Error ? err.message : err);
  }
}
