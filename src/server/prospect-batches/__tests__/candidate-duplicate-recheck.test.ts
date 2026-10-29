// FEEDBACK 29-10 — «Verificar ahora» / rescate: la revisión de duplicados sobre una candidata
// existente guarda el veredicto real, y no escribe nada cuando SellUp o HubSpot no responden.
// Run: node --import tsx --test <this file>

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  buildRecheckDuplicateMetadata,
  recheckCandidateDuplicates,
} from '../candidate-duplicate-recheck.server';
import type { CandidateDuplicateResult } from '../duplicate-detection';
import { canRecheckDuplicates } from '@/modules/prospect-review/recheck-duplicates-eligibility';

type Row = Record<string, unknown>;

function fakeSupabase(row: Row | null) {
  const updates: Row[] = [];
  const client = {
    from() {
      let patch: Row | null = null;
      const b: Record<string, unknown> = {
        select: () => b,
        eq: () => (patch ? Promise.resolve({ error: null }) : b),
        update: (p: Row) => { patch = p; updates.push(p); return b; },
        maybeSingle: async () => ({ data: row, error: null }),
      };
      return b;
    },
  };
  return { client: client as unknown as SupabaseClient, updates };
}

const ROW = {
  id: 'cand-1', name: 'CASA BRUGAL', website: 'https://casabrugal.com', domain: 'casabrugal.com',
  country_code: 'DO', tax_identifier: null, normalized_name: 'casa brugal', metadata: { claude_rescue: { ok: true } },
};

function result(over: Partial<CandidateDuplicateResult>): CandidateDuplicateResult {
  return {
    sellup_duplicate_check: {
      status: 'no_match', matched_account_id: null, matched_candidate_id: null, matched_name: null,
      matched_domain: null, matched_website: null, matched_country_code: null, matched_tax_identifier: null,
      matched_source: null, matched_status: null, matched_by: null, confidence: 0,
    },
    hubspot_duplicate_check: { status: 'no_match', matched_company_id: null, matched_company_name: null } as CandidateDuplicateResult['hubspot_duplicate_check'],
    normalized_keys: { normalized_name: 'casa brugal', normalized_domain: 'casabrugal.com', normalized_tax_identifier: null, normalized_linkedin_url: null, country_code: 'DO' },
    db_duplicate_status: 'no_match',
    db_matched_account_id: null,
    db_matched_hubspot_company_id: null,
    db_confidence_score: 0,
    ...over,
  } as CandidateDuplicateResult;
}

describe('recheckCandidateDuplicates', () => {
  it('sin coincidencias → guarda no_match y deja constancia de que se consultó HubSpot', async () => {
    const { client, updates } = fakeSupabase(ROW);
    const r = await recheckCandidateDuplicates(client, 'cand-1', async () => result({}));
    assert.equal(r.ok, true);
    assert.equal(updates.length, 1);
    assert.equal(updates[0].duplicate_status, 'no_match');
    const meta = updates[0].metadata as Row;
    assert.deepEqual((meta.duplicate_check as Row).sources_checked, ['sellup', 'hubspot']);
    // No se pierde lo que ya traía la ficha.
    assert.deepEqual(meta.claude_rescue, { ok: true });
  });

  it('ya está en HubSpot → guarda la coincidencia de HubSpot', async () => {
    const { client, updates } = fakeSupabase(ROW);
    await recheckCandidateDuplicates(client, 'cand-1', async () => result({
      db_duplicate_status: 'exact_duplicate',
      db_matched_hubspot_company_id: 'hs-9',
      hubspot_duplicate_check: { status: 'match', matched_company_id: 'hs-9', matched_company_name: 'Casa Brugal' } as CandidateDuplicateResult['hubspot_duplicate_check'],
    }));
    assert.equal(updates[0].duplicate_status, 'exact_duplicate');
    assert.equal(updates[0].matched_hubspot_company_id, 'hs-9');
    const matches = ((updates[0].metadata as Row).duplicate_check as Row).matches as Row[];
    assert.equal(matches[0].source, 'hubspot');
  });

  it('SellUp o HubSpot no responden → NO escribe nada', async () => {
    const { client, updates } = fakeSupabase(ROW);
    const r = await recheckCandidateDuplicates(client, 'cand-1', async () => result({ db_duplicate_status: 'unchecked' }));
    assert.equal(r.ok, false);
    assert.equal(updates.length, 0);
  });

  it('la candidata no existe → not_found sin escribir', async () => {
    const { client, updates } = fakeSupabase(null);
    const r = await recheckCandidateDuplicates(client, 'cand-1', async () => result({}));
    assert.deepEqual(r.ok ? null : r.reason, 'not_found');
    assert.equal(updates.length, 0);
  });

  it('HubSpot no configurado → sólo consta SellUp', () => {
    const meta = buildRecheckDuplicateMetadata(
      result({ hubspot_duplicate_check: { status: 'not_configured' } as CandidateDuplicateResult['hubspot_duplicate_check'] }),
      'x',
    );
    assert.deepEqual(meta.sources_checked, ['sellup']);
  });
});

describe('canRecheckDuplicates — cuándo se ofrece «Verificar ahora»', () => {
  it('sólo en revisión y sin verificar', () => {
    assert.equal(canRecheckDuplicates({ status: 'needs_review', duplicateStatus: 'unchecked' }), true);
    assert.equal(canRecheckDuplicates({ status: 'needs_review', duplicateStatus: 'insufficient_data' }), true);
    assert.equal(canRecheckDuplicates({ status: 'needs_review', duplicateStatus: 'no_match' }), false);
    assert.equal(canRecheckDuplicates({ status: 'discarded', duplicateStatus: 'unchecked' }), false);
  });
});

describe('capa gratuita de registros oficiales — consulta HubSpot al guardar (código)', () => {
  const src = readFileSync(
    join(__dirname, '..', 'country-source-discovery', 'run-prepaid-novelty-discovery.server.ts'),
    'utf8',
  );
  it('el guardado pide la revisión de HubSpot (antes quedaba «sin verificar»)', () => {
    const persistCall = src.slice(src.indexOf('await deps.persist(client, {'));
    assert.match(persistCall.slice(0, 1200), /runHubspotCheck: true/);
  });
});
