/**
 * Lusha Credential Diagnostics — 17B.4P
 *
 * Diagnóstico server-only para resolución de credenciales Lusha.
 * No expone secretos. No llama Lusha. No crea candidatos ni contactos.
 * Registra evidencia segura: stage, checks booleanos, detalles sanitizados.
 */

import { createClient as createAdminClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';

import { LUSHA_VAULT_SECRET_NAME } from './lusha-connection';

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

  // ── A. Env check ─────────────────────────────────────────────────────────
  const supabaseUrl =
    process.env['NEXT_PUBLIC_SUPABASE_URL'] ||
    'https://lrdruowtadwbdulndlph.supabase.co';
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

  // ── B. Admin client ───────────────────────────────────────────────────────
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient(supabaseUrl, serviceRoleKey!);
    checks.adminClientCreated = true;
  } catch (err: unknown) {
    const name = err instanceof Error ? err.constructor.name : 'UnknownError';
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
          'No se pudo crear cliente admin de Supabase. Credencial Lusha resuelta desde LUSHA_API_KEY (env fallback).',
      };
    }

    return {
      ok: false,
      stage: 'admin_client',
      checks,
      safeDetails,
      recommendation:
        'No se pudo crear cliente admin de Supabase. Verificar que SUPABASE_SERVICE_ROLE_KEY sea un JWT válido.',
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
