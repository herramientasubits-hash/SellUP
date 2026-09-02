/**
 * AGENT1-LUSHA-PROVIDER-SEEN-DEDUPE-FIX — la suite dedicada del corte.
 *
 * ── El defecto, medido en Producción ─────────────────────────────────────────
 *
 * `provider_usage_logs` de Prod, cuatro llamadas `company_prospecting_v3` con
 * `status: success` y 25 resultados cada una. Tres comparten la MISMA huella de
 * petición (`7aa292ef…` = CO / technology / banda 201-5000 / 1 rama):
 *
 *   · 2026-09-01 19:04 → lote `26f49596`, 5 candidatos, 1 crédito.  ✅
 *   · 2026-09-01 21:59 → `batch_id: null`, 1 crédito.               ❌
 *   · 2026-09-02 05:36 → `batch_id: null`, 1 crédito.               ❌
 *
 * La primera corrida dejó los 25 dominios devueltos en la memoria provider-seen
 * (`provider_new_domains_recorded: 25`). Las dos siguientes volvieron a pedir la
 * misma página —Lusha V3 no excluye del lado del servidor, así que la petición no
 * puede pedir «no me devuelvas éstos»—, la cobraron, y sembraron esos 25 dominios
 * en el registro de identidad de la corrida. Las 25 filas cayeron con motivo
 * `known_domain_seed`, `useful` quedó vacío, y la corrida salió por
 * `status: 'empty'`: sin lote, sin candidatos, con el crédito cobrado y sin
 * telemetría durable que lo explicara.
 *
 * ── La distinción que el corte restaura ──────────────────────────────────────
 *
 * «Ya PAGAMOS por verla» no es «ya ES NUESTRA». Entre esas 25 había empresas
 * descartadas por sobrante de objetivo (`target_overflow_discarded`) y por
 * precisión: nadie las posee, y son candidatas legítimas en la corrida siguiente.
 *
 * Autoridad que se CONSERVA intacta, y que estas pruebas verifican una por una:
 * HubSpot, cuentas de SellUp, la guarda de candidato activo y el dedupe de la
 * propia corrida.
 *
 * ── 🔴 Lo que este corte NO hace, y no se afirma en ninguna prueba ───────────
 *
 * Ahorrar el crédito de una empresa ya vista. Sin exclusión previa al cobro eso
 * es imposible, lo fijó CUT-L1 y sigue siendo cierto. Lo único que cambia es que
 * el resultado de la página ya pagada deje de tirarse entero.
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
import { LUSHA_PENDING_REVIEW_MIN_USEFUL_CANDIDATES } from '@/server/prospect-batches/lusha-pending-review-limits';
import type {
  LushaPreviewCompany,
  LushaPreviewInput,
  LushaPreviewResult,
} from '@/server/prospect-batches/lusha-preview';
import {
  PROVIDER_EXCLUSION_DEDUPE_AUTHORITY_SOURCES,
  isProviderExclusionDedupeAuthority,
  planProviderExclusions,
} from '@/modules/prospect-batches/provider-seen/provider-exclusion-planner';
import type { ActiveCandidateRecord } from '@/server/agents/prospecting-toolkit/active-candidate-identity-guard';
import type {
  DuplicateCheckInput,
  DuplicateCheckResult,
} from '@/server/agents/prospecting-toolkit/types';

import { preM126FencedInsert } from '@/server/prospect-batches/__tests__/support/lusha-pre-m126-fenced-insert';
import { preM126BatchEpochSnapshot } from '@/server/prospect-batches/__tests__/support/lusha-batch-epoch-snapshot';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const INPUT: LushaPreviewInput = {
  countryCode: 'CO',
  macroIndustryKey: 'technology',
  subIndustryId: null,
  sizeBandKey: '201-5000',
  searchText: null,
};

const ACTOR = {
  internalUserId: 'user-1',
  clientRequestId: '22222222-2222-4222-8222-222222222222',
  requestedTarget: LUSHA_PENDING_REVIEW_MIN_USEFUL_CANDIDATES,
};

/**
 * Las cinco empresas de la página. Son el equivalente reducido de la página real:
 * la misma respuesta, devuelta dos veces, porque la petición es idéntica.
 */
const PAGE = [
  { providerCompanyId: 'v1.tech-1', name: 'Tech Uno', domain: 'tech-uno.com.co' },
  { providerCompanyId: 'v1.tech-2', name: 'Tech Dos', domain: 'tech-dos.com.co' },
  { providerCompanyId: 'v1.tech-3', name: 'Tech Tres', domain: 'tech-tres.com.co' },
  { providerCompanyId: 'v1.tech-4', name: 'Tech Cuatro', domain: 'tech-cuatro.com.co' },
  { providerCompanyId: 'v1.tech-5', name: 'Tech Cinco', domain: 'tech-cinco.com.co' },
] as const;

function company(overrides: Partial<LushaPreviewCompany> = {}): LushaPreviewCompany {
  return {
    providerCompanyId: null,
    name: 'Empresa',
    domain: null,
    country: 'Colombia',
    countryIso2: 'CO',
    industry: 'Technology, Information & Media',
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

/** La página tal cual la devuelve el proveedor, idéntica en las dos corridas. */
function pageResults(): LushaPreviewCompany[] {
  return PAGE.map((c) => company({ ...c }));
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
      sector: 'Tecnología',
      industryKey: 'technology',
      macroIndustryKey: 'technology',
      mainIndustriesIds: [17],
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
 * Coincidencia EXACTA de dominio en HubSpot, con la forma que la producción
 * publicó: `source: 'hubspot'`, `confidence: 92` (eje `exact_domain`), que es la
 * única que `strong-identity-duplicate-match` acepta como identidad FUERTE.
 */
function hubspotExactDomain(input: DuplicateCheckInput): DuplicateCheckResult {
  return {
    status: 'existing_in_hubspot',
    confidence: 92,
    input,
    matches: [
      {
        source: 'hubspot',
        status: 'existing_in_hubspot',
        confidence: 92,
        matchedId: '1094729004',
        matchedName: input.name ?? null,
        matchedDomain: input.domain ?? null,
        reason: `Dominio exacto coincide en HubSpot: ${input.domain}`,
      },
    ],
    summary: 'duplicado exacto en HubSpot',
    checkedSources: ['sellup', 'hubspot'],
  };
}

type Overrides = {
  duplicateFor?: (input: DuplicateCheckInput) => DuplicateCheckResult;
  activeCandidates?: ActiveCandidateRecord[];
};

function makeDeps(script: LushaPreviewResult[], overrides: Overrides = {}) {
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
      return (overrides.duplicateFor ?? noDuplicate)(input);
    },
    fetchActiveCandidates: async () => overrides.activeCandidates ?? [],
  };

  return { deps, searchInputs, batches, candidateRows, duplicateChecks };
}

function run(
  script: LushaPreviewResult[],
  execution?: LushaMultiBranchExecution,
  overrides: Overrides = {},
) {
  const harness = makeDeps(script, overrides);
  return persistLushaPendingReviewBatch(harness.deps, INPUT, ACTOR, undefined, execution).then(
    (res) => ({ res, ...harness }),
  );
}

/**
 * La ejecución de una corrida REPETIDA: la memoria provider-seen ya trae los ids y
 * los dominios que la corrida anterior pagó por ver, y nada más. Es exactamente
 * lo que `runPrePaidNoveltyGate` compone en Producción cuando la capa gratuita no
 * aporta —el caso de `technology`, que quedó con cero cobertura CIIU—.
 */
function repeatRunExecution(): LushaMultiBranchExecution {
  return {
    providerExclusionPlan: planProviderExclusions('lusha', {
      providerSeenIds: PAGE.map((c) => c.providerCompanyId),
      providerSeenDomains: PAGE.map((c) => c.domain),
    }),
  };
}

/** La PRIMERA corrida: sin memoria previa, sin conocidos, plan vacío. */
function firstRunExecution(): LushaMultiBranchExecution {
  return { providerExclusionPlan: planProviderExclusions('lusha', {}) };
}

// ── 1 · La primera corrida crea candidatos ───────────────────────────────────

describe('1 · la primera corrida crea candidatos', () => {
  it('🔴 cinco empresas nuevas ⇒ lote real, cinco candidatos, objetivo cerrado', async () => {
    const { res, batches, candidateRows } = await run(
      [successResult(pageResults())],
      firstRunExecution(),
    );

    assert.equal(res.ok, true);
    assert.equal(res.status, 'success');
    assert.ok(res.batchId, '🔴 se creó lote');
    assert.equal(batches.length, 1);
    assert.equal(res.usefulCandidatesCount, PAGE.length);
    assert.equal(candidateRows.length, PAGE.length);
    assert.deepEqual(
      candidateRows.map((r) => r.domain).sort(),
      PAGE.map((c) => c.domain).sort(),
    );
    // Nada que sembrar todavía: la memoria no existe.
    assert.equal(res.multiBranch?.localKnownSeedCount, 0);
    assert.equal(res.multiBranch?.localKnownSuppressedTotal, 0);
  });
});

// ── 2 · La segunda corrida con los MISMOS dominios ───────────────────────────

describe('2 · la segunda corrida con los mismos dominios', () => {
  it('🔴 provider_seen NO marca duplicado: los cinco vuelven a ser candidatos', async () => {
    const { res, batches, candidateRows } = await run(
      [successResult(pageResults())],
      repeatRunExecution(),
    );

    // 🔴 ÉSTE es el defecto de Producción, invertido: antes salía por
    // `status: 'empty'` con `batchId: null` y cero candidatos.
    assert.notEqual(res.status, 'empty', '🔴 la corrida repetida no puede salir vacía');
    assert.ok(res.batchId, '🔴 se creó lote');
    assert.equal(batches.length, 1);
    assert.equal(res.usefulCandidatesCount, PAGE.length);
    assert.equal(candidateRows.length, PAGE.length);

    // 🔴 Ni una sola fila cayó por la siembra, y ninguna quedó marcada duplicada.
    assert.equal(res.multiBranch?.localKnownSuppressedTotal, 0);
    assert.equal(res.multiBranch?.duplicateReasonCounts.known_domain_seed, 0);
    assert.deepEqual(
      [...new Set(candidateRows.map((r) => r.duplicate_status))],
      ['no_match'],
      '🔴 «ya pagamos por verla» no puede marcar duplicate',
    );
  });

  it('🔴 la memoria sigue CONOCIÉNDOSE: lo que cambia es su autoridad, no su registro', async () => {
    const plan = repeatRunExecution().providerExclusionPlan!;

    // Se conoce entera —CUT-L1 § 3 sigue en pie— y no viaja, por capacidad.
    assert.equal(plan.domains.available, PAGE.length);
    assert.equal(plan.domains.availableValues.length, PAGE.length);
    assert.equal(plan.domains.sent.length, 0);
    assert.equal(plan.domains.bySource.provider_seen, PAGE.length);
    // 🔴 Pero NADA de eso puede decidir un duplicado.
    assert.deepEqual([...plan.domains.dedupeAuthorityValues], []);
    assert.deepEqual([...plan.ids.dedupeAuthorityValues], []);

    // Y la corrida lo publica: sembró cero, aunque conozca cinco.
    const { res } = await run([successResult(pageResults())], repeatRunExecution());
    assert.equal(res.multiBranch?.localKnownSeedCount, 0);
  });

  it('🔴 no se afirma NINGÚN ahorro: el crédito de la página ya cobrada no vuelve', async () => {
    const { res } = await run([successResult(pageResults())], repeatRunExecution());

    const serialized = JSON.stringify(res.multiBranch);
    for (const forbidden of ['credits_saved', 'creditsSaved', 'usd_saved', 'usdSaved']) {
      assert.ok(!serialized.includes(forbidden), `🔴 ${forbidden} sería dinero inventado`);
    }
    // El crédito que el proveedor dijo, sin compensación por lo suprimido.
    assert.equal(res.creditsCharged, 1);
  });
});

// ── 3 · HubSpot sigue bloqueando ─────────────────────────────────────────────

describe('3 · HubSpot sigue siendo autoridad', () => {
  it('🔴 dominio exacto en HubSpot ⇒ exact_duplicate y fuera de revisión, con la memoria llena', async () => {
    const blocked = PAGE[0].domain;

    const { res, candidateRows } = await run(
      [successResult(pageResults()), successResult([])],
      repeatRunExecution(),
      {
        duplicateFor: (input) =>
          input.domain === blocked ? hubspotExactDomain(input) : noDuplicate(input),
      },
    );

    assert.equal(res.usefulCandidatesCount, PAGE.length - 1);
    assert.equal(res.excludedExactDuplicatesCount, 1);
    assert.ok(
      !candidateRows.some((r) => r.domain === blocked),
      '🔴 la empresa de HubSpot no se persiste',
    );
    // 🔴 Bloqueada por HubSpot, NO por la siembra: los dos motivos no se confunden.
    assert.equal(res.multiBranch?.localKnownSuppressedTotal, 0);
    assert.equal(res.multiBranch?.duplicateReasonCounts.known_domain_seed, 0);
  });
});

// ── 4 · La guarda de candidato activo sigue bloqueando ───────────────────────

describe('4 · el candidato ACTIVO sigue siendo autoridad', () => {
  it('🔴 dominio de un candidato activo ⇒ salto duro, con la memoria llena', async () => {
    const blocked = PAGE[1].domain;

    const { res, candidateRows, duplicateChecks } = await run(
      [successResult(pageResults()), successResult([])],
      repeatRunExecution(),
      {
        activeCandidates: [
          {
            id: 'cand-activo-1',
            name: 'Tech Dos',
            domain: blocked,
            inferredCompanyName: 'Tech Dos',
            normalizedName: 'tech dos',
            // Uno de los cinco estados que OCUPAN el lote según la CHECK real
            // (`ACTIVE_CANDIDATE_STATUSES`). Un estado inventado dejaría la
            // guarda sin candidatos activos y la prueba pasaría por la razón
            // equivocada.
            status: 'needs_review',
          },
        ],
      },
    );

    assert.equal(res.skippedActiveDuplicatesCount, 1);
    assert.equal(res.usefulCandidatesCount, PAGE.length - 1);
    assert.ok(
      !candidateRows.some((r) => r.domain === blocked),
      '🔴 el candidato activo no se duplica',
    );
    // 🔴 El salto es ANTERIOR al checker canónico: no arrastra trabajo pagado.
    assert.ok(!duplicateChecks.some((c) => c.domain === blocked));
    // 🔴 Y otra vez: bloqueada por la guarda, no por la siembra.
    assert.equal(res.multiBranch?.localKnownSuppressedTotal, 0);
  });
});

// ── 5 · El plan, a nivel de unidad ───────────────────────────────────────────

describe('5 · `dedupeAuthorityValues` — quién puede decidir un duplicado', () => {
  it('🔴 el censo de procedencias con autoridad excluye `provider_seen` y sólo a ésa', () => {
    assert.deepEqual(
      [...PROVIDER_EXCLUSION_DEDUPE_AUTHORITY_SOURCES],
      ['sellup_known', 'hubspot_local', 'free_source_accepted', 'same_run'],
    );
    assert.equal(isProviderExclusionDedupeAuthority('provider_seen'), false);
    for (const source of PROVIDER_EXCLUSION_DEDUPE_AUTHORITY_SOURCES) {
      assert.equal(isProviderExclusionDedupeAuthority(source), true, source);
    }
  });

  it('🔴 se retira la PROCEDENCIA, no el valor: un dominio con dos orígenes sobrevive', () => {
    const plan = planProviderExclusions('lusha', {
      providerSeenDomains: ['vista.example', 'compartida.example'],
      sellupKnownDomains: ['cuenta.example', 'compartida.example'],
      hubspotLocalDomains: ['crm.example'],
      freeSourceAcceptedDomains: ['gratis.example'],
    });

    assert.deepEqual(
      [...plan.domains.availableValues],
      ['compartida.example', 'crm.example', 'cuenta.example', 'gratis.example', 'vista.example'],
    );
    // 🔴 `compartida.example` se queda: llega TAMBIÉN por una cuenta de SellUp.
    // `vista.example` se va: sólo la avala «ya pagamos por verla».
    assert.deepEqual(
      [...plan.domains.dedupeAuthorityValues],
      ['compartida.example', 'crm.example', 'cuenta.example', 'gratis.example'],
    );
  });

  it('la vista con autoridad usa el MISMO normalizador y el MISMO orden', () => {
    const plan = planProviderExclusions('lusha', {
      sellupKnownDomains: ['https://WWW.Zeta.com/nosotros', 'ALFA.com', 'alfa.com', '  ', null],
    });

    assert.deepEqual([...plan.domains.dedupeAuthorityValues], ['alfa.com', 'zeta.com']);
    assert.deepEqual(
      [...plan.domains.dedupeAuthorityValues],
      [...plan.domains.availableValues],
      'sin provider_seen las dos vistas coinciden exactamente',
    );
  });

  it('🔴 la telemetría publica las TRES cifras, para que ningún cero se malinterprete', () => {
    const metadata = planProviderExclusions('lusha', {
      providerSeenDomains: ['vista.example'],
      sellupKnownDomains: ['cuenta.example'],
    });

    assert.equal(metadata.domains.available, 2);
    assert.equal(metadata.domains.dedupeAuthorityValues.length, 1);
    assert.equal(metadata.domains.sent.length, 0);
  });
});
