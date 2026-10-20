/**
 * AUDIT-HARDENING-1 — un índice de novedad fiscal incompleto no dice «no visto».
 *
 * Antes, si la consulta a `prospect_candidates` o a `accounts` fallaba, el índice
 * quedaba vacío en silencio y el escritor de fuentes estructuradas (capa gratuita
 * por país) escribía como nueva una empresa que ya era cuenta o candidata.
 *
 * Todo con dobles locales: sin red, sin Supabase real.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';

import { buildTaxIdNoveltyIndex, evaluateTaxIdNovelty } from '../tax-id-novelty-checker';

/** Doble de Supabase: la tabla indicada responde con error; las demás, vacías. */
function makeSupabase(failingTable: 'prospect_candidates' | 'accounts' | null): SupabaseClient {
  function builder(table: string) {
    const chain = {
      select: () => chain,
      in: () => chain,
      eq: () => chain,
      neq: () => chain,
      then(resolve: (v: { data: unknown; error: { message: string } | null }) => unknown) {
        const failed = table === failingTable;
        return Promise.resolve(
          resolve(failed ? { data: null, error: { message: 'statement timeout' } } : { data: [], error: null }),
        );
      },
    };
    return chain;
  }
  return { from: (table: string) => builder(table) } as unknown as SupabaseClient;
}

const NIT = '900123456-1';

async function decide(failingTable: 'prospect_candidates' | 'accounts' | null, taxId: string | null = NIT) {
  const index = await buildTaxIdNoveltyIndex({ supabase: makeSupabase(failingTable), taxIds: [taxId], countryCode: 'CO' });
  return { index, decision: evaluateTaxIdNovelty({ name: 'Acme', taxId, countryCode: 'CO', index }) };
}

describe('tax-id-novelty — índice incompleto (AUDIT-HARDENING-1)', () => {
  it('si falla la consulta de cuentas, no se escribe como nueva', async () => {
    const { index, decision } = await decide('accounts');
    assert.equal(index.degraded, true);
    assert.equal(decision.status, 'novelty_check_unavailable');
    assert.equal(decision.shouldSkip, true);
  });

  it('si falla la consulta de candidatos, tampoco', async () => {
    const { index, decision } = await decide('prospect_candidates');
    assert.equal(index.degraded, true);
    assert.equal(decision.shouldSkip, true);
  });

  it('con el índice completo y sin coincidencias, sigue siendo nueva', async () => {
    const { index, decision } = await decide(null);
    assert.notEqual(index.degraded, true);
    assert.equal(decision.status, 'new_candidate');
    assert.equal(decision.shouldSkip, false);
  });

  it('sin número fiscal no hay nada que verificar: no se bloquea', async () => {
    const { decision } = await decide('accounts', null);
    assert.equal(decision.status, 'new_candidate_no_tax_id');
    assert.equal(decision.shouldSkip, false);
  });
});
