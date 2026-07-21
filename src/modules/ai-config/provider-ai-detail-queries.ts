// ============================================================
// ai-config — AI provider detail query helper (Hito Q3B)
// ============================================================
// Read-only. No writes. No schema changes. No external calls.
//
// Returns models + pricing + active-config context for a single
// IA provider (anthropic | openai | gemini) to be surfaced in
// /settings/providers/[providerKey] → tab "Modelos y tarifas".
// ============================================================

/* eslint-disable @typescript-eslint/no-explicit-any */

import { createSupabaseAdminClient } from '@/lib/supabase/admin';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AiModelWithPricing {
  id: string;
  modelKey: string;
  displayName: string;
  status: string;
  contextWindow: number | null;
  isActiveGlobalModel: boolean;
  latestPricing: {
    inputPerMillion: number;
    outputPerMillion: number;
    effectiveFrom: string;
    currency: string;
  } | null;
}

export interface AiProviderDetailResult {
  providerId: string;
  providerKey: string;
  providerName: string;
  providerStatus: string;
  connectionStatus: string;
  isActiveProviderGlobal: boolean;
  activeModelKey: string | null;
  models: AiModelWithPricing[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const IA_PROVIDER_KEYS = new Set(['anthropic', 'openai', 'gemini']);

export function isIaProviderKey(providerKey: string): boolean {
  return IA_PROVIDER_KEYS.has(providerKey.toLowerCase());
}

// ─── Admin client ─────────────────────────────────────────────────────────────

// Fail-closed service-role client via the canonical factory. No hardcoded
// production fallback: createSupabaseAdminClient() throws
// UnsafeSupabaseEnvironmentError when config is missing or unsafe (H5.1).
function getAdminClient() {
  return createSupabaseAdminClient();
}

// ─── Query ────────────────────────────────────────────────────────────────────

const AI_ACTIVE_CONFIG_ID = '00000000-0000-0000-0000-000000000001';

/**
 * Returns read-only AI detail for a single IA provider.
 * Returns null if providerKey is not an IA provider or is not found in DB.
 *
 * Read-only. Never mutates DB state. Never calls external APIs.
 */
export async function getAiProviderDetail(
  providerKey: string,
): Promise<AiProviderDetailResult | null> {
  const key = providerKey.toLowerCase();
  if (!isIaProviderKey(key)) return null;

  try {
    const admin = getAdminClient();

    const [providerResult, activeConfigResult] = await Promise.all([
      admin
        .from('ai_providers')
        .select('id, key, name, status, connection_status')
        .eq('key', key)
        .single(),
      admin
        .from('ai_active_config')
        .select(
          'active_provider_id, active_model_id, ai_providers!active_provider_id(key), ai_models!active_model_id(key)',
        )
        .eq('id', AI_ACTIVE_CONFIG_ID)
        .single(),
    ]);

    const provider = providerResult.data as any;
    if (!provider) return null;

    const activeConfig = activeConfigResult.data as any;
    const activeProviderKey: string | null = activeConfig?.ai_providers?.key ?? null;
    const activeModelKey: string | null = activeConfig?.ai_models?.key ?? null;
    const isActiveProviderGlobal = activeProviderKey === key;

    const [modelsResult, pricingResult] = await Promise.all([
      admin
        .from('ai_models')
        .select('id, key, name, status, context_window_tokens')
        .eq('provider_id', provider.id)
        .order('name'),
      admin
        .from('ai_model_pricing')
        .select(
          'model_id, input_cost_per_million_tokens, output_cost_per_million_tokens, currency, effective_from',
        )
        .eq('is_current', true),
    ]);

    const rawModels: any[] = modelsResult.data ?? [];
    const rawPricing: any[] = pricingResult.data ?? [];

    const pricingMap = new Map<string, any>();
    rawPricing.forEach((p) => pricingMap.set(p.model_id as string, p));

    const models: AiModelWithPricing[] = rawModels.map((m) => {
      const pricing = pricingMap.get(m.id as string) ?? null;
      return {
        id: m.id as string,
        modelKey: m.key as string,
        displayName: m.name as string,
        status: (m.status as string) ?? 'inactive',
        contextWindow:
          m.context_window_tokens != null ? Number(m.context_window_tokens) : null,
        isActiveGlobalModel: (m.key as string) === activeModelKey,
        latestPricing: pricing
          ? {
              inputPerMillion: Number(pricing.input_cost_per_million_tokens),
              outputPerMillion: Number(pricing.output_cost_per_million_tokens),
              currency: (pricing.currency as string) ?? 'USD',
              effectiveFrom: pricing.effective_from as string,
            }
          : null,
      };
    });

    return {
      providerId: provider.id as string,
      providerKey: key,
      providerName: provider.name as string,
      providerStatus: (provider.status as string) ?? 'inactive',
      connectionStatus: (provider.connection_status as string) ?? 'not_configured',
      isActiveProviderGlobal,
      activeModelKey: isActiveProviderGlobal ? activeModelKey : null,
      models,
    };
  } catch {
    return null;
  }
}
