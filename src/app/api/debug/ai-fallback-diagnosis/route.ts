/**
 * DIAGNÓSTICO TEMPORAL — Hito 16EN.5
 * Ruta solo accesible en development para inspeccionar el estado
 * del sistema de fallback de IA sin exponer credenciales.
 *
 * GET /api/debug/ai-fallback-diagnosis
 *
 * IMPORTANTE: Nunca loguea API keys.
 * ELIMINAR después de confirmar el fix.
 */
import { NextResponse } from 'next/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { getAIActiveConfig } from '@/modules/ai-config/actions';
import {
  buildAIExecutionCandidates,
  hasGeminiCredential,
  normalizeAIProviderKey,
} from '@/server/prospect-batches/candidate-enrichment';
import { resolveAIProviderCredential } from '@/server/services/ai-credentials';
import { createClient } from '@/lib/supabase/server';

function getAdmin() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    'https://lrdruowtadwbdulndlph.supabase.co';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error('enrichment_configuration_unavailable');
  }
  return createAdminClient(url, key);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function checkVaultAlias(admin: any, alias: string) {
  const name = `sellup_ai_${alias}`;
  try {
    const { data } = await admin.rpc('has_vault_secret', { p_name: name });
    return { alias, vault_key: name, found: data === true };
  } catch (e) {
    return { alias, vault_key: name, found: false, error: String(e) };
  }
}

export async function GET() {
  // Solo disponible en development — protección adicional para staging/prod
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 403 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  const admin = getAdmin();

  // ── 1. Active config ──────────────────────────────────────────────────────
  const activeConfig = await getAIActiveConfig();

  // ── 2. Providers from DB ──────────────────────────────────────────────────
  const { data: dbProviders } = await admin
    .from('ai_providers')
    .select('id, name, key, status, credentials_status, connection_status, vault_secret_id');

  // ── 3. Models from DB ─────────────────────────────────────────────────────
  const { data: dbModels } = await admin
    .from('ai_models')
    .select(`
      id,
      key,
      name,
      is_selectable,
      ai_providers!provider_id (
        key,
        name
      )
    `)
    .eq('is_selectable', true);

  // ── 4. Vault checks for all relevant aliases ──────────────────────────────
  // Incluye formato nuevo (sellup_ai_*) y formato viejo (ai_provider_*_api_key)
  const aliasesToCheck = [
    'google',
    'gemini',
    'anthropic',
    'openai',
  ];
  const vaultChecks = await Promise.all(
    aliasesToCheck.map((a) => checkVaultAlias(admin, a))
  );

  // Chequeo adicional de nombres legacy (migración 012)
  const legacyNames = [
    'ai_provider_google_api_key',
    'ai_provider_gemini_api_key',
    'ai_provider_anthropic_api_key',
    'ai_provider_openai_api_key',
  ];
  const legacyVaultChecks = await Promise.all(
    legacyNames.map(async (name) => {
      try {
        const { data } = await admin.rpc('has_vault_secret', { p_name: name });
        return { vault_key: name, found: data === true };
      } catch {
        return { vault_key: name, found: false };
      }
    })
  );

  // ── 4b. Detailed Gemini check via hasGeminiCredential ────────────────────
  const geminiDetailedCheck = await hasGeminiCredential();

  // ── 4c. Unified credential resolution per provider ───────────────────────
  const [geminiResolution, anthropicResolution, openaiResolution] = await Promise.all([
    resolveAIProviderCredential('google'),
    resolveAIProviderCredential('anthropic'),
    resolveAIProviderCredential('openai'),
  ]);

  // ── 5. Build execution candidates (full logic) ────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const executionCandidates = await buildAIExecutionCandidates(supabase as any, activeConfig);

  // ── 6. Provider key normalization check ───────────────────────────────────
  const normalizationSamples = [
    'google', 'gemini', 'Google Gemini', 'anthropic', 'claude', 'openai',
  ].map((v) => ({ input: v, normalized: normalizeAIProviderKey(v) }));

  // ── 7. Models specifically for Google/Gemini ─────────────────────────────
  const geminiModels = (dbModels ?? []).filter((m) => {
    const rawProv = m.ai_providers as unknown;
    const provData = (Array.isArray(rawProv) ? rawProv[0] : rawProv) as
      | { key: string; name: string }
      | null;
    const normalized = normalizeAIProviderKey(provData?.key || '');
    return normalized === 'google';
  });

  return NextResponse.json({
    diagnosis_timestamp: new Date().toISOString(),
    active_config: activeConfig
      ? {
          provider_key: activeConfig.provider_key,
          provider_name: activeConfig.provider_name,
          model_key: activeConfig.model_key,
          model_name: activeConfig.model_name,
        }
      : null,
    providers_from_db: (dbProviders ?? []).map((p) => ({
      key: p.key,
      name: p.name,
      status: p.status,
      credentials_status: p.credentials_status,
      connection_status: p.connection_status,
      has_vault_secret_id: !!p.vault_secret_id,
    })),
    models_from_db_selectable: (dbModels ?? []).map((m) => {
      const rawProv = m.ai_providers as unknown;
      const provData = (Array.isArray(rawProv) ? rawProv[0] : rawProv) as
        | { key: string; name: string }
        | null;
      return {
        key: m.key,
        name: m.name,
        is_selectable: m.is_selectable,
        provider_key_raw: provData?.key ?? null,
        provider_key_normalized: normalizeAIProviderKey(provData?.key || ''),
        provider_name: provData?.name ?? null,
      };
    }),
    gemini_models_in_db: geminiModels.map((m) => ({
      key: m.key,
      name: m.name,
    })),
    vault_credential_checks: vaultChecks,
    vault_legacy_checks: legacyVaultChecks,
    gemini_detailed_check: {
      available: geminiDetailedCheck.available,
      resolved_provider_key: geminiDetailedCheck.resolved_provider_key,
      checked_aliases: geminiDetailedCheck.checked_aliases,
    },
    google_credential_available:
      vaultChecks.find((v) => v.alias === 'google')?.found ||
      vaultChecks.find((v) => v.alias === 'gemini')?.found ||
      legacyVaultChecks.find((v) => v.vault_key === 'ai_provider_google_api_key')?.found ||
      legacyVaultChecks.find((v) => v.vault_key === 'ai_provider_gemini_api_key')?.found ||
      false,
    unified_credential_resolution: {
      google: {
        available: geminiResolution.available,
        source: geminiResolution.source,
        secret_name: geminiResolution.secret_name ?? null,
        checked_aliases: geminiResolution.checked_aliases,
      },
      anthropic: {
        available: anthropicResolution.available,
        source: anthropicResolution.source,
        secret_name: anthropicResolution.secret_name ?? null,
        checked_aliases: anthropicResolution.checked_aliases,
      },
      openai: {
        available: openaiResolution.available,
        source: openaiResolution.source,
        secret_name: openaiResolution.secret_name ?? null,
        checked_aliases: openaiResolution.checked_aliases,
      },
    },
    normalization_samples: normalizationSamples,
    execution_candidates_final: executionCandidates.map((c) => ({
      provider_key: c.provider_key,
      provider_display_name: c.provider_display_name,
      model_key: c.model_key,
      model_display_name: c.model_display_name,
      priority: c.priority,
      credential_available: c.credential_available,
    })),
    execution_candidates_selected_for_attempts: executionCandidates
      .slice(0, 5)
      .map((c) => ({
        provider_key: c.provider_key,
        model_key: c.model_key,
        priority: c.priority,
      })),
  });
}
