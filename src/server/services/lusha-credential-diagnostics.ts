/**
 * Lusha Credential Diagnostics — 17B.4P (H5.9B admin-factory migration)
 *
 * Diagnóstico server-only para resolución de credenciales Lusha.
 * No expone secretos. No llama Lusha. No crea candidatos ni contactos.
 * Registra evidencia segura: stage, checks booleanos, detalles sanitizados.
 *
 * H5.9B: el stage B ya no construye el admin client inline con un fallback
 * hardcodeado a producción. Usa la factory fail-closed createSupabaseAdminClient(),
 * que lee env vía el env-guard y lanza UnsafeSupabaseEnvironmentError en vez de
 * caer a un proyecto Supabase de producción. La inspección raw de env del stage A
 * se mantiene independiente de la factory para preservar el contrato diagnóstico
 * (hasSupabaseUrl / hasServiceRoleKey / longitudes / host / fallback LUSHA_API_KEY).
 */

import { createHash } from 'crypto';

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import {
  UnsafeSupabaseEnvironmentError,
  type SupabaseEnvUnsafeReason,
} from '@/lib/supabase/env-guard.server';
import { LUSHA_VAULT_SECRET_NAME, resolveLushaCredential } from './lusha-connection';
import { isLushaContactEnrichmentEnabled } from '@/lib/feature-flags.server';

// ── Types ─────────────────────────────────────────────────────────────────────

export type LushaCredentialStage =
  | 'env_check'
  | 'admin_client'
  | 'vault_rpc'
  | 'secret_missing'
  | 'secret_empty'
  | 'resolved_from_vault'
  | 'resolved_from_env_fallback'
  | 'failed';

export interface LushaCredentialDiagnosticResult {
  ok: boolean;
  stage: LushaCredentialStage;
  checks: {
    hasSupabaseUrl: boolean;
    hasServiceRoleKey: boolean;
    hasLushaEnvFallback: boolean;
    adminClientCreated: boolean;
    vaultRpcCalled: boolean;
    vaultRpcOk: boolean;
    vaultSecretFound: boolean;
    vaultSecretNonEmpty: boolean;
    envFallbackNonEmpty: boolean;
  };
  safeDetails: {
    supabaseUrlHost?: string | null;
    serviceRoleKeyLength?: number | null;
    serviceRoleKeyLooksJwt?: boolean | null;
    lushaEnvFallbackLength?: number | null;
    vaultSecretLength?: number | null;
    vaultSecretFingerprint?: string | null;
    rpcErrorCode?: string | null;
    rpcErrorMessage?: string | null;
    exceptionName?: string | null;
    exceptionMessage?: string | null;
  };
  recommendation: string;
}

export interface DiagnoseLushaInput {
  triggeredBy?: string | null;
  accountId?: string | null;
  runId?: string | null;
  source?: 'wizard' | 'manual_debug' | 'runner';
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function safeUrlHost(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    return new URL(raw).hostname;
  } catch {
    return raw.slice(0, 40).replace(/[?#].*/, '') || null;
  }
}

function looksLikeJwt(s: string): boolean {
  const parts = s.split('.');
  return parts.length === 3 && parts.every((p) => p.length > 0);
}

/** sha256 hex, first 8 chars — never a partial secret */
function fingerprint(secret: string): string {
  return createHash('sha256').update(secret).digest('hex').slice(0, 8);
}

function sanitizeExceptionMessage(msg: string): string {
  // Remove anything that looks like a credential value (long alphanum strings > 20 chars)
  return msg.replace(/[A-Za-z0-9_\-.]{21,}/g, '[REDACTED]').slice(0, 200);
}

/**
 * Maps an env-guard fail-closed reason (or a generic client-creation failure)
 * to an actionable, secret-free recommendation. Always returns a non-empty
 * string so the admin_client stage never surfaces a blank recommendation.
 */
function adminClientFailureRecommendation(
  reason: SupabaseEnvUnsafeReason | null,
): string {
  switch (reason) {
    case 'missing_supabase_url':
      return 'NEXT_PUBLIC_SUPABASE_URL no está configurada en el runtime. Agregarla en Variables de Entorno de Vercel. El env-guard falla de forma segura (fail-closed) en vez de caer a un proyecto Supabase de producción hardcodeado.';
    case 'missing_service_role_key':
      return 'SUPABASE_SERVICE_ROLE_KEY no está disponible en el runtime. Agregarla en Variables de Entorno de Vercel.';
    case 'non_production_environment_targets_production_supabase':
      return 'Un entorno no-productivo resolvió NEXT_PUBLIC_SUPABASE_URL al proyecto Supabase de producción. El env-guard falló de forma segura (fail-closed) y no creó un cliente admin apuntando a producción desde un entorno no-prod. Verificar NEXT_PUBLIC_SUPABASE_URL / VERCEL_ENV.';
    default:
      return 'No se pudo crear cliente admin de Supabase. Verificar que SUPABASE_SERVICE_ROLE_KEY sea un JWT válido y que NEXT_PUBLIC_SUPABASE_URL apunte al proyecto correcto.';
  }
}

// ── Main diagnostic ───────────────────────────────────────────────────────────

export async function diagnoseLushaCredentialResolution(
  input?: DiagnoseLushaInput,
): Promise<LushaCredentialDiagnosticResult> {
  const checks: LushaCredentialDiagnosticResult['checks'] = {
    hasSupabaseUrl: false,
    hasServiceRoleKey: false,
    hasLushaEnvFallback: false,
    adminClientCreated: false,
    vaultRpcCalled: false,
    vaultRpcOk: false,
    vaultSecretFound: false,
    vaultSecretNonEmpty: false,
    envFallbackNonEmpty: false,
  };
  const safeDetails: LushaCredentialDiagnosticResult['safeDetails'] = {};

  // ── A. Env check (raw inspection — independent of the admin factory) ───────
  // Read env directly (no hardcoded production fallback) so the diagnostic
  // reports the true runtime state. The admin client itself is built in stage B
  // via the fail-closed factory; this stage only inspects env for evidence.
  const supabaseUrl = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const serviceRoleKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  const lushaEnvFallback = process.env['LUSHA_API_KEY'];

  checks.hasSupabaseUrl = !!supabaseUrl;
  checks.hasServiceRoleKey = !!serviceRoleKey;
  checks.hasLushaEnvFallback = !!lushaEnvFallback;

  safeDetails.supabaseUrlHost = safeUrlHost(supabaseUrl);
  safeDetails.serviceRoleKeyLength = serviceRoleKey ? serviceRoleKey.length : null;
  safeDetails.serviceRoleKeyLooksJwt = serviceRoleKey ? looksLikeJwt(serviceRoleKey) : null;
  safeDetails.lushaEnvFallbackLength = lushaEnvFallback ? lushaEnvFallback.length : null;

  if (!checks.hasServiceRoleKey) {
    checks.envFallbackNonEmpty = !!(lushaEnvFallback?.trim());

    if (checks.envFallbackNonEmpty) {
      return {
        ok: true,
        stage: 'resolved_from_env_fallback',
        checks,
        safeDetails,
        recommendation:
          'SUPABASE_SERVICE_ROLE_KEY no disponible. Credencial Lusha resuelta desde LUSHA_API_KEY (env fallback). Si falla en Vercel, verificar que LUSHA_API_KEY esté configurada en Variables de Entorno.',
      };
    }

    return {
      ok: false,
      stage: 'env_check',
      checks,
      safeDetails,
      recommendation:
        'El runtime no tiene SUPABASE_SERVICE_ROLE_KEY ni LUSHA_API_KEY disponibles. Agregar SUPABASE_SERVICE_ROLE_KEY en Variables de Entorno de Vercel.',
    };
  }

  // ── B. Admin client (fail-closed factory) ─────────────────────────────────
  // createSupabaseAdminClient() reads env via the env-guard and throws
  // UnsafeSupabaseEnvironmentError (never falls back to a hardcoded production
  // project) when config is missing or a non-prod environment resolves to the
  // production project. We catch that throw, record the exception name/reason
  // as safe evidence, and — mirroring the runner's resolveLushaCredential —
  // preserve the LUSHA_API_KEY env fallback path when a fallback exists.
  let admin: ReturnType<typeof createSupabaseAdminClient>;
  try {
    admin = createSupabaseAdminClient();
    checks.adminClientCreated = true;
  } catch (err: unknown) {
    const reason =
      err instanceof UnsafeSupabaseEnvironmentError ? err.reason : null;
    const name = err instanceof Error ? err.name : 'UnknownError';
    const msg = err instanceof Error ? err.message : String(err);
    safeDetails.exceptionName = name;
    safeDetails.exceptionMessage = sanitizeExceptionMessage(msg);
    checks.envFallbackNonEmpty = !!(lushaEnvFallback?.trim());

    if (checks.envFallbackNonEmpty) {
      return {
        ok: true,
        stage: 'resolved_from_env_fallback',
        checks,
        safeDetails,
        recommendation:
          'No se pudo crear cliente admin de Supabase (env-guard fail-closed). Credencial Lusha resuelta desde LUSHA_API_KEY (env fallback).',
      };
    }

    return {
      ok: false,
      stage: 'admin_client',
      checks,
      safeDetails,
      recommendation: adminClientFailureRecommendation(reason),
    };
  }

  // ── C. Vault RPC ──────────────────────────────────────────────────────────
  checks.vaultRpcCalled = true;
  let vaultSecret: string | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (admin.rpc as any)('get_vault_secret_decrypted', {
      p_name: LUSHA_VAULT_SECRET_NAME,
    });

    if (error) {
      safeDetails.rpcErrorCode = error.code ?? null;
      safeDetails.rpcErrorMessage = error.message ? error.message.slice(0, 200) : null;
      checks.vaultRpcOk = false;
    } else {
      checks.vaultRpcOk = true;
      vaultSecret = typeof data === 'string' ? data : null;
    }
  } catch (err: unknown) {
    checks.vaultRpcOk = false;
    const name = err instanceof Error ? err.constructor.name : 'UnknownError';
    const msg = err instanceof Error ? err.message : String(err);
    safeDetails.exceptionName = name;
    safeDetails.exceptionMessage = sanitizeExceptionMessage(msg);
  }

  // ── D. Vault result ───────────────────────────────────────────────────────
  if (checks.vaultRpcOk) {
    checks.vaultSecretFound = vaultSecret !== null;
    checks.vaultSecretNonEmpty = !!(vaultSecret?.trim());

    if (!checks.vaultSecretFound) {
      return {
        ok: false,
        stage: 'secret_missing',
        checks,
        safeDetails,
        recommendation: `No se encontró el secret '${LUSHA_VAULT_SECRET_NAME}' en Vault. Guardarlo desde Configuración → Proveedores → Lusha.`,
      };
    }

    if (!checks.vaultSecretNonEmpty) {
      safeDetails.vaultSecretLength = vaultSecret!.length;
      return {
        ok: false,
        stage: 'secret_empty',
        checks,
        safeDetails,
        recommendation: `El secret '${LUSHA_VAULT_SECRET_NAME}' existe en Vault pero está vacío. Actualizar la API Key de Lusha.`,
      };
    }

    safeDetails.vaultSecretLength = vaultSecret!.length;
    safeDetails.vaultSecretFingerprint = fingerprint(vaultSecret!);

    return {
      ok: true,
      stage: 'resolved_from_vault',
      checks,
      safeDetails,
      recommendation:
        'Credencial Lusha resuelta desde Vault. Si el runner sigue fallando, el problema no es de credenciales — revisar permisos de red o feature flag ENABLE_LUSHA_CONTACT_ENRICHMENT.',
    };
  }

  // ── E. Vault falló — env fallback ─────────────────────────────────────────
  checks.envFallbackNonEmpty = !!(lushaEnvFallback?.trim());

  if (checks.envFallbackNonEmpty) {
    return {
      ok: true,
      stage: 'resolved_from_env_fallback',
      checks,
      safeDetails,
      recommendation:
        'El runtime no pudo leer Supabase Vault vía RPC, pero LUSHA_API_KEY (env fallback) está disponible. Credencial resuelta.',
    };
  }

  return {
    ok: false,
    stage: 'vault_rpc',
    checks,
    safeDetails,
    recommendation: `El runtime no pudo leer Supabase Vault vía RPC y no hay LUSHA_API_KEY de fallback. Verificar: (1) RPC 'get_vault_secret_decrypted' habilitada, (2) SUPABASE_SERVICE_ROLE_KEY correcta, (3) secreto '${LUSHA_VAULT_SECRET_NAME}' en Vault.`,
  };
}

// ── Human-readable message from diagnostic result ─────────────────────────────

export function lushaCredentialDiagnosticMessage(
  result: LushaCredentialDiagnosticResult,
): string {
  switch (result.stage) {
    case 'env_check':
      return result.checks.hasServiceRoleKey
        ? 'Error en variables de entorno de Supabase.'
        : 'El runtime no tiene SUPABASE_SERVICE_ROLE_KEY disponible.';
    case 'admin_client':
      return 'No se pudo crear cliente admin de Supabase.';
    case 'vault_rpc':
      return 'El runtime no pudo leer Supabase Vault vía RPC.';
    case 'secret_missing':
      return `No se encontró el secret '${LUSHA_VAULT_SECRET_NAME}' en Vault.`;
    case 'secret_empty':
      return `El secret '${LUSHA_VAULT_SECRET_NAME}' existe pero está vacío.`;
    case 'resolved_from_vault':
      return 'Credencial Lusha resuelta desde Vault.';
    case 'resolved_from_env_fallback':
      return 'Credencial Lusha resuelta desde variable de entorno (fallback).';
    case 'failed':
      return 'No se pudo resolver la credencial Lusha.';
  }
}

// ── Execution preflight ───────────────────────────────────────────────────────

export type LushaPreflightBlockedBy =
  | 'feature_flag'
  | 'credential'
  | 'runner_configuration'
  | null;

export interface LushaExecutionPreflightResult {
  ok: boolean;
  stages: {
    featureFlag: {
      checked: true;
      enabled: boolean;
    };
    credential: {
      checked: true;
      ok: boolean;
      source: 'vault' | 'env_fallback' | null;
      fingerprint: string | null;
      length: number | null;
    };
    runnerEntry: {
      reachable: boolean;
    };
    providerCall: {
      attempted: false;
    };
  };
  wouldExecuteProvider: boolean;
  blockedBy: LushaPreflightBlockedBy;
  recommendation: string;
}

/**
 * Executes the same pre-conditions as the Lusha runner but stops before calling
 * Lusha. Safe to call anytime: no credits consumed, no candidates created,
 * no provider usage logged.
 */
export async function diagnoseLushaExecutionPreflight(): Promise<LushaExecutionPreflightResult> {
  // 1. Feature flag — same check as the runner
  const flagEnabled = isLushaContactEnrichmentEnabled();

  if (!flagEnabled) {
    return {
      ok: false,
      stages: {
        featureFlag: { checked: true, enabled: false },
        credential: { checked: true, ok: false, source: null, fingerprint: null, length: null },
        runnerEntry: { reachable: false },
        providerCall: { attempted: false },
      },
      wouldExecuteProvider: false,
      blockedBy: 'feature_flag',
      recommendation:
        'ENABLE_LUSHA_CONTACT_ENRICHMENT no está habilitado. Activar la variable de entorno en Vercel y redeploy.',
    };
  }

  // 2. Credential — use the unified resolver (same path as getLushaApiKey)
  const resolution = await resolveLushaCredential();

  if (!resolution.ok) {
    return {
      ok: false,
      stages: {
        featureFlag: { checked: true, enabled: true },
        credential: { checked: true, ok: false, source: null, fingerprint: null, length: null },
        runnerEntry: { reachable: false },
        providerCall: { attempted: false },
      },
      wouldExecuteProvider: false,
      blockedBy: 'credential',
      recommendation:
        `Credencial Lusha no resuelta (stage: ${resolution.stage}). Verificar que '${LUSHA_VAULT_SECRET_NAME}' esté guardado en Vault y que SUPABASE_SERVICE_ROLE_KEY esté disponible en runtime.`,
    };
  }

  // 3. Runner entry reachable (credential resolved, flag on → runner would proceed)
  return {
    ok: true,
    stages: {
      featureFlag: { checked: true, enabled: true },
      credential: {
        checked: true,
        ok: true,
        source: resolution.source,
        fingerprint: resolution.safe.fingerprint,
        length: resolution.safe.length,
      },
      runnerEntry: { reachable: true },
      providerCall: { attempted: false },
    },
    wouldExecuteProvider: true,
    blockedBy: null,
    recommendation:
      'Preflight completado. El runner pasaría las validaciones previas y llamaría a Lusha. Si el runner sigue fallando, el problema es posterior al preflight (run_id inválido, account_id faltante, o error de red hacia Lusha).',
  };
}
