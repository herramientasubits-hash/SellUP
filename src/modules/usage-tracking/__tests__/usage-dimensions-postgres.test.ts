/**
 * Migración 147 (dimensiones de cada consulta) contra un PostgreSQL REAL y efímero.
 *
 * Lo que la 147 promete no se ve leyendo SQL, hay que ejecutarlo:
 *
 *   § 1 · aplica sobre la cadena real (036 → 040 → 063) y rellena las filas que ya
 *         existían; reaplicarla no cambia ni una fila (idempotente);
 *   § 2 · el disparador rellena cada dimensión al insertar como service_role;
 *   § 3 · un valor enviado por el escritor nunca se pisa;
 *   § 4 · la función SQL y el espejo TypeScript etiquetan igual cada regla;
 *   § 5 · las funciones son internas: ni anon ni authenticated las ejecutan.
 *
 * DATOS SINTÉTICOS. Ni una fila viene de Producción. En local se SALTA con motivo
 * explícito si falta el arnés (`npm install --no-save embedded-postgres@17.6.0-beta.15`);
 * con SELLUP_REQUIRE_POSTGRES_HARNESS el salto es un FALLO. No llama a ningún
 * proveedor, no lee un flag, no toca Producción: 0 créditos.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  SUPABASE_ROLES_SQL,
  AUTHENTICATED_HARDENING_SQL,
  readMigration,
  resolveEmbeddedPostgres,
  type EmbeddedPostgresLike,
  type PgLikeClient,
} from '@/server/prospect-batches/__tests__/support/cut3b4-real-migration-chain';

import {
  AGENT_DIMENSION_RULES,
  resolveAgentDimensions,
  type AgentDimensionRule,
} from '../usage-dimensions';

const here = dirname(fileURLToPath(import.meta.url));
// __tests__ → usage-tracking → modules → src → repo root
const repoRoot = join(here, '..', '..', '..', '..');

const CHAIN = [
  '036_usage_tracking_foundation.sql',
  '040_prospect_batches_foundation.sql',
  '063_tavily_pricing_and_batch_traceability.sql',
] as const;
const MIGRATION_147 = '147_provider_usage_log_dimensions.sql';

/**
 * El borde AJENO a la cadena: lo que 036 y 040 referencian y otras migraciones
 * crean (roles, personas internas, cuentas y el predicado de acceso de la 040).
 */
const PLATFORM_SQL = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
CREATE TABLE IF NOT EXISTS public.roles (
  id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS public.internal_users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id  uuid UNIQUE,
  access_status text NOT NULL DEFAULT 'active',
  role_id       uuid NULL REFERENCES public.roles(id)
);
CREATE TABLE IF NOT EXISTS public.accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid()
);
CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION public.has_active_access(p_auth_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM internal_users WHERE auth_user_id = p_auth_user_id AND access_status = 'active'
  );
$$;
`;

const { ctor: EmbeddedPostgresCtor, skip: harnessSkipReason } = resolveEmbeddedPostgres(import.meta.url);

let dataDir: string;
let postgres: EmbeddedPostgresLike;
let db: PgLikeClient;

type Dims = {
  agent_key: string | null;
  agent_step: string | null;
  country_code: string | null;
  macro_industry_key: string | null;
  search_mode: string | null;
};

async function newBatch(input: { country: string | null; source: string; metadata: unknown }): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO public.prospect_batches (name, country_code, source, metadata)
     VALUES ('lote-147', $1, $2, $3::jsonb) RETURNING id`,
    [input.country, input.source, JSON.stringify(input.metadata)],
  );
  return String(rows[0].id);
}

type LogInput = {
  provider: string;
  operation: string;
  batchId?: string | null;
  runId?: string | null;
  metadata?: Record<string, unknown>;
  provided?: Partial<Dims>;
};

/** Inserta como service_role, igual que el escritor de la aplicación. */
async function insertLog(input: LogInput, asServiceRole = true): Promise<string> {
  const provided = input.provided ?? {};
  if (asServiceRole) {
    await db.query('BEGIN');
    await db.query('SET LOCAL ROLE service_role');
  }
  try {
    const { rows } = await db.query(
      `INSERT INTO public.provider_usage_logs
         (provider_key, operation_key, batch_id, agent_run_id, metadata${asServiceRole ? ', agent_key, agent_step, country_code, macro_industry_key, search_mode' : ''})
       VALUES ($1, $2, $3, $4, $5::jsonb${asServiceRole ? ', $6, $7, $8, $9, $10' : ''})
       RETURNING id`,
      [
        input.provider,
        input.operation,
        input.batchId ?? null,
        input.runId ?? null,
        JSON.stringify(input.metadata ?? {}),
        ...(asServiceRole
          ? [
              provided.agent_key ?? null,
              provided.agent_step ?? null,
              provided.country_code ?? null,
              provided.macro_industry_key ?? null,
              provided.search_mode ?? null,
            ]
          : []),
      ],
    );
    if (asServiceRole) await db.query('COMMIT');
    return String(rows[0].id);
  } catch (err) {
    if (asServiceRole) await db.query('ROLLBACK');
    throw err;
  }
}

async function dimsOf(id: string): Promise<Dims> {
  const { rows } = await db.query(
    `SELECT agent_key, agent_step, country_code, macro_industry_key, search_mode
       FROM public.provider_usage_logs WHERE id = $1`,
    [id],
  );
  return rows[0] as unknown as Dims;
}

async function snapshot(): Promise<string> {
  const { rows } = await db.query(
    `SELECT id, agent_key, agent_step, country_code, macro_industry_key, search_mode
       FROM public.provider_usage_logs ORDER BY id`,
  );
  return JSON.stringify(rows);
}

/** Una operación de ejemplo que cumple la regla. */
function sampleOperation(rule: AgentDimensionRule): string[] {
  switch (rule.operation.kind) {
    case 'any':
      return ['cualquier_operacion'];
    case 'in':
      return [...rule.operation.values];
    case 'prefix':
      return [`${rule.operation.value}otra`];
    case 'contains':
      return [`algo_${rule.operation.value}_mas`];
  }
}

describe('Migración 147 (dimensiones de las consultas) contra PostgreSQL real', { skip: harnessSkipReason }, () => {
  let legacyRunLog: string;
  let legacyClassifier: string;
  let legacyRescue: string;
  let legacyUnknown: string;
  let legacyProvided: string;
  let techBatch: string;
  let importBatch: string;

  before(async () => {
    if (!EmbeddedPostgresCtor) return;
    dataDir = mkdtempSync(join(tmpdir(), 'sellup-m147-'));
    postgres = new EmbeddedPostgresCtor({
      databaseDir: dataDir,
      user: 'postgres',
      password: 'postgres',
      port: 54473,
      persistent: false,
    });
    await postgres.initialise();
    await postgres.start();
    db = postgres.getPgClient();
    await db.connect();
    await db.query(SUPABASE_ROLES_SQL);
    await db.query(PLATFORM_SQL);
    await db.query(AUTHENTICATED_HARDENING_SQL);
    for (const file of CHAIN) await db.query(readMigration(repoRoot, file));

    // Filas que ya existían ANTES de la 147 (el relleno tiene que encontrarlas).
    techBatch = await newBatch({
      country: 'co',
      source: 'agent_1',
      metadata: { apollo_discovery_taxonomy: { macro_industry_key: 'technology' } },
    });
    importBatch = await newBatch({
      country: 'PE',
      source: 'imported',
      metadata: { claude_company_search: { macro_industry_key: 'retail' } },
    });
    const { rows } = await db.query(
      `INSERT INTO public.agent_runs (agent_key) VALUES ('prospect_generation') RETURNING id`,
    );
    const runId = String(rows[0].id);
    legacyClassifier = await insertLog({ provider: 'anthropic', operation: 'company_classification', batchId: techBatch }, false);
    legacyRescue = await insertLog(
      { provider: 'anthropic', operation: 'company_classification', batchId: importBatch, metadata: { flow: 'claude_rescue' } },
      false,
    );
    legacyRunLog = await insertLog({ provider: 'openai', operation: 'generate', runId }, false);
    legacyUnknown = await insertLog({ provider: 'openai', operation: 'generate' }, false);
    // Una fila vieja que ya traía un valor (escrito a mano): el relleno no lo toca.
    legacyProvided = await insertLog({ provider: 'tavily', operation: 'multi_query_web_search', batchId: techBatch }, false);

    await db.query(readMigration(repoRoot, MIGRATION_147));
  });

  after(async () => {
    try {
      await db?.end();
    } catch {
      /* ya cerrado */
    }
    try {
      await postgres?.stop();
    } catch {
      /* ya parado */
    }
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  });

  it('§ 1 — el relleno etiqueta las filas que ya existían', async () => {
    assert.deepEqual(await dimsOf(legacyClassifier), {
      agent_key: 'agent1',
      agent_step: 'clasificador',
      country_code: 'CO',
      macro_industry_key: 'technology',
      search_mode: 'exploratory',
    });
    assert.deepEqual(await dimsOf(legacyRescue), {
      agent_key: 'agent1',
      agent_step: 'rescate',
      country_code: 'PE',
      macro_industry_key: 'retail',
      search_mode: 'import',
    });
    // Sin regla: el agente sale de la ejecución; el paso no se inventa.
    assert.deepEqual(await dimsOf(legacyRunLog), {
      agent_key: 'agent1',
      agent_step: null,
      country_code: null,
      macro_industry_key: null,
      search_mode: null,
    });
    // Ni regla, ni ejecución, ni lote: todo NULL.
    assert.deepEqual(await dimsOf(legacyUnknown), {
      agent_key: null,
      agent_step: null,
      country_code: null,
      macro_industry_key: null,
      search_mode: null,
    });
  });

  it('§ 1 — el relleno es idempotente y respeta lo que ya estaba escrito', async () => {
    await db.query(`UPDATE public.provider_usage_logs SET country_code = 'MX', agent_step = 'manual' WHERE id = $1`, [
      legacyProvided,
    ]);
    const before = await snapshot();
    await db.query(readMigration(repoRoot, MIGRATION_147));
    await db.query(readMigration(repoRoot, MIGRATION_147));
    assert.equal(await snapshot(), before);
    const kept = await dimsOf(legacyProvided);
    assert.equal(kept.country_code, 'MX');
    assert.equal(kept.agent_step, 'manual');
  });

  it('§ 2 — el disparador rellena cada dimensión al insertar como service_role', async () => {
    const id = await insertLog({
      provider: 'anthropic',
      operation: 'company_domain_search',
      batchId: techBatch,
      metadata: { flow: 'claude_rescue', found: true },
    });
    assert.deepEqual(await dimsOf(id), {
      agent_key: 'agent1',
      agent_step: 'rescate_web',
      country_code: 'CO',
      macro_industry_key: 'technology',
      search_mode: 'exploratory',
    });
  });

  it('§ 2 — sin lote no hay país, industria ni forma', async () => {
    const id = await insertLog({ provider: 'apollo', operation: 'person_match' });
    assert.deepEqual(await dimsOf(id), {
      agent_key: 'agent2a',
      agent_step: 'identificar_contacto',
      country_code: null,
      macro_industry_key: null,
      search_mode: null,
    });
  });

  it('§ 3 — un valor enviado por el escritor nunca se pisa', async () => {
    const id = await insertLog({
      provider: 'apollo',
      operation: 'organizations_search',
      batchId: techBatch,
      provided: { agent_key: 'agent2a', country_code: 'AR', search_mode: 'competitors' },
    });
    assert.deepEqual(await dimsOf(id), {
      agent_key: 'agent2a',
      // La regla es del Agente 1: no se le pone un paso de otro agente.
      agent_step: null,
      country_code: 'AR',
      macro_industry_key: 'technology',
      search_mode: 'competitors',
    });
  });

  it('§ 4 — la función SQL etiqueta cada regla igual que el espejo TypeScript', async () => {
    for (const rule of AGENT_DIMENSION_RULES) {
      for (const provider of rule.providers) {
        for (const operation of sampleOperation(rule)) {
          const { rows } = await db.query(
            `SELECT public.provider_usage_agent_dimensions($1, $2, $3) AS d`,
            [provider, operation, rule.flow],
          );
          const [agentKey, agentStep] = rows[0].d as [string | null, string | null];
          assert.deepEqual(
            { agentKey, agentStep },
            resolveAgentDimensions(provider, operation, rule.flow),
            `${provider} · ${operation} · ${rule.flow ?? '-'}`,
          );
        }
      }
    }
    // Y lo que no tiene regla, tampoco la tiene en SQL.
    const { rows } = await db.query(`SELECT public.provider_usage_agent_dimensions('openai', 'generate', NULL) AS d`);
    assert.deepEqual(rows[0].d, [null, null]);
  });

  it('§ 5 — anon y authenticated no ejecutan las funciones internas', async () => {
    for (const role of ['anon', 'authenticated']) {
      for (const fn of [
        'public.provider_usage_agent_dimensions(text, text, text)',
        'public.provider_usage_agent_from_run(text)',
        'public.provider_usage_batch_dimensions(uuid)',
        'public.provider_usage_logs_fill_dimensions()',
      ]) {
        const { rows } = await db.query(`SELECT has_function_privilege('${role}', '${fn}', 'EXECUTE') AS ok`);
        assert.equal(rows[0].ok, false, `${role} ejecuta ${fn}`);
      }
    }
  });
});
