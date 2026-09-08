/**
 * A1-LUSHA-WATERFALL-SIZE-GATE § CUT-5B — UNA sola autoridad decide el tamaño, y
 * la ficha no puede contradecirla.
 *
 * ── Lo que esta suite fija, y lo que NO ─────────────────────────────────────
 *
 * CUT-5A ya puso el suelo de 200 en la admisión del waterfall, así que 199 y 50
 * YA eran rechazo duro antes de este corte. Lo que quedaba roto era la frontera
 * entre «el proveedor dio una cifra» y «el proveedor no dio nada», y estaba
 * partida en dos módulos que la leían distinto:
 *
 *   · `normalizeEmployeeCount` colapsaba `0` a `null` ⇒ la ADMISIÓN lo trataba
 *     como tamaño DESCONOCIDO y mandaba a revisión humana una empresa que el
 *     proveedor había declarado de cero empleados.
 *   · `buildLushaIcpSizeGate` leía `employeesExact` en crudo ⇒ la FICHA decía
 *     `block` para ese mismo `0`, y también para `NaN` y para los negativos,
 *     inventando un veredicto de tamaño a partir de valores que no son tamaños.
 *
 * Dos lecturas de la misma pregunta sobre la misma empresa. Esta suite fija que
 * hay una sola: `classifyKnownEmployeeCount`, en el módulo del umbral de CUT-5A.
 *
 * 🔴 Lo que NO se afirma: nada sobre Apollo cambia. El normalizador compartido
 * sigue leyendo `0` como ausencia de dato por DEFECTO, y sólo la pierna Lusha
 * pide la lectura canónica. Hay pruebas explícitas de esa no-regresión (§ F).
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
  buildLushaIcpSizeGate,
  type PersistLushaPendingReviewDeps,
  type PersistLushaPendingReviewResult,
  type LushaPendingReviewBatchRow,
  type LushaPendingReviewCandidateRow,
} from '@/server/prospect-batches/lusha-pending-review';
import {
  normalizeLushaPreviewCompany,
  type LushaPreviewCompany,
  type LushaPreviewInput,
  type LushaPreviewResult,
} from '@/server/prospect-batches/lusha-preview';
import {
  ICP_SIZE_GATE_DEFAULT_THRESHOLD,
  classifyKnownEmployeeCount,
} from '@/server/agents/prospecting-toolkit/icp-size-gate';
import {
  normalizeProviderDiscoveredCompany,
  evaluateProspectIntakeGate,
} from '@/server/agents/prospect-intake';
import type {
  DuplicateCheckInput,
  DuplicateCheckResult,
} from '@/server/agents/prospecting-toolkit/types';
import { preM126FencedInsert } from '@/server/prospect-batches/__tests__/support/lusha-pre-m126-fenced-insert';
import { preM126BatchEpochSnapshot } from '@/server/prospect-batches/__tests__/support/lusha-batch-epoch-snapshot';
import { runLushaWaterfallLeg } from '@/modules/prospect-batches/chat-wizard-execution/wizard-lusha-waterfall.server';

// ── Fixtures: la forma del WATERFALL, sin banda de tamaño ─────────────────────

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
  };
  const deps: PersistLushaPendingReviewDeps = {
    runSearch: async (input) =>
      (input.page ?? 0) > 0
        ? { ...waterfallSearchResult([]), status: 'empty' as const }
        : waterfallSearchResult(results),
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

/**
 * El desenlace de admisión de UNA empresa por la ruta real: adaptador Lusha →
 * normalizador compartido → gate obligatorio. Es el mismo encadenamiento que
 * corre `resolveLushaCandidatesDuplicateState`, con las mismas opciones.
 */
function admissionFor(employeesExact: unknown) {
  const c = company({ employeesExact: employeesExact as number | null });
  const criteria = { countryCode: 'CO', minEmployees: ICP_SIZE_GATE_DEFAULT_THRESHOLD } as never;
  const discovered = {
    provider: 'lusha' as const,
    providerRecordId: c.providerCompanyId,
    providerRequestId: null,
    companyName: c.name,
    commercialName: null,
    legalName: null,
    websiteUrl: c.domain ? `https://${c.domain}` : null,
    domain: c.domain,
    linkedinUrl: c.linkedinUrl,
    country: c.country,
    countryCode: c.countryIso2,
    region: null,
    city: null,
    industry: c.industry,
    subindustry: null,
    industryCodes: {},
    employeeCount: c.employeesExact,
    employeeRange: null,
    sourceUrl: null,
    sourceConfidence: null,
    providerMetadataSafe: {},
  } as never;
  const normalized = normalizeProviderDiscoveredCompany(discovered, criteria, {
    treatZeroEmployeeCountAsKnown: true,
  });
  return evaluateProspectIntakeGate(normalized, criteria);
}

// ─────────────────────────────────────────────────────────────────────────────
// A · la clasificación conocido/desconocido: UNA función, tres familias
// ─────────────────────────────────────────────────────────────────────────────

describe('CUT-5B § A — classifyKnownEmployeeCount', () => {
  it('un entero positivo es un CONTEO CONOCIDO', () => {
    assert.equal(classifyKnownEmployeeCount(199), 199);
    assert.equal(classifyKnownEmployeeCount(200), 200);
    assert.equal(classifyKnownEmployeeCount(201), 201);
    assert.equal(classifyKnownEmployeeCount(1), 1);
  });

  it('CERO es un conteo CONOCIDO, no una ausencia de dato', () => {
    // 🔴 Ésta es la línea del corte. Si `0` vuelve a leerse como desconocido,
    // una empresa declarada de cero empleados deja de caer por el suelo ICP y
    // sale a revisión humana. La mutación se comprueba en § E.
    assert.equal(classifyKnownEmployeeCount(0), 0);
    assert.notEqual(classifyKnownEmployeeCount(0), null);
  });

  it('null y undefined son DESCONOCIDOS', () => {
    assert.equal(classifyKnownEmployeeCount(null), null);
    assert.equal(classifyKnownEmployeeCount(undefined), null);
  });

  it('NaN e ±Infinity son DESCONOCIDOS: no se inventa un conteo', () => {
    assert.equal(classifyKnownEmployeeCount(Number.NaN), null);
    assert.equal(classifyKnownEmployeeCount(Number.POSITIVE_INFINITY), null);
    assert.equal(classifyKnownEmployeeCount(Number.NEGATIVE_INFINITY), null);
  });

  it('un NEGATIVO es inválido, NO «más pequeño que cero»', () => {
    assert.equal(classifyKnownEmployeeCount(-1), null);
    assert.equal(classifyKnownEmployeeCount(-500), null);
  });

  it('un no-número es DESCONOCIDO', () => {
    assert.equal(classifyKnownEmployeeCount('200'), null);
    assert.equal(classifyKnownEmployeeCount({}), null);
  });

  it('los fraccionarios se truncan, no se redondean hacia arriba', () => {
    assert.equal(classifyKnownEmployeeCount(200.7), 200);
    assert.equal(classifyKnownEmployeeCount(199.9), 199);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B · la ADMISIÓN por la ruta real, punta por punta
// ─────────────────────────────────────────────────────────────────────────────

describe('CUT-5B § B — la admisión, valor por valor', () => {
  const HARD = 'known_employee_count_below_min';

  it('199 ⇒ rechazo duro', () => {
    const g = admissionFor(199);
    assert.equal(g.decision, 'hard_excluded');
    assert.ok(g.hardReasons.includes(HARD));
  });

  it('0 ⇒ rechazo duro (conteo conocido por debajo del suelo)', () => {
    const g = admissionFor(0);
    assert.equal(g.decision, 'hard_excluded');
    assert.ok(g.hardReasons.includes(HARD));
  });

  it('50 ⇒ rechazo duro: el score NO puede rescatarla', () => {
    const g = admissionFor(50);
    assert.equal(g.decision, 'hard_excluded');
    // La empresa de 50 SÍ pasa el gate de calidad del preview (85 >= 70), y aun
    // así no entra. La admisión no lee el score, y esa es la garantía.
    const prev = normalizeLushaPreviewCompany(
      {
        id: 'p', name: 'Acme', domain: 'acme.co', country: 'Colombia', countryIso2: 'CO',
        industry: 'Hospitals', linkedinUrl: null,
        employeeCountExact: 50, employeeCountMin: null, employeeCountMax: null,
      } as never,
      {
        expectedCountryName: 'Colombia', expectedCountryIso2: 'CO',
        industryKey: 'health_pharma', sectorLabel: 'Salud',
        matchKeywords: ['Hospitals'], sizeBand: null, minScore: 70,
      } as never,
    );
    assert.ok(prev.score >= 70, 'el score sigue por encima del mínimo del preview');
    assert.equal(prev.passesGate, true, 'y el gate de calidad la aprueba');
    assert.equal(g.decision, 'hard_excluded', 'y aun así la admisión la rechaza');
  });

  it('200 ⇒ elegible (el umbral es INCLUSIVO)', () => {
    const g = admissionFor(200);
    assert.notEqual(g.decision, 'hard_excluded');
    assert.equal(g.hardReasons.includes(HARD), false);
  });

  it('201 ⇒ elegible', () => {
    assert.notEqual(admissionFor(201).decision, 'hard_excluded');
  });

  it('null ⇒ reviewable, JAMÁS rechazo', () => {
    const g = admissionFor(null);
    assert.equal(g.decision, 'reviewable_with_warnings');
    assert.equal(g.hardReasons.includes(HARD), false);
    assert.ok(g.warnings.includes('employee_count_unknown'));
  });

  it('undefined ⇒ reviewable, JAMÁS rechazo', () => {
    const g = admissionFor(undefined);
    assert.equal(g.decision, 'reviewable_with_warnings');
    assert.equal(g.hardReasons.includes(HARD), false);
  });

  it('NaN ⇒ reviewable: desconocido no es «menor que el umbral»', () => {
    const g = admissionFor(Number.NaN);
    assert.equal(g.decision, 'reviewable_with_warnings');
    assert.equal(g.hardReasons.includes(HARD), false);
    assert.ok(g.warnings.includes('employee_count_unknown'));
  });

  it('un negativo ⇒ reviewable: valor inválido, no conteo real', () => {
    const g = admissionFor(-5);
    assert.equal(g.decision, 'reviewable_with_warnings');
    assert.equal(g.hardReasons.includes(HARD), false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C · la FICHA y la DECISIÓN no pueden discrepar
// ─────────────────────────────────────────────────────────────────────────────

describe('CUT-5B § C — icp_size_gate concuerda con la admisión', () => {
  /** El desenlace de la ficha, reducido a las tres familias de la admisión. */
  function fichaFamily(employeesExact: unknown): 'reject' | 'eligible' | 'review' {
    const d = buildLushaIcpSizeGate(company({ employeesExact: employeesExact as number })).decision;
    return d === 'block' ? 'reject' : d === 'pass' ? 'eligible' : 'review';
  }

  function admissionFamily(employeesExact: unknown): 'reject' | 'eligible' | 'review' {
    const g = admissionFor(employeesExact);
    if (g.decision === 'hard_excluded') return 'reject';
    return g.warnings.includes('employee_count_unknown') ? 'review' : 'eligible';
  }

  const CASES: Array<[string, unknown, 'reject' | 'eligible' | 'review']> = [
    ['199', 199, 'reject'],
    ['0', 0, 'reject'],
    ['50', 50, 'reject'],
    ['200', 200, 'eligible'],
    ['201', 201, 'eligible'],
    ['null', null, 'review'],
    ['undefined', undefined, 'review'],
    ['NaN', Number.NaN, 'review'],
    ['-5', -5, 'review'],
  ];

  for (const [label, value, expected] of CASES) {
    it(`${label} ⇒ ficha y decisión dicen «${expected}»`, () => {
      assert.equal(admissionFamily(value), expected, 'la ADMISIÓN');
      assert.equal(fichaFamily(value), expected, 'la FICHA');
      assert.equal(fichaFamily(value), admissionFamily(value), 'y coinciden entre sí');
    });
  }

  it('la ficha NO inventa un veredicto sobre un valor que no es un tamaño', () => {
    // Antes de CUT-5B `NaN >= 200` era `false` y la ficha devolvía `block`.
    assert.equal(buildLushaIcpSizeGate(company({ employeesExact: Number.NaN })).decision, 'needs_validation');
    assert.equal(buildLushaIcpSizeGate(company({ employeesExact: -5 })).decision, 'needs_validation');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D · la RUTA REAL del waterfall atraviesa esta decisión
// ─────────────────────────────────────────────────────────────────────────────

describe('CUT-5B § D — la pierna del waterfall', () => {
  const CANONICAL_BATCH_ID = 'b7f1c3d2-0a44-4f9e-9c31-8d6e5a2b1c07';
  const WIZARD_CLIENT_REQUEST_ID = '22222222-2222-4222-8222-222222222222';

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
              sizeBandKey: (actionInput as { sizeBandKey?: string | null }).sizeBandKey ?? null,
              searchText: null,
            },
            ACTOR,
          )) as PersistLushaPendingReviewResult,
      },
    );
    return { outcome, calls };
  }

  test('una empresa de 0 empleados NO sobrevive a la pierna del waterfall', async () => {
    const { outcome, calls } = await runLegAgainstRealCore([
      company({ name: 'Fantasma', domain: 'fantasma.com', employeesExact: 0 }),
    ]);
    assert.equal(outcome.executed, true);
    assert.equal(calls.candidateRows.length, 0, '0 empleados no puede llegar a candidato');
    assert.equal(
      outcome.executed === true && outcome.result.hardExcludedByGateCount,
      1,
      'el rechazo ocurrió DENTRO de la pierna, no en una prueba aparte',
    );
  });

  test('la de 0 empleados ni siquiera llega al comprobador de duplicados', async () => {
    const { calls } = await runLegAgainstRealCore([
      company({ name: 'Fantasma', domain: 'fantasma.com', employeesExact: 0 }),
    ]);
    assert.equal(calls.duplicateInputs.length, 0);
  });

  test('una empresa SIN conteo sobrevive: desconocido no es rechazo', async () => {
    const { outcome, calls } = await runLegAgainstRealCore([
      company({ name: 'Sin Dato', domain: 'sindato.com', employeesExact: null }),
    ]);
    assert.equal(outcome.executed, true);
    assert.deepEqual(insertedNames(calls), ['Sin Dato']);
  });

  test('200 exactos siguen sobreviviendo (CUT-5A no se relaja)', async () => {
    const { calls } = await runLegAgainstRealCore([
      company({ name: 'Justa', domain: 'justa.com', employeesExact: 200 }),
    ]);
    assert.deepEqual(insertedNames(calls), ['Justa']);
  });

  test('el rechazo por 0 usa el motivo duro que YA existe, sin código nuevo', async () => {
    const { calls } = await runWaterfallShapedBatch([
      company({ name: 'Fantasma', domain: 'fantasma.com', employeesExact: 0 }),
      company({ name: 'Grande', domain: 'grande.com', employeesExact: 900 }),
    ]);
    const meta = calls.batches[0].metadata as Record<string, unknown>;
    const excluded = meta.excludedByMandatoryGate as Array<Record<string, unknown>>;
    assert.equal(excluded.length, 1);
    assert.equal(excluded[0].name, 'Fantasma');
    assert.equal(excluded[0].decision, 'hard_excluded');
    assert.equal(excluded[0].reason, 'known_employee_count_below_min');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// E · trinquetes: cada mutación relevante tiene que caer
// ─────────────────────────────────────────────────────────────────────────────

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

function readSource(relativePath: string): string {
  return stripComments(fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8'));
}

describe('CUT-5B § E — trinquetes', () => {
  const GATE = 'src/server/agents/prospecting-toolkit/icp-size-gate.ts';
  const CORE = 'src/server/prospect-batches/lusha-pending-review.ts';
  const PREVIEW = 'src/server/prospect-batches/lusha-preview.ts';

  test('MUTACIÓN — el umbral sigue siendo 200 e INCLUSIVO', () => {
    assert.equal(ICP_SIZE_GATE_DEFAULT_THRESHOLD, 200);
    // Cambiarlo a 201 rompe aquí y en cada caso de 200 de § B/§ C/§ D.
    assert.equal(admissionFor(200).hardReasons.length, 0);
  });

  test('MUTACIÓN — el cero no puede volver a leerse como desconocido', () => {
    assert.equal(classifyKnownEmployeeCount(0), 0);
    assert.equal(admissionFor(0).decision, 'hard_excluded');
    const source = readSource(GATE);
    assert.equal(
      /truncated\s*>\s*0/.test(source),
      false,
      '`> 0` devuelve el cero al saco de «sin dato» y una empresa de cero empleados vuelve a revisión',
    );
    assert.ok(/truncated\s*>=\s*0/.test(source), 'el cero es conteo conocido');
  });

  test('MUTACIÓN — la pierna Lusha no puede dejar de pedir la lectura canónica del cero', () => {
    const source = readSource(CORE);
    assert.ok(
      /treatZeroEmployeeCountAsKnown:\s*true/.test(source),
      'sin la opción el normalizador colapsa el 0 y el rechazo por tamaño desaparece',
    );
  });

  test('MUTACIÓN — eliminar el gate de la ruta real deja la suite en rojo', () => {
    const source = readSource(CORE);
    assert.ok(
      /evaluateProspectIntakeGate\(normalized,\s*criteria\)/.test(source),
      'la admisión pasa por el gate compartido; quitarlo es quitar la autoridad',
    );
    assert.ok(
      /minEmployees:\s*resolveLushaLocalMinEmployees\(/.test(source),
      'y el criterio sigue llevando el suelo de CUT-5A',
    );
  });

  test('MUTACIÓN — <200 no puede degradarse a mero warning / −15', () => {
    // La degradación se ve en el desenlace, no en el score: si `known_...` deja
    // de ser HARD, esto pasa a `reviewable_*` y cae.
    for (const value of [0, 1, 50, 199]) {
      const g = admissionFor(value);
      assert.equal(g.decision, 'hard_excluded', `${value} debe ser rechazo duro`);
      assert.ok(g.hardReasons.includes('known_employee_count_below_min'));
    }
  });

  test('MUTACIÓN — 200 no puede convertirse en reject ni en warning', () => {
    const g = admissionFor(200);
    assert.equal(g.decision, 'reviewable_clean');
    assert.equal(g.hardReasons.length, 0);
    assert.equal(g.warnings.includes('employee_count_unknown'), false);
  });

  test('MUTACIÓN — unknown no puede convertirse en reject', () => {
    for (const value of [null, undefined, Number.NaN, -5]) {
      const g = admissionFor(value);
      assert.notEqual(g.decision, 'hard_excluded', `${String(value)} nunca es rechazo`);
    }
  });

  test('NO aparece una segunda autoridad de tamaño', () => {
    // Ni el preview ni el núcleo pueden declarar su propio 200 ni su propia
    // clasificación de conteo: los dos importan los del módulo del gate ICP.
    for (const file of [CORE, PREVIEW]) {
      const source = readSource(file);
      assert.ok(
        /ICP_SIZE_GATE_DEFAULT_THRESHOLD/.test(source),
        `${file} debe nombrar el umbral compartido`,
      );
      assert.equal(
        /(<|>|<=|>=)\s*200\b/.test(source),
        false,
        `${file} no puede comparar contra un literal 200 propio`,
      );
    }
    // Y el suelo ICP del preview se evalúa con la clasificación CANÓNICA, no con
    // una lectura propia del conteo.
    const previewSource = readSource(PREVIEW);
    assert.ok(
      /classifyKnownEmployeeCount\(company\.employeeCountExact\)/.test(previewSource),
      'el suelo ICP del preview usa el clasificador compartido',
    );
  });

  test('el suelo ICP del preview sólo ENDURECE: nunca deja de marcar lo que ya marcaba', () => {
    // 🔴 La comprobación que salvó este corte de una relajación silenciosa.
    // Reescribir TODO `employeesOutOfBand` con el clasificador canónico dejaba de
    // marcar 240 combinaciones (un `employeeCountMax` negativo, que la lectura
    // antigua comparaba como número). Por eso el bloque de banda quedó verbatim
    // y el suelo ICP es puro añadido. Esta prueba recorre el espacio entero.
    const oldOutOfBand = (c: Record<string, unknown>, band: { min?: number; max?: number } | null): boolean => {
      if (!band || (typeof band.min !== 'number' && typeof band.max !== 'number')) return false;
      const exact = typeof c.employeeCountExact === 'number' ? c.employeeCountExact : null;
      if (exact !== null) {
        if (typeof band.min === 'number' && exact < band.min) return true;
        if (typeof band.max === 'number' && exact > band.max) return true;
        return false;
      }
      const mn = typeof c.employeeCountMin === 'number' ? c.employeeCountMin : null;
      const mx = typeof c.employeeCountMax === 'number' ? c.employeeCountMax : null;
      if (mn === null && mx === null) return false;
      if (typeof band.min === 'number' && mx !== null && mx < band.min) return true;
      if (typeof band.max === 'number' && mn !== null && mn > band.max) return true;
      return false;
    };

    const VALUES = [null, 0, 1, 50, 199, 200, 201, 1000, 6000, Number.NaN, -5, 200.7];
    const BANDS: Array<{ min?: number; max?: number } | null> = [
      null, { min: 200 }, { min: 201, max: 5000 }, { min: 1001, max: 5000 }, { max: 500 },
    ];

    let relaxed = 0;
    let tightened = 0;
    for (const exact of VALUES) for (const mn of VALUES) for (const mx of VALUES) for (const band of BANDS) {
      const raw = {
        id: 'p', name: 'A', domain: 'a.co', country: 'Colombia', countryIso2: 'CO',
        industry: 'software', linkedinUrl: null,
        employeeCountExact: exact, employeeCountMin: mn, employeeCountMax: mx,
      };
      const crit = {
        expectedCountryName: 'Colombia', expectedCountryIso2: 'CO', industryKey: 'k',
        sectorLabel: 'l', matchKeywords: ['software'], sizeBand: band, minScore: 70,
      };
      const now = normalizeLushaPreviewCompany(raw as never, crit as never)
        .issues.includes('employees_out_of_range');
      const before = oldOutOfBand(raw as never, band);
      if (before && !now) relaxed++;
      else if (!before && now) tightened++;
    }
    assert.equal(relaxed, 0, 'CUT-5B no puede dejar de marcar nada que ya se marcaba');
    assert.ok(tightened > 0, 'y el suelo ICP sí tiene que marcar casos nuevos');
  });

  test('el suelo LOCAL no se ha convertido en filtro de proveedor', () => {
    const previewSource = readSource(PREVIEW);
    assert.equal(
      /resolveLushaLocalMinEmployees/.test(previewSource),
      false,
      'el suelo local no puede entrar en el cuerpo de la petición a Lusha',
    );
    assert.equal(
      /sizes:\s*\[[^\]]*200/.test(previewSource),
      false,
      'no hay filtro de tamaño server-side: el contrato de Lusha sigue sin soportarlo',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F · NO-REGRESIÓN de Apollo: el default del normalizador no se ha movido
// ─────────────────────────────────────────────────────────────────────────────

describe('CUT-5B § F — Apollo no cambia', () => {
  const APOLLO_BRIDGE =
    'src/server/agents/prospecting-toolkit/apollo-two-round/apollo-shared-intake-bridge.ts';

  /** El mismo encadenamiento, pero SIN opciones: la llamada que hace Apollo. */
  function admissionWithDefaults(employeeCount: unknown) {
    const criteria = { countryCode: 'CO', minEmployees: ICP_SIZE_GATE_DEFAULT_THRESHOLD } as never;
    const discovered = {
      provider: 'apollo' as const,
      providerRecordId: 'a1', providerRequestId: null,
      companyName: 'Acme', commercialName: null, legalName: null,
      websiteUrl: 'https://acme.co', domain: 'acme.co',
      linkedinUrl: 'https://www.linkedin.com/company/acme',
      country: 'Colombia', countryCode: 'CO', region: null, city: null,
      industry: 'Hospitals', subindustry: null, industryCodes: {},
      employeeCount, employeeRange: null,
      sourceUrl: null, sourceConfidence: null, providerMetadataSafe: {},
    } as never;
    const normalized = normalizeProviderDiscoveredCompany(discovered, criteria);
    return { normalized, gate: evaluateProspectIntakeGate(normalized, criteria) };
  }

  it('sin opciones, un 0 SIGUE leyéndose como «sin dato» — igual que antes de CUT-5B', () => {
    const { normalized, gate } = admissionWithDefaults(0);
    assert.equal(normalized.employeeCount, null, 'el default no cambió');
    assert.equal(gate.decision, 'reviewable_with_warnings');
    assert.ok(gate.warnings.includes('employee_count_unknown'));
  });

  it('sin opciones, los demás valores se comportan exactamente igual que antes', () => {
    assert.equal(admissionWithDefaults(199).gate.decision, 'hard_excluded');
    assert.equal(admissionWithDefaults(200).gate.decision, 'reviewable_clean');
    assert.equal(admissionWithDefaults(201).gate.decision, 'reviewable_clean');
    assert.equal(admissionWithDefaults(null).gate.decision, 'reviewable_with_warnings');
    assert.equal(admissionWithDefaults(Number.NaN).gate.decision, 'reviewable_with_warnings');
    assert.equal(admissionWithDefaults(-5).gate.decision, 'reviewable_with_warnings');
  });

  test('el puente de Apollo NO pide la lectura canónica del cero', () => {
    const source = readSource(APOLLO_BRIDGE);
    assert.equal(
      /treatZeroEmployeeCountAsKnown/.test(source),
      false,
      'Apollo llama al normalizador SIN opciones: por eso su comportamiento no se mueve',
    );
    assert.ok(
      /normalizeProviderDiscoveredCompany\(discovered,\s*criteria\)/.test(source),
      'la llamada de Apollo sigue siendo de dos argumentos',
    );
  });

  /**
   * TABLA DORADA de la vía por DEFECTO — la que recorren Apollo y Tavily.
   *
   * 🔴 Se fijó comparando el normalizador actual contra el de `origin/main`
   * (pre-CUT-5B) sobre 12.960 combinaciones de proveedor × employeeCount ×
   * minEmployees × país × dominio × LinkedIn, con `deepStrictEqual` sobre el
   * objeto COMPLETO y sobre el desenlace del gate: 0 diferencias observables.
   *
   * Esta tabla es lo que queda de aquella comparación cuando el código viejo ya
   * no está a mano. Si alguien mueve el default —el único camino por el que
   * Apollo podría empezar a leer el `0` como conocido—, esta prueba cae.
   */
  const APOLLO_DEFAULT_GOLDEN: Array<[string, unknown, number | null, string]> = [
    ['0',          0,                          null, 'reviewable_with_warnings'],
    ['-0',         -0,                         null, 'reviewable_with_warnings'],
    ['0.4',        0.4,                        null, 'reviewable_with_warnings'],
    ['0.9',        0.9,                        null, 'reviewable_with_warnings'],
    ['null',       null,                       null, 'reviewable_with_warnings'],
    ['undefined',  undefined,                  null, 'reviewable_with_warnings'],
    ['NaN',        Number.NaN,                 null, 'reviewable_with_warnings'],
    ['+Infinity',  Number.POSITIVE_INFINITY,   null, 'reviewable_with_warnings'],
    ['-Infinity',  Number.NEGATIVE_INFINITY,   null, 'reviewable_with_warnings'],
    ['-1',         -1,                         null, 'reviewable_with_warnings'],
    ['-200',       -200,                       null, 'reviewable_with_warnings'],
    ['1',          1,                             1, 'hard_excluded'],
    ['199',        199,                         199, 'hard_excluded'],
    ['199.9',      199.9,                       199, 'hard_excluded'],
    ['200',        200,                         200, 'reviewable_clean'],
    ['200.7',      200.7,                       200, 'reviewable_clean'],
    ['201',        201,                         201, 'reviewable_clean'],
    ['1000000',    1_000_000,               1000000, 'reviewable_clean'],
  ];

  for (const [label, value, expectedCount, expectedDecision] of APOLLO_DEFAULT_GOLDEN) {
    it(`vía Apollo (sin opciones) — ${label} ⇒ count=${String(expectedCount)}, ${expectedDecision}`, () => {
      const { normalized, gate } = admissionWithDefaults(value);
      assert.equal(normalized.employeeCount, expectedCount);
      assert.equal(gate.decision, expectedDecision);
    });
  }

  it('la opción de Lusha SÓLO mueve los valores que truncan a cero', () => {
    // El delta entre las dos vías es exactamente {0, -0, 0.4, 0.9}. Ni uno más:
    // si la opción empezara a mover 199 o null, sería una autoridad distinta.
    const PROBE: unknown[] = [
      null, undefined, 0, -0, 0.4, 0.9, 1, 49, 199, 199.9, 200, 200.7, 201, 1000,
      Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1, -5, -200,
    ];
    const moved: string[] = [];
    for (const value of PROBE) {
      const withDefaults = admissionWithDefaults(value).normalized.employeeCount;
      const withOptIn = admissionFor(value).audit.employeeCount;
      if (withDefaults !== withOptIn) moved.push(String(value));
    }
    assert.deepEqual(moved.sort(), ['0', '0', '0.4', '0.9'], 'sólo el cero (y lo que trunca a cero) cambia');
  });

  test('la opción es un parámetro de contrato, NO un feature flag', () => {
    const source = readSource('src/server/agents/prospect-intake/normalize.ts');
    assert.equal(/process\.env/.test(source), false, 'sin env');
    assert.equal(/isEnabled|featureFlag|flagFor/i.test(source), false, 'sin registro de flags');
    assert.ok(
      /options:\s*NormalizeProspectOptions\s*=\s*\{\}/.test(source),
      'el default vacío es lo que preserva a Apollo',
    );
  });
});
