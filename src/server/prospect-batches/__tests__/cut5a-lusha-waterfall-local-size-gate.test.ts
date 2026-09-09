/**
 * A1-LUSHA-WATERFALL-SIZE-GATE § CUT-5A — la pierna Lusha del waterfall respeta
 * el suelo de tamaño LOCAL (>= 200 empleados).
 *
 * ── El defecto que esta suite fija ───────────────────────────────────────────
 *
 * `runLushaWaterfallLeg` NO manda `sizeBandKey`. Sin banda,
 * `requestSummary.sizeBand` viaja `null`, `buildLushaProspectSearchCriteria`
 * devolvía `minEmployees: null` y el gate compartido de intake SALTA su
 * comprobación de tamaño (exige `minEmployees !== null`). En el waterfall, Lusha
 * corría SIN restricción de tamaño alguna: ni de proveedor ni local.
 *
 * Todas las suites de Lusha que ya existían montan `sizeBand: {min: 201}` en el
 * `requestSummary` de su doble, así que ninguna podía ver el defecto. Esta lo
 * reproduce con la forma EXACTA del waterfall: `sizeBandKey` ausente y
 * `requestSummary.sizeBand: null`.
 *
 * ── Lo que NO se afirma ──────────────────────────────────────────────────────
 *
 * · Nada sobre paridad con Apollo: `LUSHA_SIZE_PARITY = UNSUPPORTED_BY_PROVIDER_CONTRACT`.
 * · Nada sobre ahorro de créditos: el filtro es POSTERIOR a la respuesta y la
 *   página ya está pagada cuando se aplica.
 * · Nada sobre `filters.companies.include.sizes`: el suelo es local y una prueba
 *   estática vigila que no se convierta en filtro de proveedor.
 *
 * 0 llamadas a proveedor (cada dependencia es un doble), 0 escrituras, 0
 * migraciones, 0 créditos, 0 flags.
 */

import { describe, it, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  persistLushaPendingReviewBatch,
  buildLushaProspectSearchCriteria,
  buildLushaIcpSizeGate,
  resolveLushaLocalMinEmployees,
  type PersistLushaPendingReviewDeps,
  type PersistLushaPendingReviewResult,
  type LushaPendingReviewBatchRow,
  type LushaPendingReviewCandidateRow,
} from '@/server/prospect-batches/lusha-pending-review';
import type {
  LushaPreviewCompany,
  LushaPreviewInput,
  LushaPreviewResult,
} from '@/server/prospect-batches/lusha-preview';
import { ICP_SIZE_GATE_DEFAULT_THRESHOLD } from '@/server/agents/prospecting-toolkit/icp-size-gate';
import type {
  DuplicateCheckInput,
  DuplicateCheckResult,
} from '@/server/agents/prospecting-toolkit/types';
import { preM126FencedInsert } from '@/server/prospect-batches/__tests__/support/lusha-pre-m126-fenced-insert';
import { preM126BatchEpochSnapshot } from '@/server/prospect-batches/__tests__/support/lusha-batch-epoch-snapshot';
import { runLushaWaterfallLeg } from '@/modules/prospect-batches/chat-wizard-execution/wizard-lusha-waterfall.server';

// ── Fixtures: la forma del WATERFALL, sin banda de tamaño ─────────────────────

/** La entrada tal como la construye la pierna: sin `sizeBandKey`. */
const WATERFALL_INPUT: LushaPreviewInput = {
  countryCode: 'CO',
  macroIndustryKey: 'health_pharma',
  subIndustryId: null,
  searchText: null,
};

const ACTOR = {
  internalUserId: 'user-1',
  clientRequestId: '11111111-1111-4111-8111-111111111111',
  requestedTarget: 5,
};

function identitySlug(domain: string | null, name: string | null): string {
  const base = domain ?? name ?? 'sin-identidad';
  return base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'sin-identidad';
}

function company(overrides: Partial<LushaPreviewCompany> = {}): LushaPreviewCompany {
  const merged = {
    name: 'Clínica Andes',
    domain: 'clinicaandes.com',
    country: 'Colombia',
    countryIso2: 'CO',
    industry: 'Hospitals & Clinics',
    employeesExact: 300,
    employeesMin: null,
    employeesMax: null,
    score: 92,
    passesGate: true,
    issues: [],
    ...overrides,
  };
  const slug = identitySlug(merged.domain ?? null, merged.name ?? null);
  return {
    ...merged,
    providerCompanyId: overrides.providerCompanyId ?? `pc-${slug}`,
    linkedinUrl:
      overrides.linkedinUrl !== undefined
        ? overrides.linkedinUrl
        : `https://linkedin.com/company/${slug}`,
  };
}

/**
 * 🔴 `sizeBand: null` es el corazón de esta suite: es lo que produce una corrida
 * sin `sizeBandKey`, es decir la del waterfall.
 */
function waterfallSearchResult(
  results: LushaPreviewCompany[],
  sizeBand: { min?: number; max?: number } | null = null,
): LushaPreviewResult {
  return {
    ok: true,
    status: results.length === 0 ? 'empty' : 'success',
    results,
    billing: { creditsCharged: 1, resultsReturned: results.length, expectedMaxCredits: 1 },
    warnings: [],
    requestSummary: {
      country: 'Colombia',
      countryCode: 'CO',
      sector: 'Salud',
      industryKey: 'health_pharma',
      macroIndustryKey: 'health_pharma',
      mainIndustriesIds: [11],
      subIndustryId: null,
      sizeBand,
      hasSearchText: false,
    },
  };
}

function noDup(input: DuplicateCheckInput): DuplicateCheckResult {
  return {
    status: 'new_candidate',
    confidence: 85,
    input,
    matches: [],
    summary: 'nuevo',
    checkedSources: ['sellup', 'hubspot'],
  };
}

function makeDeps(results: LushaPreviewCompany[]) {
  const calls = {
    batches: [] as LushaPendingReviewBatchRow[],
    candidateRows: [] as LushaPendingReviewCandidateRow[],
    duplicateInputs: [] as DuplicateCheckInput[],
    searches: 0,
  };
  const deps: PersistLushaPendingReviewDeps = {
    runSearch: async (input) => {
      calls.searches++;
      return (input.page ?? 0) > 0
        ? { ...waterfallSearchResult([]), status: 'empty' as const }
        : waterfallSearchResult(results);
    },
    reserveBatch: async (row: LushaPendingReviewBatchRow) => {
      calls.batches.push(row);
      return { id: 'batch-1', adopted: false, identityEpoch: 0 };
    },
    insertCandidatesFenced: preM126FencedInsert,
    readBatchIdentityEpoch: preM126BatchEpochSnapshot,
    insertCandidates: async (rows) => {
      calls.candidateRows.push(...rows);
      return { insertedCount: rows.length };
    },
    checkCompanyDuplicate: async (input) => {
      calls.duplicateInputs.push(input);
      return noDup(input);
    },
    fetchActiveCandidates: async () => [],
    officialSourceResolvers: [],
  };
  return { deps, calls };
}

async function runWaterfallShapedBatch(results: LushaPreviewCompany[]) {
  const { deps, calls } = makeDeps(results);
  const res = await persistLushaPendingReviewBatch(deps, WATERFALL_INPUT, ACTOR);
  return { res, calls };
}

const insertedNames = (calls: { candidateRows: LushaPendingReviewCandidateRow[] }) =>
  calls.candidateRows.map((r) => r.name);

// ─────────────────────────────────────────────────────────────────────────────
// A · el suelo local: la definición de negocio, no la banda pedida
// ─────────────────────────────────────────────────────────────────────────────

describe('CUT-5A § A — resolveLushaLocalMinEmployees', () => {
  it('el umbral es el del gate ICP compartido, no un literal propio', () => {
    assert.equal(ICP_SIZE_GATE_DEFAULT_THRESHOLD, 200);
    assert.equal(resolveLushaLocalMinEmployees(null), ICP_SIZE_GATE_DEFAULT_THRESHOLD);
  });

  it('sin banda (waterfall) ⇒ 200, JAMÁS null', () => {
    assert.equal(resolveLushaLocalMinEmployees(null), 200);
    assert.equal(resolveLushaLocalMinEmployees(undefined), 200);
  });

  it('una banda MÁS LAXA que el suelo no puede bajarlo', () => {
    assert.equal(resolveLushaLocalMinEmployees(51), 200);
    assert.equal(resolveLushaLocalMinEmployees(1), 200);
    assert.equal(resolveLushaLocalMinEmployees(0), 200);
  });

  it('una banda MÁS ESTRICTA se respeta tal cual', () => {
    assert.equal(resolveLushaLocalMinEmployees(201), 201);
    assert.equal(resolveLushaLocalMinEmployees(1001), 1001);
    assert.equal(resolveLushaLocalMinEmployees(5001), 5001);
  });

  it('un valor no finito cae al suelo (fail-closed, no NaN de vuelta)', () => {
    assert.equal(resolveLushaLocalMinEmployees(Number.NaN), 200);
    assert.equal(resolveLushaLocalMinEmployees(Number.POSITIVE_INFINITY), 200);
  });
});

describe('CUT-5A § B — buildLushaProspectSearchCriteria', () => {
  it('sin banda (la corrida del waterfall) el criterio lleva el suelo 200', () => {
    const criteria = buildLushaProspectSearchCriteria(
      WATERFALL_INPUT,
      waterfallSearchResult([company()], null),
    );
    assert.equal(criteria.minEmployees, 200);
  });

  it('el suelo NO inventa techo: `maxEmployees` sigue siendo sólo la banda', () => {
    const criteria = buildLushaProspectSearchCriteria(
      WATERFALL_INPUT,
      waterfallSearchResult([company()], null),
    );
    assert.equal(criteria.maxEmployees, null);
  });

  it('la banda estándar del flujo standalone (201-5000) no se toca', () => {
    const criteria = buildLushaProspectSearchCriteria(
      { ...WATERFALL_INPUT, sizeBandKey: '201-5000' },
      waterfallSearchResult([company()], { min: 201, max: 5000 }),
    );
    assert.equal(criteria.minEmployees, 201);
    assert.equal(criteria.maxEmployees, 5000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C · la admisión real, con la forma del waterfall (sin banda)
// ─────────────────────────────────────────────────────────────────────────────

describe('CUT-5A § C — admisión por tamaño en una corrida sin banda', () => {
  it('199 empleados ⇒ rechazo definitivo', async () => {
    const { res, calls } = await runWaterfallShapedBatch([
      company({ name: 'Casi', domain: 'casi.com', employeesExact: 199 }),
    ]);

    assert.equal(res.hardExcludedByGateCount, 1);
    assert.equal(calls.candidateRows.length, 0, '199 no puede llegar a candidato');
    // Nada excluido ⇒ nada persistido ⇒ ni lote: la corrida sale vacía.
    assert.equal(res.status, 'empty');
    assert.equal(calls.batches.length, 0);
  });

  it('el rechazo por tamaño usa el motivo DURO que YA existe en la taxonomía', async () => {
    // Con una empresa admisible en la misma página sí hay lote, y con él la
    // auditoría del gate. El motivo NO es nuevo: `known_employee_count_below_min`
    // es exactamente `LUSHA_DISCARD_REASON_CODE.icpSizeBelowMin`.
    const { calls } = await runWaterfallShapedBatch([
      company({ name: 'Casi', domain: 'casi.com', employeesExact: 199 }),
      company({ name: 'Grande', domain: 'grande.com', employeesExact: 900 }),
    ]);

    const meta = calls.batches[0].metadata as Record<string, unknown>;
    const excluded = meta.excludedByMandatoryGate as Array<Record<string, unknown>>;
    assert.equal(excluded.length, 1);
    assert.equal(excluded[0].name, 'Casi');
    assert.equal(excluded[0].decision, 'hard_excluded');
    assert.equal(excluded[0].reason, 'known_employee_count_below_min');
    const gateSummary = meta.gate_summary as Record<string, unknown>;
    assert.equal(gateSummary.hard_excluded_count, 1);
    assert.ok(
      (gateSummary.reason_counts as Record<string, number>).known_employee_count_below_min >= 1,
    );
  });

  it('199 no llega ni al comprobador de duplicados', async () => {
    const { calls } = await runWaterfallShapedBatch([
      company({ name: 'Casi', domain: 'casi.com', employeesExact: 199 }),
    ]);
    assert.equal(calls.duplicateInputs.length, 0);
  });

  it('200 exactos ⇒ elegible (el umbral es INCLUSIVO)', async () => {
    const { calls } = await runWaterfallShapedBatch([
      company({ name: 'Justa', domain: 'justa.com', employeesExact: 200 }),
    ]);
    assert.deepEqual(insertedNames(calls), ['Justa']);
  });

  it('201 ⇒ elegible', async () => {
    const { calls } = await runWaterfallShapedBatch([
      company({ name: 'Una Más', domain: 'unamas.com', employeesExact: 201 }),
    ]);
    assert.deepEqual(insertedNames(calls), ['Una Más']);
  });

  it('5000 ⇒ elegible', async () => {
    const { calls } = await runWaterfallShapedBatch([
      company({ name: 'Grande', domain: 'grande.com', employeesExact: 5000 }),
    ]);
    assert.deepEqual(insertedNames(calls), ['Grande']);
  });

  it('> 5000 ⇒ elegible: NO hay techo artificial', async () => {
    const { res, calls } = await runWaterfallShapedBatch([
      company({ name: 'Enorme', domain: 'enorme.com', employeesExact: 5001 }),
      company({ name: 'Colosal', domain: 'colosal.com', employeesExact: 1_000_001 }),
    ]);
    assert.equal(res.hardExcludedByGateCount, 0);
    assert.deepEqual(insertedNames(calls).sort(), ['Colosal', 'Enorme']);
  });

  it('tamaño desconocido ⇒ la semántica EXPLÍCITA del gate: nunca bloqueo, siempre marca', async () => {
    const { res, calls } = await runWaterfallShapedBatch([
      company({ name: 'Sin Dato', domain: 'sindato.com', employeesExact: null, employeesMin: null, employeesMax: null }),
    ]);

    // «UNKNOWN !== menor que el umbral»: el gate compartido lo dice y esta suite
    // no lo reinterpreta. No es un bloqueo…
    assert.equal(res.hardExcludedByGateCount, 0);
    // …y tampoco es un pase limpio: viaja marcado para revisión humana.
    const warnings = (calls.candidateRows[0].metadata as Record<string, unknown>)
      .gate_warnings as string[];
    assert.ok(warnings.includes('employee_count_unknown'));
  });

  it('el veredicto de la FICHA y el de la ADMISIÓN no discrepan', async () => {
    const small = company({ name: 'Casi', domain: 'casi.com', employeesExact: 199 });
    // La ficha ya bloqueaba con el mismo umbral; lo que faltaba era que la
    // admisión hiciera la misma pregunta.
    assert.equal(buildLushaIcpSizeGate(small).decision, 'block');
    const { res } = await runWaterfallShapedBatch([small]);
    assert.equal(res.hardExcludedByGateCount, 1);
  });

  it('grande y pequeña en la misma página: sólo la pequeña cae', async () => {
    const { res, calls } = await runWaterfallShapedBatch([
      company({ name: 'Tiny', domain: 'tiny.com', employeesExact: 10 }),
      company({ name: 'Big', domain: 'big.com', employeesExact: 500 }),
    ]);
    assert.equal(res.hardExcludedByGateCount, 1);
    assert.deepEqual(insertedNames(calls), ['Big']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D · la PIERNA del waterfall ejecuta de verdad el gate
// ─────────────────────────────────────────────────────────────────────────────

describe('CUT-5A § D — la pierna del waterfall ejecuta el gate', () => {
  const CANONICAL_BATCH_ID = 'b7f1c3d2-0a44-4f9e-9c31-8d6e5a2b1c07';
  const WIZARD_CLIENT_REQUEST_ID = '22222222-2222-4222-8222-222222222222';

  /**
   * La pierna corre de punta a punta contra el NÚCLEO REAL de persistencia. El
   * único doble es la acción de servidor (auth + presupuesto + liquidación), que
   * aquí se sustituye por la traducción que ella hace: recibe la entrada de la
   * pierna —SIN `sizeBandKey`, porque la pierna no lo manda— y llama al núcleo.
   */
  async function runLegAgainstRealCore(results: LushaPreviewCompany[]) {
    const { deps, calls } = makeDeps(results);
    const outcome = await runLushaWaterfallLeg(
      {
        wizardClientRequestId: WIZARD_CLIENT_REQUEST_ID,
        canonicalBatchId: CANONICAL_BATCH_ID,
        countryCode: 'CO',
        macroIndustryKey: 'health_pharma',
        subIndustryId: null,
        target: 5,
        usefulAccumulated: 0,
        apolloTerminal: true,
      },
      {
        waterfallEnabled: () => true,
        lushaAvailable: () => true,
        runLushaBatch: async (actionInput) =>
          (await persistLushaPendingReviewBatch(
            deps,
            {
              countryCode: actionInput.countryCode,
              macroIndustryKey: actionInput.macroIndustryKey,
              subIndustryId: actionInput.subIndustryId ?? null,
              // 🔴 La acción sólo puede pasar lo que la pierna le dio, y la
              // pierna no da banda de tamaño. Ponerla aquí falsearía el arnés.
              sizeBandKey: (actionInput as { sizeBandKey?: string | null }).sizeBandKey ?? null,
              searchText: null,
            },
            ACTOR,
          )) as PersistLushaPendingReviewResult,
      },
    );
    return { outcome, calls };
  }

  test('la entrada de la pierna NO tiene por dónde pedir un tamaño', async () => {
    const { outcome } = await runLegAgainstRealCore([company()]);
    assert.equal(outcome.executed, true);
    // Si algún día la pierna aprende a mandar banda, este arnés deja de ser fiel
    // y hay que rehacerlo a conciencia: por eso se afirma la ausencia.
    const legSource = readSource(
      'src/modules/prospect-batches/chat-wizard-execution/wizard-lusha-waterfall.server.ts',
    );
    assert.equal(
      /sizeBandKey/.test(legSource),
      false,
      'la pierna no manda banda: el suelo TIENE que ser local',
    );
  });

  test('una empresa de 199 empleados NO sobrevive a la pierna del waterfall', async () => {
    const { outcome, calls } = await runLegAgainstRealCore([
      company({ name: 'Casi', domain: 'casi.com', employeesExact: 199 }),
    ]);
    assert.equal(outcome.executed, true);
    assert.equal(calls.candidateRows.length, 0);
    assert.equal(
      outcome.executed === true && outcome.result.hardExcludedByGateCount,
      1,
      'el gate corrió DENTRO de la pierna, no en una prueba aparte',
    );
  });

  test('una empresa de 200 empleados sí sobrevive a la pierna del waterfall', async () => {
    const { outcome, calls } = await runLegAgainstRealCore([
      company({ name: 'Justa', domain: 'justa.com', employeesExact: 200 }),
    ]);
    assert.equal(outcome.executed, true);
    assert.deepEqual(insertedNames(calls), ['Justa']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// E · trinquetes: la mutación que desactiva el suelo tiene que caer
// ─────────────────────────────────────────────────────────────────────────────

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

function readSource(relativePath: string): string {
  return stripComments(fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8'));
}

describe('CUT-5A § E — trinquetes', () => {
  const CORE = 'src/server/prospect-batches/lusha-pending-review.ts';

  test('MUTACIÓN — el criterio no puede volver a derivar `minEmployees` de la banda a secas', () => {
    const source = readSource(CORE);
    // Ésta es LA línea del defecto. Restaurarla desactiva el suelo del waterfall
    // sin romper ninguna otra suite, así que el trinquete tiene que ser estático.
    assert.equal(
      /minEmployees:\s*rs\.sizeBand\?\.min\s*\?\?\s*null/.test(source),
      false,
      'volver a `rs.sizeBand?.min ?? null` deja el waterfall sin restricción de tamaño',
    );
    assert.ok(
      /minEmployees:\s*resolveLushaLocalMinEmployees\(/.test(source),
      'el criterio debe pasar por el suelo local',
    );
  });

  test('MUTACIÓN — el suelo no puede declarar su propio 200', () => {
    const source = readSource(CORE);
    assert.ok(
      /ICP_SIZE_GATE_DEFAULT_THRESHOLD/.test(source),
      'el umbral se importa del gate ICP: dos literales `200` pueden divergir',
    );
  });

  test('el suelo LOCAL no se ha convertido en filtro de proveedor', () => {
    const previewSource = readSource('src/server/prospect-batches/lusha-preview.ts');
    // El cuerpo de la petición sigue derivando `sizes` SÓLO de la banda pedida.
    assert.equal(
      /resolveLushaLocalMinEmployees/.test(previewSource),
      false,
      'el suelo local no puede entrar en el cuerpo de la petición a Lusha',
    );
    assert.equal(
      /\{\s*min:\s*200\s*\}/.test(previewSource),
      false,
      'CUT-5 original cerró como UNSUPPORTED_BY_PROVIDER_CONTRACT: no hay `{min:200}` server-side',
    );
  });
});
