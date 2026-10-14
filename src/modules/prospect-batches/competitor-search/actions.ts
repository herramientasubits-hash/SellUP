'use server';

/**
 * Agente 1 · «Competidores de una empresa» — arma la FICHA de la empresa de
 * referencia para que la vendedora la confirme.
 *
 * Una llamada a Claude con búsqueda web (≈ US$0,03), registrada en Uso de IA como
 * parte de «Claude busca empresas» (`flow: competitor_reference`). No escribe nada
 * más: la referencia sólo se guarda en el lote cuando la búsqueda se lanza.
 */

import { z } from 'zod';
import { isAgent1ClaudeCompanySearchAutoEnabled } from '@/lib/feature-flags.server';
import { createClient } from '@/lib/supabase/server';
import { checkProviderQuotaAvailable } from '@/modules/budgets/budget-resolution';
import { loadActiveDiscoveryCatalog } from '@/modules/industry-catalog/discovery-catalog-loader';
import { requireActiveUser } from '@/modules/prospect-batches/actions';
import { LATAM_COUNTRIES } from '@/modules/prospect-batches/types';
import { logProviderUsage } from '@/modules/usage-tracking/logging';
import { runAnthropicConversation } from '@/server/agents/prospecting-toolkit/claude-classifier/anthropic-messages-client';
import { resolveActiveAnthropicModel } from '@/server/agents/prospecting-toolkit/claude-classifier/classify-batch-candidates.server';
import { identifyReferenceCompany } from '@/server/agents/prospecting-toolkit/claude-classifier/reference-company';
import {
  CLAUDE_CLASSIFIER_CONTRACT_VERSION,
  CLAUDE_CLASSIFIER_PROVIDER_KEY,
} from '@/server/agents/prospecting-toolkit/claude-classifier/types';
import { detectPromptInjection } from '@/modules/industry-catalog/schema';
import {
  collapseReferenceText,
  normalizeReferenceDomain,
  type CompetitorReferenceCard,
} from './competitor-reference';

/** Una llamada con hasta 3 búsquedas web tarda 10–30 s. */
const REFERENCE_REQUEST_TIMEOUT_MS = 60_000;
/** Se registra con la operación de «Claude busca empresas» (sin migración). */
const REFERENCE_OPERATION_KEY = 'company_search';

const requestSchema = z
  .object({
    query: z.string().max(200).optional(),
    accountId: z.string().uuid().optional(),
  })
  .strict();

export type ResolveCompetitorReferenceResult =
  | { ok: true; reference: CompetitorReferenceCard }
  | { ok: false; message: string };

type AccountRow = {
  id: string;
  name: string;
  domain: string | null;
  country_code: string | null;
};

async function loadAccount(accountId: string): Promise<AccountRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('accounts')
    .select('id, name, domain, country_code')
    .eq('id', accountId)
    .maybeSingle();
  if (error || !data) return null;
  return data as AccountRow;
}

export async function resolveCompetitorReferenceAction(
  request: unknown,
): Promise<ResolveCompetitorReferenceResult> {
  const { internalUserId } = await requireActiveUser();
  // Sin «Claude busca empresas» la búsqueda de competidores no puede correr: no se
  // paga la ficha de una referencia que después no se podría usar.
  if (!isAgent1ClaudeCompanySearchAutoEnabled()) {
    return { ok: false, message: 'La búsqueda de competidores usa a Claude, que no está activo en este momento.' };
  }
  const parsed = requestSchema.safeParse(request);
  if (!parsed.success) return { ok: false, message: 'Solicitud inválida.' };

  const account = parsed.data.accountId ? await loadAccount(parsed.data.accountId) : null;
  if (parsed.data.accountId && !account) {
    return { ok: false, message: 'No encontramos esa cuenta o no tienes acceso a ella.' };
  }
  const query = collapseReferenceText(account?.name ?? parsed.data.query ?? '');
  if (query.length < 2) return { ok: false, message: 'Escribe el nombre o la web de la empresa.' };
  if (detectPromptInjection(query)) return { ok: false, message: 'Escribe sólo el nombre o la web de la empresa.' };

  const active = await resolveActiveAnthropicModel();
  if ('error' in active) {
    return { ok: false, message: 'Claude no está configurado en Configuración → IA.' };
  }
  if (!(await checkProviderQuotaAvailable(CLAUDE_CLASSIFIER_PROVIDER_KEY)).allowed) {
    return { ok: false, message: 'Se agotó la cuota de Claude de este mes.' };
  }

  let catalog;
  try {
    catalog = await loadActiveDiscoveryCatalog();
  } catch {
    return { ok: false, message: 'No pudimos leer el catálogo de industrias. Intenta de nuevo.' };
  }
  const knownCountryCode =
    account?.country_code && LATAM_COUNTRIES.some((c) => c.code === account.country_code)
      ? account.country_code
      : null;
  const input = {
    query,
    knownDomain: normalizeReferenceDomain(account?.domain),
    knownCountryCode,
    countries: LATAM_COUNTRIES,
    industries: catalog.industries.map((i) => i.name),
  };

  const startedMs = Date.now();
  const outcome = await identifyReferenceCompany(input, active.model, {
    runConversation: (body) =>
      runAnthropicConversation({ apiKey: active.apiKey, body, timeoutMs: REFERENCE_REQUEST_TIMEOUT_MS }),
  });
  if (outcome.usage) {
    await logProviderUsage({
      provider_key: CLAUDE_CLASSIFIER_PROVIDER_KEY,
      operation_key: REFERENCE_OPERATION_KEY,
      model: outcome.usage.model,
      input_tokens: outcome.usage.inputTokens,
      output_tokens: outcome.usage.outputTokens,
      results_returned: outcome.card ? 1 : 0,
      estimated_cost_usd: outcome.usage.estimatedCostUsd,
      status: outcome.errorCode ? 'error' : 'success',
      error_code: outcome.errorCode ?? undefined,
      duration_ms: Date.now() - startedMs,
      triggered_by: internalUserId,
      metadata: {
        contract_version: CLAUDE_CLASSIFIER_CONTRACT_VERSION,
        flow: 'competitor_reference',
        found: outcome.card !== null,
        web_search_requests: outcome.usage.webSearchRequests,
        pricing_source: outcome.usage.pricingSource,
      },
    }).catch(() => false);
  }

  if (outcome.errorCode) {
    return { ok: false, message: 'Claude no respondió. Intenta de nuevo en unos segundos.' };
  }
  if (!outcome.card) {
    return {
      ok: false,
      message: 'No pudimos identificar la empresa. Prueba con su sitio web (por ejemplo, alpina.com).',
    };
  }
  const card = outcome.card;
  return {
    ok: true,
    reference: {
      name: card.name,
      domain: card.domain,
      description: card.description,
      accountId: account?.id ?? null,
      countryCode: card.countryCode,
      industryId: catalog.industries.find((i) => i.name === card.industryName)?.id ?? null,
    },
  };
}
