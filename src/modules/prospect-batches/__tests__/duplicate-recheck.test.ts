/**
 * «Revisar duplicados» vuelve a correr la revisión: guarda lo que encuentra, no un
 * «no_match» a ciegas, y sólo la usan admin o Growth.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decideDuplicateRecheck, DUPLICATE_RECHECK_MESSAGES } from '../duplicate-recheck';

const HERE = dirname(fileURLToPath(import.meta.url));

const result = (status: Parameters<typeof decideDuplicateRecheck>[0]['db_duplicate_status'], extra = {}) => ({
  db_duplicate_status: status,
  db_matched_account_id: null,
  db_matched_hubspot_company_id: null,
  db_confidence_score: 0,
  ...extra,
});

describe('decideDuplicateRecheck', () => {
  it('si una fuente no respondió no escribe nada', () => {
    assert.deepEqual(decideDuplicateRecheck(result('unchecked')), { kind: 'unknown' });
  });

  it('una coincidencia en HubSpot queda guardada, no se limpia', () => {
    const outcome = decideDuplicateRecheck(
      result('possible_duplicate', { db_matched_hubspot_company_id: 'hs-1', db_confidence_score: 0.9 }),
    );
    assert.deepEqual(outcome, {
      kind: 'write',
      duplicateStatus: 'possible_duplicate',
      matchedAccountId: null,
      matchedHubSpotCompanyId: 'hs-1',
      confidenceScore: 0.9,
    });
  });

  it('la misma empresa en SellUp queda como duplicado exacto', () => {
    const outcome = decideDuplicateRecheck(result('exact_duplicate', { db_matched_account_id: 'acc-1' }));
    assert.equal(outcome.kind, 'write');
    assert.equal(outcome.kind === 'write' && outcome.duplicateStatus, 'exact_duplicate');
    assert.equal(outcome.kind === 'write' && outcome.matchedAccountId, 'acc-1');
  });

  it('sólo un resultado limpio pasa a no_match', () => {
    const outcome = decideDuplicateRecheck(result('no_match'));
    assert.equal(outcome.kind === 'write' && outcome.duplicateStatus, 'no_match');
  });

  it('cada resultado tiene un mensaje', () => {
    for (const status of ['no_match', 'possible_duplicate', 'exact_duplicate', 'insufficient_data'] as const) {
      assert.ok(DUPLICATE_RECHECK_MESSAGES[status].length > 0);
    }
  });
});

describe('las acciones de revisión', () => {
  const source = readFileSync(join(HERE, '..', 'actions.ts'), 'utf8');
  const body = (name: string) => {
    const start = source.indexOf(`export async function ${name}(`);
    assert.ok(start >= 0, `${name} existe`);
    return source.slice(start, source.indexOf('\nexport ', start + 1));
  };

  for (const name of ['markCandidateDuplicateReviewedAction', 'markCandidateReadyForApprovalAction']) {
    it(`${name} exige revisarTodasLasCandidatas antes de leer o escribir`, () => {
      const fn = body(name);
      const gate = fn.indexOf("checkCapability('revisarTodasLasCandidatas')");
      assert.ok(gate > 0);
      assert.ok(gate < fn.indexOf(".from('prospect_candidates')"));
    });
  }

  it('marcar duplicidad revisada vuelve a correr la revisión y no fija no_match', () => {
    const fn = body('markCandidateDuplicateReviewedAction');
    assert.ok(fn.includes('detectCandidateDuplicates('));
    assert.ok(fn.includes('decideDuplicateRecheck('));
    assert.ok(fn.includes('duplicate_status: recheck.duplicateStatus'));
    assert.ok(!fn.includes("duplicate_status: 'no_match'"));
  });
});
