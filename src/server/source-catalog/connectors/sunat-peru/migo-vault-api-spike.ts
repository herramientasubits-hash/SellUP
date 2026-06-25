/**
 * Migo Vault API Spike — Local Vault-based controlled spike
 *
 * Valida con llamadas reales controladas que Migo API sirve para
 * enriquecer empresas peruanas con CIIU y actividad económica.
 *
 * local/offline/development-only — No ejecutar en Vercel ni production.
 * Usa credencial desde Supabase Vault via resolveSourceCredential.
 * No expone token. No escribe Supabase. No crea candidatos.
 */

import { resolveSourceCredential as _resolveSourceCredential } from '../../source-connection-resolver';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

import {
  MIGO_API_BASE,
  MIGO_API_PATH,
} from './types';

import type {
  MigoVaultApiSpikeInput,
  MigoVaultApiSpikeOutput,
  MigoVaultApiSpikeStatus,
  MigoVaultApiSpikeEnvironment,
  MigoVaultApiSpikeRequestProfile,
  MigoVaultApiSpikeDataProfile,
  MigoVaultApiSpikeSampleRow,
  MigoVaultApiSpikeVerdict,
} from './types';

// ─── Constants ───────────────────────────────────────────────────────────────────

// Mutable references for dependency injection in tests
let _resolveFn = _resolveSourceCredential;
let _writeFile = writeFile;

/**
 * INTERNAL — Only for test injection. Replaces the resolveSourceCredential
 * implementation. Call with the original to reset.
 */
export function __setResolveSourceCredentialForTest(
  fn: typeof _resolveSourceCredential,
): void {
  _resolveFn = fn;
}

/**
 * INTERNAL — Only for test injection. Replaces writeFile.
 * Call with the original to reset.
 */
export function __setWriteFileForTest(
  fn: (path: string, data: string, encoding?: BufferEncoding) => Promise<void>,
): void {
  _writeFile = fn as typeof writeFile;
}

const DEFAULT_MAX_RUCS = 10;
const ABSOLUTE_MAX_RUCS = 50;
const DEFAULT_THROTTLE_MS = 500;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_RUC20_SNAPSHOT_PATH = '.tmp/sunat-peru/ruc20-filtered-snapshot.txt';
const DEFAULT_REPORT_PATH = '.tmp/sunat-peru/migo-vault-api-spike-report.json';
const MAX_CONSECUTIVE_ERRORS = 5;

// ─── Helpers ─────────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function maskString(value: string): string {
  if (value.length < 8) return '****';
  const last4 = value.slice(-4);
  return `****${last4}`;
}

function redactPayload(payload: Record<string, unknown>): string {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (key.startsWith('representante')) continue;
    if (key === 'token' || key === 'api_key' || key === 'authorization') continue;
    if (typeof value === 'string' && value.length > 200) {
      safe[key] = value.slice(0, 200) + '...';
    } else {
      safe[key] = value;
    }
  }
  const json = JSON.stringify(safe, null, 2);
  return json.length > 1000 ? json.slice(0, 1000) + '\n  // ... truncated' : json;
}

// ─── RUC Collection ──────────────────────────────────────────────────────────────

async function collectRucsFromSnapshot(
  snapshotPath: string,
  maxRucs: number,
): Promise<{ rucs: string[]; warnings: string[] }> {
  const rucs: string[] = [];
  const warnings: string[] = [];

  if (!existsSync(snapshotPath)) {
    warnings.push(`Snapshot no encontrado: ${snapshotPath}`);
    return { rucs, warnings };
  }

  let lineCount = 0;
  let isHeader = true;

  const rl = createInterface({
    input: createReadStream(snapshotPath, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (isHeader) {
      isHeader = false;
      continue;
    }

    if (rucs.length >= maxRucs) break;

    const parts = line.split('|');
    const ruc = parts[0]?.trim();
    const status = parts[2]?.trim();
    const condition = parts[3]?.trim();

    if (ruc && ruc.startsWith('20') && status === 'ACTIVO' && condition === 'HABIDO') {
      rucs.push(ruc);
    }

    lineCount++;
  }

  if (rucs.length === 0) {
    warnings.push('No se encontraron RUC20 ACTIVO+HABIDO en el snapshot.');
  }

  return { rucs, warnings };
}

// ─── Migo API Call ───────────────────────────────────────────────────────────────

async function callMigoApi(
  token: string,
  ruc: string,
  timeoutMs: number,
): Promise<{
  ok: boolean;
  status: number;
  payload: Record<string, unknown> | null;
  responseTimeMs: number;
  error?: string;
}> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const startMs = Date.now();

  try {
    const url = `${MIGO_API_BASE}${MIGO_API_PATH}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ token, ruc }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const responseTimeMs = Date.now() - startMs;

    const payload = await response.json().catch(() => null);

    if (response.status === 200 && payload && payload.success !== false) {
      return { ok: true, status: response.status, payload, responseTimeMs };
    }

    if (response.status === 401 || response.status === 403) {
      return {
        ok: false,
        status: response.status,
        payload: null,
        responseTimeMs,
        error: 'AUTH_FAILED',
      };
    }

    if (response.status === 429) {
      return {
        ok: false,
        status: response.status,
        payload: null,
        responseTimeMs,
        error: 'RATE_LIMIT',
      };
    }

    return {
      ok: false,
      status: response.status,
      payload: null,
      responseTimeMs,
      error: `HTTP_${response.status}`,
    };
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    const responseTimeMs = Date.now() - startMs;
    const isTimeout = err instanceof Error && err.name === 'AbortError';
    return {
      ok: false,
      status: 0,
      payload: null,
      responseTimeMs,
      error: isTimeout ? 'TIMEOUT' : 'NETWORK_ERROR',
    };
  }
}

// ─── Payload Analyzer ────────────────────────────────────────────────────────────

function analyzePayloads(
  payloads: Array<{ ruc: string; payload: Record<string, unknown>; responseTimeMs: number }>,
): {
  dataProfile: MigoVaultApiSpikeDataProfile;
  sampleRows: MigoVaultApiSpikeSampleRow[];
  sensitiveFieldsDetected: string[];
  persistAllowed: string[];
  persistForbidden: string[];
} {
  let containsRuc = false;
  let containsLegalName = false;
  let containsCiiu = false;
  let containsCiiuRev3 = false;
  let containsCiiuRev4 = false;
  let containsActivityDescription = false;
  let containsSecondaryActivities = false;
  let containsTaxpayerStatus = false;
  let containsDomicileCondition = false;
  let containsAddress = false;
  let containsLegalRepresentatives = false;
  const sensitiveFieldsDetected = new Set<string>();

  const sampleRows: MigoVaultApiSpikeSampleRow[] = [];

  for (const { ruc, payload } of payloads) {
    const payloadStr = JSON.stringify(payload);
    const keys = Object.keys(payload);

    if (keys.some((k) => k === 'ruc')) containsRuc = true;
    if (keys.some((k) => k.includes('razon_social') || k.includes('legal') || k === 'nombre')) containsLegalName = true;
    if (keys.some((k) => k === 'ciiu' || k.includes('ciiu'))) containsCiiu = true;
    if (keys.some((k) => k.includes('ciiu_rev3') || k.includes('ciiu_3'))) containsCiiuRev3 = true;
    if (keys.some((k) => k.includes('ciiu_rev4') || k.includes('ciiu_4') || k === 'ciiu_revision')) containsCiiuRev4 = true;
    if (keys.some((k) => k.includes('actividad') && k.includes('econom'))) containsActivityDescription = true;
    if (keys.some((k) => k.includes('actividad_secundaria') || k.includes('secundaria'))) containsSecondaryActivities = true;
    if (keys.some((k) => k === 'estado' || k.includes('tributario') || k.includes('contribuyente'))) containsTaxpayerStatus = true;
    if (keys.some((k) => k === 'condicion' || k.includes('domicilio'))) containsDomicileCondition = true;
    if (keys.some((k) => k.includes('direccion') || k.includes('ubigeo') || k.includes('departamento'))) containsAddress = true;
    if (keys.some((k) => k.startsWith('representante'))) containsLegalRepresentatives = true;

    if (keys.some((k) => k.startsWith('representante'))) {
      sensitiveFieldsDetected.add('representantes_legales');
    }

    const legalName = payload.nombre_o_razon_social ?? payload.razon_social ?? payload.legal_name ?? undefined;
    const ciiuCode = payload.ciiu ?? payload.codigo_ciiu ?? undefined;
    const ciiuDesc = payload.ciiu_descripcion ?? payload.descripcion_ciiu ?? undefined;
    const activityDesc = payload.actividad_economica ?? payload.actividad_principal ?? undefined;
    const taxpayerStatus = payload.estado ?? payload.estado_contribuyente ?? undefined;
    const domicileCondition = payload.condicion ?? payload.condicion_domicilio ?? undefined;

    sampleRows.push({
      ruc,
      legalName: typeof legalName === 'string' ? legalName : undefined,
      ciiuCode: typeof ciiuCode === 'string' ? ciiuCode : undefined,
      ciiuDescription: typeof ciiuDesc === 'string' ? ciiuDesc : undefined,
      activityDescription: typeof activityDesc === 'string' ? activityDesc : undefined,
      taxpayerStatus: typeof taxpayerStatus === 'string' ? taxpayerStatus : undefined,
      domicileCondition: typeof domicileCondition === 'string' ? domicileCondition : undefined,
      redactedPreview: redactPayload(payload),
    });
  }

  const persistAllowed: string[] = [];
  if (containsRuc) persistAllowed.push('ruc');
  if (containsLegalName) persistAllowed.push('legal_name');
  if (containsCiiu) persistAllowed.push('ciiu_code');
  if (containsCiiuRev3 || containsCiiuRev4) persistAllowed.push('ciiu_revision');
  if (containsCiiu) persistAllowed.push('ciiu_description');
  if (containsActivityDescription) persistAllowed.push('primary_activity_description');
  if (containsSecondaryActivities) persistAllowed.push('secondary_activity_descriptions');
  if (containsTaxpayerStatus) persistAllowed.push('taxpayer_status');
  if (containsDomicileCondition) persistAllowed.push('domicile_condition');
  if (containsAddress) persistAllowed.push('ubigeo', 'department', 'province', 'district', 'address_normalized');
  persistAllowed.push('provider', 'provider_checked_at');

  const persistForbidden: string[] = [
    'legal_representatives',
    'representative_names',
    'representative_document_numbers',
    'personal_phone_numbers',
    'personal_emails',
    'raw_payload',
    'authorization_headers',
    'api_key',
    'token',
  ];

  if (containsLegalRepresentatives) {
    sensitiveFieldsDetected.add('representative_names');
    sensitiveFieldsDetected.add('representative_document_numbers');
  }

  const dataProfile: MigoVaultApiSpikeDataProfile = {
    containsRuc,
    containsLegalName,
    containsCiiu,
    containsCiiuRev3,
    containsCiiuRev4,
    containsActivityDescription,
    containsSecondaryActivities,
    containsTaxpayerStatus,
    containsDomicileCondition,
    containsAddress,
    containsLegalRepresentatives,
  };

  return {
    dataProfile,
    sampleRows,
    sensitiveFieldsDetected: [...sensitiveFieldsDetected],
    persistAllowed,
    persistForbidden,
  };
}

// ─── Verdict Builder ─────────────────────────────────────────────────────────────

function buildVerdict(
  dataProfile: MigoVaultApiSpikeDataProfile,
  status: MigoVaultApiSpikeStatus,
  requestProfile: MigoVaultApiSpikeRequestProfile,
): {
  verdict: MigoVaultApiSpikeVerdict;
  recommendation: string;
} {
  if (status === 'unauthorized') {
    return {
      verdict: 'MIGO_AUTH_FAILED',
      recommendation: 'La credencial configurada no fue autorizada por Migo API. ' +
        'Verifica la API key en el panel de integraciones /settings/source-catalog/pe_migo_api.',
    };
  }

  if (status === 'rate_limited') {
    return {
      verdict: 'MIGO_RATE_LIMIT_BLOCKED',
      recommendation: 'Migo API respondió con rate limiting. ' +
        'Verifica el plan contratado y los límites de consultas por minuto/día.',
    };
  }

  if (status === 'error' || status === 'blocked') {
    return {
      verdict: 'UNKNOWN_NEEDS_MANUAL_REVIEW',
      recommendation: 'El spike no pudo completarse. Revisa los errores reportados.',
    };
  }

  if (status === 'missing_vault_credential') {
    return {
      verdict: 'UNKNOWN_NEEDS_MANUAL_REVIEW',
      recommendation: 'No hay credencial configurada en Vault para Migo API. ' +
        'Configúrala desde /settings/source-catalog/pe_migo_api.',
    };
  }

  if (requestProfile.successfulResponses === 0) {
    return {
      verdict: 'MIGO_NOT_USEFUL_FOR_CIIU',
      recommendation: 'No se obtuvo ninguna respuesta exitosa de Migo API.',
    };
  }

  if (dataProfile.containsRuc && dataProfile.containsCiiu && dataProfile.containsActivityDescription) {
    return {
      verdict: 'MIGO_CONFIRMED_FOR_CIIU_ENRICHMENT',
      recommendation: 'Migo API devuelve CIIU y actividad económica para RUC peruanos. ' +
        'Puede usarse como enrichment provider para Perú. ' +
        'Se recomienda integrar bajo demanda con caché y rate limiting controlado.',
    };
  }

  if (dataProfile.containsRuc && dataProfile.containsCiiu) {
    return {
      verdict: 'MIGO_PARTIAL_PAYLOAD',
      recommendation: 'Migo API devuelve CIIU pero no descripción de actividad económica. ' +
        'Útil como complemento pero no como fuente principal de enrichment.',
    };
  }

  return {
    verdict: 'MIGO_NOT_USEFUL_FOR_CIIU',
    recommendation: 'Migo API no devuelve CIIU ni actividad económica para los RUC consultados.',
  };
}

// ─── Report Writer ───────────────────────────────────────────────────────────────

async function writeReport(
  reportPath: string,
  output: MigoVaultApiSpikeOutput,
): Promise<void> {
  const normalizedPath = reportPath.replace(/\\/g, '/');
  if (!normalizedPath.startsWith('.tmp/sunat-peru/')) {
    throw new Error(
      `Report path fuera de .tmp/sunat-peru/: ${reportPath}. No se escribirá el reporte.`,
    );
  }

  const reportJson = JSON.stringify(output, null, 2);
  await _writeFile(reportPath, reportJson, 'utf-8');
}

// ─── Main Function ───────────────────────────────────────────────────────────────

export async function runMigoVaultApiSpike(
  input?: MigoVaultApiSpikeInput,
): Promise<MigoVaultApiSpikeOutput> {
  const warnings: string[] = [];
  const errors: string[] = [];

  // ── Defaults ─────────────────────────────────────────────────────────────────
  const sourceKey = input?.sourceKey ?? 'pe_migo_api';
  const requireAck = input?.requireAck ?? true;
  const maxRucsToTest = Math.min(
    input?.maxRucsToTest ?? DEFAULT_MAX_RUCS,
    ABSOLUTE_MAX_RUCS,
  );
  const throttleMs = input?.throttleMs ?? DEFAULT_THROTTLE_MS;
  const requestTimeoutMs = input?.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const ruc20SnapshotPath = input?.ruc20SnapshotPath ?? DEFAULT_RUC20_SNAPSHOT_PATH;
  const reportPath = input?.reportPath ?? DEFAULT_REPORT_PATH;

  // ── Guardrails ───────────────────────────────────────────────────────────────
  const vercelDetected = !!process.env.VERCEL;
  const productionDetected = process.env.NODE_ENV === 'production';
  const ackProvided = !requireAck || process.env.MIGO_API_SPIKE_ACK === 'YES';

  const environment: MigoVaultApiSpikeEnvironment = {
    localOnly: true,
    vercelDetected,
    productionDetected,
    ackProvided,
    vaultCredentialPresent: false,
  };

  if (vercelDetected) {
    errors.push('VERCEL_DETECTED: No ejecutar en Vercel. Este spike es local-only.');
  }

  if (productionDetected) {
    errors.push('PRODUCTION_DETECTED: No ejecutar en producción. Este spike es local-only.');
  }

  if (!ackProvided) {
    errors.push(
      'ACK_REQUIRED: Requiere variable de entorno MIGO_API_SPIKE_ACK=YES para confirmar ejecución.',
    );
  }

  if (errors.length > 0) {
    return {
      sourceKey: 'pe_migo_api',
      mode: 'local_vault_api_spike',
      status: 'blocked',
      environment,
      requestProfile: {
        attemptedRequests: 0,
        successfulResponses: 0,
        failedResponses: 0,
        stoppedBecause: errors[0],
        rateLimitDetected: false,
      },
      dataProfile: {
        containsRuc: false,
        containsLegalName: false,
        containsCiiu: false,
        containsCiiuRev3: false,
        containsCiiuRev4: false,
        containsActivityDescription: false,
        containsSecondaryActivities: false,
        containsTaxpayerStatus: false,
        containsDomicileCondition: false,
        containsAddress: false,
        containsLegalRepresentatives: false,
      },
      persistenceRecommendation: {
        persistAllowed: [],
        persistForbidden: [
          'legal_representatives', 'representative_names',
          'representative_document_numbers', 'personal_phone_numbers',
          'personal_emails', 'raw_payload', 'authorization_headers',
          'api_key', 'token',
        ],
        sensitiveFieldsDetected: [],
      },
      sampleRows: [],
      verdict: 'UNKNOWN_NEEDS_MANUAL_REVIEW',
      recommendation: 'Spike bloqueado por guardrails de seguridad.',
      warnings,
      errors,
    };
  }

  // ── Resolve Vault Credential ─────────────────────────────────────────────────
  let credential: { token: string; authType: string } | null = null;

  try {
    credential = await _resolveFn(sourceKey);
  } catch {
    // Fall through — credential stays null
  }

  if (!credential || !credential.token) {
    environment.vaultCredentialPresent = false;
    const status: MigoVaultApiSpikeStatus = 'missing_vault_credential';
    errors.push(
      `No se encontró credencial configurada para '${sourceKey}' en Vault. ` +
      'Configúrala desde /settings/source-catalog/pe_migo_api.',
    );

    const output: MigoVaultApiSpikeOutput = {
      sourceKey: 'pe_migo_api',
      mode: 'local_vault_api_spike',
      status,
      environment,
      requestProfile: {
        attemptedRequests: 0,
        successfulResponses: 0,
        failedResponses: 0,
        rateLimitDetected: false,
      },
      dataProfile: {
        containsRuc: false,
        containsLegalName: false,
        containsCiiu: false,
        containsCiiuRev3: false,
        containsCiiuRev4: false,
        containsActivityDescription: false,
        containsSecondaryActivities: false,
        containsTaxpayerStatus: false,
        containsDomicileCondition: false,
        containsAddress: false,
        containsLegalRepresentatives: false,
      },
      persistenceRecommendation: {
        persistAllowed: [],
        persistForbidden: [
          'legal_representatives', 'representative_names',
          'representative_document_numbers', 'personal_phone_numbers',
          'personal_emails', 'raw_payload', 'authorization_headers',
          'api_key', 'token',
        ],
        sensitiveFieldsDetected: [],
      },
      sampleRows: [],
      verdict: 'UNKNOWN_NEEDS_MANUAL_REVIEW',
      recommendation: 'Credencial no encontrada. No se pudo ejecutar el spike.',
      warnings,
      errors,
    };

    await writeReport(reportPath, output).catch(() => {});
    return output;
  }

  environment.vaultCredentialPresent = true;
  const token = credential.token;

  // ── Collect RUCs ─────────────────────────────────────────────────────────────
  let rucsToTest: string[] = [];

  if (input?.sampleRucs && input.sampleRucs.length > 0) {
    rucsToTest = input.sampleRucs.slice(0, maxRucsToTest);
  } else {
    const result = await collectRucsFromSnapshot(ruc20SnapshotPath, maxRucsToTest);
    rucsToTest = result.rucs;
    warnings.push(...result.warnings);
  }

  if (rucsToTest.length === 0) {
    errors.push('No hay RUCs para probar. Revisa el snapshot o proporciona sampleRucs.');
    const output: MigoVaultApiSpikeOutput = {
      sourceKey: 'pe_migo_api',
      mode: 'local_vault_api_spike',
      status: 'error',
      environment,
      requestProfile: {
        attemptedRequests: 0,
        successfulResponses: 0,
        failedResponses: 0,
        rateLimitDetected: false,
      },
      dataProfile: {
        containsRuc: false,
        containsLegalName: false,
        containsCiiu: false,
        containsCiiuRev3: false,
        containsCiiuRev4: false,
        containsActivityDescription: false,
        containsSecondaryActivities: false,
        containsTaxpayerStatus: false,
        containsDomicileCondition: false,
        containsAddress: false,
        containsLegalRepresentatives: false,
      },
      persistenceRecommendation: {
        persistAllowed: [],
        persistForbidden: [
          'legal_representatives', 'representative_names',
          'representative_document_numbers', 'personal_phone_numbers',
          'personal_emails', 'raw_payload', 'authorization_headers',
          'api_key', 'token',
        ],
        sensitiveFieldsDetected: [],
      },
      sampleRows: [],
      verdict: 'UNKNOWN_NEEDS_MANUAL_REVIEW',
      recommendation: 'No hay RUCs para probar.',
      warnings,
      errors,
    };
    await writeReport(reportPath, output).catch(() => {});
    return output;
  }

  // ── Execute API Calls ────────────────────────────────────────────────────────
  const successfulPayloads: Array<{
    ruc: string;
    payload: Record<string, unknown>;
    responseTimeMs: number;
  }> = [];

  let attemptedRequests = 0;
  let successfulResponses = 0;
  let failedResponses = 0;
  let consecutiveErrors = 0;
  let rateLimitDetected = false;
  let stoppedBecause: string | undefined;
  let totalResponseTimeMs = 0;

  for (const ruc of rucsToTest) {
    if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
      stoppedBecause = `max_consecutive_errors_${MAX_CONSECUTIVE_ERRORS}`;
      warnings.push(
        `Se alcanzaron ${MAX_CONSECUTIVE_ERRORS} errores consecutivos. Deteniendo.`,
      );
      break;
    }

    if (throttleMs > 0 && attemptedRequests > 0) {
      await sleep(throttleMs);
    }

    attemptedRequests++;
    const result = await callMigoApi(token, ruc, requestTimeoutMs);

    if (result.ok && result.payload) {
      successfulResponses++;
      consecutiveErrors = 0;
      totalResponseTimeMs += result.responseTimeMs;
      successfulPayloads.push({ ruc, payload: result.payload, responseTimeMs: result.responseTimeMs });
    } else if (result.error === 'AUTH_FAILED') {
      failedResponses++;
      stoppedBecause = `auth_failed_http_${result.status}`;
      warnings.push(
        `Migo API rechazó la credencial (HTTP ${result.status}) para RUC ${ruc}. Deteniendo.`,
      );
      consecutiveErrors = MAX_CONSECUTIVE_ERRORS;
      break;
    } else if (result.error === 'RATE_LIMIT') {
      failedResponses++;
      rateLimitDetected = true;
      stoppedBecause = `rate_limit_http_429`;
      warnings.push(
        `Migo API respondió con rate limiting (HTTP 429) para RUC ${ruc}. Deteniendo.`,
      );
      consecutiveErrors = MAX_CONSECUTIVE_ERRORS;
      break;
    } else {
      failedResponses++;
      consecutiveErrors++;
      warnings.push(
        `Error en RUC ${ruc}: ${result.error ?? 'unknown'} (HTTP ${result.status}). ` +
        `Error consecutivo #${consecutiveErrors}.`,
      );
    }
  }

  if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS && !stoppedBecause) {
    stoppedBecause = `max_consecutive_errors_${MAX_CONSECUTIVE_ERRORS}`;
  }

  const averageResponseTimeMs =
    successfulResponses > 0
      ? Math.round(totalResponseTimeMs / successfulResponses)
      : undefined;

  const requestProfile: MigoVaultApiSpikeRequestProfile = {
    attemptedRequests,
    successfulResponses,
    failedResponses,
    stoppedBecause,
    rateLimitDetected,
    averageResponseTimeMs,
  };

  // ── Determine Status ─────────────────────────────────────────────────────────
  let status: MigoVaultApiSpikeStatus = 'completed';
  if (stoppedBecause?.startsWith('auth_failed')) {
    status = 'unauthorized';
  } else if (rateLimitDetected) {
    status = 'rate_limited';
  } else if (successfulResponses === 0 && attemptedRequests > 0) {
    status = 'error';
  }

  // ── Analyze Payloads ─────────────────────────────────────────────────────────
  const analysis = analyzePayloads(successfulPayloads);

  // ── Build Verdict ────────────────────────────────────────────────────────────
  const { verdict, recommendation } = buildVerdict(
    analysis.dataProfile,
    status,
    requestProfile,
  );

  // ── Build Output ─────────────────────────────────────────────────────────────
  const output: MigoVaultApiSpikeOutput = {
    sourceKey: 'pe_migo_api',
    mode: 'local_vault_api_spike',
    status,
    environment,
    requestProfile,
    dataProfile: analysis.dataProfile,
    persistenceRecommendation: {
      persistAllowed: analysis.persistAllowed,
      persistForbidden: analysis.persistForbidden,
      sensitiveFieldsDetected: analysis.sensitiveFieldsDetected,
    },
    sampleRows: analysis.sampleRows,
    verdict,
    recommendation,
    warnings,
    errors,
  };

  // ── Write Report ─────────────────────────────────────────────────────────────
  await writeReport(reportPath, output).catch((err: unknown) => {
    warnings.push(
      `No se pudo escribir el reporte en ${reportPath}: ${err instanceof Error ? err.message : 'unknown'}`,
    );
  });

  return output;
}
