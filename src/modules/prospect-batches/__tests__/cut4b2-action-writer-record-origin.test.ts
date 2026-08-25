/**
 * Tests — AGENT1-CUT4-B2 § 4/§ 5/§ 9/§ 13.
 *
 * El defecto que cierran: los dos writers de `actions.ts` insertaban candidatos
 * sin tocar `prospect_candidates.record_origin`. La columna quedaba en NULL por
 * OMISIÓN del writer, no por una decisión, y con ella la fila caía fuera de la
 * cola de revisión limpia.
 *
 * 🔴 Lo que este corte NO hace: ascender nada a `production` para volverlo
 * accionable. Al contrario — el riesgo REAL de `createProspectCandidate` es el
 * opuesto: `source_primary='manual'` + `status='needs_review'` cae en la regla
 * de estado limpio (R7), así que clasificar mirando sólo el candidato ascendería
 * a producción cualquier creación manual, incluida la que cuelga de un lote de
 * smoke, de QA o de una corrida que nunca se ejecutó. Por eso el lote ADOPTADO
 * entra en la decisión. Paridad de procedencia, no ensanchamiento de permisos.
 *
 * Estrategia de mocks (sólo el I/O real):
 *   - `@/lib/supabase/server` → doble local que registra INSERT y SELECT.
 *   - `next/cache` / `next/navigation` → no-ops.
 *
 * El clasificador canónico y el proyector de columnas corren de VERDAD.
 *
 * Cero red, cero Apollo, cero Lusha, cero HubSpot, cero créditos, cero migraciones.
 *
 * Correr: node --import tsx --experimental-test-module-mocks --test <este archivo>
 */

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

import { CANDIDATE_RECORD_ORIGIN_METADATA_KEY } from '@/server/agents/prospecting-toolkit/candidate-record-origin';

// ─── Estado observable ─────────────────────────────────────────────────────

type Spy = {
  candidateInserts: Array<Record<string, unknown>>;
  batchInserts: Array<Record<string, unknown>>;
  auditInserts: Array<Record<string, unknown>>;
  candidateUpdates: Array<Record<string, unknown>>;
  batchSelects: string[];
  /** Fila que devuelve la lectura de contexto del lote. `null` ⇒ no hay contexto. */
  adoptedBatchRow: Record<string, unknown> | null;
  adoptedBatchError: { message: string } | null;
};

const spy: Spy = {
  candidateInserts: [],
  batchInserts: [],
  auditInserts: [],
  candidateUpdates: [],
  batchSelects: [],
  adoptedBatchRow: null,
  adoptedBatchError: null,
};

function resetSpy(): void {
  spy.candidateInserts.length = 0;
  spy.batchInserts.length = 0;
  spy.auditInserts.length = 0;
  spy.candidateUpdates.length = 0;
  spy.batchSelects.length = 0;
  spy.adoptedBatchRow = null;
  spy.adoptedBatchError = null;
}

mock.module('next/cache', { namedExports: { revalidatePath: () => {} } });
mock.module('next/navigation', {
  namedExports: {
    redirect: (to: string) => {
      throw new Error(`redirect inesperado a ${to}`);
    },
  },
});

mock.module('@/lib/supabase/server', {
  namedExports: { createClient: async () => makeFakeSupabase() },
});

function makeFakeSupabase(): unknown {
  return {
    auth: {
      getUser: async () => ({ data: { user: { id: 'auth-user-1' } }, error: null }),
    },
    from(table: string) {
      if (table === 'internal_users') {
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: () => chain,
          limit: () => chain,
          single: async () => ({ data: { id: 'internal-user-1' }, error: null }),
        };
        return chain;
      }

      if (table === 'prospect_batches') {
        return {
          select(columns: string) {
            spy.batchSelects.push(columns);
            const chain: Record<string, unknown> = {
              eq: () => chain,
              is: () => chain,
              maybeSingle: async () => ({
                data: spy.adoptedBatchRow,
                error: spy.adoptedBatchError,
              }),
              single: async () => ({
                data: spy.adoptedBatchRow,
                error: spy.adoptedBatchError,
              }),
            };
            return chain;
          },
          insert(row: Record<string, unknown>) {
            spy.batchInserts.push({ ...row });
            return {
              select: () => ({
                single: async () => ({
                  data: { id: 'batch-import-1', ...row },
                  error: null,
                }),
              }),
            };
          },
        };
      }

      if (table === 'prospect_candidate_audit') {
        return {
          insert: async (row: Record<string, unknown>) => {
            spy.auditInserts.push({ ...row });
            return { error: null };
          },
        };
      }

      if (table === 'prospect_candidates') {
        return {
          insert(row: Record<string, unknown>) {
            spy.candidateInserts.push({ ...row });
            const inserted = { id: 'candidate-1', ...row };
            const result = {
              select: () => ({
                single: async () => ({ data: inserted, error: null }),
              }),
            };
            // El writer manual encadena `.select().single()`; el de importación
            // externa hace `await insert(...)` a secas. Un thenable sirve a los dos.
            return Object.assign(result, {
              then: (resolve: (value: { error: null }) => void) => resolve({ error: null }),
            });
          },
          update(row: Record<string, unknown>) {
            spy.candidateUpdates.push({ ...row });
            const chain: Record<string, unknown> = {
              eq: () => chain,
              select: () => chain,
              single: async () => ({ data: null, error: null }),
              then: (resolve: (value: { error: null }) => void) => resolve({ error: null }),
            };
            return chain;
          },
        };
      }

      throw new Error(`tabla no simulada: ${table}`);
    },
  };
}

// La red se rompe a propósito: cualquier llamada real revienta el test.
globalThis.fetch = (async () => {
  throw new Error('este test no debe hacer red');
}) as typeof globalThis.fetch;

// ─── Contextos de lote ─────────────────────────────────────────────────────

const MANUAL_TRAY_BATCH = {
  source: 'manual',
  name: 'Creaciones manuales · Agosto 2026',
  metadata: { is_technical_manual: true, manual_tray: true },
};

function batchWithMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  return { ...MANUAL_TRAY_BATCH, metadata: { ...MANUAL_TRAY_BATCH.metadata, ...metadata } };
}

// ─── Helpers ───────────────────────────────────────────────────────────────

const BATCH_ID = '00000000-0000-4000-8000-00000000b001';

async function createManualCandidate(
  overrides: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const { createProspectCandidate } = await import('../actions');
  await createProspectCandidate({
    batch_id: BATCH_ID,
    name: 'Manual Uno SAS',
    country: 'Colombia',
    country_code: 'CO',
    ...overrides,
  } as never);
  assert.equal(spy.candidateInserts.length, 1, 'se esperaba exactamente un INSERT de candidato');
  return spy.candidateInserts[0];
}

function originMetadata(row: Record<string, unknown>): Record<string, unknown> {
  const meta = row.metadata as Record<string, unknown>;
  return meta[CANDIDATE_RECORD_ORIGIN_METADATA_KEY] as Record<string, unknown>;
}

function derivation(row: Record<string, unknown>): Record<string, unknown> {
  return originMetadata(row).derivation as Record<string, unknown>;
}

// ─── B2.A — la autoridad canónica decide ───────────────────────────────────

describe('CUT4-B2 § 3/§ 4 — createProspectCandidate usa la autoridad canónica', () => {
  beforeEach(resetSpy);

  it('A — persiste record_origin y publica la derivación bajo la clave canónica', async () => {
    spy.adoptedBatchRow = { ...MANUAL_TRAY_BATCH };
    const row = await createManualCandidate();

    assert.ok(
      Object.prototype.hasOwnProperty.call(row, 'record_origin'),
      'la columna ya no puede quedarse en NULL por omisión del writer',
    );
    const meta = originMetadata(row);
    assert.equal(meta.decided_by, 'canonical_writer');
    assert.equal(meta.classification_source, 'writer');
    assert.ok(meta.derivation, 'la derivación auditable tiene que viajar en la metadata');
  });

  it('§ 4 — lee el CONTEXTO del lote adoptado (source, name, metadata) antes de clasificar', async () => {
    spy.adoptedBatchRow = { ...MANUAL_TRAY_BATCH };
    await createManualCandidate();

    assert.equal(spy.batchSelects.length, 1, 'se esperaba una única lectura de contexto de lote');
    const columns = spy.batchSelects[0];
    for (const column of ['source', 'name', 'metadata']) {
      assert.ok(
        columns.includes(column),
        `el clasificador tiene que poder ver batch.${column} (SELECT fue "${columns}")`,
      );
    }
  });
});

// ─── B2.B–J — la matriz obligatoria (§ 5) ──────────────────────────────────

describe('CUT4-B2 § 5 — matriz de procedencia del candidato manual', () => {
  beforeEach(resetSpy);

  it('B — lote de producción limpio → production', async () => {
    spy.adoptedBatchRow = { ...MANUAL_TRAY_BATCH };
    const row = await createManualCandidate();
    assert.equal(row.record_origin, 'production');
    assert.equal(derivation(row).matched_rule, 'production_status');
  });

  it('C — lote de smoke adoptado → smoke_test (NUNCA production)', async () => {
    spy.adoptedBatchRow = batchWithMetadata({ smoke_test: true });
    const row = await createManualCandidate();
    assert.equal(row.record_origin, 'smoke_test');
    assert.notEqual(row.record_origin, 'production');
  });

  it('D — lote de QA adoptado → qa (NUNCA production)', async () => {
    spy.adoptedBatchRow = { ...MANUAL_TRAY_BATCH, name: 'QA visual · previo a v1.8.1' };
    const row = await createManualCandidate();
    assert.equal(row.record_origin, 'qa');
    assert.notEqual(row.record_origin, 'production');
  });

  it('E — lote de importación adoptado → import (NUNCA production)', async () => {
    spy.adoptedBatchRow = {
      source: 'external_import',
      name: 'Importación externa · 25 ago 2026',
      metadata: {},
    };
    const row = await createManualCandidate();
    assert.equal(row.record_origin, 'import');
    assert.notEqual(row.record_origin, 'production');
  });

  it('F — lote sintético adoptado → synthetic (NUNCA production)', async () => {
    spy.adoptedBatchRow = batchWithMetadata({ synthetic: true });
    const row = await createManualCandidate();
    assert.equal(row.record_origin, 'synthetic');
    assert.notEqual(row.record_origin, 'production');
  });

  it('G — lote de limpieza adoptado → historical_cleanup (NUNCA production)', async () => {
    spy.adoptedBatchRow = batchWithMetadata({ historical_cleanup: true });
    const row = await createManualCandidate();
    assert.equal(row.record_origin, 'historical_cleanup');
    assert.notEqual(row.record_origin, 'production');
  });

  // ── H/I/J — «unexecuted» ────────────────────────────────────────────────────
  //
  // El vocabulario de la migración 093 no tiene un valor `unexecuted`: el
  // clasificador canónico resuelve estos tres marcadores a `unknown` con
  // `matched_rule='unexecuted_or_unauthorized'`. `unknown` es el valor
  // fail-closed y los cuatro gates de la cola limpia ya lo rechazan. Se afirma
  // AMBAS cosas para que el test no se pueda leer como «cayó en unknown por
  // casualidad».

  it('H — execution_authorized=false → unknown por regla de no-ejecutado', async () => {
    spy.adoptedBatchRow = batchWithMetadata({ execution_authorized: false });
    const row = await createManualCandidate();
    assert.equal(row.record_origin, 'unknown');
    assert.equal(derivation(row).matched_rule, 'unexecuted_or_unauthorized');
  });

  it('I — provider_calls_allowed=false → unknown por regla de no-ejecutado', async () => {
    spy.adoptedBatchRow = batchWithMetadata({ provider_calls_allowed: false });
    const row = await createManualCandidate();
    assert.equal(row.record_origin, 'unknown');
    assert.equal(derivation(row).matched_rule, 'unexecuted_or_unauthorized');
  });

  it('J — live_pilot_not_executed=true → unknown por regla de no-ejecutado', async () => {
    spy.adoptedBatchRow = batchWithMetadata({ live_pilot_not_executed: true });
    const row = await createManualCandidate();
    assert.equal(row.record_origin, 'unknown');
    assert.equal(derivation(row).matched_rule, 'unexecuted_or_unauthorized');
  });

  it('K — el writer no fabrica duplicados: R5 no es alcanzable desde esta puerta', async () => {
    // La regla de duplicado (R5) lee `status`/`duplicate_status` DEL CANDIDATO, y
    // este writer fija `status='needs_review'` y no escribe `duplicate_status`
    // jamás. Que sea inalcanzable es el hecho que se fija — no se simula un
    // duplicado que el writer no puede producir, porque eso probaría el
    // clasificador, no el writer. El marcado de duplicados vive en
    // `markCandidateDuplicate`, fuera de este corte.
    spy.adoptedBatchRow = { ...MANUAL_TRAY_BATCH };
    const row = await createManualCandidate();
    assert.equal(row.status, 'needs_review');
    assert.ok(
      !Object.prototype.hasOwnProperty.call(row, 'duplicate_status'),
      'este writer no puede declarar un duplicado',
    );
    assert.notEqual(derivation(row).matched_rule, 'duplicate_status');
  });
});

// ─── B2 § 5 — fail-closed sin contexto de lote ─────────────────────────────

describe('CUT4-B2 § 5 — sin contexto de lote no se afirma producción', () => {
  beforeEach(resetSpy);

  it('una lectura de lote vacía NO asciende la fila manual a production', async () => {
    spy.adoptedBatchRow = null;
    const row = await createManualCandidate();

    assert.ok(
      !Object.prototype.hasOwnProperty.call(row, 'record_origin'),
      'ausencia de evidencia no es evidencia de una corrida limpia',
    );
    const context = (row.metadata as Record<string, unknown>).record_origin_batch_context as Record<
      string,
      unknown
    >;
    assert.equal(context.batch_context_available, false);
    assert.equal(context.production_assertion_suppressed, true);
  });

  it('una lectura de lote fallida tampoco asciende la fila manual a production', async () => {
    spy.adoptedBatchRow = null;
    spy.adoptedBatchError = { message: 'permission denied' };
    const row = await createManualCandidate();
    assert.ok(!Object.prototype.hasOwnProperty.call(row, 'record_origin'));
  });

  it('sin contexto de lote, un origen NO productivo del propio candidato SÍ se persiste', async () => {
    // La supresión es quirúrgica: sólo tapa la AFIRMACIÓN de producción. Un
    // marcador que decidió el candidato (aquí, una nota de smoke) se conserva.
    spy.adoptedBatchRow = null;
    const row = await createManualCandidate({ review_notes: 'smoke run de validación' });
    assert.equal(row.record_origin, 'smoke_test');
  });
});

// ─── B2 § 7/§ 8/§ 12 — invariantes del writer manual ───────────────────────

describe('CUT4-B2 § 7/§ 8/§ 12 — invariantes de createProspectCandidate', () => {
  beforeEach(resetSpy);

  it('O — una sola puerta de persistencia: un INSERT, ningún UPDATE posterior', async () => {
    spy.adoptedBatchRow = { ...MANUAL_TRAY_BATCH };
    await createManualCandidate();
    assert.equal(spy.candidateInserts.length, 1, 'INSERT_DOORS_AFTER debe seguir siendo 1');
    assert.equal(spy.candidateUpdates.length, 0, 'la procedencia no puede llegar por un parche');
  });

  it('Q — status, source_primary y duplicate_status no cambian', async () => {
    spy.adoptedBatchRow = { ...MANUAL_TRAY_BATCH };
    const row = await createManualCandidate();
    assert.equal(row.status, 'needs_review');
    assert.equal(row.source_primary, 'manual');
    assert.ok(!Object.prototype.hasOwnProperty.call(row, 'duplicate_status'));
  });

  it('Q — un source_primary explícito del llamador se respeta tal cual', async () => {
    spy.adoptedBatchRow = { ...MANUAL_TRAY_BATCH };
    const row = await createManualCandidate({ source_primary: 'other' });
    assert.equal(row.source_primary, 'other');
  });
});

// ─── B2 § 9 — createExternalCandidatesBatch ────────────────────────────────

const EXTERNAL_INPUT = {
  import_type: 'paste',
  candidates: [
    {
      company_name: 'Importada Uno SAS',
      country: 'Colombia',
      country_code: 'CO',
      industry: 'Tecnología',
      website: 'importadauno.co',
      notes: 'Nota del importador',
      source_url: 'https://fuente.example/uno',
      linkedin_url: 'https://linkedin.com/company/importadauno',
    },
  ],
  recognized_columns: ['company_name', 'country_code', 'industry'],
  unrecognized_columns: [],
  total_rows: 1,
  valid_rows: 1,
  invalid_rows: 0,
  warning_rows: 0,
};

async function runExternalImport(): Promise<Record<string, unknown>> {
  const { createExternalCandidatesBatch } = await import('../actions');
  await createExternalCandidatesBatch(EXTERNAL_INPUT as never);
  assert.equal(spy.candidateInserts.length, 1, 'se esperaba exactamente un INSERT de candidato');
  return spy.candidateInserts[0];
}

describe('CUT4-B2 § 9 — createExternalCandidatesBatch: import, siempre', () => {
  beforeEach(resetSpy);

  it('L — la fila importada se persiste con record_origin = import', async () => {
    const row = await runExternalImport();
    assert.equal(row.record_origin, 'import');
  });

  it('M — NUNCA production, ni siquiera para volverla accionable', async () => {
    const row = await runExternalImport();
    assert.notEqual(row.record_origin, 'production');
    assert.equal(originMetadata(row).is_clean_production, false);
  });

  it('L — la decisión la firma el writer canónico, no un literal', async () => {
    const row = await runExternalImport();
    const meta = originMetadata(row);
    assert.equal(meta.decided_by, 'canonical_writer');
    assert.equal(meta.classification_source, 'writer');
    assert.equal(derivation(row).matched_rule, 'external_import');
  });

  it('N — la metadata canónica es ADITIVA: la metadata de importación sobrevive', async () => {
    const row = await runExternalImport();
    const meta = row.metadata as Record<string, unknown>;

    assert.equal(meta.origen, 'external_import');
    assert.equal(meta.imported_from, 'paste');
    assert.equal(meta.source_url, 'https://fuente.example/uno');
    assert.equal(meta.evidence_url, 'https://fuente.example/uno');
    assert.equal(meta.linkedin_url, 'https://linkedin.com/company/importadauno');
    assert.equal(meta.notes, 'Nota del importador');
    assert.equal(
      (meta.import as Record<string, unknown>).origen,
      'external_import',
      'el subobjeto `import` no puede perderse',
    );
    assert.ok(meta[CANDIDATE_RECORD_ORIGIN_METADATA_KEY], 'y la derivación se suma a lo anterior');
  });

  it('Q — semántica intacta: source/source_primary/status como antes', async () => {
    const row = await runExternalImport();
    assert.equal(row.source_primary, 'external_import');
    assert.equal(row.status, 'needs_review');
    assert.equal(spy.batchInserts[0].source, 'external_import');
    assert.ok(!Object.prototype.hasOwnProperty.call(row, 'duplicate_status'));
  });

  it('O — una sola puerta: un INSERT de lote, un INSERT de candidato, cero UPDATE', async () => {
    await runExternalImport();
    assert.equal(spy.batchInserts.length, 1);
    assert.equal(spy.candidateInserts.length, 1);
    assert.equal(spy.candidateUpdates.length, 0);
  });

  it('§ 9 — la metadata del LOTE que ve el clasificador es la que se persiste', async () => {
    await runExternalImport();
    const batchMeta = spy.batchInserts[0].metadata as Record<string, unknown>;
    assert.equal(batchMeta.import_type, 'paste');
    assert.equal(batchMeta.source_label, 'Importación externa');
    assert.equal(batchMeta.created_from_external_research, true);
    assert.equal(batchMeta.imported_rows_count, 1);
  });
});
