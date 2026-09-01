/**
 * AGENT1-ACTIVE-CANDIDATE-DOMAIN-CANONICALIZATION — la CUENTA del objetivo del
 * lote VIVO `26f49596-1c89-4da4-a769-8838fe4baf06`, recorrida por la tubería de
 * selección REAL.
 *
 * ── Lo que ocurrió en Producción ────────────────────────────────────────────
 *
 * Primer despacho REAL de Lusha Prospecting. Metadata del lote, literal:
 *
 *     raw_results_total                 25
 *     unique_results_total              23   (2 suprimidos por dominio conocido)
 *     gate: hard_excluded                0   (22 limpios + 1 con aviso)
 *     active_duplicates_skipped          1
 *     exact_duplicates_excluded         14
 *     reviewable_found_total             8
 *     accepted_for_target_total          5
 *     target_overflow_discarded          3
 *     possible_duplicates_persisted      5
 *     remaining_gap_final                0
 *     stop_reason               target_reached
 *     provider_requests_used             1   (de 2 permitidas)
 *
 * Las CINCO aceptadas eran las cinco falsas `possible_duplicate`: EPM, ETB,
 * RCN TV, Controles Empresariales y Avantel S.A, cada una con un candidato
 * ACTIVO anterior con el MISMO dominio, persistido con `www.`. El objetivo se
 * declaró alcanzado con cinco duplicados de dominio.
 *
 * Y no eran las únicas: SEIS de los catorce duplicados exactos —Siigo, EL
 * TIEMPO, Caracol Radio, Ceiba Software, Intergrupo y SETI— traen en su
 * `excludedExactDuplicates` la MISMA huella (`matchedDomain: "www.…"`,
 * `matchType: "canonical_identity"`). No costaron objetivo porque HubSpot los
 * excluyó igual por dominio exacto, pero prueban que el defecto era sistemático
 * y no un caso de cinco.
 *
 * ── Lo que esta suite defiende, dicho como defecto ──────────────────────────
 *
 *   M1. que las cinco vuelvan a persistirse y a contar para el objetivo;
 *   M2. que la corrida vuelva a declarar `target_reached` sin haberlo alcanzado;
 *   M3. que las tres candidatas descartadas por CUPO no ocupen el hueco que
 *       dejan las cinco;
 *   M4. que el residual se dé por 5 (o por 0) en vez de por lo que la tubería
 *       calcula;
 *   M5. que la segunda página deje de pedirse cuando el objetivo NO está lleno.
 *
 * 🔴 El fixture está construido para que una REGRESIÓN de la guarda reproduzca
 * EXACTAMENTE los números vivos (5 aceptadas / 3 por cupo / hueco 0 / 1 página):
 * las cinco no tienen duplicado en HubSpot ni en SellUp, así que si la guarda no
 * las cierra por dominio, entran como útiles. El oráculo de la prueba es la
 * metadata de Producción, no un número escrito a mano.
 *
 * 0 proveedores, 0 créditos, 0 Producción, 0 escrituras, 0 red, 0 migraciones.
 * `runSearch`, `checkCompanyDuplicate` y `fetchActiveCandidates` son dobles.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  persistLushaPendingReviewBatch,
  type PersistLushaPendingReviewDeps,
  type LushaPendingReviewBatchRow,
  type LushaPendingReviewCandidateRow,
  type LushaMultiBranchExecution,
} from '@/server/prospect-batches/lusha-pending-review';
import type {
  LushaPreviewCompany,
  LushaPreviewInput,
  LushaPreviewResult,
} from '@/server/prospect-batches/lusha-preview';
import type { ActiveCandidateRecord } from '@/server/agents/prospecting-toolkit/active-candidate-identity-guard';
import type {
  DuplicateCheckInput,
  DuplicateCheckResult,
} from '@/server/agents/prospecting-toolkit/types';

import { preM126FencedInsert } from '@/server/prospect-batches/__tests__/support/lusha-pre-m126-fenced-insert';
import { preM126BatchEpochSnapshot } from '@/server/prospect-batches/__tests__/support/lusha-batch-epoch-snapshot';

// ─── Cifras VIVAS del lote, como oráculo ──────────────────────────────────────

const LIVE = {
  batchId: '26f49596-1c89-4da4-a769-8838fe4baf06',
  rawResultsTotal: 25,
  uniqueResultsTotal: 23,
  activeDuplicatesSkipped: 1,
  exactDuplicatesExcluded: 14,
  reviewableFoundTotal: 8,
  acceptedForTargetTotal: 5,
  targetOverflowDiscarded: 3,
  possibleDuplicatesPersisted: 5,
  remainingGapFinal: 0,
  providerRequestsUsed: 1,
  targetGap: 5,
} as const;

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const INPUT: LushaPreviewInput = {
  countryCode: 'CO',
  macroIndustryKey: 'technology',
  subIndustryId: null,
  sizeBandKey: '1001-5000',
  searchText: null,
};

const ACTOR = {
  internalUserId: 'user-live-repro',
  clientRequestId: '26f49596-1c89-4da4-a769-8838fe4baf06',
  requestedTarget: 5,
};

function company(name: string, domain: string, overrides: Partial<LushaPreviewCompany> = {}): LushaPreviewCompany {
  return {
    providerCompanyId: `lusha-${domain}`,
    name,
    domain,
    country: 'Colombia',
    countryIso2: 'CO',
    industry: 'Information Technology & Services',
    employeesExact: 2087,
    employeesMin: null,
    employeesMax: null,
    linkedinUrl: `https://www.linkedin.com/company/${domain.split('.')[0]}`,
    score: 92,
    passesGate: true,
    issues: [],
    ...overrides,
  };
}

/** Fila ACTIVA anterior tal como la devuelve la base: dominio con `www.`. */
function priorActive(id: string, name: string, persistedDomain: string): ActiveCandidateRecord {
  return {
    id,
    name,
    domain: persistedDomain,
    inferredCompanyName: name,
    normalizedName: name.toLowerCase(),
    status: 'needs_review',
  };
}

// A. Las CINCO que costaron objetivo. Dominio de entrada canónico, fila activa
//    anterior con `www.`. Ids reales de Producción.
const FIVE_FALSE_TARGETS = [
  { name: 'EPM', domain: 'une.com.co', priorId: 'dd570862-613a-4696-90b8-028ff0b5aed2' },
  { name: 'ETB', domain: 'etb.com', priorId: '7e126f65-88de-43a9-86e2-7a41e84481f2' },
  { name: 'RCN TV', domain: 'canalrcn.com', priorId: '51249a5b-a4ba-42ba-aebe-8abb952557f7' },
  { name: 'Controles Empresariales', domain: 'controlesempresariales.com', priorId: '963673ad-285a-44e2-9308-11a0cf083726' },
  { name: 'Avantel S.A', domain: 'avantel.co', priorId: '7dbaba69-cd62-45f5-b772-833cccd8a30c' },
] as const;

// B. Los SEIS duplicados exactos que TAMBIÉN traían la huella `www.` en su
//    detalle auditado. Ids reales de Producción.
const SIX_EXACT_WITH_WWW_ACTIVE = [
  { name: 'Siigo', domain: 'siigo.com', priorId: 'afbbd0ed-522a-4ddf-bdf4-befb24441d10' },
  { name: 'EL TIEMPO Casa Editorial', domain: 'eltiempo.com', priorId: '10b0c4da-da27-4ca7-a189-ac7497030313' },
  { name: 'Caracol Radio', domain: 'caracol.com.co', priorId: '0969f605-1cba-41c5-8c43-814c13752075' },
  { name: 'Ceiba Software', domain: 'ceiba.com.co', priorId: 'f07623c7-9d03-4431-8d96-9c66212649d3' },
  { name: 'Intergrupo', domain: 'intergrupo.com', priorId: '62e9e191-10fa-4541-b0c0-64298e576cb4' },
  { name: 'SETI S.A.S', domain: 'seti.com.co', priorId: 'cc8181d9-99c1-4273-a0b7-22df7eae0772' },
] as const;

// C. Los OCHO duplicados exactos SIN candidato activo. Nombres y dominios reales.
const EIGHT_EXACT_NO_ACTIVE = [
  { name: 'Caracol Televisión', domain: 'caracoltv.com' },
  { name: 'ARUS Oficial', domain: 'arus.com.co' },
  { name: 'CIAT', domain: 'ciat.cgiar.org' },
  { name: 'Grupo ASD', domain: 'grupoasd.com.co' },
  { name: 'WOM Colombia', domain: 'wom.co' },
  { name: 'Servinformación', domain: 'servinformacion.com' },
  { name: 'Universidad de Nariño', domain: 'udenar.edu.co' },
  { name: 'Habi', domain: 'habi.co' },
] as const;

// D. La UNA que ya se cerraba por dominio antes del corte: su fila activa
//    anterior está persistida SIN `www.`, así que la comparación cruda la veía.
const ALREADY_STRONG = { name: 'Activa Sin WWW', domain: 'activa-sin-www.com.co', priorId: 'prior-sin-www' } as const;

// E. Los DOS suprimidos por dominio conocido local (`known_domain_seed`). La
//    metadata viva registra el CONTEO (2), no cuáles: aquí son marcadores.
const TWO_LOCAL_KNOWN = [
  { name: 'Conocida Local Uno', domain: 'conocida-local-uno.com.co' },
  { name: 'Conocida Local Dos', domain: 'conocida-local-dos.com.co' },
] as const;

// F. Las TRES que en vivo se descartaron por CUPO (`target_overflow_discarded`).
//    Sin duplicado y sin candidato activo: son las que ocupan el hueco que
//    dejan las cinco falsas.
const THREE_OVERFLOW = [
  { name: 'Nueva Empresa Uno', domain: 'nueva-empresa-uno.com.co' },
  { name: 'Nueva Empresa Dos', domain: 'nueva-empresa-dos.com.co' },
  { name: 'Nueva Empresa Tres', domain: 'nueva-empresa-tres.com.co' },
] as const;

/** La página 0 REAL: 25 filas crudas, en el orden de los seis grupos. */
function livePage(): LushaPreviewCompany[] {
  return [
    ...TWO_LOCAL_KNOWN.map((c) => company(c.name, c.domain)),
    ...FIVE_FALSE_TARGETS.map((c) => company(c.name, c.domain)),
    ...SIX_EXACT_WITH_WWW_ACTIVE.map((c) => company(c.name, c.domain)),
    ...EIGHT_EXACT_NO_ACTIVE.map((c) => company(c.name, c.domain)),
    company(ALREADY_STRONG.name, ALREADY_STRONG.domain),
    ...THREE_OVERFLOW.map((c) => company(c.name, c.domain)),
  ];
}

/** Las 12 filas activas anteriores que la base devuelve para esta página. */
function liveActiveCandidates(): ActiveCandidateRecord[] {
  return [
    ...FIVE_FALSE_TARGETS.map((c) => priorActive(c.priorId, c.name, `www.${c.domain}`)),
    ...SIX_EXACT_WITH_WWW_ACTIVE.map((c) => priorActive(c.priorId, c.name, `www.${c.domain}`)),
    // 🔴 SIN `www.`: la única que la comparación cruda ya veía.
    priorActive(ALREADY_STRONG.priorId, ALREADY_STRONG.name, ALREADY_STRONG.domain),
  ];
}

const EXACT_DUPLICATE_DOMAINS = new Set<string>([
  ...SIX_EXACT_WITH_WWW_ACTIVE.map((c) => c.domain),
  ...EIGHT_EXACT_NO_ACTIVE.map((c) => c.domain),
]);

function duplicateResultFor(input: DuplicateCheckInput): DuplicateCheckResult {
  const domain = input.domain ?? '';
  if (EXACT_DUPLICATE_DOMAINS.has(domain)) {
    return {
      status: 'existing_in_hubspot',
      confidence: 92,
      input,
      matches: [
        {
          source: 'hubspot',
          status: 'existing_in_hubspot',
          confidence: 92,
          matchedId: `hs-${domain}`,
          matchedName: input.name,
          matchedDomain: domain,
          matchedWebsite: null,
          reason: `Dominio exacto coincide en HubSpot: ${domain}`,
        },
      ],
      summary: 'Duplicado confirmado',
      checkedSources: ['sellup', 'hubspot'],
    } as unknown as DuplicateCheckResult;
  }
  return {
    status: 'new_candidate',
    confidence: 85,
    input,
    matches: [],
    summary: 'nuevo',
    checkedSources: ['sellup', 'hubspot'],
  } as unknown as DuplicateCheckResult;
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
      sizeBand: { min: 1001, max: 5000 },
      hasSearchText: false,
    },
  };
}

/**
 * `providerExclusionPlan` con los dominios locales conocidos. `sent` va VACÍO
 * porque Lusha V3 no soporta exclusión servidor (CUT-L1, confirmado por soporte
 * HUMANO): la supresión es de CLIENTE, y es la que quita las dos primeras.
 */
function exclusionPlan(): NonNullable<LushaMultiBranchExecution['providerExclusionPlan']> {
  // 🔴 SÓLO los dos que la página trae. Los otros doce completan el conteo vivo
  // (`local_known_seed_count: 14`) sin tocar la página: un conocido que aparece
  // en la página se SUPRIME antes de la guarda, y meter ahí a los duplicados
  // exactos habría vaciado la rama del checker y falseado la cuenta.
  const known = [
    ...TWO_LOCAL_KNOWN.map((c) => c.domain),
    ...Array.from({ length: 12 }, (_, i) => `otro-conocido-${i + 1}.com.co`),
  ];
  return {
    domains: { available: known.length, availableValues: known, sent: [], omittedDueToCap: 0 },
    ids: { available: 0, availableValues: [], sent: [], omittedDueToCap: 0 },
  } as unknown as NonNullable<LushaMultiBranchExecution['providerExclusionPlan']>;
}

type Harness = {
  deps: PersistLushaPendingReviewDeps;
  calls: Array<number | null | undefined>;
  candidateRows: LushaPendingReviewCandidateRow[];
  batches: LushaPendingReviewBatchRow[];
};

function makeHarness(script: LushaPreviewResult[]): Harness {
  const calls: Array<number | null | undefined> = [];
  const batches: LushaPendingReviewBatchRow[] = [];
  const candidateRows: LushaPendingReviewCandidateRow[] = [];

  const deps: PersistLushaPendingReviewDeps = {
    runSearch: async (searchInput) => {
      calls.push(searchInput.page);
      return script[calls.length - 1] ?? successResult([]);
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
    checkCompanyDuplicate: async (dupInput) => duplicateResultFor(dupInput),
    fetchActiveCandidates: async () => liveActiveCandidates(),
  };

  return { deps, calls, candidateRows, batches };
}

async function runLiveShape() {
  // Página 0 = las 25 filas reales. Página 1 = vacía: si la corrida la pide, es
  // porque el objetivo NO estaba lleno, que es justamente lo que se prueba.
  const harness = makeHarness([successResult(livePage()), successResult([])]);
  const res = await persistLushaPendingReviewBatch(harness.deps, INPUT, ACTOR, undefined, {
    plan: { macroKey: 'technology', branches: [{ mainIndustryId: 17, label: 'Technology' }] },
    targetGap: LIVE.targetGap,
    creditsReserved: 2,
    providerExclusionPlan: exclusionPlan(),
  } as LushaMultiBranchExecution);
  return { res, ...harness };
}

// ─── § 1 · el fixture reproduce la FORMA viva ────────────────────────────────

describe('§ 1 · el fixture es el lote vivo', () => {
  test('25 filas crudas, repartidas exactamente como el lote', () => {
    assert.equal(livePage().length, LIVE.rawResultsTotal);
    assert.equal(
      TWO_LOCAL_KNOWN.length +
        FIVE_FALSE_TARGETS.length +
        SIX_EXACT_WITH_WWW_ACTIVE.length +
        EIGHT_EXACT_NO_ACTIVE.length +
        1 +
        THREE_OVERFLOW.length,
      LIVE.rawResultsTotal,
    );
    // Los catorce duplicados exactos del lote vivo.
    assert.equal(EXACT_DUPLICATE_DOMAINS.size, LIVE.exactDuplicatesExcluded);
  });

  test('las once filas activas con `www.` son las que la comparación cruda no veía', () => {
    const withWww = liveActiveCandidates().filter((c) => (c.domain ?? '').startsWith('www.'));
    assert.equal(withWww.length, FIVE_FALSE_TARGETS.length + SIX_EXACT_WITH_WWW_ACTIVE.length);
    const withoutWww = liveActiveCandidates().filter((c) => !(c.domain ?? '').startsWith('www.'));
    assert.equal(withoutWww.length, LIVE.activeDuplicatesSkipped, 'la única que ya se cerraba');
  });
});

// ─── § 2 · la cuenta del objetivo, por la tubería REAL ───────────────────────

describe('§ 2 · el objetivo recalculado por la tubería de selección', () => {
  test('M1 — las cinco NO se persisten y NO cuentan para el objetivo', async () => {
    const { res, candidateRows } = await runLiveShape();

    const persistedNames = candidateRows.map((row) => row.name);
    // El control que impide que este bucle pase por una lista vacía.
    assert.equal(candidateRows.length, THREE_OVERFLOW.length, 'el lote persiste 3 filas, no 0 y no 5');
    for (const falseTarget of FIVE_FALSE_TARGETS) {
      assert.equal(
        persistedNames.includes(falseTarget.name),
        false,
        `${falseTarget.name}: duplicado DURO de dominio activo — no puede persistirse`,
      );
    }
    assert.equal(res.possibleDuplicatesCount, 0, 'ninguna sobrevive como possible_duplicate');
  });

  test('M2/M3 — 12 saltos por dominio activo, 8 duplicados exactos, 3 útiles', async () => {
    const { res, candidateRows } = await runLiveShape();

    assert.equal(
      res.skippedActiveDuplicatesCount,
      FIVE_FALSE_TARGETS.length + SIX_EXACT_WITH_WWW_ACTIVE.length + LIVE.activeDuplicatesSkipped,
      '5 falsas + 6 exactas con huella www + 1 que ya se cerraba = 12',
    );
    assert.equal(
      res.excludedExactDuplicatesCount,
      EIGHT_EXACT_NO_ACTIVE.length,
      'los 6 que la guarda cierra antes ya no llegan al checker: 14 − 6 = 8',
    );
    assert.equal(res.usefulCandidatesCount, THREE_OVERFLOW.length, '23 − 12 − 8 = 3');

    // Las tres PERSISTIDAS son EXACTAMENTE las que en vivo se tiraron por cupo:
    // el hueco que dejan las cinco falsas lo ocupan ellas, no se queda vacío.
    assert.deepEqual(
      candidateRows.map((row) => row.name).sort(),
      THREE_OVERFLOW.map((c) => c.name).sort(),
    );
  });

  test('M3/M4 — 0 descartes por cupo y residual 2, no 5 y no 0', async () => {
    const { res } = await runLiveShape();

    assert.equal(res.targetOverflowDiscarded, 0, 'el cupo deja de recortar: sobran huecos, no candidatas');
    assert.equal(
      res.remainingGapFinal,
      LIVE.targetGap - THREE_OVERFLOW.length,
      'residual = objetivo 5 − 3 útiles = 2 (NUNCA 5: las tres del overflow lo bajan)',
    );
    assert.notEqual(res.remainingGapFinal, LIVE.remainingGapFinal, 'en vivo era 0 y era falso');
    assert.notEqual(res.remainingGapFinal, LIVE.targetGap, 'tampoco es el hueco entero');
  });

  test('M2/M5 — la corrida NO declara `target_reached` y SÍ pide la segunda página', async () => {
    const { res, calls } = await runLiveShape();

    assert.notEqual(res.stopReason, 'target_reached', 'en vivo lo declaró con cinco duplicados dentro');
    assert.equal(calls.length, 2, 'con hueco 2 la rama agota su techo de peticiones');
    assert.equal(res.providerRequestsUsed, 2);
    assert.equal(res.providerRequestsAllowed, 2);
    assert.equal(res.stopReason, 'request_cap_reached');
  });

  test('la comparación con las cifras VIVAS queda explícita', async () => {
    const { res, calls } = await runLiveShape();

    // Antes (Producción) → después (corregido).
    assert.notEqual(res.usefulCandidatesCount, LIVE.acceptedForTargetTotal); // 5 → 3
    assert.notEqual(res.skippedActiveDuplicatesCount, LIVE.activeDuplicatesSkipped); // 1 → 12
    assert.notEqual(res.excludedExactDuplicatesCount, LIVE.exactDuplicatesExcluded); // 14 → 8
    assert.notEqual(res.possibleDuplicatesCount, LIVE.possibleDuplicatesPersisted); // 5 → 0
    assert.notEqual(res.targetOverflowDiscarded, LIVE.targetOverflowDiscarded); // 3 → 0
    assert.notEqual(calls.length, LIVE.providerRequestsUsed); // 1 → 2

    // Y la suma sigue cuadrando contra las 23 revisables del lote vivo.
    assert.equal(
      res.skippedActiveDuplicatesCount + res.excludedExactDuplicatesCount + res.usefulCandidatesCount,
      LIVE.uniqueResultsTotal,
    );
  });
});
