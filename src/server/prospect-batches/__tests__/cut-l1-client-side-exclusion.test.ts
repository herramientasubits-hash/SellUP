/**
 * AGENT1-LUSHA-CUT-L1-CLIENT-SIDE-EXCLUSION § 10 — la suite dedicada del corte.
 *
 * ── El hecho HUMANO que gobierna todo esto ───────────────────────────────────
 *
 * El soporte de Lusha confirmó, por un humano, que
 * `POST /v3/companies/prospecting` NO soporta un array de exclusión del lado del
 * servidor: no existe `excludeDomains` y no existe `excludeCompanyIds`. El repo
 * afirmaba lo contrario —`filters.companies.exclude.domains` como «contrato
 * verificado»— y emitía ese bloque en Producción.
 *
 * ── Lo que este corte SÍ hace ────────────────────────────────────────────────
 *
 *   1. la petición cumple el contrato: sólo filtros de INCLUSIÓN;
 *   2. la protección económica sobrevive, movida al CLIENTE: los dominios ya
 *      conocidos siembran `lusha-run-identity-registry`;
 *   3. una empresa ya conocida no cuenta como net-new y no arrastra trabajo
 *      pagado aguas abajo (gate + costura oficial).
 *
 * ── 🔴 Lo que este corte NO hace, y no se afirma en ninguna prueba ───────────
 *
 * Ahorrar el crédito de Prospecting de una empresa histórica. Sin exclusión previa
 * al cobro, la respuesta llega —y puede cobrarse— ANTES de que se la reconozca.
 * Cualquier prueba que dijera «se ahorró un crédito» aquí sería falsa.
 *
 * `persistLushaPendingReviewBatch` es puro y todo entra inyectado: aquí no hay
 * red, ni DB, ni cliente de Lusha, ni un solo crédito real.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  persistLushaPendingReviewBatch,
  type LushaMultiBranchExecution,
  type LushaPendingReviewBatchRow,
  type LushaPendingReviewCandidateRow,
  type PersistLushaPendingReviewDeps,
} from '@/server/prospect-batches/lusha-pending-review';
import {
  LUSHA_PENDING_REVIEW_EXPECTED_MAX_CREDITS,
  LUSHA_PENDING_REVIEW_MAX_PAGES,
  LUSHA_PENDING_REVIEW_MIN_USEFUL_CANDIDATES,
} from '@/server/prospect-batches/lusha-pending-review-limits';
import {
  LUSHA_PREVIEW_MAX_PAGE,
  LUSHA_PREVIEW_SIZE,
  buildLushaPreviewRequest,
  type LushaPreviewCompany,
  type LushaPreviewInput,
  type LushaPreviewResult,
} from '@/server/prospect-batches/lusha-preview';
import {
  createLushaRunIdentityRegistry,
  dedupeLushaCompaniesByIdentity,
  evaluateLushaCompanyIdentity,
  registerLushaCompanyIdentity,
  seedLushaKnownDomains,
  toLushaIdentityRegistrySnapshot,
} from '@/server/prospect-batches/lusha-run-identity-registry';
import { planProviderExclusions } from '@/modules/prospect-batches/provider-seen/provider-exclusion-planner';
import { PREPAID_EXCLUSION_DOMAIN_CAP } from '@/modules/prospect-batches/prepaid-novelty/provider-exclusion-domains';
import type {
  DuplicateCheckInput,
  DuplicateCheckResult,
} from '@/server/agents/prospecting-toolkit/types';

import { preM126FencedInsert } from '@/server/prospect-batches/__tests__/support/lusha-pre-m126-fenced-insert';
import { preM126BatchEpochSnapshot } from '@/server/prospect-batches/__tests__/support/lusha-batch-epoch-snapshot';

// ── Fixtures ──────────────────────────────────────────────────────────────────

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
  requestedTarget: LUSHA_PENDING_REVIEW_MIN_USEFUL_CANDIDATES,
};

function company(overrides: Partial<LushaPreviewCompany> = {}): LushaPreviewCompany {
  return {
    providerCompanyId: null,
    name: 'Empresa',
    domain: null,
    country: 'Colombia',
    countryIso2: 'CO',
    industry: 'Hospitals & Clinics',
    employeesExact: 300,
    employeesMin: null,
    employeesMax: null,
    linkedinUrl: null,
    score: 92,
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
      sector: 'Salud',
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

/**
 * Deps con dobles que CUENTAN. `duplicateChecks` es la medida de «trabajo pagado
 * aguas abajo»: es el primer paso posterior al dedupe, y si una empresa ya
 * conocida llega hasta él, el corte no ha hecho su trabajo.
 */
function makeDeps(script: LushaPreviewResult[]) {
  const searchInputs: LushaPreviewInput[] = [];
  const batches: LushaPendingReviewBatchRow[] = [];
  const candidateRows: LushaPendingReviewCandidateRow[] = [];
  const duplicateChecks: DuplicateCheckInput[] = [];

  const deps: PersistLushaPendingReviewDeps = {
    runSearch: async (input) => {
      searchInputs.push(input);
      return script[searchInputs.length - 1] ?? successResult([]);
    },
    reserveBatch: async (row) => {
      batches.push(row);
      return { id: `batch-${batches.length}`, adopted: false, identityEpoch: 0 };
    },
    insertCandidatesFenced: preM126FencedInsert,
    readBatchIdentityEpoch: preM126BatchEpochSnapshot,
    insertCandidates: async (rows) => {
      candidateRows.push(...rows);
      return { insertedCount: rows.length };
    },
    checkCompanyDuplicate: async (input) => {
      duplicateChecks.push(input);
      return noDuplicate(input);
    },
    fetchActiveCandidates: async () => [],
  };

  return { deps, searchInputs, batches, candidateRows, duplicateChecks };
}

function run(script: LushaPreviewResult[], execution?: LushaMultiBranchExecution) {
  const harness = makeDeps(script);
  return persistLushaPendingReviewBatch(harness.deps, INPUT, ACTOR, undefined, execution).then(
    (res) => ({ res, ...harness }),
  );
}

/**
 * La ejecución tal y como la arma la acción real: el plan de exclusión de la
 * puerta previa al pago viaja entero, y de su dimensión de dominios sale la
 * siembra CLIENTE.
 */
function executionKnowing(
  knownDomains: readonly string[],
  source: 'provider_seen' | 'sellup_known' | 'hubspot_local' | 'free_source_accepted',
): LushaMultiBranchExecution {
  const key = {
    provider_seen: 'providerSeenDomains',
    sellup_known: 'sellupKnownDomains',
    hubspot_local: 'hubspotLocalDomains',
    free_source_accepted: 'freeSourceAcceptedDomains',
  }[source];
  return {
    providerExclusionPlan: planProviderExclusions('lusha', { [key]: knownDomains }),
  };
}

// ── L1-A · la petición ────────────────────────────────────────────────────────

describe('L1-A · la petición al proveedor', () => {
  it('🔴 nunca emite `filters.companies.exclude`, en ninguna forma', () => {
    const request = buildLushaPreviewRequest({
      countryName: 'Colombia',
      mainIndustriesIds: [11],
      subIndustryId: null,
      sizeBand: { min: 201, max: 5000 },
      searchText: null,
      page: 0,
    });

    const companies = (request as unknown as Record<string, Record<string, unknown>>).filters
      .companies as Record<string, unknown>;
    assert.deepEqual(Object.keys(companies), ['include']);
    assert.equal(companies.exclude, undefined);
  });

  it('🔴 y el ejecutor tampoco añade exclusión por su cuenta, aun conociendo dominios', async () => {
    const { searchInputs } = await run(
      [successResult([company({ providerCompanyId: 'p-1', name: 'Nueva', domain: 'nueva.com' })])],
      executionKnowing(['conocida.com', 'otra.example'], 'sellup_known'),
    );

    // Se afirma sobre TODAS las peticiones de la corrida, no sólo la primera: el
    // objetivo queda abierto y el ejecutor pide su segunda página, y una exclusión
    // colada sólo en la página 1 sería igual de falsa.
    assert.ok(searchInputs.length >= 1);
    for (const input of searchInputs) {
      const serialized = JSON.stringify(input);
      for (const forbidden of ['exclude', 'excludeDomains', 'excludeCompanyIds']) {
        assert.ok(
          !serialized.includes(forbidden),
          `🔴 ${forbidden} llegó a la entrada del preview`,
        );
      }
    }
  });
});

// ── L1-B · la telemetría de capacidad ────────────────────────────────────────

describe('L1-B · «nada enviado» no puede leerse como «nada conocido»', () => {
  it('🔴 available > 0, sent = 0, omitido por CAPACIDAD, y el motivo dicho', () => {
    const plan = planProviderExclusions('lusha', {
      providerSeenDomains: ['vista.example'],
      sellupKnownDomains: ['cuenta.example'],
      hubspotLocalDomains: ['crm.example'],
      freeSourceAcceptedDomains: ['gratis.example'],
    });

    assert.equal(plan.domains.available, 4);
    assert.equal(plan.domains.availableValues.length, 4);
    assert.equal(plan.domains.sent.length, 0);
    assert.equal(plan.domains.omittedDueToCapability, plan.domains.available);
    assert.equal(plan.domains.omittedDueToCap, 0);
    assert.equal(
      plan.domains.unsupportedReason,
      'lusha_v3_no_server_side_exclusion_human_confirmed',
    );
    // La dimensión de ids dice lo mismo, por el mismo hecho.
    assert.equal(
      plan.ids.unsupportedReason,
      'lusha_v3_no_server_side_exclusion_human_confirmed',
    );
  });

  it('🔴 y la corrida publica cuántos conocidos sembró, no sólo el cero enviado', async () => {
    const { res } = await run(
      [successResult([company({ providerCompanyId: 'p-1', name: 'Nueva', domain: 'nueva.com' })])],
      executionKnowing(['conocida.com', 'otra.example'], 'sellup_known'),
    );

    assert.equal(res.multiBranch?.localKnownSeedCount, 2, 'se sembraron los 2 conocidos');
    assert.equal(res.multiBranch?.localKnownSuppressedTotal, 0, 'ninguno volvió del proveedor');
  });
});

// ── L1-C · la protección local sobrevive ─────────────────────────────────────

describe('L1-C · una empresa ya conocida NO cuenta como net-new', () => {
  it('🔴 el proveedor la devuelve, el registro la rechaza, el objetivo no avanza', async () => {
    // El proveedor devuelve 2 empresas: una conocida y una nueva. La página ya
    // pudo cobrar su crédito —CUT-L1 no puede evitarlo— y aun así la conocida no
    // puede cerrar hueco.
    const { res, candidateRows, duplicateChecks } = await run(
      [
        successResult([
          company({ providerCompanyId: 'p-known', name: 'Conocida', domain: 'conocida.com' }),
          company({ providerCompanyId: 'p-new', name: 'Nueva', domain: 'nueva.com' }),
        ]),
      ],
      executionKnowing(['conocida.com'], 'sellup_known'),
    );

    // 🔴 No contó como net-new.
    assert.equal(res.usefulCandidatesCount, 1, 'sólo la nueva es útil');
    assert.equal(res.multiBranch?.acceptedForTargetTotal, 1);
    assert.deepEqual(
      candidateRows.map((r) => r.name),
      ['Nueva'],
      '🔴 la conocida no se persiste',
    );

    // 🔴 Y no arrastró trabajo pagado aguas abajo: la paridad de duplicados y la
    // costura oficial corren DESPUÉS del dedupe, así que nunca la vieron.
    assert.equal(duplicateChecks.length, 1);
    assert.equal(duplicateChecks[0]?.domain, 'nueva.com');

    // 🔴 Contada como supresión LOCAL, no como duplicado de corrida: el proveedor
    // no repitió nada, la empresa ya era nuestra.
    assert.equal(res.multiBranch?.localKnownSuppressedTotal, 1);
    assert.equal(res.multiBranch?.crossBranchDuplicatesRemoved, 0);
    assert.equal(res.multiBranch?.duplicateReasonCounts.known_domain_seed, 1);
    assert.equal(res.multiBranch?.duplicateReasonCounts.normalized_domain, 0);

    // 🔴 Y la corrida sigue buscando el hueco residual con los límites de SIEMPRE.
    assert.equal(res.multiBranch?.remainingGapFinal, ACTOR.requestedTarget - 1);
    assert.ok(
      (res.multiBranch?.providerRequestsUsed ?? 0) <= LUSHA_PENDING_REVIEW_MAX_PAGES,
      '🔴 la supresión no compra páginas nuevas',
    );
  });

  it('🔴 la supresión suma a las omitidas: la UI no puede decir «0 omitidas»', async () => {
    const { res } = await run(
      [
        successResult([
          company({ providerCompanyId: 'p-known', name: 'Conocida', domain: 'conocida.com' }),
        ]),
      ],
      executionKnowing(['conocida.com'], 'hubspot_local'),
    );

    assert.equal(res.usefulCandidatesCount, 0);
    assert.ok((res.skippedCount ?? 0) >= 1, '🔴 la fila retirada se cuenta como omitida');
  });

  it('sin conocidos que sembrar, la corrida es byte por byte la de antes del corte', async () => {
    const results = [
      company({ providerCompanyId: 'p-1', name: 'Una', domain: 'una.com' }),
      company({ providerCompanyId: 'p-2', name: 'Dos', domain: 'dos.com' }),
    ];

    const conPlanVacio = await run([successResult(results)], {
      providerExclusionPlan: planProviderExclusions('lusha', {}),
    });
    const sinEjecucion = await run([successResult(results)]);

    for (const outcome of [conPlanVacio, sinEjecucion]) {
      assert.equal(outcome.res.usefulCandidatesCount, 2);
      assert.equal(outcome.res.multiBranch?.localKnownSuppressedTotal, 0);
      assert.equal(outcome.res.multiBranch?.localKnownSeedCount, 0);
      assert.equal(outcome.duplicateChecks.length, 2);
    }
  });

  it('🔴 las cuatro procedencias de conocidos suprimen igual', async () => {
    for (const source of [
      'provider_seen',
      'sellup_known',
      'hubspot_local',
      'free_source_accepted',
    ] as const) {
      const { res } = await run(
        [
          successResult([
            company({ providerCompanyId: `p-${source}`, name: 'Conocida', domain: 'conocida.com' }),
          ]),
        ],
        executionKnowing(['conocida.com'], source),
      );

      assert.equal(res.usefulCandidatesCount, 0, `${source} no suprimió`);
      assert.equal(res.multiBranch?.localKnownSuppressedTotal, 1, `${source} no se contó`);
    }
  });
});

// ── L1-D · id de proveedor y dominio son evidencia INDEPENDIENTE ─────────────

describe('L1-D · id y dominio no se colapsan en una identidad combinada', () => {
  const known = seedLushaKnownDomains(createLushaRunIdentityRegistry(), ['conocida.com']);

  it('(1) mismo id de proveedor ⇒ duplicado de CORRIDA', () => {
    const first = company({ providerCompanyId: 'v1.same', name: 'A', domain: 'a.com' });
    const registry = registerLushaCompanyIdentity(
      createLushaRunIdentityRegistry(),
      // La identidad se resuelve al evaluar; registrar la del primero es lo que
      // hace el ejecutor tras aceptarlo.
      { providerCompanyId: 'v1.same', normalizedDomain: 'a.com', normalizedLinkedInUrl: null, normalizedName: 'a' },
    );

    const verdict = evaluateLushaCompanyIdentity(registry, {
      ...first,
      name: 'A distinta razón social',
      domain: 'otra-web.com',
    });
    assert.equal(verdict.outcome, 'duplicate');
    assert.equal(verdict.outcome === 'duplicate' ? verdict.reason : null, 'provider_company_id');
  });

  it('(2) id de Lusha CAMBIADO + mismo dominio normalizado ⇒ se reconoce igual', () => {
    // El id del proveedor no es una clave histórica: puede rotar. El dominio
    // conocido sigue reconociéndola, y con SU propio motivo.
    const verdict = evaluateLushaCompanyIdentity(known, {
      providerCompanyId: 'v1.id-nuevo-que-nunca-vimos',
      name: 'Conocida',
      domain: 'https://WWW.Conocida.com/quienes-somos',
      linkedinUrl: null,
    });
    assert.equal(verdict.outcome, 'duplicate');
    assert.equal(verdict.outcome === 'duplicate' ? verdict.reason : null, 'known_domain_seed');
  });

  it('(3) mismo id de Lusha + dominio DISTINTO ⇒ el dedupe de corrida sigue vivo', () => {
    const registry = registerLushaCompanyIdentity(createLushaRunIdentityRegistry(), {
      providerCompanyId: 'v1.aaa',
      normalizedDomain: 'primera.com',
      normalizedLinkedInUrl: null,
      normalizedName: 'primera',
    });

    const verdict = evaluateLushaCompanyIdentity(registry, {
      providerCompanyId: 'v1.aaa',
      name: 'Primera',
      domain: 'segunda.com',
      linkedinUrl: null,
    });
    assert.equal(verdict.outcome, 'duplicate');
    assert.equal(verdict.outcome === 'duplicate' ? verdict.reason : null, 'provider_company_id');
  });

  it('🔴 (4) id distinto + dominio distinto NO se rechaza sólo porque el nombre coincida', () => {
    // «Servicios Integrales S.A.S.» existe decenas de veces en Colombia. Con
    // dominio propio, dos homónimas son dos empresas.
    const registry = registerLushaCompanyIdentity(createLushaRunIdentityRegistry(), {
      providerCompanyId: 'v1.uno',
      normalizedDomain: 'integrales-uno.com',
      normalizedLinkedInUrl: null,
      normalizedName: 'servicios integrales sas',
    });

    const verdict = evaluateLushaCompanyIdentity(registry, {
      providerCompanyId: 'v1.dos',
      name: 'Servicios Integrales S.A.S.',
      domain: 'integrales-dos.com',
      linkedinUrl: null,
    });
    assert.equal(verdict.outcome, 'unique');
  });

  it('🔴 el id del proveedor NO se convierte en clave histórica por la siembra', () => {
    // La siembra es de DOMINIOS. Un id visto en corridas anteriores no puede
    // bloquear por sí solo: eso sería el «historical provider-ID hard block» que
    // CUT-L1 § 6 prohíbe.
    const snapshot = toLushaIdentityRegistrySnapshot(known);
    assert.equal(snapshot.known_seed_count, 1);
    assert.equal(snapshot.provider_company_id_count, 0);

    const verdict = evaluateLushaCompanyIdentity(known, {
      providerCompanyId: 'v1.visto-en-una-corrida-anterior',
      name: 'Nueva',
      domain: 'nueva.com',
      linkedinUrl: null,
    });
    assert.equal(verdict.outcome, 'unique');
  });

  it('aceptar una empresa no amplía la siembra de conocidos', () => {
    const after = registerLushaCompanyIdentity(known, {
      providerCompanyId: 'v1.nueva',
      normalizedDomain: 'nueva.com',
      normalizedLinkedInUrl: null,
      normalizedName: 'nueva',
    });

    assert.deepEqual([...after.knownDomains], ['conocida.com']);
    assert.ok(after.normalizedDomains.has('nueva.com'));
  });

  it('la siembra normaliza y es idempotente; un valor inservible no entra', () => {
    const seeded = seedLushaKnownDomains(createLushaRunIdentityRegistry(), [
      'https://WWW.Conocida.com/x',
      'conocida.com',
      null,
      undefined,
      '   ',
    ]);
    assert.deepEqual([...seeded.knownDomains], ['conocida.com']);
  });

  it('un lote mixto se reparte entre los dos motivos, sin doble conteo', () => {
    const dedupe = dedupeLushaCompaniesByIdentity(
      [
        company({ providerCompanyId: 'p-1', name: 'Nueva', domain: 'nueva.com' }),
        company({ providerCompanyId: 'p-2', name: 'Nueva otra vez', domain: 'nueva.com' }),
        company({ providerCompanyId: 'p-3', name: 'Conocida', domain: 'conocida.com' }),
      ],
      known,
    );

    assert.equal(dedupe.unique.length, 1);
    assert.equal(dedupe.duplicateCount, 2);
    assert.equal(dedupe.knownSeedRejectedCount, 1);
    assert.equal(dedupe.duplicateReasonCounts.normalized_domain, 1);
    assert.equal(dedupe.duplicateReasonCounts.known_domain_seed, 1);
  });
});

// ── L1-E · fuente gratuita y mitad de pago cuentan UNA vez ──────────────────

describe('L1-E · la misma empresa por las dos mitades cuenta una sola vez', () => {
  it('🔴 el dominio que la fuente gratuita aceptó no vuelve a cerrar hueco', async () => {
    // La capa gratuita ya aceptó `gratis.example` y lo dejó en el plan; el hueco
    // que la mitad de pago recibe ya está recortado a 4. Si el proveedor devuelve
    // esa misma empresa, aceptarla daría 1 + 4 = 5 sobre 4 empresas distintas.
    const execution: LushaMultiBranchExecution = {
      ...executionKnowing(['gratis.example'], 'free_source_accepted'),
      targetGap: ACTOR.requestedTarget - 1,
    };

    const { res, batches, candidateRows } = await run(
      [
        successResult([
          company({ providerCompanyId: 'p-gratis', name: 'Gratis', domain: 'gratis.example' }),
          company({ providerCompanyId: 'p-pago', name: 'De pago', domain: 'pago.example' }),
        ]),
      ],
      execution,
    );

    assert.equal(res.multiBranch?.acceptedForTargetTotal, 1, '🔴 sólo la de pago cuenta');
    assert.deepEqual(candidateRows.map((r) => r.name), ['De pago']);
    assert.equal(res.multiBranch?.localKnownSuppressedTotal, 1);

    // 🔴 Y el lote CANÓNICO sigue siendo uno: este corte no parte el resultado.
    assert.equal(batches.length, 1);
  });
});

// ── L1-F · el corte es de CONTRATO, no monetario ─────────────────────────────

describe('L1-F · ninguna constante económica se mueve', () => {
  it('🔴 tamaño de página, tope de páginas, objetivo y techo de créditos intactos', () => {
    assert.equal(LUSHA_PREVIEW_SIZE, 10);
    assert.equal(LUSHA_PREVIEW_MAX_PAGE, 1);
    assert.equal(LUSHA_PENDING_REVIEW_MAX_PAGES, 2);
    assert.equal(LUSHA_PENDING_REVIEW_MIN_USEFUL_CANDIDATES, 5);
    assert.equal(LUSHA_PENDING_REVIEW_EXPECTED_MAX_CREDITS, 2);
    // El tope de la dimensión de exclusión sigue DECLARADO en 100. No se toca
    // aunque hoy ningún proveedor pueda recibir una exclusión.
    assert.equal(PREPAID_EXCLUSION_DOMAIN_CAP, 100);
  });

  it('🔴 la petición conserva paginación, tamaño y opciones; `signals` sigue ausente', () => {
    const request = buildLushaPreviewRequest({
      countryName: 'Colombia',
      mainIndustriesIds: [11],
      subIndustryId: null,
      sizeBand: { min: 201, max: 5000 },
      searchText: null,
      page: 0,
    });

    assert.deepEqual(request.pagination, { page: 0, size: LUSHA_PREVIEW_SIZE });
    assert.deepEqual(request.options, { includePartialProfiles: false });
    assert.equal(request.signals, undefined);
  });

  it('🔴 suprimir localmente NO compra páginas extra ni cambia la liquidación', async () => {
    // Una página entera de conocidos deja el objetivo abierto. El ejecutor puede
    // pedir su segunda página —eso ya existía— pero NUNCA más allá del tope, y los
    // créditos reportados son los que el proveedor dijo, sin compensación.
    const knownPage = successResult([
      company({ providerCompanyId: 'k-1', name: 'K1', domain: 'k1.example' }),
      company({ providerCompanyId: 'k-2', name: 'K2', domain: 'k2.example' }),
    ]);

    const { res } = await run(
      [knownPage, successResult([])],
      executionKnowing(['k1.example', 'k2.example'], 'provider_seen'),
    );

    assert.ok(
      (res.multiBranch?.providerRequestsUsed ?? 0) <= LUSHA_PENDING_REVIEW_MAX_PAGES,
      '🔴 el tope de páginas por rama manda',
    );
    assert.equal(res.multiBranch?.localKnownSuppressedTotal, 2);
    assert.equal(res.usefulCandidatesCount, 0);
    // 🔴 Y no se afirma NINGÚN ahorro: el crédito de la página ya cobrada no
    // vuelve. Lo único que se publica son los créditos que el proveedor reportó.
    const serialized = JSON.stringify(res.multiBranch);
    for (const forbidden of ['credits_saved', 'creditsSaved', 'usd_saved', 'usdSaved']) {
      assert.ok(!serialized.includes(forbidden), `🔴 ${forbidden} sería dinero inventado`);
    }
  });
});
