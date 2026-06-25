'use server';

/**
 * discoverSourceCandidatesAction — Hito 16AJ.3
 *
 * Server Action segura que expone runSourceDiscovery para uso futuro desde
 * Agente 1 o desde una UI controlada.
 *
 * Contrato de seguridad:
 *   NO escribe en Supabase. NO crea prospect_batches. NO crea prospect_candidates.
 *   NO toca HubSpot. NO toca Tavily. NO activa Agente 1.
 *   Solo lectura. Solo reporte en memoria. Solo mode=dry_run.
 *   No retorna tokens, tickets ni payloads crudos.
 */

import { createClient } from '@/lib/supabase/server';
import { runSourceDiscovery } from '@/server/source-catalog/run-source-discovery';
import type { SourceDiscoveryCriteria } from '@/server/source-catalog/source-discovery-types';

// ─── Tipos públicos ────────────────────────────────────────────────────────────

export interface DiscoverSourceCandidatesInput {
  sourceKey: string;
  countryCode: string;
  criteria?: SourceDiscoveryCriteria;
  limit?: number;
  mode?: 'dry_run' | 'preview';
}

export interface DiscoverSourceCandidatesSample {
  name: string;
  taxId?: string | null;
  countryCode?: string | null;
  city?: string | null;
  region?: string | null;
  sectorDescription?: string | null;
  sourcePrimary?: string | null;
  qualityDecision?: string | null;
}

export interface DiscoverSourceCandidatesResult {
  ok: boolean;
  sourceKey: string;
  countryCode: string;
  recordsRead: number;
  candidatesCount: number;
  acceptedCount: number;
  lowPriorityCount: number;
  filteredOutCount: number;
  qualitySummary: {
    withTaxId: number;
    withSector: number;
    sectorUnknown: number;
    withRegion: number;
    withWebsite: number;
  };
  warnings: string[];
  errors: string[];
  samples: DiscoverSourceCandidatesSample[];
  error?: string;
}

// ─── Auth: requiere admin activo ───────────────────────────────────────────────

async function requireAdminUser(): Promise<{ id: string | null; error?: string }> {
  const supabase = await createClient();
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

  if (role?.key !== 'admin') return { id: null, error: 'No autorizado — se requiere rol admin' };

  return { id: internalUser.id };
}

// ─── Rate limiting in-memory ───────────────────────────────────────────────────

type RateLimitEntry = { count: number; windowStart: number };
const discoveryRateLimitMap = new Map<string, RateLimitEntry>();
const DISCOVERY_RATE_LIMIT_WINDOW_MS = 300_000; // 5 minutos
const DISCOVERY_RATE_LIMIT_MAX = 3;

function checkDiscoveryRateLimit(userId: string, sourceKey: string): boolean {
  const key = `${userId}:${sourceKey}:discovery`;
  const now = Date.now();
  const entry = discoveryRateLimitMap.get(key);

  if (!entry || now - entry.windowStart > DISCOVERY_RATE_LIMIT_WINDOW_MS) {
    discoveryRateLimitMap.set(key, { count: 1, windowStart: now });
    return true;
  }

  if (entry.count >= DISCOVERY_RATE_LIMIT_MAX) return false;

  entry.count += 1;
  return true;
}

// ─── Sanitización de errores ───────────────────────────────────────────────────

function sanitizeError(error: unknown): string {
  const msg =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'Error desconocido';
  return msg.replace(/\/[A-Za-z0-9_-]{20,}(?=\/|\s|$)/g, '/[REDACTED]').slice(0, 500);
}

// ─── Validación de input ───────────────────────────────────────────────────────

const ALLOWED_SOURCE_KEYS = new Set(['cl_res', 'mx_denue', 'co_rues']);
const ALLOWED_MODES = new Set(['dry_run', 'preview'] as const);
const LIMIT_MIN = 1;
const LIMIT_MAX = 20;

function validateInput(input: DiscoverSourceCandidatesInput): string | null {
  if (!input.sourceKey || typeof input.sourceKey !== 'string' || !input.sourceKey.trim()) {
    return 'sourceKey es requerido';
  }

  if (!ALLOWED_SOURCE_KEYS.has(input.sourceKey)) {
    return `sourceKey '${input.sourceKey}' no está registrado. Válidos: ${[...ALLOWED_SOURCE_KEYS].join(', ')}`;
  }

  if (!input.countryCode || typeof input.countryCode !== 'string' || !input.countryCode.trim()) {
    return 'countryCode es requerido';
  }

  if (input.limit !== undefined) {
    if (typeof input.limit !== 'number' || !Number.isInteger(input.limit)) {
      return 'limit debe ser un entero';
    }
    if (input.limit < LIMIT_MIN || input.limit > LIMIT_MAX) {
      return `limit debe estar entre ${LIMIT_MIN} y ${LIMIT_MAX}`;
    }
  }

  if (input.mode !== undefined && !ALLOWED_MODES.has(input.mode)) {
    return `mode '${input.mode}' no está permitido. Solo se permite: dry_run`;
  }

  if (input.mode && input.mode !== 'dry_run') {
    return 'Solo mode=dry_run está permitido en este hito. preview y live no están habilitados.';
  }

  return null;
}

// ─── discoverSourceCandidatesAction ───────────────────────────────────────────
//
// Action pública. Valida input, auth y rate limit antes de llamar runSourceDiscovery.
// Retorna resultado seguro con samples limitados a 5. Sin writes. Sin tokens en output.

export async function discoverSourceCandidatesAction(
  input: DiscoverSourceCandidatesInput,
): Promise<DiscoverSourceCandidatesResult> {
  const empty: DiscoverSourceCandidatesResult = {
    ok: false,
    sourceKey: input?.sourceKey ?? '',
    countryCode: input?.countryCode ?? '',
    recordsRead: 0,
    candidatesCount: 0,
    acceptedCount: 0,
    lowPriorityCount: 0,
    filteredOutCount: 0,
    qualitySummary: { withTaxId: 0, withSector: 0, sectorUnknown: 0, withRegion: 0, withWebsite: 0 },
    warnings: [],
    errors: [],
    samples: [],
  };

  // 1. Validar input
  const validationError = validateInput(input);
  if (validationError) {
    console.info('[discoverSourceCandidatesAction] input_invalid', { sourceKey: input?.sourceKey, error: validationError });
    return { ...empty, error: validationError };
  }

  // 2. Validar usuario admin activo
  const { id: actorId, error: authError } = await requireAdminUser();
  if (!actorId) {
    console.info('[discoverSourceCandidatesAction] auth_failed', { sourceKey: input.sourceKey, error: authError });
    return { ...empty, error: authError ?? 'No autorizado' };
  }

  // 3. Rate limit: máximo 3 ejecuciones cada 5 minutos por usuario + sourceKey
  if (!checkDiscoveryRateLimit(actorId, input.sourceKey)) {
    console.info('[discoverSourceCandidatesAction] rate_limit_exceeded', {
      userId: actorId,
      sourceKey: input.sourceKey,
    });
    return {
      ...empty,
      error: 'Demasiadas ejecuciones. Espera 5 minutos antes de volver a intentar.',
    };
  }

  // 4. Forzar dry_run — no se permite preview ni live en este hito
  const safeMode = 'dry_run' as const;
  const safeLimit = Math.min(input.limit ?? 10, LIMIT_MAX);

  console.info('[discoverSourceCandidatesAction] start', {
    userId: actorId,
    sourceKey: input.sourceKey,
    countryCode: input.countryCode,
    limit: safeLimit,
    mode: safeMode,
  });

  // 5. Ejecutar runSourceDiscovery — nunca escribe en DB
  let output;
  try {
    output = await runSourceDiscovery({
      sourceKey: input.sourceKey,
      countryCode: input.countryCode,
      criteria: input.criteria,
      limit: safeLimit,
      mode: safeMode,
    });
  } catch (discoveryErr: unknown) {
    const msg = sanitizeError(discoveryErr);
    console.error('[discoverSourceCandidatesAction] discovery_error', {
      userId: actorId,
      sourceKey: input.sourceKey,
      error: msg,
    });
    return { ...empty, errors: [msg], error: `Error ejecutando discovery: ${msg}` };
  }

  console.info('[discoverSourceCandidatesAction] complete', {
    userId: actorId,
    sourceKey: output.sourceKey,
    countryCode: output.countryCode,
    recordsRead: output.recordsRead,
    candidatesCount: output.candidates.length,
    acceptedCount: output.acceptedCount,
    errorsCount: output.errors.length,
  });

  // 6. Construir resultado seguro — no retornar sourceTrace ni metadata cruda
  const samples: DiscoverSourceCandidatesSample[] = output.candidates.slice(0, 5).map((c) => ({
    name: c.name,
    taxId: c.taxId ?? null,
    countryCode: c.countryCode ?? null,
    city: c.city ?? null,
    region: c.region ?? null,
    sectorDescription: c.sectorDescription ?? null,
    sourcePrimary: c.sourcePrimary ?? null,
    qualityDecision: c.qualityDecision ?? null,
  }));

  return {
    ok: output.errors.length === 0,
    sourceKey: output.sourceKey,
    countryCode: output.countryCode,
    recordsRead: output.recordsRead,
    candidatesCount: output.candidates.length,
    acceptedCount: output.acceptedCount,
    lowPriorityCount: output.lowPriorityCount,
    filteredOutCount: output.filteredOutCount,
    qualitySummary: output.qualitySummary,
    warnings: output.warnings,
    errors: output.errors,
    samples,
  };
}
