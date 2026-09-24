/**
 * AGENT1-PROVIDER-RUN-SCORECARD-1 — una fila por CORRIDA y PROVEEDOR.
 *
 * Lo que estas pruebas fijan, dicho como defecto: sin esta ficha, comparar a
 * Apollo con Lusha exige coser a mano cinco fuentes con formas distintas, y el
 * panel de efectividad —que une el coste por `batch_id`— deja fuera justo las
 * corridas que más dicen:
 *
 *   · una corrida de Lusha que lo rechaza todo NO crea lote (2026-09-24, CO ×
 *     Consumo Masivo: 4 créditos, 0 aceptadas) ⇒ su coste no aparece;
 *   · la pierna Lusha de la cascada escribe su log con `batch_id` NULL ⇒ su
 *     coste no aparece;
 *   · `provider_attempts.credits_used` de Apollo cuenta sólo las páginas de
 *     búsqueda (3 frente a 8 reales en `52b22335`).
 *
 * Los fixtures reproducen, campo por campo en lo que la ficha lee, las seis
 * corridas standalone del 2026-09-24 y el lote de cascada `9a5ac2c8`.
 */

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildProviderRunScorecard,
  summarizeProviderRunScorecard,
  type ScorecardBatchInput,
  type ScorecardOutcomeCount,
  type ScorecardPrice,
  type ScorecardUsageLogInput,
} from '../provider-run-scorecard';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const PRICES: readonly ScorecardPrice[] = [
  { providerKey: 'apollo', unitCostUsd: 0.00875, source: 'provider_pricing_config' },
  { providerKey: 'lusha', unitCostUsd: 0.08823529, source: 'provider_pricing_config' },
];

function ledger(entries: readonly (readonly [string, string, number])[]) {
  return {
    ledger: {
      maxCredits: 15,
      entries: entries.map(([operationKey, state, settledCredits]) => ({
        operationKey,
        state,
        settledCredits,
        reservedCredits: settledCredits,
      })),
    },
  };
}

function aft(paid: number, persistedPaid: number, measured = true, kind = 'exact') {
  return {
    requested_target: 5,
    accepted_free_for_target: 0,
    accepted_paid_for_target: paid,
    accepted_for_target_total: paid,
    remaining_target: 5 - paid,
    target_reached: paid >= 5,
    persisted_free_candidates: 0,
    persisted_paid_candidates: persistedPaid,
    persisted_total_candidates: persistedPaid,
    paid_acceptance_measured: measured,
    accepted_count_kind: kind,
    acceptance_unknown_reasons: [],
  };
}

function apolloBatch(
  id: string,
  industry: string,
  opts: {
    ledgerEntries: readonly (readonly [string, string, number])[];
    raw: number;
    unique: number;
    accepted: number;
    persisted: number;
    leg?: Record<string, unknown>;
    omitAcceptance?: boolean;
  },
): ScorecardBatchInput {
  return {
    id,
    createdAt: '2026-09-24T12:18:43Z',
    countryCode: 'CO',
    industry,
    metadata: {
      provider_attempts: [{ role: 'primary', provider: 'apollo', credits_used: 3 }],
      apollo_run_budget: ledger(opts.ledgerEntries),
      apollo_two_round_discovery: {
        run_metrics: { total_raw_results: opts.raw, total_unique_organizations: opts.unique },
      },
      ...(opts.omitAcceptance ? {} : { accepted_for_target: aft(opts.accepted, opts.persisted) }),
      lusha_waterfall_leg: opts.leg ?? { executed: false, skipReason: 'waterfall_flag_disabled' },
    },
  };
}

function lushaBatch(
  id: string,
  industry: string,
  opts: { credits: number; accepted: number; persisted: number },
): ScorecardBatchInput {
  return {
    id,
    createdAt: '2026-09-24T12:23:17Z',
    countryCode: 'CO',
    industry,
    metadata: {
      provider_attempts: [{ role: 'primary', provider: 'lusha', credits_used: opts.credits }],
      billing: { credits_charged: opts.credits },
      accepted_for_target: aft(opts.accepted, opts.persisted),
    },
  };
}

function lushaObservability(opts: {
  raw: number;
  unique: number;
  knownSeed: number;
  seenHits: readonly number[];
  accepted: number;
  macro?: string;
}) {
  return {
    country_code: 'CO',
    macro_industry_key: opts.macro ?? null,
    run: {
      raw_results_total: opts.raw,
      unique_results_total: opts.unique,
      accepted_for_target_total: opts.accepted,
      duplicate_reason_counts: { known_domain_seed: opts.knownSeed },
      provider_seen: {
        branch_page_novelty_yield: opts.seenHits.map((hits, page) => ({
          page,
          raw_results: 25,
          provider_seen_hits: hits,
        })),
      },
    },
  };
}

function lushaLog(
  id: string,
  batchId: string | null,
  credits: number,
  observability: Record<string, unknown>,
  clientRequestId: string | null = null,
): ScorecardUsageLogInput {
  return {
    id,
    createdAt: '2026-09-24T12:20:58Z',
    providerKey: 'lusha',
    operationKey: 'company_prospecting_v3',
    batchId,
    creditsUsed: credits,
    metadata: {
      lusha_run_observability: observability,
      run_correlation: { client_request_id: clientRequestId },
    },
  };
}

function apolloLogs(batchId: string, credits: readonly number[]): ScorecardUsageLogInput[] {
  return credits.map((c, i) => ({
    id: `${batchId}-log-${i}`,
    createdAt: '2026-09-24T12:18:45Z',
    providerKey: 'apollo',
    operationKey: i < 2 ? 'organizations_search' : 'organization_enrichment',
    batchId,
    creditsUsed: c,
    metadata: null,
  }));
}

function outcomes(
  batchId: string,
  sourcePrimary: string,
  persisted: number,
  discards: Record<string, number>,
): ScorecardOutcomeCount[] {
  return [
    { batchId, sourcePrimary, kind: 'candidate', disposition: null, count: persisted },
    ...Object.entries(discards).map(([disposition, count]) => ({
      batchId,
      sourcePrimary,
      kind: 'discard' as const,
      disposition,
      count,
    })),
  ];
}

/** Las seis corridas standalone del 2026-09-24, tal como están en Producción. */
function septemberTwentyFourth() {
  const batches: ScorecardBatchInput[] = [
    apolloBatch('2505fc9c', 'Consumo Masivo', {
      ledgerEntries: [
        ['organizations_search', 'settled', 1],
        ['organizations_search', 'settled', 1],
        ['organization_enrichment', 'settled', 1],
      ],
      raw: 36,
      unique: 33,
      accepted: 1,
      persisted: 3,
    }),
    lushaBatch('f0fbc76b', 'Retail', { credits: 2, accepted: 2, persisted: 7 }),
    apolloBatch('2ae0a20b', 'Retail', {
      ledgerEntries: [
        ['organizations_search', 'settled', 1],
        ['organizations_search', 'settled', 1],
      ],
      raw: 35,
      unique: 34,
      accepted: 0,
      persisted: 0,
    }),
    apolloBatch('8e350781', 'Gobierno', {
      ledgerEntries: [
        ['organizations_search', 'settled', 1],
        ['organizations_search', 'settled', 1],
        ...Array.from({ length: 5 }, () => ['organization_enrichment', 'settled', 1] as const),
      ],
      raw: 102,
      unique: 99,
      accepted: 2,
      persisted: 6,
    }),
    lushaBatch('b02d3ac4', 'Gobierno', { credits: 2, accepted: 3, persisted: 4 }),
  ];
  const usageLogs: ScorecardUsageLogInput[] = [
    ...apolloLogs('2505fc9c', [1, 1, 1]),
    ...apolloLogs('2ae0a20b', [1, 1]),
    ...apolloLogs('8e350781', [1, 1, 1, 1, 1, 1, 1]),
    // Consumo Masivo con Lusha: rechazó todo ⇒ NO hay lote.
    lushaLog(
      'aa3a54e5',
      null,
      4,
      lushaObservability({
        raw: 100,
        unique: 47,
        knownSeed: 4,
        seenHits: [23, 2, 23, 2],
        accepted: 0,
        macro: 'consumer_goods',
      }),
    ),
    lushaLog(
      'f0fbc76b-log',
      'f0fbc76b',
      2,
      lushaObservability({ raw: 50, unique: 48, knownSeed: 1, seenHits: [24, 1], accepted: 2 }),
    ),
    lushaLog(
      'b02d3ac4-log',
      'b02d3ac4',
      2,
      lushaObservability({ raw: 50, unique: 47, knownSeed: 0, seenHits: [25, 25], accepted: 3 }),
    ),
  ];
  const outcomeCounts: ScorecardOutcomeCount[] = [
    ...outcomes('2505fc9c', 'apollo', 3, {
      cooldown_active: 15,
      other: 7,
      hubspot_duplicate: 5,
      ownership_domain_rejected: 3,
    }),
    ...outcomes('f0fbc76b', 'lusha', 7, {
      hubspot_duplicate: 28,
      sellup_duplicate: 13,
      country_rejected: 1,
    }),
    ...outcomes('2ae0a20b', 'apollo', 0, {
      cooldown_active: 19,
      hubspot_duplicate: 4,
      other: 7,
      ownership_domain_rejected: 4,
    }),
    ...outcomes('8e350781', 'apollo', 6, {
      cooldown_active: 52,
      hubspot_duplicate: 19,
      other: 10,
      ownership_domain_rejected: 11,
      country_rejected: 1,
    }),
    ...outcomes('b02d3ac4', 'lusha', 4, { hubspot_duplicate: 22, sellup_duplicate: 21 }),
  ];
  return { batches, usageLogs, outcomeCounts, prices: PRICES };
}

function row(rows: ReturnType<typeof buildProviderRunScorecard>, runKey: string) {
  const found = rows.find((r) => r.runKey === runKey);
  assert.ok(found, `no existe la fila ${runKey}`);
  return found;
}

// ── § 1 · las seis corridas reales ───────────────────────────────────────────

describe('§ 1 — reproduce las seis corridas standalone del 2026-09-24', () => {
  const rows = buildProviderRunScorecard(septemberTwentyFourth());

  test('una fila por corrida y proveedor: 3 de Apollo y 3 de Lusha', () => {
    assert.equal(rows.length, 6);
    assert.equal(rows.filter((r) => r.provider === 'apollo').length, 3);
    assert.equal(rows.filter((r) => r.provider === 'lusha').length, 3);
    assert.ok(rows.every((r) => r.role === 'standalone'));
  });

  test('🔴 el coste de Apollo sale del libro de la corrida, no de `provider_attempts`', () => {
    const gobierno = row(rows, 'batch:8e350781:apollo');
    assert.equal(gobierno.credits, 7, '2 páginas + 5 enrichments');
    assert.equal(gobierno.creditsSource, 'apollo_run_budget_ledger');
    assert.ok(!gobierno.gaps.includes('credits_mismatch_usage_logs'));
  });

  test('🔴 la corrida de Lusha SIN lote aparece, con su coste y su aceptación', () => {
    const cm = row(rows, 'log:aa3a54e5');
    assert.equal(cm.provider, 'lusha');
    assert.equal(cm.batchId, null);
    assert.equal(cm.credits, 4);
    assert.equal(cm.acceptedForTarget, 0);
    assert.equal(cm.acceptanceSource, 'lusha_usage_log');
    assert.equal(cm.persisted, 0, 'sin lote no hay filas persistidas');
    assert.equal(cm.discarded, null, 'y los descartes no son durables: se declara, no se inventa');
    assert.ok(cm.gaps.includes('no_batch_dispositions_not_durable'));
    assert.equal(cm.industry, 'consumer_goods');
  });

  test('la aceptación sale de `accepted_for_target`, nunca de `stop_reason` ni de las filas', () => {
    assert.equal(row(rows, 'batch:2505fc9c:apollo').acceptedForTarget, 1);
    assert.equal(row(rows, 'batch:2ae0a20b:apollo').acceptedForTarget, 0);
    assert.equal(row(rows, 'batch:8e350781:apollo').acceptedForTarget, 2);
    assert.equal(row(rows, 'batch:f0fbc76b:lusha').acceptedForTarget, 2);
    assert.equal(row(rows, 'batch:b02d3ac4:lusha').acceptedForTarget, 3);
    for (const r of rows.filter((r) => r.batchId !== null)) {
      assert.equal(r.acceptanceSource, 'batch_accepted_for_target');
    }
  });

  test('persistidas y descartes por proveedor, con su motivo', () => {
    const retailLusha = row(rows, 'batch:f0fbc76b:lusha');
    assert.equal(retailLusha.persisted, 7);
    assert.equal(retailLusha.discarded, 42);
    assert.deepEqual(retailLusha.discardsByDisposition, {
      hubspot_duplicate: 28,
      sellup_duplicate: 13,
      country_rejected: 1,
    });
  });

  test('🔴 cuadre: cada empresa distinta tiene destino (Lusha suma la semilla conocida)', () => {
    for (const r of rows.filter((r) => r.batchId !== null)) {
      assert.equal(r.unaccountedCompanies, 0, r.runKey);
      assert.ok(!r.gaps.includes('unaccounted_companies'), r.runKey);
    }
  });

  test('«ya vistas por el proveedor» se mide en Lusha y se DECLARA no medido en Apollo', () => {
    assert.equal(row(rows, 'batch:b02d3ac4:lusha').alreadySeenByProvider, 50);
    assert.equal(row(rows, 'batch:f0fbc76b:lusha').alreadySeenByProvider, 25);
    const apollo = row(rows, 'batch:2ae0a20b:apollo');
    assert.equal(apollo.alreadySeenByProvider, null);
    assert.ok(apollo.gaps.includes('provider_seen_not_measured'));
  });

  test('coste en dólares con el precio aplicado y su fuente', () => {
    const r = row(rows, 'batch:8e350781:apollo');
    assert.equal(r.unitCostUsd, 0.00875);
    assert.equal(r.priceSource, 'provider_pricing_config');
    assert.ok(Math.abs((r.costUsd ?? 0) - 0.06125) < 1e-9);
    assert.ok(Math.abs((r.costPerAccepted ?? 0) - 0.030625) < 1e-9);
  });

  test('sin aceptadas no hay coste por aceptada: `null`, no infinito ni cero', () => {
    assert.equal(row(rows, 'batch:2ae0a20b:apollo').costPerAccepted, null);
    assert.equal(row(rows, 'log:aa3a54e5').costPerAccepted, null);
  });
});

// ── § 2 · resumen por proveedor ──────────────────────────────────────────────

describe('§ 2 — el resumen reproduce la tabla del informe', () => {
  const summary = summarizeProviderRunScorecard(buildProviderRunScorecard(septemberTwentyFourth()));

  test('Apollo: 3 corridas · 12 créditos · 9 persistidas · 3 aceptadas', () => {
    const a = summary.byProvider.apollo;
    assert.equal(a.runs, 3);
    assert.equal(a.credits, 12);
    assert.equal(a.persisted, 9);
    assert.equal(a.acceptedForTarget, 3);
    assert.ok(Math.abs((a.costPerAccepted ?? 0) - 0.035) < 1e-9);
  });

  test('Lusha: 3 corridas · 8 créditos · 11 persistidas · 5 aceptadas', () => {
    const l = summary.byProvider.lusha;
    assert.equal(l.runs, 3);
    assert.equal(l.credits, 8);
    assert.equal(l.persisted, 11);
    assert.equal(l.acceptedForTarget, 5);
  });

  test('el resumen avisa cuándo sus totales descansan en filas con huecos', () => {
    assert.ok(summary.byProvider.lusha.runsWithGaps >= 1, 'la corrida sin lote');
  });
});

// ── § 3 · cascada ────────────────────────────────────────────────────────────

describe('§ 3 — la cascada: dos filas sobre UN lote, sin inventar un reparto', () => {
  const cascade = {
    batches: [
      apolloBatch('9a5ac2c8', 'Tecnología', {
        ledgerEntries: [
          ['organizations_search', 'settled', 1],
          ['organizations_search', 'settled', 1],
          ['organizations_search', 'settled', 1],
          ...Array.from({ length: 4 }, () => ['organization_enrichment', 'settled', 1] as const),
        ],
        raw: 206,
        unique: 169,
        accepted: 0,
        persisted: 5,
        leg: {
          executed: true,
          gap: 5,
          clientRequestId: '01e1957d',
          acceptedForTarget: 0,
          persistedCandidates: 0,
        },
      }),
    ],
    usageLogs: [
      ...apolloLogs('9a5ac2c8', [1, 1, 1, 1, 1, 1, 1]),
      // 🔴 La pierna escribe con `batch_id` NULL; se une por `client_request_id`.
      lushaLog(
        '981e6f4e',
        null,
        1,
        lushaObservability({ raw: 25, unique: 25, knownSeed: 0, seenHits: [25], accepted: 0 }),
        '01e1957d',
      ),
    ],
    outcomeCounts: [
      ...outcomes('9a5ac2c8', 'apollo', 5, {
        cooldown_active: 84,
        hubspot_duplicate: 40,
        ownership_domain_rejected: 21,
        other: 17,
        final_validation_rejected: 2,
      }),
      ...outcomes('9a5ac2c8', 'lusha', 0, { sellup_duplicate: 15, hubspot_duplicate: 10 }),
    ],
    prices: PRICES,
  };
  const rows = buildProviderRunScorecard(cascade);

  test('la pierna Lusha aparece como tal, con su coste y su lote', () => {
    const leg = row(rows, 'log:981e6f4e');
    assert.equal(leg.role, 'waterfall_leg');
    assert.equal(leg.batchId, '9a5ac2c8');
    assert.equal(leg.credits, 1);
    assert.equal(leg.acceptedForTarget, 0);
    assert.equal(leg.acceptanceSource, 'waterfall_leg_trace');
    assert.equal(leg.discarded, 25);
  });

  test('🔴 la aceptación de Apollo en un lote compartido NO se deduce restando', () => {
    const apollo = row(rows, 'batch:9a5ac2c8:apollo');
    assert.equal(apollo.acceptedForTarget, null);
    assert.ok(apollo.gaps.includes('shared_batch_acceptance_not_attributable'));
    assert.equal(apollo.persisted, 5, 'las filas SÍ son atribuibles por `source_primary`');
  });

  test('ningún log de Lusha se cuenta dos veces', () => {
    assert.equal(rows.filter((r) => r.provider === 'lusha').length, 1);
  });
});

// ── § 4 · huecos declarados ──────────────────────────────────────────────────

describe('§ 4 — lo que falta se DECLARA, nunca se rellena', () => {
  test('un libro con una operación sin liquidar marca el coste como incompleto', () => {
    const rows = buildProviderRunScorecard({
      batches: [
        apolloBatch('x1', 'Retail', {
          ledgerEntries: [
            ['organizations_search', 'settled', 1],
            ['organizations_search', 'indeterminate', 0],
          ],
          raw: 10,
          unique: 10,
          accepted: 0,
          persisted: 0,
        }),
      ],
      usageLogs: apolloLogs('x1', [1]),
      outcomeCounts: outcomes('x1', 'apollo', 0, { other: 10 }),
      prices: PRICES,
    });
    assert.ok(rows[0]!.gaps.includes('apollo_ledger_unsettled'));
  });

  test('libro y log de uso que no coinciden se señalan', () => {
    const rows = buildProviderRunScorecard({
      batches: [
        apolloBatch('x2', 'Retail', {
          ledgerEntries: [['organizations_search', 'settled', 2]],
          raw: 10,
          unique: 10,
          accepted: 0,
          persisted: 0,
        }),
      ],
      usageLogs: apolloLogs('x2', [1]),
      outcomeCounts: outcomes('x2', 'apollo', 0, { other: 10 }),
      prices: PRICES,
    });
    assert.ok(rows[0]!.gaps.includes('credits_mismatch_usage_logs'));
  });

  test('un lote sin `accepted_for_target` publica `null` y lo dice (caso `c681bfcd`)', () => {
    const rows = buildProviderRunScorecard({
      batches: [
        apolloBatch('c681bfcd', 'Tecnología', {
          ledgerEntries: [['organizations_search', 'settled', 1]],
          raw: 167,
          unique: 170,
          accepted: 0,
          persisted: 2,
          omitAcceptance: true,
        }),
      ],
      usageLogs: apolloLogs('c681bfcd', [1]),
      outcomeCounts: outcomes('c681bfcd', 'apollo', 2, { other: 168 }),
      prices: PRICES,
    });
    assert.equal(rows[0]!.acceptedForTarget, null);
    assert.ok(rows[0]!.gaps.includes('accepted_for_target_missing'));
  });

  test('una aceptación publicada como cota inferior se marca', () => {
    const batch = lushaBatch('x3', 'Retail', { credits: 2, accepted: 1, persisted: 3 });
    (batch.metadata as Record<string, unknown>).accepted_for_target = aft(
      1,
      3,
      false,
      'lower_bound',
    );
    const rows = buildProviderRunScorecard({
      batches: [batch],
      usageLogs: [],
      outcomeCounts: outcomes('x3', 'lusha', 3, {}),
      prices: PRICES,
    });
    assert.ok(rows[0]!.gaps.includes('acceptance_lower_bound'));
  });

  test('empresas sin destino se cuentan y se señalan', () => {
    const rows = buildProviderRunScorecard({
      batches: [
        apolloBatch('x4', 'Retail', {
          ledgerEntries: [['organizations_search', 'settled', 1]],
          raw: 10,
          unique: 10,
          accepted: 0,
          persisted: 1,
        }),
      ],
      usageLogs: apolloLogs('x4', [1]),
      outcomeCounts: outcomes('x4', 'apollo', 1, { other: 8 }),
      prices: PRICES,
    });
    assert.equal(rows[0]!.unaccountedCompanies, 1);
    assert.ok(rows[0]!.gaps.includes('unaccounted_companies'));
  });

  test('sin precio configurado no hay coste en dólares, y se dice', () => {
    const rows = buildProviderRunScorecard({ ...septemberTwentyFourth(), prices: [] });
    assert.ok(rows.every((r) => r.costUsd === null && r.gaps.includes('price_missing')));
  });

  test('🔴 los logs de Lusha que no son descubrimiento de empresas (Agente 2A) no entran', () => {
    const base = septemberTwentyFourth();
    const rows = buildProviderRunScorecard({
      ...base,
      usageLogs: [
        ...base.usageLogs,
        { ...lushaLog('contact-1', null, 5, {}), operationKey: 'person_enrich' },
      ],
    });
    assert.equal(rows.length, 6);
  });

  test('datos no finitos o negativos de la base no se convierten en cuentas', () => {
    const batch = lushaBatch('x5', 'Retail', { credits: 2, accepted: 0, persisted: 0 });
    (batch.metadata as Record<string, unknown>).billing = { credits_charged: 'dos' };
    const rows = buildProviderRunScorecard({
      batches: [batch],
      usageLogs: [],
      outcomeCounts: [],
      prices: PRICES,
    });
    assert.equal(rows[0]!.credits, null);
  });
});

// ── § 5 · precio alternativo ─────────────────────────────────────────────────

describe('§ 5 — el precio de Lusha todavía es ambiguo: se puede simular sin tocar la base', () => {
  test('el mismo conjunto con el precio mensual da el coste doce veces menor', () => {
    const base = septemberTwentyFourth();
    const alt = buildProviderRunScorecard({
      ...base,
      prices: [PRICES[0]!, { providerKey: 'lusha', unitCostUsd: 0.00735294, source: 'override' }],
    });
    const r = row(alt, 'batch:b02d3ac4:lusha');
    assert.equal(r.priceSource, 'override');
    assert.ok(Math.abs((r.costUsd ?? 0) - 0.01470588) < 1e-8);
  });
});

describe('§ 6 — el cuadre también detecta destinos de más', () => {
  test('más destinos que empresas distintas ⇒ diferencia negativa y hueco declarado', () => {
    const rows = buildProviderRunScorecard({
      batches: [
        apolloBatch('x6', 'Retail', {
          ledgerEntries: [['organizations_search', 'settled', 1]],
          raw: 10,
          unique: 10,
          accepted: 0,
          persisted: 1,
        }),
      ],
      usageLogs: apolloLogs('x6', [1]),
      outcomeCounts: outcomes('x6', 'apollo', 1, { other: 11 }),
      prices: PRICES,
    });
    assert.equal(rows[0]!.unaccountedCompanies, -2);
    assert.ok(rows[0]!.gaps.includes('destinations_exceed_unique'));
  });
});
