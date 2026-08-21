/**
 * AGENT1-LUSHA-MIXED-TWO-BATCH-CONTAINMENT-1 §§ 2, 4, 5, 6, 7 — el RATCHET DE
 * CABLEADO VIVO de la superficie Lusha: la capacidad de hueco parcial existe y
 * está probada, y producción ya NO la usa.
 *
 * ── 🔴 Por qué hacen falta DOS afirmaciones y no una ────────────────────────
 *
 * La maquinaria de hueco parcial es real y se queda: `runPrePaidNoveltyDiscovery`
 * la soporta, `residualGap` se calcula, `resolveLushaTargetGap` lo recibe y
 * `canAcceptLushaUsefulCandidate` lo hace cumplir dentro de cada página pagada.
 * Este archivo NO la borra: la invoca a propósito con `true` para demostrar que
 * sigue viva.
 *
 * Lo que defiende es lo contrario y es igual de importante:
 *
 *   LUSHA_PARTIAL_GAP_CAPABILITY       = PRESENT   ← el caso de CONTRASTE
 *   LUSHA_PARTIAL_GAP_LIVE_ACTIVATION  = OFF       ← todo lo demás
 *
 * Sin este ratchet, «la capacidad está probada» se lee como «el comportamiento
 * está vivo» — y en esta superficie eso no era una hipótesis: era el estado de
 * PRODUCCIÓN. Con `true`, objetivo 5 y 3 empresas gratis, UNA búsqueda del
 * usuario terminaba en DOS lotes: la capa gratuita persiste en el suyo antes de
 * reservar, Lusha en el reservado, y el resultado devuelto apunta al segundo. La
 * invariante de sistema se cumple (3 + 2 <= 5); el resultado único del producto
 * no.
 *
 * A diferencia de la ruta del wizard con Apollo, esta superficie tampoco tiene el
 * ancla durable de idempotencia/lote que el diseño de lote único necesita, así que
 * el ejecutor de pago no puede ADOPTAR el lote de la capa gratuita. El hito que lo
 * diseña es `AGENT1-MIXED-FREE-PAID-SINGLE-BATCH-1`. Esto es contención.
 *
 * ── Cómo se prueba, para que la mutación duela ───────────────────────────────
 *
 * El cableado de estas pruebas consume `LUSHA_PENDING_REVIEW_PARTIAL_GAP_SUPPORTED`,
 * la MISMA constante que pasa el llamador de producción — no una copia escrita a
 * mano. Voltearla a `true` pone en rojo las pruebas de comportamiento de aquí. Y
 * una guarda estática cubre la otra forma de la mutación: volver a escribir el
 * literal `true` en el sitio de la llamada sin tocar la constante.
 *
 * Sin Supabase, sin Lusha, sin Apollo, sin red, 0 créditos, 0 reservas.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  LUSHA_PENDING_REVIEW_MIN_USEFUL_CANDIDATES,
  LUSHA_PENDING_REVIEW_PARTIAL_GAP_SUPPORTED,
} from '@/server/prospect-batches/lusha-pending-review-limits';
import { WIZARD_APOLLO_PARTIAL_GAP_SUPPORTED } from '@/modules/prospect-batches/chat-wizard-execution/wizard-apollo-executor';
import {
  runPrePaidNoveltyDiscovery,
  type PrePaidNoveltyDiscoveryDeps,
} from '@/server/prospect-batches/country-source-discovery/run-prepaid-novelty-discovery.server';
import { buildPrePaidNoveltyContext } from '@/modules/prospect-batches/prepaid-novelty/prepaid-novelty-context';
import { planProviderExclusions } from '@/modules/prospect-batches/provider-seen/provider-exclusion-planner';
import {
  buildProviderSeenMemory,
  collectProviderSeenObservations,
  EMPTY_PROVIDER_SEEN_MEMORY,
} from '@/modules/prospect-batches/provider-seen/provider-seen-identity';
import {
  PROVIDER_SEEN_LOAD_EMPTY,
  PROVIDER_SEEN_LOAD_FAILED,
  type ProviderSeenLoadSummary,
} from '@/modules/prospect-batches/provider-seen/provider-seen-telemetry';
import type { CountrySourceCompany } from '@/server/prospect-batches/country-source-discovery/country-source-types';
import type { PrePaidNoveltyGateResult } from '@/server/prospect-batches/country-source-discovery/run-prepaid-novelty-gate';

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** El objetivo REAL de la superficie Lusha, no un número inventado. */
const TARGET = LUSHA_PENDING_REVIEW_MIN_USEFUL_CANDIDATES;

const USER_ID = '123e4567-e89b-12d3-a456-426614174031';
const FREE_BATCH_ID = 'batch-free-source-lusha-containment';

const CLIENT = {} as unknown as SupabaseClient;

function company(index: number): CountrySourceCompany {
  return {
    recordIdentityKey: `free-lusha-${index}`,
    legalName: `SINTETICA LIBRE ${index}`,
    normalizedLegalName: `sintetica libre ${index}`,
    taxId: `9300000${index}`,
    taxIdentifierType: 'NIT',
    countryCode: 'CO',
    city: null,
    region: null,
    domain: `sintetica-libre-${index}.co`,
    declaredIndustry: 'Fabricación de productos farmacéuticos',
    industryCode: '2100',
    coarseSector: 'MANUFACTURA',
  };
}

type FreeLayer = {
  deps: PrePaidNoveltyDiscoveryDeps;
  /** 🔴 Cuántas veces la capa gratuita intentó ESCRIBIR su propio lote. */
  persistCalls: number;
};

/**
 * Dobles SÓLO de los dos bordes de I/O del runner compartido (`runGate`,
 * `persist`). El runner en sí es el de PRODUCCIÓN, y el valor de
 * `partialGapSupported` que recibe también.
 */
function freeLayer(input: {
  acceptedNovel: number;
  persistedCount: number;
  providerSeen?: ProviderSeenLoadSummary;
  providerSeenIds?: readonly string[];
}): FreeLayer {
  const accepted = Array.from({ length: input.acceptedNovel }, (_unused, i) => company(i));
  const context = buildPrePaidNoveltyContext({
    requestedTarget: TARGET,
    countryCode: 'CO',
    macroIndustryKey: 'health_pharma',
    freeSource: {
      sourceKey: 'co_siis_discovery',
      attempted: true,
      rawReturned: input.acceptedNovel,
      macroConfirmed: input.acceptedNovel,
      ambiguous: 0,
      rejected: 0,
      sellupKnown: 0,
      hubspotKnown: 0,
      acceptedNovel: input.acceptedNovel,
      failed: false,
      failureCode: null,
    },
  });

  const memory =
    input.providerSeenIds && input.providerSeenIds.length > 0
      ? buildProviderSeenMemory(
          collectProviderSeenObservations(
            'lusha',
            input.providerSeenIds.map((id) => ({ providerEntityId: id, domain: null })),
          ).observations,
        )
      : EMPTY_PROVIDER_SEEN_MEMORY;

  // 🔴 Los dominios de exclusión de Lusha son capacidad VERIFICADA y viajan de
  // verdad. El plan se construye con los dominios que la fuente gratuita aceptó,
  // que es la procedencia real de esta ruta.
  const exclusionPlan = planProviderExclusions('lusha', {
    freeSourceAcceptedDomains: accepted.map((c) => c.domain),
  });

  const gateResult: PrePaidNoveltyGateResult = {
    context,
    exclusionPlan: {
      available: exclusionPlan.domains.available,
      sent: exclusionPlan.domains.sent,
      omittedDueToCap: exclusionPlan.domains.omittedDueToCap,
    },
    providerExclusionPlan: exclusionPlan,
    providerSeen: input.providerSeen ?? PROVIDER_SEEN_LOAD_EMPTY,
    providerSeenMemory: memory,
    acceptedCompanies: accepted,
    telemetry: {},
  };

  const layer: FreeLayer = {
    persistCalls: 0,
    deps: {
      runGate: async () => gateResult,
      persist: async () => {
        layer.persistCalls++;
        return {
          batchId: input.persistedCount > 0 ? FREE_BATCH_ID : null,
          writtenCount: input.persistedCount,
          skippedCount: input.acceptedNovel - input.persistedCount,
          failed: input.persistedCount === 0,
        };
      },
    },
  };

  return layer;
}

/**
 * 🔴 El cableado que se prueba pasa `partialGapSupported` desde la constante de
 * producción, no desde un literal local. Es lo que convierte «voltear la
 * constante» en una mutación DETECTABLE por comportamiento y no sólo por grep.
 */
function runLive(
  free: PrePaidNoveltyDiscoveryDeps,
  partialGapSupported: boolean = LUSHA_PENDING_REVIEW_PARTIAL_GAP_SUPPORTED,
) {
  return runPrePaidNoveltyDiscovery(
    CLIENT,
    {
      provider: 'lusha',
      countryCode: 'CO',
      countryName: 'Colombia',
      macroIndustryKey: 'health_pharma',
      requestedTarget: TARGET,
      requestedByUserId: USER_ID,
      partialGapSupported,
    },
    free,
  );
}

// ── § 5 · el valor VIVO ───────────────────────────────────────────────────────

describe('§ 5 · la activación de hueco parcial de Lusha en producción está APAGADA', () => {
  it('🔴 `LUSHA_PENDING_REVIEW_PARTIAL_GAP_SUPPORTED` es `false`', () => {
    assert.equal(
      LUSHA_PENDING_REVIEW_PARTIAL_GAP_SUPPORTED,
      false,
      '🔴 encender esto reactiva el resultado en DOS lotes que este hito contiene; ' +
        'activarlo es AGENT1-MIXED-FREE-PAID-SINGLE-BATCH-1, no este corte',
    );
  });

  it('§ 10 · Apollo sigue igual: su constante NO la toca este hito', () => {
    assert.equal(
      WIZARD_APOLLO_PARTIAL_GAP_SUPPORTED,
      false,
      'la postura de contención de Apollo es la misma de antes',
    );
  });

  it('las dos rutas vivas comparten la MISMA postura de contención', () => {
    assert.equal(
      LUSHA_PENDING_REVIEW_PARTIAL_GAP_SUPPORTED,
      WIZARD_APOLLO_PARTIAL_GAP_SUPPORTED,
      'contención deliberadamente idéntica en las dos superficies',
    );
  });
});

// ── § 7 · el aporte PARCIAL no crea un segundo lote ──────────────────────────

describe('§ 7 · con aporte gratuito PARCIAL no hay lote gratuito separado', () => {
  it('🔴 3 de 5 gratis ⇒ NI escritura gratuita, NI demanda recortada', async () => {
    const free = freeLayer({ acceptedNovel: 3, persistedCount: 3 });

    const outcome = await runLive(free.deps);

    // 1. La capa gratuita ni siquiera intentó escribir su lote: el descarte
    //    ocurre ANTES de persistir, así que no existe un segundo lote que el
    //    usuario tendría que ir a buscar.
    assert.equal(free.persistCalls, 0, '🔴 0 escrituras de la capa gratuita');
    assert.equal(outcome.batchId, null, '🔴 ningún lote gratuito para esta corrida');
    assert.equal(outcome.persistedCount, 0);

    // 2. La ruta de pago corre con el objetivo ENTERO, como antes de esta
    //    superficie llamar a la capa gratuita.
    assert.equal(outcome.providerRequired, true);
    assert.equal(outcome.residualGap, TARGET, 'objetivo COMPLETO, no recortado');
    assert.equal(outcome.acceptedBeforeProvider, 0);
  });

  it('4 de 5 gratis tampoco activan el hueco parcial', async () => {
    const free = freeLayer({ acceptedNovel: 4, persistedCount: 4 });

    const outcome = await runLive(free.deps);

    assert.equal(free.persistCalls, 0);
    assert.equal(outcome.residualGap, TARGET);
    assert.equal(outcome.batchId, null);
  });

  it('1 de 5 gratis tampoco', async () => {
    const free = freeLayer({ acceptedNovel: 1, persistedCount: 1 });

    const outcome = await runLive(free.deps);

    assert.equal(free.persistCalls, 0);
    assert.equal(outcome.residualGap, TARGET);
    assert.equal(outcome.batchId, null);
  });

  it('🔴 persistencia PARCIAL de un aporte que cerraba el objetivo también se descarta', async () => {
    // El caso del segundo `if` del runner: la fuente aceptó 5 pero sólo se
    // guardaron 3, así que el objetivo se reabre. Sin hueco parcial, eso es una
    // no-contribución entera, no un lote a medias.
    const free = freeLayer({ acceptedNovel: TARGET, persistedCount: 3 });

    const outcome = await runLive(free.deps);

    assert.equal(free.persistCalls, 1, 'intentó escribir porque el gate cerraba el objetivo');
    assert.equal(outcome.batchId, null, '🔴 pero el lote NO se reporta como resultado');
    assert.equal(outcome.persistedCount, 0);
    assert.equal(outcome.residualGap, TARGET);
    assert.equal(outcome.acceptedBeforeProvider, 0);
  });

  it('🔴 CONTRASTE — la capacidad SÍ existe: invocada a propósito, el hueco es 2', async () => {
    // La misma capa gratuita, el mismo runner de producción, y
    // `partialGapSupported: true` pasado EXPLÍCITAMENTE. Esto es lo que producción
    // hará cuando el hito de lote único lo autorice, y es la prueba de que aquí no
    // se ha borrado ninguna capacidad.
    const free = freeLayer({ acceptedNovel: 3, persistedCount: 3 });

    const outcome = await runLive(free.deps, true);

    assert.equal(free.persistCalls, 1, 'con la capacidad activa el lote gratuito SÍ se escribe');
    assert.equal(outcome.batchId, FREE_BATCH_ID);
    assert.equal(outcome.persistedCount, 3);
    assert.equal(outcome.residualGap, 2, 'el hueco residual es real');
    assert.equal(outcome.acceptedBeforeProvider, 3);
    assert.equal(outcome.providerRequired, true);
  });
});

// ── § 6 · lo gratuito que cierra el objetivo sigue siendo GRATIS ─────────────

describe('§ 6 · la fuente gratuita que cierra el objetivo persiste y no gasta', () => {
  it('5 de 5 gratis ⇒ lote gratuito, proveedor NO requerido', async () => {
    const free = freeLayer({ acceptedNovel: TARGET, persistedCount: TARGET });

    const outcome = await runLive(free.deps);

    assert.equal(free.persistCalls, 1);
    assert.equal(outcome.batchId, FREE_BATCH_ID, 'el lote gratuito ES el resultado');
    assert.equal(outcome.persistedCount, TARGET);
    assert.equal(outcome.residualGap, 0);
    assert.equal(
      outcome.providerRequired,
      false,
      '🔴 `false` es lo que corta estimación, reserva, credencial y petición en el llamador',
    );
  });

  it('más de lo pedido tampoco requiere proveedor', async () => {
    const free = freeLayer({ acceptedNovel: TARGET + 3, persistedCount: TARGET + 3 });

    const outcome = await runLive(free.deps);

    assert.equal(outcome.providerRequired, false);
    assert.equal(outcome.residualGap, 0);
  });
});

// ── § 8 · la MEDICIÓN y la exclusión de dominios sobreviven al descarte ──────

describe('§ 8 · el descarte se lleva la CONTRIBUCIÓN, nunca la medición', () => {
  it('🔴 memoria provider-seen leída con éxito sobrevive al descarte', async () => {
    const free = freeLayer({
      acceptedNovel: 3,
      persistedCount: 3,
      providerSeen: {
        loaded: true,
        unavailableReason: null,
        idsAvailable: 2,
        domainsAvailable: 0,
        readOutcome: 'succeeded',
      },
      providerSeenIds: ['lusha_previa_1', 'lusha_previa_2'],
    });

    const outcome = await runLive(free.deps);

    assert.equal(outcome.providerSeenLoad.loaded, true, '🔴 la medición sobrevive');
    assert.equal(outcome.providerSeenMemory.providerEntityIds.size, 2);
    // Y el descarte del APORTE sigue intacto: son dos hechos distintos.
    assert.equal(free.persistCalls, 0);
    assert.equal(outcome.residualGap, TARGET);
  });

  it('🔴 lectura FALLIDA ⇒ ausencia NOMBRADA, jamás memoria vacía disfrazada', async () => {
    const free = freeLayer({
      acceptedNovel: 3,
      persistedCount: 3,
      providerSeen: PROVIDER_SEEN_LOAD_FAILED,
    });

    const outcome = await runLive(free.deps);

    assert.equal(outcome.providerSeenLoad.loaded, false);
    assert.equal(outcome.providerSeenLoad.readOutcome, PROVIDER_SEEN_LOAD_FAILED.readOutcome);
    assert.equal(outcome.residualGap, TARGET);
  });

  it('🔴 § 3 · los dominios de exclusión de Lusha SIGUEN viajando tras el descarte', async () => {
    // Es la capacidad VERIFICADA del contrato V3 y la ruta ya la emite en
    // Producción. La contención no puede llevársela: es lo que evita volver a
    // pagar por empresas que la fuente gratuita acaba de ver.
    const free = freeLayer({ acceptedNovel: 3, persistedCount: 3 });

    const outcome = await runLive(free.deps);

    assert.equal(free.persistCalls, 0, 'el aporte se descartó');
    assert.deepEqual(
      [...outcome.exclusionDomains].sort(),
      ['sintetica-libre-0.co', 'sintetica-libre-1.co', 'sintetica-libre-2.co'],
      '🔴 y aun así los dominios llegan al proveedor',
    );
  });

  /**
   * 🔴 EFECTO ABIERTO, pinchado a propósito y NO arreglado en este PR.
   *
   * `exclusionDomains` (lo que VIAJA a Lusha) sobrevive al descarte, pero
   * `providerExclusionPlan` (la vista EXPLICABLE de telemetría) vuelve al plan
   * vacío que `noContribution` construye. Ese `noContribution` se escribió para
   * Apollo, donde las exclusiones están apagadas por capacidad y un plan vacío es
   * la verdad. En Lusha NO lo es: los dominios sí viajan, así que la telemetría
   * publicará `provider_exclusion_domains_sent: 0` sobre un envío real de 3.
   *
   * Es una asimetría de OBSERVABILIDAD, no de gasto ni de privacidad, y § 8 de
   * este hito prohíbe tocar la semántica de provider-seen / exclusión. Se fija
   * aquí para que sea VISIBLE y decidible, no silenciosa.
   */
  it('🔴 EFECTO ABIERTO · el plan explicable queda vacío aunque los dominios viajen', async () => {
    const free = freeLayer({ acceptedNovel: 3, persistedCount: 3 });

    const outcome = await runLive(free.deps);

    assert.equal(outcome.exclusionDomains.length, 3, 'viajan 3 dominios de verdad');
    assert.equal(
      outcome.providerExclusionPlan.domains.sent.length,
      0,
      '🔴 pero el plan de telemetría reporta 0 — divergencia CONOCIDA, no arreglada aquí',
    );
    assert.equal(outcome.providerExclusionPlan.provider, 'lusha');
  });
});

// ── § 4 · la otra forma de la mutación: el literal en el sitio de la llamada ──

const ROOT = path.resolve(__dirname, '../../../..');
const LUSHA_ACTION = 'src/modules/prospect-batches/lusha-pending-review-actions.ts';
const LUSHA_LIMITS = 'src/server/prospect-batches/lusha-pending-review-limits.ts';

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

/**
 * 🔴 Con los COMENTARIOS FUERA. Este archivo y el llamador NOMBRAN
 * `partialGapSupported: true` en su prosa, y una guarda que leyera el cuerpo
 * crudo confundiría «citarlo» con «usarlo» — el falso positivo exacto de
 * AGENT2A-SEARCH-MORE-PHONES-1G.
 */
function stripTsComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('//');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');
}

describe('§ 4 · el sitio de la llamada no puede recuperar el literal', () => {
  it('el llamador vivo pasa la CONSTANTE, no un booleano escrito a mano', () => {
    const code = stripTsComments(read(LUSHA_ACTION));

    assert.ok(
      code.includes('partialGapSupported: LUSHA_PENDING_REVIEW_PARTIAL_GAP_SUPPORTED,'),
      'el valor vivo se decide en un solo sitio',
    );
    for (const forbidden of ['partialGapSupported: true', 'partialGapSupported: !']) {
      assert.ok(
        !code.includes(forbidden),
        `🔴 la activación no puede volver por el sitio de la llamada (${forbidden})`,
      );
    }
  });

  it('la constante se declara `false` en su único dueño', () => {
    const code = stripTsComments(read(LUSHA_LIMITS));
    assert.ok(
      code.includes('export const LUSHA_PENDING_REVIEW_PARTIAL_GAP_SUPPORTED = false;'),
      'la declaración es literal y grep-able',
    );
  });

  it('🔴 hay exactamente UN sitio de llamada vivo en la superficie Lusha', () => {
    const code = stripTsComments(read(LUSHA_ACTION));
    const occurrences = code.split('partialGapSupported:').length - 1;
    assert.equal(occurrences, 1, 'una segunda copia sería una segunda autoridad');
  });

  /** 🔴 EN NEGATIVO — la guarda detecta la mutación en el sitio de la llamada. */
  it('mutación: reescribir el literal en el llamador pone la guarda en rojo', () => {
    const mutated = stripTsComments(read(LUSHA_ACTION)).replace(
      'partialGapSupported: LUSHA_PENDING_REVIEW_PARTIAL_GAP_SUPPORTED,',
      'partialGapSupported: true,',
    );
    assert.ok(
      !mutated.includes('partialGapSupported: LUSHA_PENDING_REVIEW_PARTIAL_GAP_SUPPORTED,'),
      'la copia mutada perdió el anclaje',
    );
    assert.ok(mutated.includes('partialGapSupported: true'), 'y gana el literal prohibido');
  });

  /** 🔴 EN NEGATIVO — y también la mutación de la constante. */
  it('mutación: voltear la constante pone su guarda en rojo', () => {
    const mutated = stripTsComments(read(LUSHA_LIMITS)).replace(
      'export const LUSHA_PENDING_REVIEW_PARTIAL_GAP_SUPPORTED = false;',
      'export const LUSHA_PENDING_REVIEW_PARTIAL_GAP_SUPPORTED = true;',
    );
    assert.ok(
      !mutated.includes('export const LUSHA_PENDING_REVIEW_PARTIAL_GAP_SUPPORTED = false;'),
      'la copia mutada perdió la declaración `false`',
    );
  });
});

// ── § 6 · el orden que hace VERDAD el «0 reservas, 0 llamadas» ───────────────

describe('§ 6 · la salida gratuita ocurre ARRIBA de todo lo que cuesta dinero', () => {
  it('🔴 el early-return por `providerRequired` precede a estimación, reserva, credencial y petición', () => {
    const code = stripTsComments(read(LUSHA_ACTION));

    const wiring = code.indexOf('partialGapSupported: LUSHA_PENDING_REVIEW_PARTIAL_GAP_SUPPORTED,');
    const earlyReturn = code.indexOf('if (!prePaid.providerRequired)');
    const estimate = code.indexOf('estimateLushaRunCredits(');
    const reserve = code.indexOf('guardLushaRunBudget(');

    assert.ok(wiring > -1, 'el cableado vivo existe');
    assert.ok(earlyReturn > wiring, 'la salida gratuita se decide DESPUÉS de la capa gratuita');
    assert.ok(estimate > earlyReturn, '🔴 la estimación queda por DEBAJO de la salida gratuita');
    assert.ok(reserve > estimate, '🔴 y la reserva por debajo de la estimación');

    // La credencial y la petición al proveedor viven dentro de la ejecución
    // reservada, que es lo último.
    // 🔴 Con paréntesis/llave: `getLushaApiKey` y `searchLushaCompaniesV3` también
    // aparecen en el bloque de imports, ARRIBA de todo, y compararlos por nombre
    // desnudo confundiría «importarlo» con «llamarlo».
    for (const paid of ['getLushaApiKey()', 'searchLushaCompaniesV3({']) {
      assert.ok(code.indexOf(paid) > reserve, `🔴 ${paid} nunca por encima de la reserva`);
    }
  });
});
