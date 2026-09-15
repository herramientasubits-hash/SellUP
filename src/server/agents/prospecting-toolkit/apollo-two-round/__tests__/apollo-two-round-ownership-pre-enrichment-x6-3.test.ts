/**
 * apollo-two-round-ownership-pre-enrichment-x6-3.test.ts
 *
 * AGENT1-OWNERSHIP-PRE-ENRICHMENT-X6.3.
 *
 * Reconstruye OFFLINE la forma de la certificación `f6cad05f-570f-4791-8879-
 * 4c803932349b` (CO × Retail): 5 enrichments pagados, y 2 de ellos —
 * `intercartagena.com` y `copadeg.com` — a empresas que el gate OBLIGATORIO de
 * ownership rechazó inmediatamente después.
 *
 * El defecto que fija esta suite: el gate final sólo se resolvía antes de pagar
 * `if (candidate.eligible)`, y `isEligible` exige `sector_evidence_confirmed`.
 * Los contendientes del enrichment son, por definición, los que NO lo tienen.
 *
 * Lo que esta suite NO permite: convertir «falta sector» en un bloqueo de gasto.
 * Un ownership APROBADO con sector ausente sigue pagando — es para lo que existe
 * el enrichment.
 *
 * Sin red, sin Apollo, sin Lusha, sin Supabase, sin créditos reales.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  runApolloTwoRoundDiscovery,
  type ApolloTwoRoundDeps,
  type CheapAssessment,
  type EnrichmentResult,
  type RawDiscoveredOrganization,
  type ApolloTwoRoundRunResult,
} from '../orchestrator';
import {
  selectCandidatesForEnrichment,
  evaluateApolloEnrichmentNeed,
  type FreeCandidateSignals,
} from '../enrichment-ranking';
import {
  testConfig,
  testCorrelation,
  testQueryContext,
  simulatedEffectiveRequestBuilder,
  org,
  passingAssessment,
  ambiguousAssessment,
} from './fixtures';

// ─── Arnés: la corrida f6cad05f, con las señales que Producción registró ──────

/**
 * Las cinco empresas que RECIBIERON enrichment en `f6cad05f`, con las señales
 * gratuitas exactas de su fila en `candidate_snapshots` y el veredicto real de
 * ownership de su fila en `prospect_discarded_dispositions`.
 *
 * `ownershipConfident: true` en las CINCO — incluidas las dos que el gate
 * obligatorio rechazó. Es el testigo de que esa señal no es el veredicto.
 */
type HistoricalCase = {
  readonly id: string;
  readonly providerRank: number;
  readonly sectorConfirmedForFree: boolean;
  readonly ownershipAllowed: boolean;
  /** Qué devolvió el enrichment cuando se pagó, en la corrida real. */
  readonly sectorAfterEnrichment:
    | 'sector_evidence_confirmed'
    | 'sector_evidence_contradictory';
};

const F6CAD05F: readonly HistoricalCase[] = [
  // sector confirmado GRATIS + employee_count ausente ⇒ elegible, ownership ya
  // resuelto antes de pagar incluso ANTES de este corte. Siguen pagando.
  { id: 'caribe_supermercados', providerRank: 5, sectorConfirmedForFree: true, ownershipAllowed: true, sectorAfterEnrichment: 'sector_evidence_confirmed' },
  { id: 'primavera', providerRank: 11, sectorConfirmedForFree: true, ownershipAllowed: true, sectorAfterEnrichment: 'sector_evidence_confirmed' },
  // sector AUSENTE + ownership APROBADO ⇒ el enrichment sí resuelve algo. Su
  // compra reveló una contradicción sectorial: dinero bien gastado.
  { id: 'pqp', providerRank: 9, sectorConfirmedForFree: false, ownershipAllowed: true, sectorAfterEnrichment: 'sector_evidence_contradictory' },
  // 🔴 Los dos créditos del defecto: sector AUSENTE + ownership RECHAZADO.
  { id: 'intercontinental_cartagena', providerRank: 13, sectorConfirmedForFree: false, ownershipAllowed: false, sectorAfterEnrichment: 'sector_evidence_confirmed' },
  { id: 'copadpharma', providerRank: 7, sectorConfirmedForFree: false, ownershipAllowed: false, sectorAfterEnrichment: 'sector_evidence_confirmed' },
];

const CASE_BY_ID = new Map(F6CAD05F.map((entry) => [entry.id, entry] as const));

/** Las señales gratuitas de las cinco, tal como las registró la corrida. */
const HISTORICAL_SIGNALS = {
  countryCompatible: true,
  domainConfident: true,
  // 🔴 `true` también para las dos que ownership rechazó: es literalmente
  // `eligibility.eligible && domainSource === 'asserted'`, y no dice nada del
  // veredicto del gate.
  ownershipConfident: true,
  novel: true,
  hasCompanySizeSignal: false,
  hasLocationSignal: false,
  hasLinkedInUrl: true,
  freeOfContradictoryEvidence: true,
  knownDuplicate: false,
  cooldownActive: false,
} as const;

function assessmentFor(id: string): CheapAssessment {
  const entry = CASE_BY_ID.get(id);
  const signals = {
    ...HISTORICAL_SIGNALS,
    sectorKeywordMatchCount: entry?.sectorConfirmedForFree ? 2 : 0,
  };
  return entry?.sectorConfirmedForFree
    ? passingAssessment({ signals })
    : ambiguousAssessment({ signals });
}

type Harness = {
  result: ApolloTwoRoundRunResult;
  /** Un elemento por llamada PAGADA a `organization_enrichment`. */
  enrichCalls: string[];
  /** Un elemento por invocación del gate obligatorio de ownership. */
  finalGateCalls: string[];
  creditsSpent: number;
};

async function runHistoricalFixture(
  options: { readonly maxEnrichmentsPerRun?: number } = {},
): Promise<Harness> {
  const enrichCalls: string[] = [];
  const finalGateCalls: string[] = [];
  let creditsSpent = 0;

  const organizations: RawDiscoveredOrganization[] = F6CAD05F.map((entry) =>
    org(entry.id, { providerRank: entry.providerRank }),
  );

  const deps: ApolloTwoRoundDeps = {
    buildRoundProviderRequest: simulatedEffectiveRequestBuilder(),
    searchRound: async () => ({
      organizations,
      providerRequestCount: 1,
      internalRecordedCredits: organizations.length,
      providerTotalPages: 1,
    }),
    assessCandidate: ({ organization }) =>
      assessmentFor(organization.providerOrganizationId ?? ''),
    enrichCandidate: async ({ candidateKey }): Promise<EnrichmentResult> => {
      enrichCalls.push(candidateKey);
      creditsSpent += 1;
      const id = candidateKey.replace(/^apollo:/, '');
      return {
        executed: true,
        internalRecordedCredits: 1,
        sectorEvidenceState:
          CASE_BY_ID.get(id)?.sectorAfterEnrichment ?? 'sector_evidence_confirmed',
        providerCompanyFields: { employeeCountStatus: 'confirmed', linkedinStatus: 'confirmed' },
      };
    },
    // El gate OBLIGATORIO, con el veredicto REAL de `evaluateCompanyOwnership`
    // sobre cada par nombre↔dominio de la corrida. Gratis por contrato.
    applyFinalGates: ({ candidateKey }) => {
      finalGateCalls.push(candidateKey);
      const id = candidateKey.replace(/^apollo:/, '');
      const allowed = CASE_BY_ID.get(id)?.ownershipAllowed ?? true;
      return { rejection: allowed ? null : ('ownership_mismatch' as const) };
    },
  };

  const result = await runApolloTwoRoundDiscovery(
    {
      config: testConfig({
        targetEligibleCompanies: 5,
        maxRounds: 1,
        maxResultsPerRound: 10,
        maxRawResultsPerRun: 10,
        maxEnrichmentsPerRun: options.maxEnrichmentsPerRun ?? 5,
      }),
      queryContext: testQueryContext(),
      correlation: testCorrelation(),
    },
    deps,
  );

  return { result, enrichCalls, finalGateCalls, creditsSpent };
}

const key = (id: string): string => `apollo:${id}`;

// ─── § 1 — el gate obligatorio corre ANTES de la caja ────────────────────────

describe('X6.3 § 1 · ownership se resuelve antes del enrichment pagado', () => {
  test('3. un candidato con sector AUSENTE también pasa por el gate de ownership', async () => {
    const { finalGateCalls } = await runHistoricalFixture();
    for (const entry of F6CAD05F.filter((c) => !c.sectorConfirmedForFree)) {
      assert.ok(
        finalGateCalls.includes(key(entry.id)),
        `${entry.id} compite por enrichment: el gate obligatorio tiene que haberlo evaluado`,
      );
    }
  });

  test('el gate obligatorio se invoca a lo sumo UNA vez por candidato', async () => {
    const { finalGateCalls } = await runHistoricalFixture();
    assert.equal(
      finalGateCalls.length,
      new Set(finalGateCalls).size,
      '`finalGateEvaluated` es la idempotencia de la INVOCACIÓN y tiene que sostenerse',
    );
  });
});

// ─── § 2 — ownership rechazado ⇒ 0 créditos ─────────────────────────────────

describe('X6.3 § 2 · ownership rechazado ⇒ ningún enrichment pagado', () => {
  test('1/4. sector ausente + ownership rechazado ⇒ paid enrichment calls = 0', async () => {
    const { enrichCalls } = await runHistoricalFixture();
    for (const entry of F6CAD05F.filter((c) => !c.ownershipAllowed)) {
      assert.equal(
        enrichCalls.includes(key(entry.id)),
        false,
        `${entry.id} murió por ownership: ningún crédito puede haber salido por él`,
      );
    }
  });

  test('13. caso histórico InterContinental Cartagena → no paga', async () => {
    const { enrichCalls, finalGateCalls, result } = await runHistoricalFixture();
    assert.ok(finalGateCalls.includes(key('intercontinental_cartagena')));
    assert.equal(enrichCalls.includes(key('intercontinental_cartagena')), false);
    assert.equal(
      result.enrichmentSelections.some((s) => s.candidateKey === key('intercontinental_cartagena')),
      false,
      'ni siquiera puede ser SELECCIONADO: el rechazo ocurre antes de la selección',
    );
  });

  test('14. caso histórico COPADPHARMA → no paga', async () => {
    const { enrichCalls, finalGateCalls, result } = await runHistoricalFixture();
    assert.ok(finalGateCalls.includes(key('copadpharma')));
    assert.equal(enrichCalls.includes(key('copadpharma')), false);
    assert.equal(
      result.enrichmentSelections.some((s) => s.candidateKey === key('copadpharma')),
      false,
    );
  });

  test('el rechazo NO depende de que quede presupuesto: con cap 5 y 5 contendientes, siguen sin pagar', async () => {
    const { enrichCalls } = await runHistoricalFixture({ maxEnrichmentsPerRun: 5 });
    assert.equal(enrichCalls.includes(key('intercontinental_cartagena')), false);
    assert.equal(enrichCalls.includes(key('copadpharma')), false);
    assert.equal(enrichCalls.length, 3, 'caribe + primavera + pqp, y sólo esos tres');
  });
});

// ─── § 3 — NO se convierte en bloqueo indiscriminado ────────────────────────

describe('X6.3 § 3 · ownership aprobado ⇒ el enrichment sigue permitido', () => {
  test('2/5. sector ausente + ownership APROBADO ⇒ sigue compitiendo y sigue pagando', async () => {
    const { enrichCalls } = await runHistoricalFixture();
    assert.ok(
      enrichCalls.includes(key('pqp')),
      'PQP tiene el sector sin resolver y el ownership limpio: es exactamente para lo que existe el enrichment',
    );
  });

  test('6/8. el enrichment sigue pudiendo CAMBIAR el sector después del gate de ownership', async () => {
    const { result, enrichCalls } = await runHistoricalFixture();
    assert.ok(enrichCalls.includes(key('pqp')));
    const pqp = result.evaluatedCandidates.find((c) => c.candidateKey === key('pqp'));
    assert.ok(pqp, 'PQP tiene que seguir existiendo como candidato evaluado');
    assert.equal(
      pqp.sectorEvidenceState,
      'sector_evidence_contradictory',
      'el veredicto sectorial que compró su crédito tiene que seguir llegando',
    );
    assert.equal(
      pqp.definitiveRejectionReason,
      'sector_evidence_contradictory',
      'y su causa de muerte es SECTORIAL, no de ownership',
    );
  });

  test('7. «falta sector» por sí solo NUNCA bloquea el gasto', async () => {
    const needed = evaluateApolloEnrichmentNeed({
      candidateKey: 'apollo:sector-missing-ownership-ok',
      roundNumber: 1,
      providerRank: 1,
      ...HISTORICAL_SIGNALS,
      sectorKeywordMatchCount: 0,
      sectorEvidenceState: 'sector_evidence_missing_needs_enrichment',
      declaredSectorContradiction: false,
    });
    assert.equal(needed.eligibleForEnrichment, true);
    assert.equal(needed.disqualifiedReason, null);
  });

  test('las dos que ya pagaban antes del corte siguen pagando', async () => {
    const { enrichCalls } = await runHistoricalFixture();
    assert.ok(enrichCalls.includes(key('caribe_supermercados')));
    assert.ok(enrichCalls.includes(key('primavera')));
  });
});

// ─── § 4 — regresión de GASTO: antes 5, después 3 ───────────────────────────

describe('X6.3 § 4 · regresión de gasto sobre el fixture f6cad05f', () => {
  /** La lista que la selección recibía ANTES del corte: nadie había mirado ownership. */
  function preCutContenders(): FreeCandidateSignals[] {
    return F6CAD05F.map((entry) => ({
      candidateKey: key(entry.id),
      roundNumber: 1,
      providerRank: entry.providerRank,
      ...HISTORICAL_SIGNALS,
      sectorKeywordMatchCount: entry.sectorConfirmedForFree ? 2 : 0,
      sectorEvidenceState: entry.sectorConfirmedForFree
        ? ('sector_evidence_confirmed' as const)
        : ('sector_evidence_missing_needs_enrichment' as const),
      declaredSectorContradiction: false,
    }));
  }

  test('ANTES: los cinco compiten y los cinco se llevan un crédito', () => {
    const before = selectCandidatesForEnrichment({
      candidates: preCutContenders(),
      remainingEnrichmentBudget: 5,
      eligibleCompaniesSoFar: 0,
      targetEligibleCompanies: 5,
    });
    assert.equal(before.selected.length, 5, 'la corrida real pagó 5 enrichments');
    for (const entry of F6CAD05F.filter((c) => !c.ownershipAllowed)) {
      assert.ok(
        before.selected.some((s) => s.candidateKey === key(entry.id)),
        `${entry.id} era seleccionable: es el defecto que este corte cierra`,
      );
    }
  });

  test('DESPUÉS: 3 enrichments · credits_saved = 2 · provider_calls_saved = 2', async () => {
    const { enrichCalls, creditsSpent } = await runHistoricalFixture();
    const BEFORE_CALLS = 5;
    const BEFORE_CREDITS = 5;
    assert.equal(enrichCalls.length, 3);
    assert.equal(creditsSpent, 3);
    assert.equal(BEFORE_CALLS - enrichCalls.length, 2, 'provider_calls_saved');
    assert.equal(BEFORE_CREDITS - creditsSpent, 2, 'credits_saved');
  });

  test('9. el caso mínimo del reporte: 1 rechazado + 1 limpio ⇒ credits_saved = 1', async () => {
    const enrichCalls: string[] = [];
    const deps: ApolloTwoRoundDeps = {
      buildRoundProviderRequest: simulatedEffectiveRequestBuilder(),
      searchRound: async () => ({
        organizations: [
          org('owned', { providerRank: 1 }),
          org('not_owned', { providerRank: 2 }),
        ],
        providerRequestCount: 1,
        internalRecordedCredits: 2,
        providerTotalPages: 1,
      }),
      assessCandidate: () =>
        ambiguousAssessment({
          signals: { ...HISTORICAL_SIGNALS, sectorKeywordMatchCount: 0 },
        }),
      enrichCandidate: async ({ candidateKey }): Promise<EnrichmentResult> => {
        enrichCalls.push(candidateKey);
        return {
          executed: true,
          internalRecordedCredits: 1,
          sectorEvidenceState: 'sector_evidence_confirmed',
          providerCompanyFields: { employeeCountStatus: 'confirmed', linkedinStatus: 'confirmed' },
        };
      },
      applyFinalGates: ({ candidateKey }) => ({
        rejection: candidateKey === key('not_owned') ? ('ownership_mismatch' as const) : null,
      }),
    };

    await runApolloTwoRoundDiscovery(
      {
        config: testConfig({
          targetEligibleCompanies: 5,
          maxRounds: 1,
          maxResultsPerRound: 5,
          maxRawResultsPerRun: 5,
          maxEnrichmentsPerRun: 2,
        }),
        queryContext: testQueryContext(),
        correlation: testCorrelation(),
      },
      deps,
    );

    assert.deepEqual(enrichCalls, [key('owned')]);
    assert.equal(2 - enrichCalls.length, 1, 'credits_saved = provider_calls_saved = 1');
  });
});

// ─── § 5 — contabilidad: nada se cuenta dos veces, nadie desaparece ─────────

describe('X6.3 § 5 · contabilidad intacta', () => {
  test('7bis. el rechazo por ownership se cuenta EXACTAMENTE una vez por candidato', async () => {
    const { result } = await runHistoricalFixture();
    const ownershipRejectedInRounds = result.rounds.reduce(
      (total, round) => total + round.ownershipRejected,
      0,
    );
    assert.equal(
      ownershipRejectedInRounds,
      F6CAD05F.filter((c) => !c.ownershipAllowed).length,
      '`rejectionTallied` tiene que impedir que adelantar el gate duplique el conteo',
    );
  });

  test('8. el candidato rechazado NO desaparece: sigue evaluado y con causa nombrada', async () => {
    const { result } = await runHistoricalFixture();
    for (const entry of F6CAD05F.filter((c) => !c.ownershipAllowed)) {
      const candidate = result.evaluatedCandidates.find((c) => c.candidateKey === key(entry.id));
      assert.ok(candidate, `${entry.id} tiene que seguir en evaluatedCandidates`);
      assert.equal(candidate.definitivelyRejected, true);
      assert.equal(candidate.definitiveRejectionReason, 'ownership_mismatch');
      assert.equal(candidate.enrichmentExecuted, false, 'y sin haber gastado nada');
    }
    assert.equal(
      result.evaluatedCandidates.length,
      F6CAD05F.length,
      'las cinco siguen existiendo: el corte adelanta un veredicto, no borra empresas',
    );
  });

  test('`ownership_mismatch` aparece una sola vez en los motivos observados', async () => {
    const { result } = await runHistoricalFixture();
    assert.equal(
      result.observedRejectionReasons.filter((r) => r === 'ownership_mismatch').length,
      1,
      'es un conjunto: repetirlo delataría dos caminos de marcado',
    );
  });

  test('9bis. el objetivo NO se mueve', async () => {
    const { result } = await runHistoricalFixture();
    assert.equal(result.targetEligibleCompanies, 5);
    assert.equal(result.configuredTargetEligibleCompanies, 5);
    assert.equal(result.remainingTargetApplied, null);
  });

  test('10. el presupuesto de enrichment no se mueve: sólo cambia QUIÉN llega a gastarlo', async () => {
    const withCap2 = await runHistoricalFixture({ maxEnrichmentsPerRun: 2 });
    assert.equal(withCap2.enrichCalls.length, 2, 'el cap sigue mandando sobre los supervivientes');
    assert.equal(withCap2.enrichCalls.includes(key('intercontinental_cartagena')), false);
    assert.equal(withCap2.enrichCalls.includes(key('copadpharma')), false);
    assert.ok(
      withCap2.result.enrichmentSkips.some((s) => s.skippedReason === 'enrichment_cap_reached'),
      'el motivo del cap sigue emitiéndose para quien sí competía',
    );
  });
});

// ─── § 6 — MUTACIONES ───────────────────────────────────────────────────────

describe('X6.3 § 6 · mutaciones', () => {
  /** El cuerpo del orquestador, sin comentarios: las guardas leen CÓDIGO. */
  function orchestratorSource(): string {
    const raw = fs.readFileSync(
      path.join(process.cwd(), 'src/server/agents/prospecting-toolkit/apollo-two-round/orchestrator.ts'),
      'utf8',
    );
    return raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .map((line) => {
        const idx = line.indexOf('//');
        return idx === -1 ? line : line.slice(0, idx);
      })
      .join('\n');
  }

  test('M1. `scanFinalizability` no puede volver a ser el ÚNICO alimentador del gate', () => {
    const source = orchestratorSource();
    const invocations = source.match(/ensureFinalGateEvaluated\s*\(/g) ?? [];
    assert.ok(
      invocations.length >= 3,
      'son tres sitios: la definición no cuenta — scanFinalizability, el pre-check de gasto y el barrido final',
    );
    const collapsed = source.replace(/\s+/g, ' ');
    assert.ok(
      collapsed.includes(
        'if (competesForPaidEnrichment(candidate)) await ensureFinalGateEvaluated(candidate);',
      ),
      'el pre-check tiene que recorrer EXACTAMENTE a quien compite por el enrichment',
    );
    assert.ok(
      collapsed.includes('.filter(competesForPaidEnrichment)'),
      'y la selección tiene que leer ESE MISMO predicado, no una copia',
    );
    assert.equal(
      (collapsed.match(/const competesForPaidEnrichment/g) ?? []).length,
      1,
      'una sola definición: dos serían dos listas que pueden divergir',
    );
  });

  test('M2/M4. sin pre-check, el ownership-rechazado vuelve a entrar a la caja', () => {
    // La mutación se expresa como el estado que el pre-check produce: si NADIE
    // marca `definitivelyRejected` antes de la selección, la lista que llega a
    // `selectCandidatesForEnrichment` es la de antes del corte y el rechazado
    // gana un crédito.
    const withoutPreCheck = selectCandidatesForEnrichment({
      candidates: [
        {
          candidateKey: key('intercontinental_cartagena'),
          roundNumber: 1,
          providerRank: 13,
          ...HISTORICAL_SIGNALS,
          sectorKeywordMatchCount: 0,
          sectorEvidenceState: 'sector_evidence_missing_needs_enrichment',
          declaredSectorContradiction: false,
        },
      ],
      remainingEnrichmentBudget: 1,
      eligibleCompaniesSoFar: 0,
      targetEligibleCompanies: 5,
    });
    assert.equal(withoutPreCheck.selected.length, 1, 'el ranking por sí solo NO lo detiene');
    assert.equal(
      withoutPreCheck.skipped.length,
      0,
      'y no emite ningún motivo de exclusión: ownership no es un descalificador del gasto',
    );
  });

  test('M3. `ownershipConfident` no puede sustituir al veredicto del gate', async () => {
    const { enrichCalls, result } = await runHistoricalFixture();
    // Las dos bloqueadas llevaban `ownershipConfident: true`. Si el corte se
    // hubiera cableado a esa señal, las dos habrían pagado igual.
    assert.equal(HISTORICAL_SIGNALS.ownershipConfident, true);
    assert.equal(enrichCalls.includes(key('intercontinental_cartagena')), false);
    assert.equal(enrichCalls.includes(key('copadpharma')), false);
    const source = orchestratorSource();
    assert.equal(
      /ownershipConfident/.test(source),
      false,
      'el orquestador no debe leer esa señal para decidir nada de ownership',
    );
    assert.equal(result.evaluatedCandidates.length, F6CAD05F.length);
  });

  test('M5. duplicar el conteo del rechazo rompería § 5', async () => {
    const { result } = await runHistoricalFixture();
    const tallied = result.rounds.reduce((total, r) => total + r.ownershipRejected, 0);
    assert.notEqual(tallied, 4, 'cuatro sería exactamente el doble: dos caminos sumando el mismo rechazo');
    assert.equal(tallied, 2);
  });

  test('M6. bloquear a un ownership APROBADO rompería § 3', async () => {
    const { enrichCalls } = await runHistoricalFixture();
    const allowedIds = F6CAD05F.filter((c) => c.ownershipAllowed).map((c) => key(c.id));
    for (const id of allowedIds) assert.ok(enrichCalls.includes(id), `${id} tiene que poder pagar`);
    assert.equal(
      enrichCalls.length,
      allowedIds.length,
      'ni uno menos (el corte bloquearía de más) ni uno más (el corte no bloquearía nada)',
    );
  });

  test('M7. bloquear por «sector ausente» rompería § 3', async () => {
    const { enrichCalls } = await runHistoricalFixture();
    assert.ok(
      enrichCalls.includes(key('pqp')),
      'PQP no tiene sector y sí tiene ownership: si deja de pagar, el corte se convirtió en otro gate',
    );
  });
});

// ─── § 7 — el corte NO toca la regla de ownership ───────────────────────────

describe('X6.3 § 7 · la regla de ownership no se mueve', () => {
  test('el orquestador no conoce `evaluateCompanyOwnership` ni ninguna heurística propia', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/server/agents/prospecting-toolkit/apollo-two-round/orchestrator.ts'),
      'utf8',
    );
    assert.equal(/evaluateCompanyOwnership/.test(source), false);
    assert.equal(/isBlockedByCompanyOwnership/.test(source), false);
    assert.equal(/isStrongNameDomainMismatch/.test(source), false);
    assert.equal(
      /provider\s*===\s*['"]apollo/.test(source),
      false,
      'ninguna regla de negocio puede depender del nombre del proveedor',
    );
  });

  test('el gate sigue llegando por inyección: `deps.applyFinalGates` y nada más', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/server/agents/prospecting-toolkit/apollo-two-round/orchestrator.ts'),
      'utf8',
    );
    assert.ok(/deps\.applyFinalGates/.test(source));
  });

  test('sin `applyFinalGates` inyectado el pre-check no existe y nada cambia (suites puras)', async () => {
    const enrichCalls: string[] = [];
    const deps: ApolloTwoRoundDeps = {
      buildRoundProviderRequest: simulatedEffectiveRequestBuilder(),
      searchRound: async () => ({
        organizations: [org('solo', { providerRank: 1 })],
        providerRequestCount: 1,
        internalRecordedCredits: 1,
        providerTotalPages: 1,
      }),
      assessCandidate: () =>
        ambiguousAssessment({ signals: { ...HISTORICAL_SIGNALS, sectorKeywordMatchCount: 0 } }),
      enrichCandidate: async ({ candidateKey }): Promise<EnrichmentResult> => {
        enrichCalls.push(candidateKey);
        return {
          executed: true,
          internalRecordedCredits: 1,
          sectorEvidenceState: 'sector_evidence_confirmed',
          providerCompanyFields: { employeeCountStatus: 'confirmed', linkedinStatus: 'confirmed' },
        };
      },
    };
    await runApolloTwoRoundDiscovery(
      {
        config: testConfig({
          targetEligibleCompanies: 5,
          maxRounds: 1,
          maxResultsPerRound: 5,
          maxRawResultsPerRun: 5,
          maxEnrichmentsPerRun: 1,
        }),
        queryContext: testQueryContext(),
        correlation: testCorrelation(),
      },
      deps,
    );
    assert.deepEqual(enrichCalls, [key('solo')], 'el contrato «ausente ⇒ sin gates finales» se conserva');
  });
});
