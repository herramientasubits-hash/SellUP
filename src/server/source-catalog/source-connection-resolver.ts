/**
 * Source Connection Resolver — Server-only
 *
 * Resuelve credenciales de fuentes del catálogo desde Supabase Vault.
 * Usa el service role para leer secretos descifrados — nunca exponer al browser.
 *
 * Fallback a env solo en NODE_ENV !== 'production' y solo si la variable existe.
 * En producción, si la fuente requiere credenciales y no están en Vault: error claro.
 *
 * Naming convention de secretos en Vault:
 *   denue_mexico → 'sellup_source_denue_mexico_token'
 */

import { createClient as createAdminClient } from '@supabase/supabase-js';

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  'https://lrdruowtadwbdulndlph.supabase.co';
const supabaseServiceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxyZHJ1b3d0YWR3YmR1bG5kbHBoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODgzODY2NCwiZXhwIjoyMDk0NDE0NjY0fQ.0fnp65rmdJxklJvVkaWuA3J9dtBpf0Jg2zB2kSyyg0E';

// Nombres de secretos en Vault por source_key
export const VAULT_SOURCE_SECRET_NAMES: Record<string, string> = {
  denue_mexico: 'sellup_source_denue_mexico_token',
  chilecompra_chile: 'sellup_source_chilecompra_ticket',
} as const;

// Fallback env solo en desarrollo — NUNCA en producción
const DEV_ENV_FALLBACK: Record<string, string> = {
  denue_mexico: 'INEGI_DENUE_TOKEN',
  chilecompra_chile: 'CHILECOMPRA_API_TICKET',
};

export type AuthType = 'api_key' | 'bearer_token' | 'oauth2';

export type ResolvedSourceCredential = {
  token: string;
  authType: AuthType;
  sourceKey: string;
  vaultSecretName: string;
};

type SourceCatalogConnectionRow = {
  source_key: string;
  requires_credentials: boolean;
  credentials_status: string;
  auth_type: string;
  vault_secret_name: string | null;
};

function getAdminSupabase() {
  return createAdminClient(supabaseUrl, supabaseServiceKey);
}

function isDevelopment(): boolean {
  return process.env.NODE_ENV !== 'production';
}

/**
 * Resuelve la credencial de una fuente del catálogo.
 *
 * Fuentes sin credenciales (requires_credentials = false):
 *   retorna null — no lanza error.
 *
 * Fuentes con credenciales:
 *   1. Lee vault_secret_name desde source_catalog_connections.
 *   2. Descifra el secreto via get_vault_secret_decrypted() con service role.
 *   3. Si Vault falla y NODE_ENV !== 'production', intenta fallback env.
 *   4. En producción sin secreto en Vault: error explícito.
 */
export async function resolveSourceCredential(
  sourceKey: string,
): Promise<ResolvedSourceCredential | null> {
  const admin = getAdminSupabase();

  const { data, error } = await admin
    .from('source_catalog_connections')
    .select('source_key, requires_credentials, credentials_status, auth_type, vault_secret_name')
    .eq('source_key', sourceKey)
    .single<SourceCatalogConnectionRow>();

  if (error || !data) {
    throw new Error(
      `SourceConnectionResolver: fuente '${sourceKey}' no encontrada en source_catalog_connections. ` +
      `Verifica que la migración 047 fue aplicada y el seed está presente.`,
    );
  }

  if (!data.requires_credentials) {
    return null;
  }

  const vaultSecretName = data.vault_secret_name ?? VAULT_SOURCE_SECRET_NAMES[sourceKey];

  if (!vaultSecretName) {
    throw new Error(
      `SourceConnectionResolver: fuente '${sourceKey}' requiere credenciales pero no tiene vault_secret_name configurado.`,
    );
  }

  if (data.credentials_status !== 'stored') {
    if (!isDevelopment()) {
      throw new Error(
        `SourceConnectionResolver: Missing stored credentials for source '${sourceKey}'. ` +
        `credentials_status='${data.credentials_status}'. Configura la credencial desde el panel de integraciones.`,
      );
    }

    // Desarrollo: intentar fallback env
    const envVar = DEV_ENV_FALLBACK[sourceKey];
    const envToken = envVar ? process.env[envVar] : undefined;

    if (!envToken || envToken.trim() === '') {
      throw new Error(
        `SourceConnectionResolver [dev]: credencial no almacenada en Vault para '${sourceKey}' ` +
        `y no se encontró variable de entorno de fallback (${envVar ?? 'sin mapping'}).`,
      );
    }

    return {
      token: envToken.trim(),
      authType: (data.auth_type as AuthType) || 'api_key',
      sourceKey,
      vaultSecretName,
    };
  }

  // Leer desde Vault via RPC (service role)
  const { data: vaultResult, error: vaultError } = await admin.rpc(
    'get_vault_secret_decrypted',
    { p_name: vaultSecretName },
  );

  if (vaultError || vaultResult === null || vaultResult === undefined) {
    if (!isDevelopment()) {
      throw new Error(
        `SourceConnectionResolver: No se pudo leer el secreto Vault '${vaultSecretName}' ` +
        `para fuente '${sourceKey}'. Verifica que el secreto existe en Vault.`,
      );
    }

    // Desarrollo: fallback env aunque credentials_status sea 'stored'
    const envVar = DEV_ENV_FALLBACK[sourceKey];
    const envToken = envVar ? process.env[envVar] : undefined;

    if (!envToken || envToken.trim() === '') {
      throw new Error(
        `SourceConnectionResolver [dev]: Vault falló para '${sourceKey}' ` +
        `y el fallback env (${envVar ?? 'sin mapping'}) tampoco está disponible.`,
      );
    }

    return {
      token: envToken.trim(),
      authType: (data.auth_type as AuthType) || 'api_key',
      sourceKey,
      vaultSecretName,
    };
  }

  const token = String(vaultResult).trim();

  if (!token) {
    throw new Error(
      `SourceConnectionResolver: El secreto Vault '${vaultSecretName}' para '${sourceKey}' está vacío.`,
    );
  }

  return {
    token,
    authType: (data.auth_type as AuthType) || 'api_key',
    sourceKey,
    vaultSecretName,
  };
}
