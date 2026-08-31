/**
 * AGENT1-COUNTRY-SOURCE-PREPAID-NOVELTY-GATE-1 § 20 — qué se puede AFIRMAR.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPrePaidNoveltyContext } from '../prepaid-novelty-context';
import { buildPrePaidNoveltyTelemetry } from '../prepaid-novelty-telemetry';

// 🔴 CUT-L1 § 3 — `availableValues` lleva los 12 CONOCIDOS y `sent` lo que
// viajaría. La telemetría tiene que poder decir las dos cosas por separado.
const PLAN = {
  available: 12,
  availableValues: Array.from({ length: 12 }, (_, i) => `k${i}.example`),
  sent: ['a.example', 'b.example'],
  omittedDueToCap: 10,
};

function context(acceptedNovel: number, requestedTarget = 5) {
  return buildPrePaidNoveltyContext({
    requestedTarget,
    countryCode: 'CO',
    macroIndustryKey: 'health_pharma',
    freeSource: {
      sourceKey: 'co_siis_discovery',
      attempted: true,
      rawReturned: 40,
      macroConfirmed: 8,
      ambiguous: 20,
      rejected: 12,
      sellupKnown: 4,
      hubspotKnown: 2,
      acceptedNovel,
      failed: false,
      failureCode: null,
    },
  });
}

test('§ 20 — NUNCA se publican créditos ni dólares ahorrados', () => {
  const telemetry = buildPrePaidNoveltyTelemetry(context(2), PLAN, null);
  const serialized = JSON.stringify(telemetry);

  assert.ok(!serialized.includes('credits_saved'), 'no se inventan créditos ahorrados');
  assert.ok(!serialized.includes('usd_saved'), 'no se inventan dólares ahorrados');
  assert.ok(!serialized.includes('cost_saved'));
});

test('§ 20 — lo que sí se publica son hechos OBSERVADOS', () => {
  const avoided = buildPrePaidNoveltyTelemetry(context(5), PLAN, null);
  assert.equal(
    (avoided.savings as Record<string, unknown>).provider_requests_avoided_by_zero_residual,
    1,
    'la corrida no pidió nada porque el hueco era 0: es un hecho',
  );

  const notAvoided = buildPrePaidNoveltyTelemetry(context(2), PLAN, null);
  assert.equal(
    (notAvoided.savings as Record<string, unknown>).provider_requests_avoided_by_zero_residual,
    0,
  );
});

test('§ 20 — el recorte de exclusiones se reporta entero: disponibles, enviadas y omitidas', () => {
  const telemetry = buildPrePaidNoveltyTelemetry(context(2), PLAN, null);
  const pre = telemetry.pre_provider as Record<string, number>;

  assert.equal(pre.exclusion_domains_available, 12);
  assert.equal(pre.exclusion_domains_sent, 2);
  assert.equal(pre.exclusion_domains_omitted, 10);
  assert.equal(pre.residual_gap, 3);
  assert.equal(pre.accepted_before_provider, 2);
});

test('§ 20 — la fuente reporta sus tres veredictos por separado', () => {
  const source = buildPrePaidNoveltyTelemetry(context(2), PLAN, null).country_source as Record<
    string,
    unknown
  >;
  assert.equal(source.raw_returned, 40);
  assert.equal(source.macro_confirmed, 8);
  assert.equal(source.ambiguous, 20);
  assert.equal(source.rejected, 12);
  assert.equal(source.sellup_known, 4);
  assert.equal(source.hubspot_known, 2);
  assert.equal(source.accepted_novel, 2);
  assert.equal(source.failed, false);
});

test('§ 20 — las páginas segundas evitadas salen del ejecutor, nunca de una estimación', () => {
  const telemetry = buildPrePaidNoveltyTelemetry(context(2), PLAN, {
    required: true,
    initialResidualGap: 3,
    pagesAttempted: 3,
    pagesSkippedZeroNovelty: 3,
    branchesAttempted: 3,
    requestsUsed: 3,
    usefulNovel: 0,
  });

  assert.equal(
    (telemetry.savings as Record<string, unknown>).second_pages_avoided_zero_novelty,
    3,
  );
  assert.equal((telemetry.provider as Record<string, unknown>).requests_used, 3);
  assert.equal((telemetry.provider as Record<string, unknown>).useful_novel, 0);
});
