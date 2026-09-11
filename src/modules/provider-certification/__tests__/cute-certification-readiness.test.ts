/**
 * A1-CERTIFICATION-READINESS § CUT-E — la línea base deja de ser una promesa.
 *
 * ── Lo que esta suite afirma ─────────────────────────────────────────────────
 *
 *   A  E.1 · la aceptación REAL del writer llega a la línea base, y DICE de
 *      dónde vino. Sin reconstruirla desde contadores y sin inferirla de que
 *      una fila exista.
 *   B  E.3 · el coste de Apollo suma TODAS sus operaciones cobradas.
 *   C  E.4 · el adaptador de Lusha lee la forma REAL de Producción.
 *   D  E.2 · hay un consumidor operable, y no llama a ningún proveedor.
 *   E  equivalencia: la ruta por corrida y la ruta por fila no pueden divergir.
 *   F  la trampa del lote compartido: no declarar rota una correlación intacta.
 *   G  trinquetes de mutación y guardas estáticas.
 *
 * ── Las cifras son REALES ────────────────────────────────────────────────────
 *
 * Todos los fixtures son la corrida `294298cdd4fa9c37baf9a33543cb1355`
 * (lote `483f3584`, 08-09-2026), leída de Producción el 11-09-2026:
 * 2 filas de búsqueda (5 + 1 créditos) y 5 de enriquecimiento (1 cada una) para
 * Apollo, y 1 fila de `company_prospecting_v3` (2 créditos) para Lusha.
 *
 * 0 llamadas a proveedor · 0 escrituras · 0 migraciones · 0 créditos · 0 flags.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildCertificationBaselineRow,
  computeCertificationMetrics,
  CERTIFICATION_ACCEPTANCE_SOURCES,
  CERT_SEAM_ACCEPTED_NOT_CORRELATED,
  CERT_SEAM_BATCH_ACCEPTANCE_SHARED_BY_TWO_PROVIDERS,
  CERT_SEAM_CREDITS_NOT_BROKEN_DOWN_BY_OPERATION,
} from '../certification-baseline';
import {
  apolloUsageLogToCertificationBaseline,
  lushaUsageLogToCertificationBaseline,
  readLushaRowFacts,
  type ProviderUsageLogLike,
} from '../usage-log-adapters';
import {
  APOLLO_CHARGED_OPERATIONS,
  LUSHA_CHARGED_OPERATIONS,
  buildApolloRunCertificationBaseline,
  buildLushaRunCertificationBaseline,
  resolveBatchAcceptanceContrast,
  summarizeChargedCredits,
} from '../run-baseline';
import type { StoredCandidateRow } from '@/server/agents/prospecting-toolkit/apollo-accepted-for-target-replay';
import {
  ACCEPTED_FOR_TARGET_DECIDED_BY,
  CANDIDATE_ACCEPTED_FOR_TARGET_TRACE_KEY,
} from '@/server/agents/prospecting-toolkit/candidate-accepted-for-target-trace';

const RUN_ID = '294298cdd4fa9c37baf9a33543cb1355';
const BATCH_ID = '483f3584-7055-493b-acfd-d9038e858e45';
const FINGERPRINT = 'eb4959cd8ecde7cbeaed76164a356b1e';

function apolloSearchRow(o: {
  credits: number | null;
  results: number;
  duration: number | null;
  pages: number;
  paidRaw: number;
  unique: number;
  precisionRejected: number;
  duplicatesRemoved: number;
  createdAt: string;
}): ProviderUsageLogLike {
  return {
    provider_key: 'apollo',
    operation_key: 'organizations_search',
    credits_used: o.credits,
    results_returned: o.results,
    duration_ms: o.duration,
    wizard_run_id: RUN_ID,
    request_fingerprint: FINGERPRINT,
    batch_id: BATCH_ID,
    created_at: o.createdAt,
    metadata: {
      country: 'Colombia',
      countryCode: 'CO',
      industry: 'Gobierno',
      apollo_benchmark_funnel: {
        paid_raw: o.paidRaw,
        unique: o.unique,
        duplicate: 0,
        provider_seen_hit: o.paidRaw,
        historical_known: null,
        precision_rejected: o.precisionRejected,
        // 🔴 Producción lo trae `null` y este corte NO lo cambia: la aceptación
        // es de la corrida y esta fila es UNA consulta.
        accepted_for_target: null,
      },
      apollo_pagination: {
        pages_processed: o.pages,
        normalization: { duplicates_removed_count: o.duplicatesRemoved },
      },
    },
  };
}

function apolloEnrichmentRow(createdAt: string, credits: number | null = 1): ProviderUsageLogLike {
  return {
    provider_key: 'apollo',
    operation_key: 'organization_enrichment',
    credits_used: credits,
    results_returned: 1,
    // Producción no registra latencia en NINGUNA de sus 82 filas de enrichment.
    duration_ms: null,
    wizard_run_id: RUN_ID,
    request_fingerprint: FINGERPRINT,
    batch_id: BATCH_ID,
    created_at: createdAt,
    metadata: {},
  };
}

/** Las 7 filas de Apollo de la corrida real: 5 + 1 de búsqueda, 5 × 1 de enrichment. */
const APOLLO_RUN_ROWS: readonly ProviderUsageLogLike[] = [
  apolloSearchRow({
    credits: 5,
    results: 7,
    duration: 6388,
    pages: 5,
    paidRaw: 7,
    unique: 7,
    precisionRejected: 0,
    duplicatesRemoved: 10,
    createdAt: '2026-09-08T12:50:07.978Z',
  }),
  apolloSearchRow({
    credits: 1,
    results: 3,
    duration: 913,
    pages: 1,
    paidRaw: 3,
    unique: 3,
    precisionRejected: 0,
    duplicatesRemoved: 21,
    createdAt: '2026-09-08T12:50:12.206Z',
  }),
  apolloEnrichmentRow('2026-09-08T12:50:13.604Z'),
  apolloEnrichmentRow('2026-09-08T12:50:13.953Z'),
  apolloEnrichmentRow('2026-09-08T12:50:14.308Z'),
  apolloEnrichmentRow('2026-09-08T12:50:14.573Z'),
  apolloEnrichmentRow('2026-09-08T12:50:14.941Z'),
];

/** La fila REAL de Lusha, con las claves tal como la base las guarda. */
const LUSHA_RUN_ROW: ProviderUsageLogLike = {
  provider_key: 'lusha',
  operation_key: 'company_prospecting_v3',
  credits_used: 2,
  results_returned: 50,
  duration_ms: 24841,
  wizard_run_id: RUN_ID,
  request_fingerprint: 'fc05326387cd36ea2f167aa1392a4f45',
  batch_id: BATCH_ID,
  created_at: '2026-09-08T12:50:40.863Z',
  metadata: {
    lusha_run_observability: {
      country_code: 'CO',
      macro_industry_key: 'government',
      credits_settled: 2,
      credits_reserved: 2,
      precision_rejected: 0,
      exact_duplicates: 23,
      target_overflow_discarded: 3,
      reviewable_found_total: 8,
      accepted_for_target_total: 5,
      run: {
        raw_results_total: 50,
        provider_requests_used: 2,
        cross_branch_duplicates_removed: 2,
        accepted_for_target_total: 5,
      },
    },
  },
};

function candidate(id: string, accepted: boolean, reasons: string[] = []): StoredCandidateRow {
  return {
    id,
    source_trace: {
      [CANDIDATE_ACCEPTED_FOR_TARGET_TRACE_KEY]: {
        acceptedForTarget: accepted,
        decidedBy: ACCEPTED_FOR_TARGET_DECIDED_BY,
        blockingReasons: accepted ? [] : reasons,
      },
    },
  };
}

/** Una corrida NUEVA de Apollo (post-D.1): 3 aceptadas de 5 filas escritas. */
const APOLLO_NEW_RUN_CANDIDATES: readonly StoredCandidateRow[] = [
  candidate('c1', true),
  candidate('c2', false, ['icp_size']),
  candidate('c3', true),
  candidate('c4', false, ['sector']),
  candidate('c5', true),
];

function apolloRun(o: Partial<Parameters<typeof buildApolloRunCertificationBaseline>[0]> = {}) {
  return buildApolloRunCertificationBaseline({
    usageRows: APOLLO_RUN_ROWS,
    candidateRows: APOLLO_NEW_RUN_CANDIDATES,
    batchAcceptedPaidForTarget: 3,
    providerKeysInBatch: ['apollo'],
    ...o,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// A · E.1 — la aceptación real llega, y dice de dónde viene
// ─────────────────────────────────────────────────────────────────────────────

describe('CUT-E § A — aceptación de Apollo', () => {
  it('POSITIVO — la corrida publica las aceptadas del writer y su procedencia', () => {
    const { row } = apolloRun();
    assert.equal(row.values.companies_accepted, 3);
    assert.equal(row.values.companies_accepted_source, 'per_candidate_writer_trace');
    assert.equal(row.field_sources.companies_accepted, 'observed');
    assert.equal(row.missing_correlation_seams.companies_accepted, undefined);
  });

  it('POSITIVO — con la aceptación presente, las métricas ya se calculan', () => {
    const m = computeCertificationMetrics(apolloRun().row);
    assert.equal(m.useful_yield, 3 / 10, '3 aceptadas de 10 empresas vistas');
    assert.equal(m.precision, 3 / 3, '3 aceptadas, 0 rechazadas por precisión');
    assert.equal(m.cost_per_useful, 11 / 3, '11 créditos entre 3 aceptadas');
  });

  it('NEGATIVO — una corrida PRE-D.1 no tiene traza: null, y la costura se nombra', () => {
    const { row } = apolloRun({ candidateRows: [{ id: 'viejo', source_trace: null }] });
    assert.equal(row.values.companies_accepted, null);
    assert.equal(row.values.companies_accepted_source, null);
    assert.equal(
      row.missing_correlation_seams.companies_accepted,
      CERT_SEAM_ACCEPTED_NOT_CORRELATED,
    );
    assert.equal(computeCertificationMetrics(row).cost_per_useful, null);
  });

  it('NEGATIVO — una traza sin la marca del writer NO cuenta como veredicto', () => {
    const impostor: StoredCandidateRow = {
      id: 'x',
      source_trace: {
        [CANDIDATE_ACCEPTED_FOR_TARGET_TRACE_KEY]: {
          acceptedForTarget: true,
          decidedBy: 'otra_capa',
          blockingReasons: [],
        },
      },
    };
    assert.equal(apolloRun({ candidateRows: [impostor] }).row.values.companies_accepted, null);
  });

  it('🔴 NO se infiere de que la fila exista: 5 candidatos, 3 aceptadas', () => {
    const { row, replay } = apolloRun();
    assert.equal(replay.candidatesPersisted, 5);
    assert.notEqual(row.values.companies_accepted, 5);
    assert.equal(row.values.companies_accepted, 3);
  });

  it('🔴 NO se reconstruye desde el contador del lote: el contador sólo CONTRASTA', () => {
    // El lote dice 9 y los veredictos dicen 3. Gana el veredicto, y la
    // discrepancia se DECLARA en vez de promediarse.
    const { row, replay, diagnostics } = apolloRun({ batchAcceptedPaidForTarget: 9 });
    assert.equal(row.values.companies_accepted, 3);
    assert.equal(replay.correlationBroken, true);
    assert.ok(diagnostics.includes('apollo_acceptance_correlation_broken'));
  });

  it('la procedencia sólo puede ser una de las dos autoridades declaradas', () => {
    for (const row of [apolloRun().row, buildLushaRunCertificationBaseline({ usageRows: [LUSHA_RUN_ROW] }).row]) {
      assert.ok(
        (CERTIFICATION_ACCEPTANCE_SOURCES as readonly string[]).includes(
          row.values.companies_accepted_source as string,
        ),
      );
    }
  });

  it('Lusha declara SU autoridad, que es distinta — y la asimetría queda visible', () => {
    const lusha = buildLushaRunCertificationBaseline({ usageRows: [LUSHA_RUN_ROW] }).row;
    assert.equal(lusha.values.companies_accepted, 5);
    assert.equal(lusha.values.companies_accepted_source, 'provider_run_total');
    assert.notEqual(
      lusha.values.companies_accepted_source,
      apolloRun().row.values.companies_accepted_source,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B · E.3 — el coste completo
// ─────────────────────────────────────────────────────────────────────────────

describe('CUT-E § B — coste de Apollo', () => {
  it('POSITIVO — suma búsqueda Y enriquecimiento: 6 + 5 = 11', () => {
    const { row, credits } = apolloRun();
    assert.equal(row.values.credits, 11);
    assert.deepEqual(row.values.credits_by_operation, {
      organizations_search: 6,
      organization_enrichment: 5,
    });
    assert.equal(credits.chargedRows, 7);
  });

  it('🔴 NEGATIVO — 6 era la cifra del defecto: sumar sólo la búsqueda', () => {
    const { row } = apolloRun();
    assert.notEqual(row.values.credits, 6, 'sumar sólo organizations_search subestima un 45%');
  });

  it('NEGATIVO — el coste por útil cambia de verdad con el total completo', () => {
    const completo = computeCertificationMetrics(apolloRun().row).cost_per_useful;
    const soloBusqueda = 6 / 3;
    assert.equal(completo, 11 / 3);
    assert.notEqual(completo, soloBusqueda);
  });

  it('NEGATIVO — una fila cobrada sin créditos deja el TOTAL en null, no parcial', () => {
    const rows = [...APOLLO_RUN_ROWS.slice(0, 6), apolloEnrichmentRow('2026-09-08T12:50:14.941Z', null)];
    const { row, credits } = apolloRun({ usageRows: rows });
    assert.equal(row.values.credits, null, 'un total parcial presentado como total es el defecto');
    assert.equal(credits.rowsWithUnknownCredits, 1);
    assert.deepEqual(credits.byOperation, { organizations_search: 6, organization_enrichment: 4 });
  });

  it('sin ninguna fila cobrada, el desglose es null y la costura se nombra', () => {
    const summary = summarizeChargedCredits([], APOLLO_CHARGED_OPERATIONS);
    assert.equal(summary.total, null);
    assert.equal(summary.byOperation, null);
    const row = buildCertificationBaselineRow({
      provider: 'apollo',
      providerOrder: null,
      wizardRunId: null,
      batchId: null,
      certificationRunId: null,
      country: null,
      macroIndustry: null,
      requestFingerprint: null,
      pages: null,
      credits: null,
      creditsByOperation: null,
      latencyMs: null,
      companiesSeen: null,
      companiesAccepted: null,
      companiesAcceptedSource: null,
      companiesRejected: null,
      employeeCountKnown: null,
      identityResolved: null,
      dedupeRemoved: null,
      dispositions: null,
      startedAt: null,
      finishedAt: null,
    });
    assert.equal(
      row.missing_correlation_seams.credits_by_operation,
      CERT_SEAM_CREDITS_NOT_BROKEN_DOWN_BY_OPERATION,
    );
  });

  it('🔴 la latencia de la corrida es null: el enrichment no la registra', () => {
    assert.equal(apolloRun().row.values.latency_ms, null);
  });

  it('el embudo se SUMA entre las consultas, no se toma de la primera', () => {
    const { row } = apolloRun();
    assert.equal(row.values.pages, 6, '5 + 1 páginas');
    assert.equal(row.values.companies_seen, 10, '7 + 3 empresas pagadas');
    assert.equal(row.values.identity_resolved, 10);
    assert.equal(row.values.companies_rejected, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C · E.4 — el casing real de Lusha
// ─────────────────────────────────────────────────────────────────────────────

describe('CUT-E § C — casing de Lusha', () => {
  it('POSITIVO — sobre la fila REAL, los tres campos tienen valor', () => {
    const facts = readLushaRowFacts(LUSHA_RUN_ROW);
    assert.equal(facts.pages, 2);
    assert.equal(facts.companiesSeen, 50);
    assert.equal(facts.dedupeRemoved, 2);
  });

  it('POSITIVO — y llegan a la fila de línea base', () => {
    const row = lushaUsageLogToCertificationBaseline(LUSHA_RUN_ROW);
    assert.equal(row.values.pages, 2);
    assert.equal(row.values.dedupe_removed, 2);
    assert.ok(!row.fields_missing.includes('pages'));
    assert.ok(!row.fields_missing.includes('dedupe_removed'));
  });

  it('🔴 NEGATIVO — con camelCase (la forma que NUNCA existió) sale null', () => {
    const camel: ProviderUsageLogLike = {
      ...LUSHA_RUN_ROW,
      results_returned: null,
      metadata: {
        lusha_run_observability: {
          accepted_for_target_total: 5,
          run: {
            rawResultsTotal: 50,
            providerRequestsUsed: 2,
            crossBranchDuplicatesRemoved: 2,
          },
        },
      },
    };
    const facts = readLushaRowFacts(camel);
    assert.equal(facts.pages, null, 'leer camelCase volvería a esconder un valor real');
    assert.equal(facts.companiesSeen, null);
    assert.equal(facts.dedupeRemoved, null);
  });

  it('el embudo de rechazo suma las tres familias: 0 + 23 + 3', () => {
    assert.equal(readLushaRowFacts(LUSHA_RUN_ROW).companiesRejected, 26);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D · E.2 — el consumidor operable
// ─────────────────────────────────────────────────────────────────────────────

const SCRIPT = path.join(process.cwd(), 'scripts/agent1/certification-baseline-replay.ts');

describe('CUT-E § D — consumidor', () => {
  it('el script existe y está cableado a un npm script', () => {
    assert.ok(fs.existsSync(SCRIPT), 'falta el consumidor: la línea base seguiría sin ruta');
    const pkg = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };
    assert.ok(pkg.scripts['cert:baseline'], 'falta el npm script');
    assert.match(pkg.scripts['cert:baseline'], /certification-baseline-replay\.ts/);
  });

  it('🔴 REPLAY_NO_PROVIDER — el script no importa ningún cliente de proveedor', () => {
    const src = fs.readFileSync(SCRIPT, 'utf8');
    const imports = [...src.matchAll(/^\s*import[^;]*?from\s+'([^']+)';/gm)].map((m) => m[1]);
    for (const spec of imports) {
      assert.ok(
        !/integrations\/|apollo-client|lusha-client|tavily|web-search-providers|hubspot/.test(spec),
        `el consumidor importa un proveedor: ${spec}`,
      );
    }
  });

  it('🔴 PROD_WRITES = 0 — el script no contiene ni un verbo de escritura', () => {
    const src = fs.readFileSync(SCRIPT, 'utf8');
    for (const verb of ['.insert(', '.update(', '.upsert(', '.delete(', '.rpc(']) {
      assert.ok(!src.includes(verb), `el consumidor escribe: ${verb}`);
    }
  });

  it('el replay es puro: dos veces la misma entrada, el mismo resultado', () => {
    assert.deepEqual(apolloRun().row, apolloRun().row);
    assert.deepEqual(
      buildLushaRunCertificationBaseline({ usageRows: [LUSHA_RUN_ROW] }).row,
      buildLushaRunCertificationBaseline({ usageRows: [LUSHA_RUN_ROW] }).row,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// E · equivalencia entre la ruta por corrida y la ruta por fila
// ─────────────────────────────────────────────────────────────────────────────

describe('CUT-E § E — una sola autoridad de extracción', () => {
  it('con UNA fila, el embudo de las dos rutas coincide campo por campo', () => {
    const single = APOLLO_RUN_ROWS[1];
    const porFila = apolloUsageLogToCertificationBaseline(single);
    const porCorrida = buildApolloRunCertificationBaseline({
      usageRows: [single],
      candidateRows: [],
      batchAcceptedPaidForTarget: null,
      providerKeysInBatch: ['apollo'],
    }).row;
    for (const field of [
      'country',
      'macro_industry',
      'request_fingerprint',
      'pages',
      'companies_seen',
      'companies_rejected',
      'identity_resolved',
      'dedupe_removed',
      'provider',
      'wizard_run_id',
      'batch_id',
      'started_at',
    ] as const) {
      assert.deepEqual(
        porCorrida.values[field],
        porFila.values[field],
        `${field} divergió entre la ruta por corrida y la ruta por fila`,
      );
    }
  });

  it('lo mismo para Lusha', () => {
    const porFila = lushaUsageLogToCertificationBaseline(LUSHA_RUN_ROW);
    const porCorrida = buildLushaRunCertificationBaseline({ usageRows: [LUSHA_RUN_ROW] }).row;
    for (const field of [
      'country',
      'macro_industry',
      'pages',
      'companies_seen',
      'companies_accepted',
      'companies_rejected',
      'dedupe_removed',
      'credits',
    ] as const) {
      assert.deepEqual(porCorrida.values[field], porFila.values[field], `${field} divergió`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F · la trampa del lote compartido
// ─────────────────────────────────────────────────────────────────────────────

describe('CUT-E § F — el lote NO es el proveedor', () => {
  it('🔴 con dos proveedores en el lote, el contraste NO se hace', () => {
    // El caso real: lote 483f3584, `accepted_paid_for_target: 5`, y esas 5 son
    // de Lusha. Apollo escribió 0. Contrastar 0 contra 5 declararía rota una
    // correlación intacta.
    const { replay, diagnostics, row } = apolloRun({
      candidateRows: [],
      batchAcceptedPaidForTarget: 5,
      providerKeysInBatch: ['apollo', 'lusha'],
    });
    assert.equal(replay.correlationBroken, false, 'no medir no es discrepar');
    assert.equal(row.values.companies_accepted, null);
    assert.ok(diagnostics.includes(CERT_SEAM_BATCH_ACCEPTANCE_SHARED_BY_TWO_PROVIDERS));
  });

  it('con un solo proveedor, el contraste SÍ se hace', () => {
    const contrast = resolveBatchAcceptanceContrast({
      batchAcceptedPaidForTarget: 3,
      providerKeysInBatch: ['apollo'],
    });
    assert.equal(contrast.count, 3);
    assert.equal(contrast.notComparableReason, null);
  });

  it('un lote sin filas de gasto no inventa contraste', () => {
    const contrast = resolveBatchAcceptanceContrast({
      batchAcceptedPaidForTarget: null,
      providerKeysInBatch: [],
    });
    assert.equal(contrast.count, null);
    assert.equal(contrast.notComparableReason, null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// G · trinquetes y guardas estáticas
// ─────────────────────────────────────────────────────────────────────────────

const REPO = process.cwd();

describe('CUT-E § G — trinquetes', () => {
  it('🔴 APOLLO_REGRESSION — el provider SIGUE publicando `acceptedForTarget: null`', () => {
    // El fix de E.1 va del lado LECTOR. Si alguien "arregla" el escritor, la
    // cifra se duplicaría entre las 2 filas de búsqueda de cada corrida.
    const src = fs.readFileSync(
      path.join(
        REPO,
        'src/server/agents/prospecting-toolkit/web-search-providers/apollo-organizations-search-provider.ts',
      ),
      'utf8',
    );
    const occurrences = src.split('acceptedForTarget: null').length - 1;
    assert.equal(occurrences, 2, 'las DOS construcciones del embudo deben seguir publicando null');
  });

  it('🔴 COUPLING — las operaciones cobradas de Apollo salen de la unión existente', () => {
    const src = fs.readFileSync(
      path.join(REPO, 'src/server/agents/prospecting-toolkit/apollo-usage-operation-context.ts'),
      'utf8',
    );
    const match = src.match(/export type ApolloUsageOperationKey\s*=\s*([^;]+);/);
    assert.ok(match, 'no se pudo leer la unión de operaciones de Apollo');
    const declared = [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
    assert.deepEqual(
      [...APOLLO_CHARGED_OPERATIONS].sort(),
      declared,
      'la lista de operaciones cobradas se separó de la unión que las declara',
    );
  });

  it('🔴 COUPLING — la operación de Lusha coincide con la constante del servidor', () => {
    const src = fs.readFileSync(
      path.join(REPO, 'src/server/prospect-batches/lusha-provider-usage-observability.ts'),
      'utf8',
    );
    const match = src.match(
      /export const LUSHA_COMPANY_DISCOVERY_OPERATION_KEY\s*=\s*'([^']+)'/,
    );
    assert.ok(match, 'no se pudo leer la constante de operación de Lusha');
    assert.deepEqual([...LUSHA_CHARGED_OPERATIONS], [match[1]]);
  });

  it('🔴 GUARDA ESTÁTICA — el adaptador no vuelve a leer `run` en camelCase', () => {
    const src = fs.readFileSync(path.join(REPO, 'src/modules/provider-certification/usage-log-adapters.ts'), 'utf8');
    for (const wrong of [
      'run.providerRequestsUsed',
      'run.rawResultsTotal',
      'run.crossBranchDuplicatesRemoved',
      'run.pagesAttempted',
    ]) {
      assert.ok(!src.includes(wrong), `volvió el casing equivocado: ${wrong}`);
    }
  });

  it('MUTACIÓN — `fields_missing` y `field_sources` siguen sin poder discrepar', () => {
    for (const row of [
      apolloRun().row,
      apolloRun({ candidateRows: [] }).row,
      buildLushaRunCertificationBaseline({ usageRows: [LUSHA_RUN_ROW] }).row,
      buildLushaRunCertificationBaseline({ usageRows: [] }).row,
    ]) {
      const missingBySource = Object.entries(row.field_sources)
        .filter(([, source]) => source === 'missing')
        .map(([field]) => field);
      assert.deepEqual([...row.fields_missing].sort(), missingBySource.sort());
    }
  });

  it('MUTACIÓN — una aceptación sin procedencia, o al revés, es inadmisible', () => {
    for (const row of [
      apolloRun().row,
      apolloRun({ candidateRows: [] }).row,
      buildLushaRunCertificationBaseline({ usageRows: [LUSHA_RUN_ROW] }).row,
      buildLushaRunCertificationBaseline({ usageRows: [] }).row,
    ]) {
      assert.equal(
        row.values.companies_accepted === null,
        row.values.companies_accepted_source === null,
        'un número sin dueño, o un dueño sin número',
      );
    }
  });

  it('MUTACIÓN — el total de créditos nunca es la suma de una sola operación', () => {
    const { credits } = apolloRun();
    const byOp = credits.byOperation as Record<string, number>;
    const soloUna = Math.max(...Object.values(byOp));
    assert.notEqual(credits.total, soloUna);
    assert.equal(
      credits.total,
      Object.values(byOp).reduce((a, b) => a + b, 0),
    );
  });

  it('GUARDA ESTÁTICA — el módulo entero sigue siendo una proyección pura', () => {
    const dir = path.join(REPO, 'src/modules/provider-certification');
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
      const src = fs.readFileSync(path.join(dir, file), 'utf8');
      for (const forbidden of ['createClient', 'fetch(', 'insert(', 'upsert(', 'apiKey']) {
        assert.ok(!src.includes(forbidden), `${file} contiene \`${forbidden}\``);
      }
    }
  });
});
