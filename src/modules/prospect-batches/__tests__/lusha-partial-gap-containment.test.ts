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
  type ProviderSeenProvider,
} from '@/modules/prospect-batches/provider-seen/provider-seen-identity';
import {
  buildProviderSeenTelemetry,
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
  /**
   * 🔴 REVIEW-1 § 6 — el proveedor decide la CAPACIDAD de exclusión, así que la
   * puerta doblada tiene que planificar para el mismo que el runner recibe. Sin
   * esto no se puede probar que Apollo sigue saliendo con `sent: []` por
   * capacidad apagada mientras Lusha sale con sus dominios reales.
   */
  provider?: ProviderSeenProvider;
}): FreeLayer {
  const provider: ProviderSeenProvider = input.provider ?? 'lusha';
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
            provider,
            input.providerSeenIds.map((id) => ({ providerEntityId: id, domain: null })),
          ).observations,
        )
      : EMPTY_PROVIDER_SEEN_MEMORY;

  // 🔴 Los dominios de exclusión de Lusha son capacidad VERIFICADA y viajan de
  // verdad. El plan se construye con los dominios que la fuente gratuita aceptó,
  // que es la procedencia real de esta ruta.
  const exclusionPlan = planProviderExclusions(provider, {
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
  provider: ProviderSeenProvider = 'lusha',
) {
  return runPrePaidNoveltyDiscovery(
    CLIENT,
    {
      provider,
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

  /**
   * 🔴 AGENT1-LOCAL-CUT6-PARTIAL-ACTIVATION § 15 — estos dos casos afirmaban que
   * Apollo seguía en `false` y que las dos rutas compartían postura. CUT-6 encendió
   * Apollo porque CUT-5 le dio lote canónico compartido; Lusha pending-review NO lo
   * recibe (CUT-5 § 9), así que allí un aporte parcial todavía partiría el
   * resultado en dos lotes.
   *
   * La asimetría pasa a ser el contrato, y es lo que se congela: la contención de
   * Lusha no puede caerse «por simetría» con la de Apollo.
   */
  it('§ 10 · la contención de Lusha NO depende de la postura de Apollo', () => {
    assert.equal(
      LUSHA_PENDING_REVIEW_PARTIAL_GAP_SUPPORTED,
      false,
      '🔴 esta superficie sigue sin ancla de lote canónico',
    );
    assert.equal(
      WIZARD_APOLLO_PARTIAL_GAP_SUPPORTED,
      true,
      'Apollo se activó en CUT-6, y eso no arrastra a Lusha',
    );
  });

  it('🔴 las dos rutas vivas ya NO comparten postura, y la diferencia es deliberada', () => {
    assert.notEqual(
      LUSHA_PENDING_REVIEW_PARTIAL_GAP_SUPPORTED,
      WIZARD_APOLLO_PARTIAL_GAP_SUPPORTED,
      'cada superficie decide con su propia constante, no por imitación',
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

  it('🔴 persistencia PARCIAL: la CONTRIBUCIÓN se descarta, la VERDAD DURABLE no', async () => {
    // El caso del segundo `if` del runner: la fuente aceptó 5 pero sólo se
    // guardaron 3, así que el objetivo se reabre. Sin hueco parcial, eso es una
    // no-contribución entera, no un lote a medias.
    //
    // ── REANCLADA por AGENT1-LOCAL-CUT9A § 6 ────────────────────────────────
    //
    // 🔴 Esta prueba afirmaba TAMBIÉN `batchId: null` y `persistedCount: 0`, y eso
    // no era contención: era el defecto. Las 3 filas se escribieron de verdad y el
    // lote existe de verdad; devolver ceros dejaba unas filas huérfanas que el
    // usuario sí acaba viendo en la cola, y una corrida afirmando que no escribió
    // nada. La guarda estaba defendiendo la mentira, no la política.
    //
    // Lo que esta prueba protege sigue siendo la CONTENCIÓN, y se protege ENTERA:
    // el aporte no recorta el objetivo, el proveedor corre completo y nada se
    // descuenta. Lo que deja de exigir es que se mienta sobre lo ya persistido.
    const free = freeLayer({ acceptedNovel: TARGET, persistedCount: 3 });

    const outcome = await runLive(free.deps);

    assert.equal(free.persistCalls, 1, 'intentó escribir porque el gate cerraba el objetivo');

    // ── CONTENCIÓN (sin cambios) — el hueco parcial NO está activado ──
    assert.equal(outcome.residualGap, TARGET, 'el aporte parcial recortó el objetivo');
    assert.equal(outcome.acceptedBeforeProvider, 0, 'el aporte parcial se acreditó');
    assert.equal(outcome.providerRequired, true);

    // ── VERDAD DURABLE (CUT9A § 6) — lo escrito se dice ──
    assert.equal(outcome.persistedCount, 3, '🔴 se falsearon a 0 unas filas reales');
    assert.equal(outcome.batchId, FREE_BATCH_ID, '🔴 un lote REAL se reportó como nulo');
  });

  it('🔴 CUT9A § 6 — sin filas escritas, «cero» sigue siendo la verdad', async () => {
    // El contraste que impide leer lo anterior como «siempre reporta lote»: cuando
    // la escritura no dejó NADA, cero y lote nulo son exactos, y siguen siéndolo.
    const free = freeLayer({ acceptedNovel: TARGET, persistedCount: 0 });

    const outcome = await runLive(free.deps);

    assert.equal(free.persistCalls, 1);
    assert.equal(outcome.persistedCount, 0);
    assert.equal(outcome.batchId, null);
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
   * 🔴 REVIEW-1 §§ 3, 4, 9 — el RATCHET INVERTIDO.
   *
   * Este caso existía en el corte anterior fijando el defecto: `exclusionDomains`
   * (lo que VIAJA a Lusha) sobrevivía al descarte, pero `providerExclusionPlan`
   * (la vista MEDIBLE) volvía al plan vacío que `noContribution` reconstruía. Ese
   * `noContribution` se escribió para Apollo, donde la capacidad de exclusión está
   * apagada y un plan vacío es la verdad; en Lusha NO lo era, así que la
   * telemetría publicaba `provider_exclusion_domains_sent: 0` sobre un envío REAL
   * de 3 dominios.
   *
   * La cobertura no se borra: se INVIERTE. Lo que ahora se exige es el acuerdo —
   * la lista que se envía y la que se mide tienen que contar el MISMO envío.
   */
  it('🔴 RATCHET INVERTIDO · lo que viaja y lo que se mide cuentan el MISMO envío', async () => {
    const free = freeLayer({ acceptedNovel: 3, persistedCount: 3 });

    const outcome = await runLive(free.deps);

    assert.equal(free.persistCalls, 0, 'el aporte se descartó');
    assert.equal(outcome.exclusionDomains.length, 3, 'viajan 3 dominios de verdad');
    assert.equal(
      outcome.providerExclusionPlan.domains.sent.length,
      3,
      '🔴 y el plan medible dice 3, no 0',
    );
    assert.equal(outcome.providerExclusionPlan.provider, 'lusha');

    // 🔴 El acuerdo se afirma sobre las LISTAS, no sólo sobre sus longitudes: dos
    // cuentas iguales sobre dominios distintos seguirían siendo una divergencia.
    assert.deepEqual(
      [...outcome.providerExclusionPlan.domains.sent].sort(),
      [...outcome.exclusionDomains].sort(),
      '🔴 misma lista, no sólo misma cantidad',
    );
  });

  /**
   * 🔴 REVIEW-1 § 7 — el acuerdo, visto desde la telemetría PUBLICADA.
   *
   * No basta con que el objeto del plan tenga 3: lo que un operador lee es
   * `provider_exclusion_domains_sent`, y ése sale de `buildProviderSeenTelemetry`,
   * el mismo constructor canónico que `toLushaRunTelemetryMetadata` invoca con
   * `telemetry.providerExclusionPlan`. Se afirma sobre ESE campo para que la
   * prueba no dependa de una forma intermedia que nadie publica.
   */
  it('🔴 § 7 · `provider_exclusion_domains_sent` publica 3, y coincide con lo enviado', async () => {
    const free = freeLayer({ acceptedNovel: 3, persistedCount: 3 });

    const outcome = await runLive(free.deps);

    const published = buildProviderSeenTelemetry({
      freeSource: outcome.freeSource,
      providerSeen: outcome.providerSeenLoad,
      exclusionPlan: outcome.providerExclusionPlan,
    });

    assert.equal(
      published.provider_exclusion_domains_sent,
      3,
      '🔴 la telemetría ya no reporta 0 sobre un envío de 3',
    );
    assert.equal(
      published.provider_exclusion_domains_sent,
      outcome.exclusionDomains.length,
      '🔴 las dos vistas del MISMO envío tienen que estar de acuerdo',
    );
    // La capacidad de dominios de Lusha está encendida: «0 enviados» nunca puede
    // leerse como «no soportado» en esta ruta.
    assert.equal(published.provider_exclusion_domains_unsupported_reason, null);
  });

  /**
   * 🔴 REVIEW-1 § 6 — Apollo no cambia de comportamiento.
   *
   * El plan arrastrado es el REAL, no uno reconstruido, y aun así sale con
   * `sent: []`: `APOLLO_EXCLUSION_CAPABILITY` tiene los dominios apagados, así que
   * el vacío de Apollo es una VERDAD de capacidad y no un efecto del descarte. Es
   * exactamente la asimetría que hacía que el plan vacío pareciera correcto.
   */
  it('🔴 § 6 · Apollo con capacidad APAGADA sigue en vacío, y es la verdad', async () => {
    const free = freeLayer({ acceptedNovel: 3, persistedCount: 3, provider: 'apollo' });

    const outcome = await runLive(free.deps, WIZARD_APOLLO_PARTIAL_GAP_SUPPORTED, 'apollo');

    // 🔴 CUT-6 — con la activación viva el aporte YA NO se descarta: se persiste.
    // El punto de este caso nunca fue el descarte, sino que el vacío de
    // exclusiones de Apollo es una verdad de CAPACIDAD y no un efecto del
    // descarte — y eso se demuestra MEJOR ahora, con el aporte conservado.
    assert.equal(free.persistCalls, 1, 'el aporte parcial se persiste (CUT-6)');
    assert.deepEqual([...outcome.exclusionDomains], [], 'Apollo no envía exclusiones');
    assert.deepEqual(
      [...outcome.providerExclusionPlan.domains.sent],
      [],
      '🔴 y su plan medible también está vacío',
    );
    assert.equal(outcome.providerExclusionPlan.provider, 'apollo');
    // 🔴 Y el vacío queda EXPLICADO: «0 enviados» por capacidad, no por falta de
    // material. Es la diferencia que el corte 1 pidió no perder.
    assert.equal(
      outcome.providerExclusionPlan.domains.unsupportedReason,
      'apollo_exclusion_contract_unverified',
    );
    assert.equal(
      outcome.residualGap,
      TARGET - 3,
      '🔴 y la ruta de pago corre por el HUECO, no por el objetivo entero',
    );
  });

  /**
   * 🔴 REVIEW-1 § 6 — el ÚNICO delta que Apollo sí ve, fijado a propósito.
   *
   * Lo que viaja no cambia: `sent` sigue en 0 y no se introduce ni una exclusión
   * en el cuerpo de la petición de Apollo. Lo que cambia es que el plan arrastrado
   * es el REAL, así que sus contadores de «lo que se sabía» dejan de estar en 0:
   * `available` y `omittedDueToCapability` pasan a 3 donde el plan reconstruido
   * decía 0.
   *
   * Es la dirección correcta y es literalmente para lo que esos campos existen —
   * «que “0 enviados” nunca se lea como “no había nada que enviar”»—, pero es un
   * cambio de telemetría en la ruta Apollo y por eso se PINCHA aquí en vez de
   * dejarlo pasar como efecto colateral silencioso.
   */
  it('🔴 § 6 · Apollo: `sent` intacto en 0, y sus contadores de capacidad dejan de mentir', async () => {
    const free = freeLayer({ acceptedNovel: 3, persistedCount: 3, provider: 'apollo' });

    const outcome = await runLive(free.deps, WIZARD_APOLLO_PARTIAL_GAP_SUPPORTED, 'apollo');
    const domains = outcome.providerExclusionPlan.domains;

    // 🔴 Lo que viaja: idéntico. Es el invariante de § 5 del acta.
    assert.equal(domains.sent.length, 0, '🔴 Apollo no gana ni una exclusión enviada');
    assert.equal(outcome.exclusionDomains.length, 0);

    // Lo que se MIDE: ahora es verdad.
    assert.equal(domains.available, 3, 'se conocían 3 dominios');
    assert.equal(domains.omittedDueToCapability, 3, '🔴 y los 3 se omitieron por CAPACIDAD');
    assert.equal(domains.omittedDueToCap, 0, 'ninguno cayó por el tope propio');

    // Y el acuerdo de § 3 también se sostiene en Apollo, por el otro lado: 0 = 0.
    const published = buildProviderSeenTelemetry({
      freeSource: outcome.freeSource,
      providerSeen: outcome.providerSeenLoad,
      exclusionPlan: outcome.providerExclusionPlan,
    });
    assert.equal(published.provider_exclusion_domains_sent, 0);
    assert.equal(published.provider_exclusion_domains_available, 3);
  });

  /**
   * 🔴 REVIEW-1 § 7 (FAILURE CASE) — sin plan resuelto, el vacío sigue permitido.
   *
   * El arreglo arrastra el plan de la puerta; no INVENTA uno. Si la puerta no pudo
   * producir nada —fuente sin cablear, lectura caída— el descarte publica el plan
   * por defecto, y ahí «vacío» es la verdad literal: no hubo envío que medir.
   */
  it('🔴 sin puerta que aporte plan, el vacío por defecto sigue siendo válido', async () => {
    const free = freeLayer({
      acceptedNovel: 0,
      persistedCount: 0,
      providerSeen: PROVIDER_SEEN_LOAD_FAILED,
    });

    const outcome = await runLive(free.deps);

    assert.deepEqual([...outcome.exclusionDomains], [], 'no había dominios que enviar');
    assert.deepEqual(
      [...outcome.providerExclusionPlan.domains.sent],
      [],
      '🔴 y el plan lo dice sin inventar nada',
    );
    // El acuerdo se sostiene también en el caso degenerado.
    assert.equal(
      outcome.providerExclusionPlan.domains.sent.length,
      outcome.exclusionDomains.length,
    );
  });
});

// ── § 4 · la otra forma de la mutación: el literal en el sitio de la llamada ──

const ROOT = path.resolve(__dirname, '../../../..');
const LUSHA_ACTION = 'src/modules/prospect-batches/lusha-pending-review-actions.ts';
const LUSHA_LIMITS = 'src/server/prospect-batches/lusha-pending-review-limits.ts';
const SHARED_RUNNER =
  'src/server/prospect-batches/country-source-discovery/run-prepaid-novelty-discovery.server.ts';

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

// ── § 3/§ 4/§ 8 · el ACUERDO, visto desde el cableado ────────────────────────

/**
 * 🔴 REVIEW-1 §§ 3, 4, 8 — las dos vistas del mismo envío salen del MISMO objeto.
 *
 * Las pruebas de comportamiento de § 8 ya fijan que el plan arrastrado coincide
 * con los dominios enviados. Lo que estas guardas defienden es la otra mitad: que
 * el ejecutor de pago siga leyendo LAS DOS del mismo `prePaid`, y que el runner
 * compartido siga ARRASTRANDO el plan de la puerta en vez de reconstruirlo.
 *
 * Es la mutación que § 8 del acta pide probar en negativo: volver a poner
 * `planProviderExclusions(input.provider, {})` en la ruta de descarte devolvería
 * el defecto —telemetría en 0 sobre un envío real— sin tocar ni un byte de lo que
 * viaja al proveedor, así que ninguna prueba de gasto lo vería.
 */
describe('§ 3 · lo que viaja y lo que se mide comparten autoridad', () => {
  it('🔴 el ejecutor de pago lee las DOS vistas del mismo `prePaid`', () => {
    const code = stripTsComments(read(LUSHA_ACTION));

    assert.ok(
      code.includes('excludeDomains: prePaid.exclusionDomains,'),
      'la lista que viaja al cuerpo de la petición sigue siendo la del runner',
    );
    assert.ok(
      code.includes('providerExclusionPlan: prePaid.providerExclusionPlan,'),
      '🔴 y la vista medible viaja al mismo sitio, desde el mismo resultado',
    );
  });

  it('🔴 el runner compartido ARRASTRA el plan de la puerta, no lo reconstruye', () => {
    const code = stripTsComments(read(SHARED_RUNNER));

    // Las dos rutas de descarte pasan el plan resuelto por la puerta.
    const carried = code.split('providerExclusionPlan: gate.providerExclusionPlan,').length - 1;
    assert.equal(
      carried,
      4,
      '🔴 dos rutas de descarte + dos salidas normales arrastran el plan de la puerta',
    );

    // 🔴 Y el plan vacío sobrevive SÓLO como valor por defecto del paquete, que es
    // el caso «no hay puerta de la que arrastrar». Una segunda aparición sería una
    // reconstrucción, que es exactamente el defecto de REVIEW-1 § 3.
    const rebuilt = code.split('planProviderExclusions(input.provider, {})').length - 1;
    assert.equal(rebuilt, 1, '🔴 el plan vacío sólo puede ser el DEFECTO, nunca el descarte');
  });

  /** 🔴 EN NEGATIVO — la guarda detecta la reconstrucción del plan vacío. */
  it('mutación: reconstruir el plan vacío en el descarte pone la guarda en rojo', () => {
    const mutated = stripTsComments(read(SHARED_RUNNER)).replace(
      'providerExclusionPlan: gate.providerExclusionPlan,\n    });',
      'providerExclusionPlan: planProviderExclusions(input.provider, {}),\n    });',
    );

    const carried = mutated.split('providerExclusionPlan: gate.providerExclusionPlan,').length - 1;
    const rebuilt = mutated.split('planProviderExclusions(input.provider, {})').length - 1;

    assert.ok(
      carried < 4 || rebuilt > 1,
      '🔴 la copia mutada pierde un arrastre o gana una reconstrucción',
    );
  });
});
