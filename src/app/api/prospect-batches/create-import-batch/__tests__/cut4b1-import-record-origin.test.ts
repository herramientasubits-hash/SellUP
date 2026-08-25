/**
 * Tests — AGENT1-CUT4-B1 § 8/§ 9/§ 14 (bloque IMPORT).
 *
 * El defecto que cierran: la ruta de importación externa insertaba candidatos con
 * `source_primary='external_import'` y `status='needs_review'` sin tocar
 * `prospect_candidates.record_origin`. La columna quedaba en NULL por OMISIÓN del
 * writer, no por una decisión.
 *
 * 🔴 Lo que este corte NO hace: convertir una importación en `production`. La
 * procedencia la decide el clasificador canónico y su regla de import (R4) gana a
 * cualquier inferencia de producción. Que una importación siga siendo no accionable
 * en la cola limpia es el comportamiento ESPERADO — esto es paridad de procedencia,
 * no ensanchamiento de permisos.
 *
 * Estrategia de mocks (sólo el I/O real):
 *   - `@/lib/supabase/server` → doble local que registra los INSERT.
 *   - `@/modules/prospect-batches/import-catalog-loader` → catálogo macro-only REAL
 *     en forma, sin base de datos.
 *   - `@/modules/prospect-batches/actions` → la validación post-import se registra
 *     como llamada; ese archivo pertenece a CUT4-B2 y aquí no se toca ni se
 *     importa de verdad (es un módulo `use server`).
 *
 * El servicio de clasificación y el constructor de payload corren de VERDAD.
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
  batchInserts: Array<Record<string, unknown>>;
  candidateInserts: Array<Record<string, unknown>>;
  auditInserts: Array<Record<string, unknown>>;
  postImportValidationCalls: Array<{ batchId: string; userId: string }>;
};

const spy: Spy = {
  batchInserts: [],
  candidateInserts: [],
  auditInserts: [],
  postImportValidationCalls: [],
};

function resetSpy(): void {
  spy.batchInserts.length = 0;
  spy.candidateInserts.length = 0;
  spy.auditInserts.length = 0;
  spy.postImportValidationCalls.length = 0;
}

// ─── Catálogo macro-only, con la FORMA real ────────────────────────────────
// v2 publica macro industrias y CERO subindustrias: una fila con industria
// resuelta y subindustria ausente es `warning`, que no bloquea la persistencia.

const CATALOG_VERSION_ID = '00000000-0000-4000-8000-0000000000c1';
const INDUSTRY_ID = '00000000-0000-4000-8000-0000000000a1';

mock.module('@/modules/prospect-batches/import-catalog-loader', {
  namedExports: {
    loadImportCatalog: async () => ({
      success: true,
      catalogVersionId: CATALOG_VERSION_ID,
      catalog: {
        version: 'v2.0.0',
        industries: [
          { id: INDUSTRY_ID, name: 'Tecnología', slug: 'tecnologia', active: true },
        ],
        subindustries: [],
        aliases: [],
      },
    }),
  },
});

mock.module('@/modules/prospect-batches/actions', {
  namedExports: {
    validateImportedCandidatesBatch: async (batchId: string, userId: string) => {
      spy.postImportValidationCalls.push({ batchId, userId });
      return { ok: true };
    },
  },
});

mock.module('@/lib/supabase/server', {
  namedExports: {
    createClient: async () => makeFakeSupabase(),
  },
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
          single: async () => ({ data: { id: 'internal-user-1' }, error: null }),
        };
        return chain;
      }
      if (table === 'prospect_batches') {
        return {
          insert(row: Record<string, unknown>) {
            spy.batchInserts.push({ ...row });
            return {
              select: () => ({
                single: async () => ({
                  data: { id: 'batch-import-1', name: row.name },
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
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: async () => ({ data: [], error: null }),
          insert: async (row: Record<string, unknown>) => {
            spy.candidateInserts.push({ ...row });
            return { error: null };
          },
        };
        return chain;
      }
      throw new Error(`tabla no simulada: ${table}`);
    },
  };
}

// La red se rompe a propósito: cualquier llamada real revienta el test.
globalThis.fetch = (async () => {
  throw new Error('este test no debe hacer red');
}) as typeof globalThis.fetch;

// ─── Petición mínima ───────────────────────────────────────────────────────

function importRequest(overrides: Record<string, unknown> = {}): Request {
  return new Request('https://app.test/api/prospect-batches/create-import-batch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
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
          ...(overrides.candidateOverrides as Record<string, unknown> ?? {}),
        },
      ],
      recognized_columns: ['company_name', 'country_code', 'industry'],
      unrecognized_columns: [],
      total_rows: 1,
      valid_rows: 1,
      invalid_rows: 0,
      warning_rows: 0,
      ...(overrides.bodyOverrides as Record<string, unknown> ?? {}),
    }),
  });
}

async function runRoute(request: Request): Promise<{ status: number; body: Record<string, unknown> }> {
  const { POST } = await import('../route');
  // El handler tipa NextRequest; una Request estándar cumple lo que este handler usa.
  const response = await POST(request as never);
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

function recordOriginMetadata(row: Record<string, unknown>): Record<string, unknown> {
  const meta = row.metadata as Record<string, unknown>;
  return meta[CANDIDATE_RECORD_ORIGIN_METADATA_KEY] as Record<string, unknown>;
}

// ─── B1.5 — la columna deja de quedarse en NULL por omisión ────────────────

describe('CUT4-B1 § 8 — importación externa: procedencia persistida', () => {
  beforeEach(resetSpy);

  it('el candidato importado ya no deja record_origin sin escribir', async () => {
    const { status } = await runRoute(importRequest());

    assert.equal(status, 200);
    assert.equal(spy.candidateInserts.length, 1);
    const row = spy.candidateInserts[0];
    assert.ok(
      'record_origin' in row,
      'el writer tiene que persistir la decisión canónica, no omitir la columna',
    );
    assert.notEqual(row.record_origin, undefined);
    assert.notEqual(row.record_origin, null);
  });

  it('la procedencia es la que dicta el clasificador canónico: import, NO production', async () => {
    await runRoute(importRequest());

    const row = spy.candidateInserts[0];
    assert.equal(row.record_origin, 'import');
    assert.notEqual(
      row.record_origin,
      'production',
      'una importación externa no puede forzarse a production',
    );
  });

  it('la derivación canónica queda auditable en la metadata', async () => {
    await runRoute(importRequest());

    const block = recordOriginMetadata(spy.candidateInserts[0]);
    assert.ok(block);
    assert.equal(block.record_origin, 'import');
    assert.equal(block.classification_source, 'writer');
    assert.equal(block.is_clean_production, false);
    assert.equal(block.decided_by, 'canonical_writer');
    const derivation = block.derivation as Record<string, unknown>;
    assert.equal(derivation.matched_rule, 'external_import');
  });

  it('no escribe classification_source ni classification_confidence', async () => {
    await runRoute(importRequest());

    const row = spy.candidateInserts[0];
    assert.ok(!('classification_source' in row));
    assert.ok(!('classification_confidence' in row));
  });
});

// ─── B1.6 — nada más de la ruta cambia ─────────────────────────────────────

describe('CUT4-B1 § 8/§ 10 — el resto de la importación queda intacto', () => {
  beforeEach(resetSpy);

  it('source_primary sigue siendo external_import y status needs_review', async () => {
    await runRoute(importRequest());

    const row = spy.candidateInserts[0];
    assert.equal(row.source_primary, 'external_import');
    assert.equal(row.status, 'needs_review');
  });

  it('la metadata de importación sobrevive byte a byte', async () => {
    await runRoute(importRequest());

    const meta = spy.candidateInserts[0].metadata as Record<string, unknown>;
    assert.equal(meta.imported_from, 'paste');
    assert.equal(meta.origen, 'external_import');
    assert.equal(meta.source_url, 'https://fuente.example/uno');
    assert.equal(meta.evidence_url, 'https://fuente.example/uno');
    assert.equal(meta.notes, 'Nota del importador');
    assert.deepEqual(meta.import, {
      source_url: 'https://fuente.example/uno',
      notes: 'Nota del importador',
      origen: 'external_import',
    });
  });

  it('las columnas de catálogo y clasificación se siguen escribiendo', async () => {
    await runRoute(importRequest());

    const row = spy.candidateInserts[0];
    assert.equal(row.catalog_version_id, CATALOG_VERSION_ID);
    assert.equal(row.industry_id, INDUSTRY_ID);
    assert.ok('import_classification' in row);
  });

  it('el lote conserva su source, su nombre y toda su metadata', async () => {
    await runRoute(importRequest());

    const batch = spy.batchInserts[0];
    assert.equal(batch.source, 'external_import');
    assert.equal(batch.status, 'ready_for_review');
    assert.ok(typeof batch.name === 'string' && (batch.name as string).startsWith('Importación externa · '));
    const meta = batch.metadata as Record<string, unknown>;
    assert.equal(meta.import_type, 'paste');
    assert.equal(meta.source_label, 'Importación externa');
    assert.equal(meta.created_from_external_research, true);
    assert.equal(meta.enrichment_auto_run, false);
    assert.equal(meta.hubspot_sync_on_import, false);
    assert.ok(meta.classification_summary);
    assert.ok(!('record_origin' in batch), 'record_origin es de la fila del candidato, no del lote');
  });

  it('la validación post-importación se sigue invocando una sola vez', async () => {
    await runRoute(importRequest());

    assert.deepEqual(spy.postImportValidationCalls, [
      { batchId: 'batch-import-1', userId: 'internal-user-1' },
    ]);
  });

  it('una sola puerta de persistencia por candidato', async () => {
    await runRoute(importRequest());

    assert.equal(spy.candidateInserts.length, 1);
    assert.equal(spy.batchInserts.length, 1);
  });
});
