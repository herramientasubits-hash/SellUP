/**
 * A1-LUSHA-SIZE-PARITY § CUT-C.1 — standalone y waterfall responden IGUAL a
 * «¿esta empresa tiene el tamaño que buscamos?».
 *
 * ── El defecto que esta suite fija ───────────────────────────────────────────
 *
 * El puente del wizard (`resolveWizardLushaCriteria`) mandaba
 * `sizeBandKey: '201-5000'`. La pierna del waterfall (`runLushaWaterfallLeg`) no
 * manda banda ninguna. Misma empresa, mismo día, dos veredictos:
 *
 *   · 200 empleados EXACTOS  → waterfall ADMITE · standalone RECHAZA (duro)
 *   · 5.001 / 1.000.001      → waterfall ADMITE limpio · standalone ni siquiera
 *                              los pedía (`sizes:[{min:201,max:5000}]`) y, si
 *                              llegaban, los marcaba `employees_out_of_range`
 *
 * Ni el 201 ni el 5.000 salen de una regla de negocio: salen de la ETIQUETA de
 * una banda de UI. La regla real es `ICP_SIZE_GATE_DEFAULT_THRESHOLD` — 200,
 * INCLUSIVO, sin techo — que es la que la pierna del waterfall ya aplicaba vía
 * `resolveLushaLocalMinEmployees`.
 *
 * ── Lo que esta suite afirma ─────────────────────────────────────────────────
 *
 *   A  El puente del wizard no pide banda (unidad + guarda estática).
 *   B  El criterio de tamaño es IDÉNTICO en las dos formas.
 *   C  La petición al proveedor es IDÉNTICA: sin `sizes` en ninguna de las dos.
 *   D  La ADMISIÓN real, contra el núcleo de persistencia, sobre
 *      199/200/201/5000/5001/1000001/desconocido: mismo desenlace en las dos.
 *   E  La ETIQUETA (`employees_out_of_range`) sobre los mismos 7 valores.
 *   F  Trinquetes de mutación.
 *
 * ── Lo que esta suite NO afirma ──────────────────────────────────────────────
 *
 * · Nada sobre ahorro de créditos. Al revés: sin prefiltro de proveedor la
 *   página trae MÁS empresas por debajo del ICP, que el suelo local rechaza
 *   DESPUÉS de haberla pagado. Lo que se gana es comparabilidad.
 * · Nada sobre `sizes: [{min: 200}]`. Esa forma sigue sin contrato verificado
 *   (`LUSHA_SIZE_PARITY = UNSUPPORTED_BY_PROVIDER_CONTRACT`) y § C exige que NO
 *   aparezca.
 * · Nada sobre Apollo.
 *
 * 0 llamadas a proveedor (cada dependencia es un doble), 0 escrituras,
 * 0 migraciones, 0 créditos, 0 flags.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  persistLushaPendingReviewBatch,
  buildLushaProspectSearchCriteria,
  resolveLushaLocalMinEmployees,
  type PersistLushaPendingReviewDeps,
  type LushaPendingReviewBatchRow,
  type LushaPendingReviewCandidateRow,
} from '@/server/prospect-batches/lusha-pending-review';
import {
  buildLushaPreviewRequest,
  normalizeLushaPreviewCompany,
  resolveLushaPreviewSizeBand,
  LUSHA_PREVIEW_DEFAULT_MIN_SCORE,
  type LushaPreviewCompany,
  type LushaPreviewCriteria,
  type LushaPreviewInput,
  type LushaPreviewResult,
} from '@/server/prospect-batches/lusha-preview';
import { ICP_SIZE_GATE_DEFAULT_THRESHOLD } from '@/server/agents/prospecting-toolkit/icp-size-gate';
import {
  resolveWizardLushaCriteria,
  WIZARD_LUSHA_REQUESTED_SIZE_BAND_KEY,
} from '@/modules/prospect-batches/wizard-lusha-criteria';
import type { ActiveIndustryCatalog } from '@/modules/industry-catalog/types';
import type {
  DuplicateCheckInput,
  DuplicateCheckResult,
} from '@/server/agents/prospecting-toolkit/types';
import { preM126FencedInsert } from '@/server/prospect-batches/__tests__/support/lusha-pre-m126-fenced-insert';
import { preM126BatchEpochSnapshot } from '@/server/prospect-batches/__tests__/support/lusha-batch-epoch-snapshot';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const CATALOG: ActiveIndustryCatalog = {
  version: '2.0.0',
  industries: [
    {
      id: 'ind-health',
      name: 'Salud & Farmacéuticos',
      slug: 'health-pharma',
      description: null,
      sortOrder: 1,
    },
  ],
  subindustries: [],
};

/** La entrada que produce el PUENTE DEL WIZARD hoy. No se escribe a mano. */
function standaloneInput(): LushaPreviewInput {
  const decision = resolveWizardLushaCriteria(
    { countryCode: 'CO', industryId: 'ind-health', subindustryIds: [], additionalCriteriaRaw: null },
    CATALOG,
    true,
  );
  assert.equal(decision.provider, 'lusha', 'el fixture exige una decisión Lusha real');
  assert.ok(decision.input);
  return decision.input as LushaPreviewInput;
}

/** La entrada que produce la PIERNA DEL WATERFALL: sin `sizeBandKey`. */
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

/**
 * Los 7 valores que este corte tiene que responder igual en las dos piernas.
 * `null` = tamaño DESCONOCIDO (el proveedor no reportó cifra).
 */
const BOUNDARY_EMPLOYEE_COUNTS: ReadonlyArray<number | null> = [
  199, 200, 201, 5000, 5001, 1_000_001, null,
];

function labelOf(count: number | null): string {
  return count === null ? 'desconocido' : String(count);
}

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
    employeesExact: 300 as number | null,
    employeesMin: null,
    employeesMax: null,
    score: 92,
    passesGate: true,
    issues: [] as string[],
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
 * El `requestSummary` que devolvería el núcleo para una entrada dada. Se DERIVA
 * de `input.sizeBandKey` con la MISMA función que usa producción
 * (`resolveLushaPreviewSizeBand`): si el doble lo escribiera a mano, la suite
 * mediría un arnés y no el sistema.
 */
function searchResultFor(
  input: LushaPreviewInput,
  results: LushaPreviewCompany[],
): LushaPreviewResult {
  const band = resolveLushaPreviewSizeBand(input.sizeBandKey);
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
      sizeBand: band ? { min: band.min, max: band.max } : null,
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

function makeDeps(input: LushaPreviewInput, results: LushaPreviewCompany[]) {
  const calls = {
    batches: [] as LushaPendingReviewBatchRow[],
    candidateRows: [] as LushaPendingReviewCandidateRow[],
    duplicateInputs: [] as DuplicateCheckInput[],
  };
  const deps: PersistLushaPendingReviewDeps = {
    runSearch: async (searchInput) =>
      (searchInput.page ?? 0) > 0
        ? { ...searchResultFor(input, []), status: 'empty' as const }
        : searchResultFor(input, results),
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
    checkCompanyDuplicate: async (dupInput) => {
      calls.duplicateInputs.push(dupInput);
      return noDup(dupInput);
    },
    fetchActiveCandidates: async () => [],
    officialSourceResolvers: [],
  };
  return { deps, calls };
}

/** El desenlace OBSERVABLE de una empresa de `count` empleados en una pierna. */
async function admissionOutcome(input: LushaPreviewInput, count: number | null) {
  const { deps, calls } = makeDeps(input, [
    company({ name: 'Sujeto', domain: 'sujeto.com', employeesExact: count }),
  ]);
  const res = await persistLushaPendingReviewBatch(deps, input, ACTOR);
  return {
    hardExcludedByGateCount: res.hardExcludedByGateCount,
    inserted: calls.candidateRows.map((r) => r.name),
    duplicateChecks: calls.duplicateInputs.length,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// A · el puente del wizard no pide banda
// ─────────────────────────────────────────────────────────────────────────────

describe('CUT-C.1 § A — el puente del wizard', () => {
  it('la constante canónica es «ninguna banda»', () => {
    assert.equal(WIZARD_LUSHA_REQUESTED_SIZE_BAND_KEY, null);
  });

  it('la entrada que produce el wizard NO lleva banda de tamaño', () => {
    assert.equal(standaloneInput().sizeBandKey, null);
  });

  it('y por tanto no lleva techo: `resolveLushaPreviewSizeBand` no resuelve nada', () => {
    assert.equal(resolveLushaPreviewSizeBand(standaloneInput().sizeBandKey), null);
  });

  it('GUARDA ESTÁTICA — el puente no puede volver a importar la banda de UI', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/modules/prospect-batches/wizard-lusha-criteria.ts'),
      'utf8',
    );
    // Se comparan sólo las líneas de CÓDIGO: el comentario del corte cita el
    // nombre a propósito, y grepear crudo confundiría «nombrarlo» con «usarlo».
    const code = src
      .split('\n')
      .filter((line) => {
        const t = line.trim();
        return t.length > 0 && !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*');
      })
      .join('\n');
    assert.ok(
      !code.includes('LUSHA_PREVIEW_DEFAULT_SIZE_BAND_KEY'),
      'el puente del wizard volvió a depender de la banda por defecto del panel de UI',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B · el criterio de tamaño es idéntico en las dos piernas
// ─────────────────────────────────────────────────────────────────────────────

describe('CUT-C.1 § B — criterio de tamaño', () => {
  it('standalone y waterfall producen EXACTAMENTE el mismo suelo y el mismo techo', () => {
    const s = standaloneInput();
    const standalone = buildLushaProspectSearchCriteria(s, searchResultFor(s, [company()]));
    const waterfall = buildLushaProspectSearchCriteria(
      WATERFALL_INPUT,
      searchResultFor(WATERFALL_INPUT, [company()]),
    );
    assert.deepEqual(
      { min: standalone.minEmployees, max: standalone.maxEmployees },
      { min: waterfall.minEmployees, max: waterfall.maxEmployees },
    );
  });

  it('el suelo es el umbral ICP compartido, no un literal propio', () => {
    const s = standaloneInput();
    const criteria = buildLushaProspectSearchCriteria(s, searchResultFor(s, [company()]));
    assert.equal(criteria.minEmployees, ICP_SIZE_GATE_DEFAULT_THRESHOLD);
    assert.equal(ICP_SIZE_GATE_DEFAULT_THRESHOLD, 200);
  });

  it('NO hay techo artificial en standalone', () => {
    const s = standaloneInput();
    assert.equal(
      buildLushaProspectSearchCriteria(s, searchResultFor(s, [company()])).maxEmployees,
      null,
    );
  });

  it('el suelo nunca es null en ninguna de las dos piernas', () => {
    assert.equal(resolveLushaLocalMinEmployees(null), 200);
    assert.equal(resolveLushaLocalMinEmployees(undefined), 200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C · la PETICIÓN al proveedor es idéntica — y sigue sin `sizes`
// ─────────────────────────────────────────────────────────────────────────────

describe('CUT-C.1 § C — cuerpo de la petición', () => {
  /**
   * El cuerpo que produciría esta entrada. La banda se DERIVA de
   * `input.sizeBandKey` con la misma función que usa producción, que es
   * exactamente el paso donde vivía la discrepancia.
   */
  function requestFor(input: LushaPreviewInput) {
    const band = resolveLushaPreviewSizeBand(input.sizeBandKey);
    return buildLushaPreviewRequest({
      countryName: 'Colombia',
      mainIndustriesIds: [11],
      subIndustryId: input.subIndustryId ?? null,
      sizeBand: band ? { min: band.min, max: band.max } : null,
      searchText: input.searchText ?? null,
    });
  }

  function sizesOf(input: LushaPreviewInput): unknown {
    return requestFor(input).filters?.companies?.include?.sizes;
  }

  it('standalone y waterfall emiten el MISMO cuerpo', () => {
    assert.deepEqual(requestFor(standaloneInput()), requestFor(WATERFALL_INPUT));
  });

  it('ninguna de las dos manda `sizes` — `{min: 200}` sigue sin contrato', () => {
    assert.equal(sizesOf(standaloneInput()), undefined);
    assert.equal(sizesOf(WATERFALL_INPUT), undefined);
  });

  it('MUTACIÓN — la banda vieja reintroduce `sizes` en el cuerpo', () => {
    assert.deepEqual(sizesOf({ ...standaloneInput(), sizeBandKey: '201-5000' }), [
      { min: 201, max: 5000 },
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D · ADMISIÓN real sobre los 7 valores frontera
// ─────────────────────────────────────────────────────────────────────────────

describe('CUT-C.1 § D — admisión, 199/200/201/5000/5001/1000001/desconocido', () => {
  for (const count of BOUNDARY_EMPLOYEE_COUNTS) {
    it(`${labelOf(count)} empleados ⇒ el MISMO desenlace en standalone y waterfall`, async () => {
      const standalone = await admissionOutcome(standaloneInput(), count);
      const waterfall = await admissionOutcome(WATERFALL_INPUT, count);
      assert.deepEqual(standalone, waterfall);
    });
  }

  it('199 ⇒ rechazo duro, y no llega al comprobador de duplicados', async () => {
    const out = await admissionOutcome(standaloneInput(), 199);
    assert.equal(out.hardExcludedByGateCount, 1);
    assert.deepEqual(out.inserted, []);
    assert.equal(out.duplicateChecks, 0);
  });

  it('200 EXACTOS ⇒ admitido (el umbral es INCLUSIVO)', async () => {
    const out = await admissionOutcome(standaloneInput(), 200);
    assert.equal(out.hardExcludedByGateCount, 0);
    assert.deepEqual(out.inserted, ['Sujeto']);
  });

  it('201 ⇒ admitido', async () => {
    assert.deepEqual((await admissionOutcome(standaloneInput(), 201)).inserted, ['Sujeto']);
  });

  it('5.000 ⇒ admitido', async () => {
    assert.deepEqual((await admissionOutcome(standaloneInput(), 5000)).inserted, ['Sujeto']);
  });

  it('5.001 ⇒ admitido — NO hay techo', async () => {
    assert.deepEqual((await admissionOutcome(standaloneInput(), 5001)).inserted, ['Sujeto']);
  });

  it('1.000.001 ⇒ admitido — tampoco el techo de Apollo aplica aquí', async () => {
    assert.deepEqual((await admissionOutcome(standaloneInput(), 1_000_001)).inserted, ['Sujeto']);
  });

  it('DESCONOCIDO ⇒ jamás rechazo duro (desconocido ≠ menor que 200)', async () => {
    const out = await admissionOutcome(standaloneInput(), null);
    assert.equal(out.hardExcludedByGateCount, 0);
    assert.deepEqual(out.inserted, ['Sujeto']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// E · la ETIQUETA sobre los mismos 7 valores
// ─────────────────────────────────────────────────────────────────────────────

describe('CUT-C.1 § E — etiqueta `employees_out_of_range`', () => {
  function criteriaFor(input: LushaPreviewInput): LushaPreviewCriteria {
    const band = resolveLushaPreviewSizeBand(input.sizeBandKey);
    return {
      expectedCountryName: 'Colombia',
      expectedCountryIso2: 'CO',
      industryKey: 'health_pharma',
      sectorLabel: 'Salud',
      matchKeywords: ['Hospitals'],
      sizeBand: band ? { min: band.min, max: band.max } : null,
      minScore: LUSHA_PREVIEW_DEFAULT_MIN_SCORE,
    };
  }

  function flagged(input: LushaPreviewInput, count: number | null): boolean {
    const normalized = normalizeLushaPreviewCompany(
      {
        id: 'pc-1',
        name: 'Sujeto',
        domain: 'sujeto.com',
        country: 'Colombia',
        countryIso2: 'CO',
        industry: 'Hospitals & Clinics',
        employeeCountExact: count,
      } as never,
      criteriaFor(input),
    );
    return normalized.issues.includes('employees_out_of_range');
  }

  for (const count of BOUNDARY_EMPLOYEE_COUNTS) {
    it(`${labelOf(count)} ⇒ la MISMA etiqueta en las dos piernas`, () => {
      assert.equal(flagged(standaloneInput(), count), flagged(WATERFALL_INPUT, count));
    });
  }

  it('sólo 199 queda marcado; 200 y todo lo que está por encima, no', () => {
    const s = standaloneInput();
    assert.equal(flagged(s, 199), true);
    for (const count of [200, 201, 5000, 5001, 1_000_001, null]) {
      assert.equal(flagged(s, count), false, `${labelOf(count)} no debe marcarse`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F · trinquetes de mutación
// ─────────────────────────────────────────────────────────────────────────────

describe('CUT-C.1 § F — trinquetes', () => {
  it('MUTACIÓN 1 — devolver la banda `201-5000` al wizard rompe la paridad de 200', async () => {
    // Es literalmente el código previo a este corte.
    const mutated: LushaPreviewInput = { ...standaloneInput(), sizeBandKey: '201-5000' };
    const out = await admissionOutcome(mutated, 200);
    assert.equal(out.hardExcludedByGateCount, 1, 'con la banda vieja, 200 se rechaza');
    assert.deepEqual(out.inserted, []);
    // …y el waterfall la admite. Ésa es la discrepancia entera.
    assert.deepEqual((await admissionOutcome(WATERFALL_INPUT, 200)).inserted, ['Sujeto']);
  });

  it('MUTACIÓN 2 — la banda vieja reintroduce un TECHO a 5.000', () => {
    const mutated: LushaPreviewInput = { ...standaloneInput(), sizeBandKey: '201-5000' };
    const criteria = buildLushaProspectSearchCriteria(mutated, searchResultFor(mutated, [company()]));
    assert.equal(criteria.maxEmployees, 5000);
    assert.notEqual(
      criteria.maxEmployees,
      buildLushaProspectSearchCriteria(
        WATERFALL_INPUT,
        searchResultFor(WATERFALL_INPUT, [company()]),
      ).maxEmployees,
    );
  });

  it('MUTACIÓN 3 — bajar el suelo por debajo del umbral ICP no es alcanzable por banda', () => {
    // Una banda MÁS LAXA no puede rebajar el suelo: el ICP manda.
    assert.equal(resolveLushaLocalMinEmployees(51), ICP_SIZE_GATE_DEFAULT_THRESHOLD);
    assert.equal(resolveLushaLocalMinEmployees(0), ICP_SIZE_GATE_DEFAULT_THRESHOLD);
  });

  it('FIDELIDAD DEL ARNÉS — si la pierna del waterfall aprende a mandar banda, esta suite deja de medir lo que dice', () => {
    const src = fs.readFileSync(
      path.join(
        process.cwd(),
        'src/modules/prospect-batches/chat-wizard-execution/wizard-lusha-waterfall.server.ts',
      ),
      'utf8',
    );
    const code = src
      .split('\n')
      .filter((line) => {
        const t = line.trim();
        return t.length > 0 && !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*');
      })
      .join('\n');
    assert.ok(
      !code.includes('sizeBandKey'),
      'la pierna del waterfall empezó a mandar banda: WATERFALL_INPUT ya no es fiel',
    );
  });
});
