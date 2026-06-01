'use server';

import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { testDenueConnection } from '@/server/source-catalog/connectors/denue-mexico/denue-client';
import { resolveSourceCredential } from '@/server/source-catalog/source-connection-resolver';
import { runDenueCandidateDryRun } from '@/server/source-catalog/connectors/denue-mexico/run-denue-candidate-dry-run';
import type { DenueCandidateDryRunReport } from '@/server/source-catalog/connectors/denue-mexico/run-denue-candidate-dry-run';

// ─── Admin Supabase (service role — server-only) ───────────────────────────────

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  'https://lrdruowtadwbdulndlph.supabase.co';
const supabaseServiceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxyZHJ1b3d0YWR3YmR1bG5kbHBoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODgzODY2NCwiZXhwIjoyMDk0NDE0NjY0fQ.0fnp65rmdJxklJvVkaWuA3J9dtBpf0Jg2zB2kSyyg0E';

function getAdminSupabase() {
  return createAdminClient(supabaseUrl, supabaseServiceKey);
}

// ─── Result types ──────────────────────────────────────────────────────────────

export type ConfigureSourceCredentialResult = {
  ok: boolean;
  sourceKey: string;
  credentialsStatus?: string;
  connectionStatus?: string;
  message?: string;
  error?: string;
};

export type TestSourceCredentialConnectionResult = {
  ok: boolean;
  sourceKey: string;
  connectionStatus?: string;
  testStatus?: string;
  httpStatus?: number | null;
  responseTimeMs?: number | null;
  message?: string;
  error?: string;
};

// ─── Admin validation (mirrors integrations/actions.ts pattern) ────────────────

async function getAdminInternalUserId(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<{ id: string | null; error?: string }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { id: null, error: 'No autenticado' };

  const { data: internalUser } = await supabase
    .from('internal_users')
    .select('id, role_id')
    .eq('auth_user_id', user.id)
    .eq('access_status', 'active')
    .single();

  if (!internalUser) return { id: null, error: 'Usuario no encontrado o inactivo' };

  const { data: role } = await supabase
    .from('roles')
    .select('key')
    .eq('id', internalUser.role_id)
    .single();

  if (role?.key !== 'admin') return { id: null, error: 'No autorizado' };

  return { id: internalUser.id };
}

// ─── Audit log (uses generic event_type values already in CHECK constraint) ────
// Note: integration_audit.event_type constraint only covers existing generic events.
// Source-specific events (source_credential_stored etc.) need migration 048 to be
// added — see DEBT section at bottom of this file. For now we use generic values.

async function logSourceAuditEvent(
  sourceKey: string,
  eventType: string,
  actorId: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  try {
    const admin = getAdminSupabase();
    await admin.from('integration_audit').insert({
      integration_key: sourceKey,
      event_type: eventType,
      actor_user_id: actorId,
      metadata: metadata ?? null,
    });
  } catch {
    // Audit failures must never block main operations
  }
}

// ─── Rate limiting (in-memory, single server instance) ────────────────────────

type RateLimitEntry = { count: number; windowStart: number };
const credentialTestRateLimitMap = new Map<string, RateLimitEntry>();
const CRED_TEST_RATE_LIMIT_WINDOW_MS = 60_000;
const CRED_TEST_RATE_LIMIT_MAX = 3;

function checkCredentialTestRateLimit(userId: string, sourceKey: string): boolean {
  const key = `${userId}:${sourceKey}`;
  const now = Date.now();
  const entry = credentialTestRateLimitMap.get(key);

  if (!entry || now - entry.windowStart > CRED_TEST_RATE_LIMIT_WINDOW_MS) {
    credentialTestRateLimitMap.set(key, { count: 1, windowStart: now });
    return true;
  }

  if (entry.count >= CRED_TEST_RATE_LIMIT_MAX) return false;

  entry.count += 1;
  return true;
}

// ─── Error sanitization ───────────────────────────────────────────────────────

function sanitizeConnectionError(error: unknown): string {
  let msg =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'Error desconocido';

  // Remove long alphanumeric sequences that may be tokens embedded in URLs
  msg = msg.replace(/\/[A-Za-z0-9_-]{20,}(?=\/|\s|$)/g, '/[REDACTED]');

  return msg.slice(0, 500);
}

// ─── configureSourceCredentialAction ──────────────────────────────────────────
//
// Stores or replaces a source credential in Supabase Vault, then updates
// source_catalog_connections. Never stores or returns the secret itself.

export async function configureSourceCredentialAction(
  sourceKey: string,
  secret: string,
): Promise<ConfigureSourceCredentialResult> {
  // 1. Validate admin
  const supabase = await createClient();
  const { id: actorId, error: authError } = await getAdminInternalUserId(supabase);
  if (!actorId) {
    return { ok: false, sourceKey, error: authError ?? 'No autorizado' };
  }

  // 2. Validate inputs
  if (!sourceKey || sourceKey.trim().length === 0) {
    return { ok: false, sourceKey, error: 'sourceKey es requerido' };
  }
  if (!secret || secret.trim().length === 0) {
    return { ok: false, sourceKey, error: 'El secreto no puede estar vacío' };
  }

  const admin = getAdminSupabase();

  // 3. Validate sourceKey exists in catalog
  const { data: sourceRow, error: sourceError } = await admin
    .from('source_catalog_connections')
    .select('source_key, requires_credentials, vault_secret_name')
    .eq('source_key', sourceKey.trim())
    .single();

  if (sourceError || !sourceRow) {
    return {
      ok: false,
      sourceKey,
      error: `Fuente '${sourceKey}' no encontrada en el catálogo`,
    };
  }

  // 4. Validate source requires credentials
  if (!sourceRow.requires_credentials) {
    return {
      ok: false,
      sourceKey,
      error: `La fuente '${sourceKey}' no requiere credenciales`,
    };
  }

  // 5. Resolve vault_secret_name
  const vaultSecretName = sourceRow.vault_secret_name as string | null;
  if (!vaultSecretName) {
    return {
      ok: false,
      sourceKey,
      error: `La fuente '${sourceKey}' no tiene vault_secret_name configurado`,
    };
  }

  // 6. Upsert secret in Vault (service role only — never logged, never returned)
  const { data: vaultSecretId, error: vaultError } = await admin.rpc('upsert_vault_secret', {
    p_name: vaultSecretName,
    p_secret: secret.trim(),
    p_description: `Token de fuente ${sourceKey} para SellUp`,
  });

  if (vaultError) {
    return {
      ok: false,
      sourceKey,
      error: 'Error al guardar la credencial en Vault',
    };
  }

  // 7. Update source_catalog_connections (vault_secret_id only — never the secret)
  const now = new Date().toISOString();
  await admin
    .from('source_catalog_connections')
    .update({
      vault_secret_id: vaultSecretId as string,
      credentials_status: 'stored',
      connection_status: 'not_tested',
      connected_at: null,
      connected_by: null,
      last_connection_error: null,
      updated_at: now,
    })
    .eq('source_key', sourceKey.trim());

  // 8. Audit (uses generic 'credential_stored' — already in event_type CHECK constraint)
  await logSourceAuditEvent(sourceKey, 'credential_stored', actorId);

  // 9. Return safe result — no token, no secret
  return {
    ok: true,
    sourceKey,
    credentialsStatus: 'stored',
    connectionStatus: 'not_tested',
    message: 'Credencial guardada correctamente. Prueba la conexión para verificarla.',
  };
}

// ─── testSourceCredentialConnectionAction ─────────────────────────────────────
//
// Reads the credential from Vault, runs the source-specific connection test,
// and persists the result in source_catalog_connections. Never returns the token.

export async function testSourceCredentialConnectionAction(
  sourceKey: string,
): Promise<TestSourceCredentialConnectionResult> {
  // 1. Validate admin
  const supabase = await createClient();
  const { id: actorId, error: authError } = await getAdminInternalUserId(supabase);
  if (!actorId) {
    return { ok: false, sourceKey, error: authError ?? 'No autorizado' };
  }

  // 2. Rate limit check
  if (!checkCredentialTestRateLimit(actorId, sourceKey)) {
    return {
      ok: false,
      sourceKey,
      error: 'Demasiados intentos. Espera un momento antes de volver a probar.',
    };
  }

  const admin = getAdminSupabase();

  // 3. Look up source record
  const { data: sourceRow, error: sourceError } = await admin
    .from('source_catalog_connections')
    .select('source_key, requires_credentials, credentials_status, vault_secret_name, connection_status')
    .eq('source_key', sourceKey)
    .single();

  if (sourceError || !sourceRow) {
    return {
      ok: false,
      sourceKey,
      error: `Fuente '${sourceKey}' no encontrada en el catálogo`,
    };
  }

  // 4. Sources that don't require credentials
  if (!sourceRow.requires_credentials) {
    return {
      ok: true,
      sourceKey,
      connectionStatus: 'not_applicable',
      testStatus: 'success',
      message: 'Esta fuente no requiere credenciales de autenticación',
    };
  }

  // 5. Credentials must be stored before testing
  if (sourceRow.credentials_status !== 'stored') {
    return {
      ok: false,
      sourceKey,
      connectionStatus: 'error',
      testStatus: 'failed',
      error: `Credencial no configurada para '${sourceKey}'. Configura el token primero.`,
    };
  }

  // 6. Resolve credential from Vault (service role — token never leaves server)
  let token: string;
  try {
    const resolved = await resolveSourceCredential(sourceKey);
    if (!resolved) {
      return {
        ok: false,
        sourceKey,
        error: 'No se pudo resolver la credencial desde Vault',
      };
    }
    token = resolved.token;
  } catch (resolverError: unknown) {
    return {
      ok: false,
      sourceKey,
      error: `Error al recuperar credencial: ${sanitizeConnectionError(resolverError)}`,
    };
  }

  // 7. Source-specific connection test
  if (sourceKey !== 'denue_mexico') {
    return {
      ok: false,
      sourceKey,
      error: `Prueba de credencial no soportada para fuente '${sourceKey}'`,
    };
  }

  await logSourceAuditEvent(sourceKey, 'connection_tested', actorId);

  const testResult = await testDenueConnection(token);

  const httpStatus = testResult.httpStatus ?? null;
  const responseTimeMs = testResult.responseTimeMs ?? null;

  let testStatus: 'success' | 'failed' | 'auth_error';
  let connectionStatus: string;
  let sanitizedError: string | null = null;

  if (testResult.ok) {
    testStatus = 'success';
    connectionStatus = 'connected';
  } else {
    const rawError = testResult.error ?? 'Error desconocido';
    const lowerErr = rawError.toLowerCase();
    testStatus =
      lowerErr.includes('token inválido') ||
      lowerErr.includes('html') ||
      lowerErr.includes('expirado')
        ? 'auth_error'
        : 'failed';
    connectionStatus = 'error';
    sanitizedError = sanitizeConnectionError(rawError);
  }

  // 8. Persist test result — token never written to DB
  const now = new Date().toISOString();
  const updatePayload: Record<string, unknown> = {
    last_tested_at: now,
    last_tested_by: actorId,
    last_test_status: testStatus,
    last_test_http_status: httpStatus,
    last_test_response_time_ms: responseTimeMs,
    last_connection_error: sanitizedError,
    connection_status: connectionStatus,
    updated_at: now,
  };
  if (testStatus === 'success') {
    updatePayload.connected_at = now;
    updatePayload.connected_by = actorId;
  }

  await admin
    .from('source_catalog_connections')
    .update(updatePayload)
    .eq('source_key', sourceKey);

  // Audit result
  if (testStatus === 'success') {
    await logSourceAuditEvent(sourceKey, 'connection_succeeded', actorId, {
      http_status: httpStatus,
      response_time_ms: responseTimeMs,
    });
  } else {
    await logSourceAuditEvent(sourceKey, 'connection_failed', actorId, {
      test_status: testStatus,
    });
  }

  // 9. Return safe result — no token
  return {
    ok: testStatus === 'success',
    sourceKey,
    connectionStatus,
    testStatus,
    httpStatus,
    responseTimeMs,
    message:
      testStatus === 'success'
        ? 'Conexión verificada correctamente'
        : (sanitizedError ?? 'Error al probar la conexión'),
    ...(testStatus !== 'success' && { error: sanitizedError ?? 'Error al probar la conexión' }),
  };
}

// ─── DEBT: Audit event types for source catalog ────────────────────────────────
//
// The integration_audit.event_type CHECK constraint (migration 042) does not
// include source-specific events. We currently use generic values:
//   - 'credential_stored'  → configureSourceCredentialAction success
//   - 'connection_tested'  → testSourceCredentialConnectionAction start
//   - 'connection_succeeded' / 'connection_failed' → test result
//
// Future migration (048) should add source-specific events:
//   'source_credential_stored', 'source_credential_updated',
//   'source_connection_tested', 'source_connection_succeeded',
//   'source_connection_failed'
//
// Also: integration_key for source catalog connections uses source_key values
// ('denue_mexico', etc.) which differ from integration keys ('hubspot', 'slack').
// Consider a separate source_catalog_audit table in a future hito.

// ─── Safe dry-run report (no token, no PII) ───────────────────────────────────

export type SafeDryRunSummary = {
  recordsRead: number;
  normalizedCount: number;
  acceptedDraftsCount: number;
  filteredOutCount: number;
  lowPriorityCount: number;
  noTaxIdCount: number;
  errorsCount: number;
};

export type SafeDryRunSampleItem = {
  name: string | null;
  city: string | null;
  department: string | null;
  activity: string | null;
  qualityDecision: string;
  qualityReason: string;
};

export type SafeDryRunFilteredSample = {
  name: string | null;
  city: string | null;
  filterReason: string;
};

export type SafeDryRunReport = {
  executedAt: string;
  sourceKey: string;
  sourceProvider: string;
  countryCode: string;
  connectionSource: 'vault/resolver' | 'env_fallback';
  queryParams: {
    codigoActividad: string;
    entidades: string[];
    condiciones: string[];
  };
  summary: SafeDryRunSummary;
  warnings: string[];
  sampleItems: SafeDryRunSampleItem[];
  filteredSamples: SafeDryRunFilteredSample[];
};

export type RunSourceDryRunResult = {
  ok: boolean;
  sourceKey: string;
  report?: SafeDryRunReport;
  error?: string;
};

// Rate limit for dry-run (in-memory, single server instance)
const dryRunRateLimitMap = new Map<string, { count: number; windowStart: number }>();
const DRY_RUN_RATE_LIMIT_WINDOW_MS = 300_000; // 5 min window
const DRY_RUN_RATE_LIMIT_MAX = 2;

function checkDryRunRateLimit(userId: string, sourceKey: string): boolean {
  const key = `${userId}:${sourceKey}:dryrun`;
  const now = Date.now();
  const entry = dryRunRateLimitMap.get(key);
  if (!entry || now - entry.windowStart > DRY_RUN_RATE_LIMIT_WINDOW_MS) {
    dryRunRateLimitMap.set(key, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= DRY_RUN_RATE_LIMIT_MAX) return false;
  entry.count += 1;
  return true;
}

function buildSafeReport(
  report: DenueCandidateDryRunReport,
  connectionSource: 'vault/resolver' | 'env_fallback',
): SafeDryRunReport {
  return {
    executedAt: report.executedAt,
    sourceKey: report.sourceKey,
    sourceProvider: report.sourceProvider,
    countryCode: report.countryCode,
    connectionSource,
    queryParams: report.queryParams,
    summary: {
      recordsRead: report.summary.recordsRead,
      normalizedCount: report.summary.normalizedCount,
      acceptedDraftsCount: report.summary.acceptedDraftsCount,
      filteredOutCount: report.summary.filteredOutCount,
      lowPriorityCount: report.summary.lowPriorityCount,
      noTaxIdCount: report.summary.noTaxIdCount,
      errorsCount: report.summary.errorsCount,
    },
    warnings: report.warnings,
    // Max 5 sample items, only safe fields
    sampleItems: report.items.slice(0, 5).map((item) => ({
      name: item.name,
      city: item.city,
      department: item.department,
      activity: item.activity,
      qualityDecision: item.qualityDecision,
      qualityReason: item.qualityReason,
    })),
    filteredSamples: report.filteredSamples.slice(0, 5).map((s) => ({
      name: s.name,
      city: s.city,
      filterReason: s.filterReason,
    })),
  };
}

// ─── runSourceDryRunAction ─────────────────────────────────────────────────────
//
// Executes a controlled dry-run for a source using the credential stored in Vault.
// Currently only supports denue_mexico. No writes to Supabase. No token in output.

export async function runSourceDryRunAction(
  sourceKey: string,
): Promise<RunSourceDryRunResult> {
  // Accept both catalog key (mx_denue) and DB source_key (denue_mexico)
  const DENUE_KEYS = new Set(['denue_mexico', 'mx_denue']);
  if (!DENUE_KEYS.has(sourceKey)) {
    return {
      ok: false,
      sourceKey,
      error: `Dry-run no soportado para fuente '${sourceKey}'. Solo denue_mexico está disponible.`,
    };
  }
  // Normalize to DB key for resolver
  const dbSourceKey = 'denue_mexico';

  // 1. Validate admin
  const supabase = await createClient();
  const { id: actorId, error: authError } = await getAdminInternalUserId(supabase);
  if (!actorId) {
    return { ok: false, sourceKey, error: authError ?? 'No autorizado' };
  }

  // 2. Rate limit (use dbSourceKey for consistent key)
  if (!checkDryRunRateLimit(actorId, dbSourceKey)) {
    return {
      ok: false,
      sourceKey,
      error: 'Demasiadas ejecuciones de dry-run. Espera 5 minutos antes de volver a intentar.',
    };
  }

  // 3. Resolve credential from Vault (always uses DB key)
  let resolvedToken: string;
  let connectionSource: 'vault/resolver' | 'env_fallback';

  try {
    const resolved = await resolveSourceCredential(dbSourceKey);
    if (!resolved) {
      return {
        ok: false,
        sourceKey,
        error: 'La fuente no requiere credencial — configuración inesperada.',
      };
    }
    resolvedToken = resolved.token;
    connectionSource = resolved.vaultSecretName ? 'vault/resolver' : 'env_fallback';
  } catch (resolverErr: unknown) {
    return {
      ok: false,
      sourceKey,
      error: `No se pudo resolver la credencial: ${sanitizeConnectionError(resolverErr)}`,
    };
  }

  // 4. Execute dry-run — no writes, no HubSpot, no Supabase writes
  try {
    const report = await runDenueCandidateDryRun({ resolvedToken });
    const safeReport = buildSafeReport(report, connectionSource);

    await logSourceAuditEvent(dbSourceKey, 'connection_tested', actorId, {
      dry_run: true,
      records_read: report.summary.recordsRead,
      accepted: report.summary.acceptedDraftsCount,
    });

    return { ok: true, sourceKey, report: safeReport };
  } catch (dryRunErr: unknown) {
    return {
      ok: false,
      sourceKey,
      error: `Error ejecutando dry-run: ${sanitizeConnectionError(dryRunErr)}`,
    };
  }
}
