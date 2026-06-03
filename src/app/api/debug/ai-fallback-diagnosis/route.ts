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
import { createClient } from '@/lib/supabase/server';

function getAdmin() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    'https://lrdruowtadwbdulndlph.supabase.co';
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxyZHJ1b3d0YWR3YmR1bG5kbHBoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODgzODY2NCwiZXhwIjoyMDk0NDE0NjY0fQ.0fnp65rmdJxklJvVkaWuA3J9dtBpf0Jg2zB2kSyyg0E';
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
  const aliasesToCheck = [
    'google',
    'gemini',
    'anthropic',
    'openai',
  ];
  const vaultChecks = await Promise.all(
    aliasesToCheck.map((a) => checkVaultAlias(admin, a))
  );

  // ── 4b. Detailed Gemini check via hasGeminiCredential ────────────────────
  const geminiDetailedCheck = await hasGeminiCredential();

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
    gemini_detailed_check: {
      available: geminiDetailedCheck.available,
      resolved_provider_key: geminiDetailedCheck.resolved_provider_key,
      checked_aliases: geminiDetailedCheck.checked_aliases,
    },
    google_credential_available:
      vaultChecks.find((v) => v.alias === 'google')?.found ||
      vaultChecks.find((v) => v.alias === 'gemini')?.found ||
      false,
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
