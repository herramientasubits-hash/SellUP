/**
 * Tests — AGENT1-IMPORT-PARITY-1: la ruta de importación aplica «una empresa,
 * un vendedor» igual que Apollo/Lusha.
 *
 *   · fila repetida en el archivo            → `duplicate`, no se reclama
 *   · dominio activo en el lote de otro      → `duplicate`, no se reclama
 *   · el resto                               → `needs_review` + reclamo global
 *   · todas                                  → `identity_key` calculada
 *
 * Mocks (sólo el I/O real): cliente de sesión, cliente administrativo, catálogo
 * y la validación post-import (módulo `use server`, tiene su propio test).
 *
 * Cero red, cero proveedores, cero créditos, cero migraciones.
 *
 * Correr: node --import tsx --experimental-test-module-mocks --test <este archivo>
 */

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

import { IMPORT_ADMISSION_METADATA_KEY } from '@/server/prospect-batches/import-identity-admission';

type Row = Record<string, unknown>;

const spy = {
  candidateInserts: [] as Row[],
  batchUpdates: [] as Row[],
  rpcCalls: [] as Array<{ fn: string; args: Row }>,
  claimedElsewhereIds: new Set<string>(),
};

function resetSpy(): void {
  spy.candidateInserts.length = 0;
  spy.batchUpdates.length = 0;
  spy.rpcCalls.length = 0;
  spy.claimedElsewhereIds = new Set();
}

const ACTIVE_ELSEWHERE: Row[] = [
  { id: 'cand-otro-vendedor', name: 'Tomada SAS', domain: 'www.tomada.co', normalized_name: 'tomada', metadata: {}, status: 'needs_review' },
];

function insertedWithIds(): Row[] {
  return spy.candidateInserts.map((r, i) => ({ ...r, id: `cand-${i + 1}` }));
}

/** Cadena de consulta mínima: registra filtros y resuelve al esperarla. */
function queryChain(resolve: (filters: Row) => unknown): Record<string, unknown> {
  const filters: Row = {};
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: (col: string, v: unknown) => { filters[`eq:${col}`] = v; return chain; },
    in: (col: string, v: unknown) => { filters[`in:${col}`] = v; return chain; },
    neq: (col: string, v: unknown) => { filters[`neq:${col}`] = v; return chain; },
    limit: () => chain,
    then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) =>
      Promise.resolve({ data: resolve(filters), error: null }).then(ok, ko),
  };
  return chain;
}

function makeAdmin(): unknown {
  return {
    from(table: string) {
      if (table !== 'prospect_candidates') throw new Error(`admin: tabla no simulada ${table}`);
      return queryChain((f) => {
        // Prefetch de la guarda: por estado activo + dominio.
        if (f['in:domain']) return ACTIVE_ELSEWHERE;
        // Relectura del reclamo: por lote + ids.
        const ids = (f['in:id'] as string[]) ?? [];
        return insertedWithIds()
          .filter((r) => ids.includes(r.id as string))
          .map((r) => ({ ...r, tax_id: null, source_trace: null }));
      });
    },
    async rpc(fn: string, args: Row) {
      spy.rpcCalls.push({ fn, args });
      const ids = (args.p_candidates as Array<{ candidateId: string }>).map((c) => c.candidateId);
      return {
        data: {
          claimed_candidate_ids: ids.filter((id) => !spy.claimedElsewhereIds.has(id)),
          claimed_elsewhere_candidate_ids: ids.filter((id) => spy.claimedElsewhereIds.has(id)),
        },
        error: null,
      };
    },
  };
}

function makeSession(): unknown {
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'auth-user-1' } }, error: null }) },
    from(table: string) {
      if (table === 'internal_users') {
        const c: Record<string, unknown> = {
          select: () => c,
          eq: () => c,
          single: async () => ({ data: { id: 'internal-user-1' }, error: null }),
        };
        return c;
      }
      if (table === 'prospect_batches') {
        const read: Record<string, unknown> = {
          eq: () => read,
          single: async () => ({ data: { metadata: { import_validation: { ok: true } } }, error: null }),
        };
        return {
          select: () => read,
          update: (row: Row) => {
            spy.batchUpdates.push(row);
            return { eq: async () => ({ error: null }) };
          },
          insert: (row: Row) => ({
            select: () => ({ single: async () => ({ data: { id: 'batch-import-1', name: row.name }, error: null }) }),
          }),
        };
      }
      if (table === 'prospect_candidate_audit') {
        return { insert: async () => ({ error: null }) };
      }
      if (table === 'prospect_candidates') {
        const chain = queryChain((f) => {
          const ids = (f['in:id'] as string[]) ?? [];
          return insertedWithIds()
            .filter((r) => (ids.length === 0 || ids.includes(r.id as string)) && r.status !== f['neq:status'])
            .map((r) => ({ id: r.id, status: r.status, duplicate_status: r.duplicate_status ?? null, metadata: r.metadata }));
        });
        chain.insert = (row: Row) => {
          spy.candidateInserts.push({ ...row });
          const id = `cand-${spy.candidateInserts.length}`;
          return { select: () => ({ single: async () => ({ data: { id }, error: null }) }) };
        };
        return chain;
      }
      throw new Error(`sesión: tabla no simulada ${table}`);
    },
  };
}

mock.module('@/lib/supabase/server', { namedExports: { createClient: async () => makeSession() } });
mock.module('@/lib/supabase/admin', { namedExports: { createSupabaseAdminClient: () => makeAdmin() } });
mock.module('@/modules/prospect-batches/actions', {
  namedExports: { validateImportedCandidatesBatch: async () => ({ success: true }) },
});
mock.module('@/modules/prospect-batches/import-catalog-loader', {
  namedExports: {
    loadImportCatalog: async () => ({
      success: true,
      catalogVersionId: '00000000-0000-4000-8000-0000000000c1',
      catalog: {
        version: 'v2.0.0',
        industries: [{ id: '00000000-0000-4000-8000-0000000000a1', name: 'Tecnología', slug: 'tecnologia', active: true }],
        subindustries: [],
        aliases: [],
      },
    }),
  },
});

globalThis.fetch = (async () => {
  throw new Error('este test no debe hacer red');
}) as typeof globalThis.fetch;

function company(name: string, website: string, extra: Row = {}): Row {
  return { company_name: name, country: 'Colombia', country_code: 'CO', industry: 'Tecnología', website, ...extra };
}

async function importRows(candidates: Row[]): Promise<{ status: number; body: Row }> {
  const { POST } = await import('../route');
  const request = new Request('https://app.test/api/prospect-batches/create-import-batch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      import_type: 'csv',
      candidates,
      recognized_columns: ['company_name', 'country_code', 'industry', 'website'],
      unrecognized_columns: [],
      total_rows: candidates.length,
      valid_rows: candidates.length,
      invalid_rows: 0,
      warning_rows: 0,
    }),
  });
  const response = await POST(request as never);
  return { status: response.status, body: (await response.json()) as Row };
}

describe('AGENT1-IMPORT-PARITY-1 — admisión por identidad en la ruta de importación', () => {
  beforeEach(resetSpy);

  it('repetida en el archivo y activa en otro lote quedan duplicate; el resto needs_review', async () => {
    const { status } = await importRows([
      company('Acme SAS', 'https://acme.com.co'),
      company('ACME S.A.S.', 'www.acme.com.co'),
      company('Tomada SAS', 'tomada.co'),
      company('Nueva SAS', 'nueva.co'),
    ]);
    assert.equal(status, 200);
    assert.deepEqual(spy.candidateInserts.map((r) => r.status), ['needs_review', 'duplicate', 'duplicate', 'needs_review']);
    assert.equal(spy.candidateInserts[1].duplicate_status, 'exact_duplicate');
    assert.equal(spy.candidateInserts[2].duplicate_status, 'exact_duplicate');
    assert.equal('duplicate_status' in spy.candidateInserts[0], false);

    const reasons = spy.candidateInserts.map(
      (r) => ((r.metadata as Row)[IMPORT_ADMISSION_METADATA_KEY] as Row).reason ?? null,
    );
    assert.deepEqual(reasons, [null, 'intra_file_duplicate', 'active_candidate_domain', null]);
  });

  it('toda fila lleva identity_key de la autoridad compartida', async () => {
    await importRows([company('Acme SAS', 'https://acme.com.co'), company('Nit SAS', '', { tax_identifier: '900123456-7' })]);
    assert.equal(spy.candidateInserts[0].identity_key, 'domain:acme.com.co');
    assert.match(String(spy.candidateInserts[1].identity_key), /^tax:co:/);
  });

  it('el NIT se guarda normalizado, con su tipo y su estado de validación (PARITY-2)', async () => {
    await importRows([company('Nit SAS', '', { tax_identifier: '900.123.456' })]);
    const [inserted] = spy.candidateInserts;
    assert.match(String(inserted.tax_identifier), /^900123456-\d$/);
    assert.equal(inserted.tax_identifier_type, 'NIT');
    assert.equal((inserted.metadata as Row).tax_identifier_validation, 'valid_check_digit_computed');
  });

  it('sólo se reclaman las filas vivas, con el cliente administrativo y la RPC de la 140', async () => {
    await importRows([
      company('Acme SAS', 'https://acme.com.co'),
      company('ACME S.A.S.', 'www.acme.com.co'),
      company('Tomada SAS', 'tomada.co'),
      company('Nueva SAS', 'nueva.co'),
    ]);
    assert.equal(spy.rpcCalls.length, 1);
    assert.equal(spy.rpcCalls[0].fn, 'claim_company_identities');
    const claimed = (spy.rpcCalls[0].args.p_candidates as Array<{ candidateId: string; batchId: string }>);
    assert.deepEqual(claimed.map((c) => c.candidateId), ['cand-1', 'cand-4']);
    assert.ok(claimed.every((c) => c.batchId === 'batch-import-1'));
  });

  it('el resumen del lote cuenta duplicados y reclamos perdidos sin pisar la metadata previa', async () => {
    spy.claimedElsewhereIds = new Set(['cand-2']);
    await importRows([company('Uno SAS', 'uno.co'), company('Dos SAS', 'dos.co')]);
    const last = spy.batchUpdates.at(-1)?.metadata as Row;
    assert.deepEqual(last.import_validation, { ok: true });
    assert.deepEqual(last[IMPORT_ADMISSION_METADATA_KEY], {
      active_candidate_guard: 'ok',
      intra_file_duplicates: 0,
      active_candidate_duplicates: 0,
      global_claims_degraded: false,
      claimed_elsewhere: 1,
    });
  });
});
