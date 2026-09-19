/**
 * AGENT1-LUSHA-MEASURABLE-ACCEPTANCE-X6.12 — la aceptación de Lusha deja de ser
 * inmedible.
 *
 * ── El defecto que estas pruebas fijan ───────────────────────────────────────
 *
 * `LUSHA_PROSPECTING_EVIDENCE_CAPABILITY` declaraba TRES condiciones no
 * disponibles y era una CONSTANTE, así que ninguna candidata de Lusha podía
 * cumplir las siete del contrato canónico: `acceptedForTarget` valía `null` por
 * construcción, `paidAcceptedContributionFromWriterTruth` lo leía como
 * `{ measured: false }` y la pierna aportaba CERO al objetivo por muchas filas
 * que persistiera. En Producción eso se vio en el lote `bedebe9b`: ocho filas
 * Lusha escritas, `accepted_for_target_total: 0` y
 * `acceptance_unknown_reasons: ['acceptance_not_measured']`.
 *
 * Las tres condiciones se cierran con evidencia que la ruta YA tenía o podía
 * producir sin gastar un crédito:
 *
 *   · `ownership_gate`    — `evaluateLushaOwnershipEvidence`, por la costura de
 *                           admisión única de X6.10-C.
 *   · `linkedin_status`   — la URL que el proveedor entrega, ACREDITADA como
 *                           página de empresa y escrita en su columna.
 *   · `subindustry_match` — los criterios ORIGINALES llegan hasta la aceptación;
 *                           sin subindustria pedida la pregunta no aplica.
 *
 * ── 🔴 Lo que estas pruebas NO permiten ──────────────────────────────────────
 *
 * Que el ownership se convierta en un descarte. X6.4 midió el heurístico textual
 * contra datos reales y rechazaba a las dueñas legítimas de su dominio (EPM ↔
 * `une.com.co` entre ellas). Aquí ese caso EXACTO tiene prueba: la empresa se
 * persiste, se revisa y no cuenta. Perder empresas reales contradiría la regla
 * de producto —conservar todas las válidas— y no es lo que este corte hace.
 *
 * Todo entra inyectado: sin red, sin base, sin cliente de Lusha, sin créditos.
 */

import { describe, it, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  persistLushaPendingReviewBatch,
  buildLushaPendingReviewCandidateRows,
  toLushaSurvivorCompletenessInput,
  type PersistLushaPendingReviewDeps,
  type LushaPendingReviewBatchRow,
  type LushaPendingReviewCandidateRow,
  type LushaMultiBranchExecution,
  type ResolvedLushaCandidate,
} from '@/server/prospect-batches/lusha-pending-review';
import {
  evaluateLushaOwnershipEvidence,
  toLushaOwnershipGateMetadata,
} from '@/server/prospect-batches/lusha-ownership-evidence';
import {
  evaluateLushaSurvivorCompleteness,
  resolveLushaRunAcceptanceTruth,
} from '@/server/prospect-batches/lusha-run-acceptance-truth';
import { resolveLushaProspectingEvidenceCapability } from '@/server/agents/prospecting-toolkit/provider-evidence-capability';
import { paidAcceptedContributionFromWriterTruth } from '@/modules/prospect-batches/accepted-for-target';
import { resolveLushaMacroSearchPlan } from '@/server/prospect-batches/lusha-macro-search-plan';
import type {
  LushaPreviewCompany,
  LushaPreviewInput,
  LushaPreviewResult,
} from '@/server/prospect-batches/lusha-preview';
import type {
  DuplicateCheckInput,
  DuplicateCheckResult,
} from '@/server/agents/prospecting-toolkit/types';

import { preM126FencedInsert } from '@/server/prospect-batches/__tests__/support/lusha-pre-m126-fenced-insert';
import { preM126BatchEpochSnapshot } from '@/server/prospect-batches/__tests__/support/lusha-batch-epoch-snapshot';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const INPUT: LushaPreviewInput = {
  countryCode: 'CO',
  macroIndustryKey: 'health_pharma',
  subIndustryId: null,
  sizeBandKey: '201-5000',
  searchText: null,
};

const ACTOR = {
  internalUserId: 'user-1',
  clientRequestId: '11111111-1111-4111-8111-111111111111',
  requestedTarget: 5,
};

const HEALTH_PHARMA_PLAN = resolveLushaMacroSearchPlan('health_pharma');

const LINKEDIN = 'https://www.linkedin.com/company/acme-colombia';

/**
 * 🔴 Una página de empresa DISTINTA por empresa. La URL de LinkedIn es una
 * identidad de dedupe (`normalized_linkedin_url`), así que repetirla convertiría
 * a tres empresas distintas en una sola — y la prueba mediría el dedupe en vez
 * de la aceptación.
 */
function linkedinFor(id: string): string {
  return `https://www.linkedin.com/company/${id}-co`;
}

/**
 * Empresa que el ownership SÍ acredita (el dominio contiene el nombre) y que
 * trae las tres evidencias. La industria declarada es la de la rama principal
 * del plan, para que la precisión macro confirme.
 */
function ownedCompany(
  id: string,
  name: string,
  domain: string,
  overrides: Partial<LushaPreviewCompany> = {},
): LushaPreviewCompany {
  return {
    providerCompanyId: id,
    name,
    domain,
    country: 'Colombia',
    countryIso2: 'CO',
    industry: 'Healthcare',
    employeesExact: 700,
    employeesMin: null,
    employeesMax: null,
    linkedinUrl: linkedinFor(id),
    score: 100,
    passesGate: true,
    issues: [],
    ...overrides,
  };
}

function successResult(results: LushaPreviewCompany[]): LushaPreviewResult {
  return {
    ok: true,
    status: results.length === 0 ? 'empty' : 'success',
    results,
    billing: { creditsCharged: 1, resultsReturned: results.length, expectedMaxCredits: 1 },
    warnings: [],
    requestSummary: {
      country: 'Colombia',
      countryCode: 'CO',
      sector: 'Salud & Farmacéuticos',
      industryKey: 'health_pharma',
      macroIndustryKey: 'health_pharma',
      mainIndustriesIds: [11],
      subIndustryId: null,
      sizeBand: { min: 201, max: 5000 },
      hasSearchText: false,
    },
  };
}

function noDuplicate(input: DuplicateCheckInput): DuplicateCheckResult {
  return {
    status: 'new_candidate',
    confidence: 85,
    input,
    matches: [],
    summary: 'nuevo',
    checkedSources: ['sellup', 'hubspot'],
  };
}

function makeDeps(
  script: LushaPreviewResult[],
  overrides: Partial<PersistLushaPendingReviewDeps> = {},
) {
  let searchCalls = 0;
  const batches: LushaPendingReviewBatchRow[] = [];
  const candidateRows: LushaPendingReviewCandidateRow[] = [];

  const deps: PersistLushaPendingReviewDeps = {
    runSearch: async () => {
      searchCalls += 1;
      return script[searchCalls - 1] ?? successResult([]);
    },
    reserveBatch: async (row: LushaPendingReviewBatchRow) => {
      batches.push(row);
      return { id: `batch-${batches.length}`, adopted: false, identityEpoch: 0 };
    },
    insertCandidatesFenced: preM126FencedInsert,
    readBatchIdentityEpoch: preM126BatchEpochSnapshot,
    insertCandidates: async (rows) => {
      candidateRows.push(...rows);
      return { insertedCount: rows.length };
    },
    checkCompanyDuplicate: async (input) => noDuplicate(input),
    fetchActiveCandidates: async () => [],
    ...overrides,
  };

  return { deps, batches, candidateRows, searchCallCount: () => searchCalls };
}

function run(
  script: LushaPreviewResult[],
  execution?: LushaMultiBranchExecution,
  overrides?: Partial<PersistLushaPendingReviewDeps>,
) {
  const harness = makeDeps(script, overrides);
  return persistLushaPendingReviewBatch(harness.deps, INPUT, ACTOR, undefined, execution).then(
    (res) => ({ res, ...harness }),
  );
}

function execution(overrides: Partial<LushaMultiBranchExecution> = {}): LushaMultiBranchExecution {
  assert.ok(HEALTH_PHARMA_PLAN, 'el catálogo debe publicar el plan de health_pharma');
  return { plan: HEALTH_PHARMA_PLAN, targetGap: 5, creditsReserved: 6, ...overrides };
}

// ═════════════════════════════════════════════════════════════════════════════
// § A — OWNERSHIP CON EVIDENCIA REAL, Y SIN PODER DE DESCARTE
// ═════════════════════════════════════════════════════════════════════════════

describe('X6.12 § A · ownership con evidencia real', () => {
  it('el veredicto sale de la costura de admisión, no de una regla propia', () => {
    const owned = evaluateLushaOwnershipEvidence({
      name: 'Cueros Velez SAS',
      domain: 'cuerosvelez.com',
      linkedinUrl: LINKEDIN,
    });

    assert.equal(owned.gateVerdict, 'pass');
    assert.equal(owned.admission.blocked, false);
    assert.equal(owned.admission.admittedBy, 'textual_gate');
    assert.equal(owned.evaluatedDomain, 'cuerosvelez.com');
  });

  it('el dominio se NORMALIZA antes de juzgar: una URL entera no cambia el veredicto', () => {
    const fromHost = evaluateLushaOwnershipEvidence({
      name: 'Cueros Velez SAS',
      domain: 'cuerosvelez.com',
      linkedinUrl: null,
    });
    const fromUrl = evaluateLushaOwnershipEvidence({
      name: 'Cueros Velez SAS',
      domain: 'https://www.cuerosvelez.com/',
      linkedinUrl: null,
    });

    assert.equal(fromUrl.evaluatedDomain, fromHost.evaluatedDomain);
    assert.equal(fromUrl.gateVerdict, fromHost.gateVerdict);
  });

  it('sin dominio no se fabrica un pase: la pregunta no se puede formular', () => {
    const evidence = evaluateLushaOwnershipEvidence({
      name: 'Empresa sin sitio',
      domain: null,
      linkedinUrl: LINKEDIN,
    });

    assert.equal(evidence.gateVerdict, 'fail');
    assert.equal(evidence.evaluatedDomain, null);
  });

  it('🔴 LinkedIn NUNCA admite por sí solo (contrato de X6.10-A, aquí también)', () => {
    // `une.com.co` es el caso REAL que X6.4 midió: el heurístico textual lo
    // rechaza aunque la empresa sea la dueña. Ni con LinkedIn presente admite.
    const evidence = evaluateLushaOwnershipEvidence({
      name: 'EPM',
      domain: 'une.com.co',
      linkedinUrl: 'https://www.linkedin.com/company/epm',
    });

    assert.equal(evidence.gateVerdict, 'fail');
    assert.notEqual(evidence.admission.admittedBy, 'structural_alias_evidence');
    assert.equal(evidence.admission.recoveredByStructuralEvidence, false);
  });

  it('la metadata declara el veredicto Y que NO bloquea', () => {
    const evidence = evaluateLushaOwnershipEvidence({
      name: 'EPM',
      domain: 'une.com.co',
      linkedinUrl: null,
    });
    const meta = toLushaOwnershipGateMetadata(evidence);

    assert.equal(meta.verdict, 'fail');
    assert.equal(meta.blocks_persistence, false);
    assert.equal(meta.evaluated_domain, 'une.com.co');
    assert.equal(typeof meta.textual_confidence, 'string');
  });

  it('🔴 un ownership rechazado NO descarta: la fila existe y va a revisión', async () => {
    const { res, candidateRows } = await run(
      [successResult([ownedCompany('e0', 'EPM', 'une.com.co')])],
      execution(),
    );

    assert.equal(res.ok, true);
    assert.equal(res.insertedCandidatesCount, 1, '🔴 la empresa real NO se pierde');
    assert.equal(candidateRows[0].status, 'needs_review');
    const meta = candidateRows[0].metadata as { ownership_gate?: Record<string, unknown> };
    assert.equal(meta.ownership_gate?.verdict, 'fail');
    // …y no cuenta hacia el mínimo, que es la otra mitad de la verdad.
    assert.equal(res.multiBranch?.acceptedForTargetTotal, 0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// § B — LA URL DE LINKEDIN, ACREDITADA Y EN SU COLUMNA
// ═════════════════════════════════════════════════════════════════════════════

describe('X6.12 § B · LinkedIn válida', () => {
  function rowFor(linkedinUrl: string | null): LushaPendingReviewCandidateRow {
    const resolved = {
      company: ownedCompany('c0', 'Acme Colombia SAS', 'acme.com', { linkedinUrl }),
      resolution: {
        dbDuplicateStatus: 'no_match',
        matchedAccountId: null,
        matchedHubspotCompanyId: null,
        accountDuplicateCheck: 'no_match',
        hubSpotDuplicateCheck: 'no_match',
        activeCandidateDuplicateCheck: 'no_match',
        activeGuardReason: null,
        duplicateDetails: null,
      },
    } as unknown as ResolvedLushaCandidate;
    return buildLushaPendingReviewCandidateRows('batch-1', [resolved])[0];
  }

  it('una página de EMPRESA se escribe en la columna', () => {
    assert.equal(rowFor(LINKEDIN).linkedin_url, LINKEDIN);
  });

  it('un perfil personal NO es una página de empresa: la columna queda nula', () => {
    assert.equal(rowFor('https://www.linkedin.com/in/alguien').linkedin_url, null);
  });

  it('sin URL no se fabrica ninguna', () => {
    assert.equal(rowFor(null).linkedin_url, null);
  });

  it('la columna y el bloque de metadata deciden con el MISMO predicado', () => {
    const row = rowFor('https://www.linkedin.com/in/alguien');
    const meta = row.metadata as { linkedin_enrichment?: unknown };
    assert.equal(row.linkedin_url, null);
    assert.equal(meta.linkedin_enrichment, undefined, 'ni columna ni bloque: una sola regla');
  });

  it('la aceptación lee la URL ACREDITADA, no la cruda', () => {
    const accredited = toLushaSurvivorCompletenessInput({
      company: ownedCompany('c0', 'Acme Colombia SAS', 'acme.com', {
        linkedinUrl: 'https://www.linkedin.com/in/alguien',
      }),
      resolution: { dbDuplicateStatus: 'no_match' },
    } as unknown as ResolvedLushaCandidate);

    assert.equal(accredited.linkedinUrl, null, 'un perfil personal no satisface la condición');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// § C — LA SUBINDUSTRIA PEDIDA, SIN PERDERSE EN EL TRANSPORTE
// ═════════════════════════════════════════════════════════════════════════════

describe('X6.12 § C · subindustria según los criterios originales', () => {
  const survivor = {
    employeeCount: 700,
    duplicateStatus: 'no_match',
    ownershipGate: 'pass' as const,
    linkedinUrl: LINKEDIN,
    macroIndustryConfirmed: true,
  };

  it('sin subindustria pedida la pregunta NO aplica y la candidata completa', () => {
    assert.equal(evaluateLushaSurvivorCompleteness(survivor), 'complete');
    assert.deepEqual(
      resolveLushaProspectingEvidenceCapability({ subindustryRequested: false })
        .unavailableConditions,
      [],
    );
  });

  it('con subindustria pedida NO se finge una confirmación: queda UNKNOWN', () => {
    assert.equal(
      evaluateLushaSurvivorCompleteness(survivor, { requestedSubindustries: ['Hospitals'] }),
      'unknown',
      '🔴 la macro confirmada NUNCA demuestra la subindustria pedida',
    );
    assert.deepEqual(
      resolveLushaProspectingEvidenceCapability({ subindustryRequested: true })
        .unavailableConditions,
      ['subindustry_match'],
    );
  });

  it('y entonces la corrida entera declara su aceptación NO MEDIDA', () => {
    const truth = resolveLushaRunAcceptanceTruth([survivor, survivor], {
      requestedSubindustries: ['Hospitals'],
    });

    assert.equal(truth.acceptanceMeasurable, false);
    assert.equal(truth.acceptedForTarget, null);
    const contribution = paidAcceptedContributionFromWriterTruth({
      completeValidCandidates: truth.acceptedForTarget,
      persistedCandidates: 2,
    });
    assert.equal(contribution.measured, false);
  });

  it('la macro SIN confirmar tampoco completa, aunque no se pida subindustria', () => {
    assert.equal(
      evaluateLushaSurvivorCompleteness({ ...survivor, macroIndustryConfirmed: false }),
      'incomplete',
    );
  });

  it('el criterio llega por la ejecución, no se deduce dentro del núcleo', async () => {
    const company = ownedCompany('c0', 'Acme Colombia SAS', 'acme.com');

    const withoutRequest = await run([successResult([company])], execution());
    const withRequest = await run(
      [successResult([company])],
      execution({ requestedSubindustries: ['Hospitals'] }),
    );

    assert.equal(withoutRequest.res.multiBranch?.acceptedForTargetTotal, 1);
    assert.equal(
      withRequest.res.multiBranch?.acceptedForTargetTotal,
      null,
      '🔴 el mismo universo, otra pregunta: sin respuesta no hay medición',
    );
    // 🔴 Y el GASTO no se mueve por pedir subindustria.
    assert.equal(withoutRequest.res.creditsCharged, withRequest.res.creditsCharged);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// § D — INTEGRACIÓN CON I/O SIMULADO: LA ACEPTACIÓN YA SE MIDE
// ═════════════════════════════════════════════════════════════════════════════

describe('X6.12 § D · la corrida completa, con I/O simulado', () => {
  it('tres empresas con evidencia ⇒ tres aceptadas MEDIDAS y tres filas', async () => {
    const { res, candidateRows } = await run(
      [
        successResult([
          ownedCompany('c0', 'Acme Colombia SAS', 'acme.com'),
          ownedCompany('c1', 'Cueros Velez SAS', 'cuerosvelez.com'),
          ownedCompany('c2', 'Sodimac Colombia', 'sodimac.com.co'),
        ]),
      ],
      execution(),
    );

    assert.equal(res.ok, true);
    assert.equal(res.insertedCandidatesCount, 3);
    assert.equal(res.multiBranch?.acceptedForTargetTotal, 3);
    assert.equal(candidateRows.length, 3);
    for (const row of candidateRows) {
      assert.match(row.linkedin_url ?? '', /^https:\/\/www\.linkedin\.com\/company\//);
      const meta = row.metadata as { ownership_gate?: Record<string, unknown> };
      assert.equal(meta.ownership_gate?.verdict, 'pass');
    }
  });

  it('la mezcla se reparte: completas, incompletas y filas, cada una en su cuenta', async () => {
    const { res } = await run(
      [
        successResult([
          ownedCompany('c0', 'Acme Colombia SAS', 'acme.com'),
          // Sin empleados: condición EVALUADA que falla ⇒ incompleta.
          ownedCompany('c1', 'Cueros Velez SAS', 'cuerosvelez.com', { employeesExact: null }),
          // Ownership no acreditado ⇒ incompleta, pero se persiste.
          ownedCompany('c2', 'EPM', 'une.com.co'),
        ]),
      ],
      execution(),
    );

    assert.equal(res.insertedCandidatesCount, 3, 'el universo durable no se recorta');
    assert.equal(res.multiBranch?.acceptedForTargetTotal, 1);
  });

  it('🔴 el aporte llega MEDIDO hasta la aritmética de la corrida', async () => {
    const { res } = await run(
      [
        successResult([
          ownedCompany('c0', 'Acme Colombia SAS', 'acme.com'),
          ownedCompany('c1', 'Cueros Velez SAS', 'cuerosvelez.com'),
        ]),
      ],
      execution(),
    );

    const contribution = paidAcceptedContributionFromWriterTruth({
      completeValidCandidates: res.multiBranch?.acceptedForTargetTotal ?? null,
      persistedCandidates: res.insertedCandidatesCount,
    });

    assert.equal(contribution.measured, true, '🔴 ésta es la línea que X6.12 cruza');
    assert.equal(contribution.measured && contribution.acceptedForTarget, 2);
    assert.equal(contribution.persistedCandidates, 2);
  });

  it('🔴 el gasto NO cambia: las mismas páginas que antes de la evidencia', async () => {
    const withEvidence = await run(
      [successResult([ownedCompany('c0', 'Acme Colombia SAS', 'acme.com')])],
      execution(),
    );
    const withoutEvidence = await run(
      [
        successResult([
          ownedCompany('c0', 'Acme Colombia SAS', 'acme.com', { linkedinUrl: null }),
        ]),
      ],
      execution(),
    );

    assert.equal(withEvidence.searchCallCount(), withoutEvidence.searchCallCount());
    assert.equal(withEvidence.res.creditsCharged, withoutEvidence.res.creditsCharged);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// § E — EL CONTEO SALE DE LA VERDAD FINAL DEL WRITER
// ═════════════════════════════════════════════════════════════════════════════

describe('X6.12 § E · la verdad final del writer', () => {
  it('con la escritura confirmada, la aceptación se RE-EVALÚA sobre lo escrito', async () => {
    const { res } = await run(
      [
        successResult([
          ownedCompany('c0', 'Acme Colombia SAS', 'acme.com'),
          ownedCompany('c1', 'Cueros Velez SAS', 'cuerosvelez.com'),
        ]),
      ],
      execution(),
    );

    assert.equal(res.insertedCandidatesCount, 2);
    assert.equal(res.multiBranch?.acceptedForTargetTotal, 2);
  });

  it('🔴 si la base confirma MENOS filas, la aceptación no las sigue', async () => {
    const { res } = await run(
      [
        successResult([
          ownedCompany('c0', 'Acme Colombia SAS', 'acme.com'),
          ownedCompany('c1', 'Cueros Velez SAS', 'cuerosvelez.com'),
        ]),
      ],
      execution(),
      // La base confirma UNA sola fila de las dos entregadas.
      { insertCandidates: async () => ({ insertedCount: 1 }) },
    );

    assert.equal(res.insertedCandidatesCount, 1);
    assert.equal(
      res.multiBranch?.acceptedForTargetTotal,
      1,
      '🔴 nunca más aceptadas que filas confirmadas',
    );
  });

  it('la aceptación jamás supera las filas que la base confirmó', async () => {
    const { res } = await run(
      [successResult([ownedCompany('c0', 'Acme Colombia SAS', 'acme.com')])],
      execution(),
      { insertCandidates: async () => ({ insertedCount: 0 }) },
    );

    assert.equal(res.multiBranch?.acceptedForTargetTotal, 0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// § F — LO QUE ESTE CORTE NO TOCA
// ═════════════════════════════════════════════════════════════════════════════

describe('X6.12 § F · fronteras', () => {
  test('la compra sigue cerrándose con supervivientes, no con la aceptación', async () => {
    // Dos corridas con el MISMO universo y aceptaciones opuestas piden lo mismo.
    const measured = await run(
      [successResult([ownedCompany('c0', 'Acme Colombia SAS', 'acme.com')])],
      execution(),
    );
    const unmeasured = await run(
      [successResult([ownedCompany('c0', 'Acme Colombia SAS', 'acme.com')])],
      execution({ requestedSubindustries: ['Hospitals'] }),
    );

    assert.notEqual(
      measured.res.multiBranch?.acceptedForTargetTotal,
      unmeasured.res.multiBranch?.acceptedForTargetTotal,
    );
    assert.equal(measured.searchCallCount(), unmeasured.searchCallCount());
    assert.equal(measured.res.remainingGapFinal, unmeasured.res.remainingGapFinal);
  });

  test('🔴 el objetivo sigue SIN recortar el universo persistido', async () => {
    const companies = [
      ownedCompany('c0', 'Acme Colombia SAS', 'acme.com'),
      ownedCompany('c1', 'Cueros Velez SAS', 'cuerosvelez.com'),
      ownedCompany('c2', 'Sodimac Colombia', 'sodimac.com.co'),
      ownedCompany('c3', 'Industrias Haceb', 'haceb.com'),
      ownedCompany('c4', 'Bancolombia SA', 'bancolombia.com'),
      ownedCompany('c5', 'Nutresa SA', 'nutresa.com'),
    ];
    const { res } = await run([successResult(companies)], execution({ targetGap: 5 }));

    assert.equal(
      res.insertedCandidatesCount,
      6,
      '🔴 seis empresas válidas con objetivo 5: se conservan las seis',
    );
  });
});
