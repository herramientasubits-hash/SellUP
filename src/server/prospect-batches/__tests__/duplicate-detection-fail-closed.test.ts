/**
 * AGENT1-DUPLICATE-DETECTION-FISCAL-AUTHORITY-1 · AGENT1-DUPLICATE-DETECTION-FAIL-CLOSED-1 ·
 * AGENT1-NORMALIZED-NAME-LOOKUP-1 — la detección universal (importación) usa la
 * misma identidad fiscal que el resto de Agente 1, no da «sin coincidencia» sobre
 * una lectura fallida y encuentra el nombre guardado con sufijo legal.
 *
 * Sin red: un doble de cliente Supabase; HubSpot fuera (`includeHubSpot: false`).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';

import { detectCandidateDuplicates } from '../duplicate-detection';
import {
  createFakeSupabase,
  filterValue,
  type RecordedQuery,
} from '@/server/agents/prospecting-toolkit/__tests__/support/fake-supabase-query';

const candidate = (overrides: Record<string, unknown> = {}) => ({
  id: 'cand-nuevo',
  name: 'Acme S.A.S.',
  domain: null,
  website: null,
  country_code: 'CO',
  tax_identifier: '900.123.456-7',
  ...overrides,
});

async function detect(respond: (q: RecordedQuery) => { data: unknown[] | null; error: unknown }, overrides = {}) {
  const { client, queries } = createFakeSupabase(respond);
  const result = await detectCandidateDuplicates({
    supabase: client as unknown as SupabaseClient,
    candidate: candidate(overrides),
    includeHubSpot: false,
  });
  return { result, queries };
}

describe('identidad fiscal con país', () => {
  it('🔴 «900.123.456-7» encuentra la cuenta guardada como «900123456» (antes: igualdad cruda, no la veía)', async () => {
    const { result, queries } = await detect((q) =>
      q.table === 'accounts' && filterValue(q, 'in', 'tax_identifier')
        ? { data: [{ id: 'acc-1', name: 'Acme', tax_identifier: '900123456', country_code: 'CO' }], error: null }
        : { data: [], error: null },
    );
    assert.equal(result.sellup_duplicate_check.status, 'duplicate');
    assert.equal(result.sellup_duplicate_check.matched_account_id, 'acc-1');
    assert.equal(result.db_duplicate_status, 'exact_duplicate');
    const needles = filterValue(queries[0], 'in', 'tax_identifier') as string[];
    assert.ok(needles.includes('900.123.456-7') && needles.includes('900123456'));
  });

  it('🔴 el mismo número en OTRO país no es la misma empresa (antes: duplicado con confianza 100)', async () => {
    const { result } = await detect((q) =>
      q.table === 'accounts' && filterValue(q, 'in', 'tax_identifier')
        ? { data: [{ id: 'acc-mx', name: 'Otra', tax_identifier: '900123456', country_code: 'MX' }], error: null }
        : { data: [], error: null },
    );
    assert.equal(result.sellup_duplicate_check.status, 'no_match');
  });

  it('mismo canónico pero fila SIN país ⇒ posible duplicado (no se descarta ni se da por probado)', async () => {
    const { result } = await detect((q) =>
      q.table === 'accounts' && filterValue(q, 'in', 'tax_identifier')
        ? { data: [{ id: 'acc-sin-pais', name: 'Acme', tax_identifier: '900123456-7', country_code: null }], error: null }
        : { data: [], error: null },
    );
    assert.equal(result.sellup_duplicate_check.status, 'possible_duplicate');
    assert.equal(result.sellup_duplicate_check.matched_by, 'tax_identifier_unproven_country');
  });
});

describe('lectura fallida ⇒ unchecked', () => {
  it('🔴 un error de Supabase deja la comprobación en error y el estado en unchecked (antes: no_match)', async () => {
    const { result } = await detect(() => ({ data: null, error: { code: '57014' } }));
    assert.equal(result.sellup_duplicate_check.status, 'error');
    assert.equal(result.db_duplicate_status, 'unchecked');
  });

  it('sin errores y sin coincidencias sigue siendo no_match', async () => {
    const { result } = await detect(() => ({ data: [], error: null }));
    assert.equal(result.db_duplicate_status, 'no_match');
  });
});

describe('nombre normalizado', () => {
  it('🔴 busca «acme s a s» (como se guarda) además de «acme»', async () => {
    const { result, queries } = await detect(
      (q) => {
        const names = filterValue(q, 'in', 'normalized_name') as string[] | undefined;
        return q.table === 'accounts' && names?.includes('acme s a s')
          ? { data: [{ id: 'acc-nombre', name: 'Acme S.A.S.', country_code: 'CO' }], error: null }
          : { data: [], error: null };
      },
      { tax_identifier: null },
    );
    assert.equal(result.sellup_duplicate_check.status, 'possible_duplicate');
    assert.equal(result.sellup_duplicate_check.matched_by, 'normalized_name_country');
    const nameQuery = queries.find((q) => filterValue(q, 'in', 'normalized_name'));
    assert.ok(nameQuery);
    assert.deepEqual((filterValue(nameQuery, 'in', 'normalized_name') as string[]).sort(), ['acme', 'acme s a s']);
  });
});
