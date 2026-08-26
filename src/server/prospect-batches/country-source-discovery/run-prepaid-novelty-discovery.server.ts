/**
 * run-prepaid-novelty-discovery.server.ts — la capa gratuita, ya ejecutada y
 * persistida, lista para que una ruta de proveedor la consuma.
 *
 * AGENT1-COUNTRY-SOURCE-PREPAID-NOVELTY-GATE-1 §§ 13, 14, 16, 25.
 *
 * ── 🔴 `partialGapSupported`: la diferencia honesta entre las dos rutas ──────
 *
 * La invariante de § 14 —`aceptadasGratis + aceptadasPagadas <= objetivo`— sólo se
 * puede garantizar si el ejecutor de pago sabe cuántas empresas ACEPTAR. La ruta
 * Lusha lo sabe: `resolveLushaTargetGap` existe desde el ejecutor multirrama y
 * `canAcceptLushaUsefulCandidate` la hace cumplir dentro de cada página pagada.
 *
 * 🔴 AGENT1-LUSHA-MIXED-TWO-BATCH-CONTAINMENT-1 §§ 2, 4 — y aun sabiéndolo, la
 * ruta Lusha pasa `false` desde este hito. Saber aceptar un objetivo reducido no
 * era la única condición: el aporte parcial gratuito se persiste en su PROPIO
 * lote, y esta superficie NO tiene el ancla durable de idempotencia/lote que
 * permitiría al ejecutor de pago adoptarlo. Con `true`, UNA búsqueda terminaba en
 * DOS lotes —y eso estuvo VIVO en producción hasta esta contención—. El valor
 * vivo de la ruta Lusha se decide en UN sitio,
 * `LUSHA_PENDING_REVIEW_PARTIAL_GAP_SUPPORTED`.
 *
 * 🔴 AGENT1-LOCAL-CUT6-PARTIAL-ACTIVATION §§ 3, 5, 15 — la ruta APOLLO ya NO pasa
 * `false`. `WIZARD_APOLLO_PARTIAL_GAP_SUPPORTED` es `true` desde CUT-6, así que
 * por esta rama un aporte parcial SOBREVIVE: se persiste en el lote canónico de la
 * ejecución y el hueco que queda es el que la ruta de pago recibe.
 *
 * Las dos condiciones que lo bloqueaban están cerradas, y son distintas:
 *
 *   · SABER aceptar un objetivo reducido — cerrada por
 *     AGENT1-APOLLO-BENCHMARK-PARITY-CUT-2: `resultDemand` viaja por su propio
 *     campo hasta `targetPersistibleCandidates`, y `boundByRemainingTarget` es su
 *     única cota.
 *   · Tener DÓNDE persistirlo sin partir el resultado — cerrada por
 *     AGENT1-LOCAL-CUT5-SINGLE-BATCH-PLUMBING: `resolveBatchId` entrega el lote de
 *     la ejecución, así que lo gratuito y lo de pago comparten `batch_id` y ya no
 *     hay una búsqueda que termine en dos lotes.
 *
 * 🔴 Lo que sigue en `false` es la ruta LUSHA de pending-review
 * (`LUSHA_PENDING_REVIEW_PARTIAL_GAP_SUPPORTED`), y no por inercia: esa superficie
 * NO recibe `resolveBatchId` —no forma parte de CUT-5 (§ 9)— así que allí el
 * aporte parcial seguiría creando lote propio. La asimetría ES el contrato, y por
 * eso este runner sigue OBEDECIENDO el parámetro en vez de decidir por su cuenta.
 *
 * Consecuencia, y por qué esta bandera existe en vez de un apaño: con
 * `partialGapSupported: false` la capa gratuita es TODO-O-NADA. O cierra el
 * objetivo entero —y entonces el proveedor no corre y no se persiste nada de
 * pago— o no aporta a ESTA corrida y el proveedor corre con el objetivo completo.
 * Lo que NO hace es persistir 2 empresas gratis y dejar que Apollo persista 10
 * más: eso rompería la invariante y el usuario recibiría 12 donde pidió 10.
 *
 * 🔴 Con `true` la invariante de § 14 la sigue sosteniendo el hueco, no el
 * descarte: la ruta de pago recibe `residualGap` y su objetivo de ACEPTACIÓN se
 * recorta a él, así que 2 gratis + 8 de pago siguen siendo 10, nunca 12.
 *
 * 🔴 Lo que el descarte NO tira es la MEDICIÓN: la memoria provider-seen leída con
 * éxito sobrevive al descarte y llega a la ruta de pago. Ver `noContribution`.
 *
 * 🔴 AGENT1-LUSHA-MIXED-TWO-BATCH-CONTAINMENT-1 REVIEW-1 §§ 3, 4 — y tampoco tira
 * el PLAN DE EXCLUSIÓN ya resuelto. La lista de dominios sobrevivía al descarte
 * desde el corte anterior, pero su vista explicable volvía al plan vacío, así que
 * la telemetría publicaba `provider_exclusion_domains_sent: 0` sobre un envío REAL
 * de 3 en la ruta Lusha. Eran dos vistas del MISMO envío contándolo distinto: la
 * que viaja (`exclusionDomains`) y la que se mide (`providerExclusionPlan`). Ahora
 * las dos salen del plan que la puerta ya resolvió, así que no pueden divergir.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  notAttemptedFreeSourceOutcome,
  withFreeSourcePersistenceOutcome,
  type PrePaidFreeSourceOutcome,
} from '@/modules/prospect-batches/prepaid-novelty/prepaid-novelty-context';
import {
  planProviderExclusions,
  type ProviderExclusionPlan,
} from '@/modules/prospect-batches/provider-seen/provider-exclusion-planner';
import {
  PROVIDER_SEEN_LOAD_UNAVAILABLE,
  type ProviderSeenLoadSummary,
} from '@/modules/prospect-batches/provider-seen/provider-seen-telemetry';
import { buildPrePaidNoveltyTelemetry } from '@/modules/prospect-batches/prepaid-novelty/prepaid-novelty-telemetry';
import { runProductionPrePaidNoveltyGate } from './prepaid-novelty-gate.server';
import {
  EMPTY_PROVIDER_SEEN_MEMORY,
  type ProviderSeenMemory,
  type ProviderSeenProvider,
} from '@/modules/prospect-batches/provider-seen/provider-seen-identity';
import { persistCountrySourceCandidates } from './persist-country-source-candidates';

export type PrePaidNoveltyDiscoveryInput = {
  /**
   * ADDENDUM PROVIDER-SEEN §§ 5, 6 — qué proveedor de pago correría después.
   * Decide la CAPACIDAD de exclusión y de qué memoria se lee. Sin valor por
   * defecto a propósito.
   */
  provider: ProviderSeenProvider;
  countryCode: string;
  countryName: string;
  macroIndustryKey: string | null;
  requestedTarget: number;
  requestedByUserId: string;
  /**
   * ¿Puede el ejecutor de pago de esta ruta aceptar un objetivo REDUCIDO?
   *
   * `true`  — un hueco parcial se aprovecha.
   * `false` — todo o nada. Ver la cabecera.
   *
   * 🔴 AGENT1-LOCAL-CUT6-PARTIAL-ACTIVATION § 15 — las dos rutas vivas ya NO
   * coinciden, y la diferencia es deliberada: Apollo pasa `true`
   * (`WIZARD_APOLLO_PARTIAL_GAP_SUPPORTED`) porque CUT-5 le dio lote canónico
   * compartido; Lusha pending-review sigue en `false`
   * (`LUSHA_PENDING_REVIEW_PARTIAL_GAP_SUPPORTED`) porque su superficie no lo
   * recibe y allí un aporte parcial todavía crearía un segundo lote. Este runner
   * sólo obedece: no mira constantes ni decide por proveedor.
   */
  partialGapSupported: boolean;
  /**
   * AGENT1-LOCAL-CUT5-SINGLE-BATCH-PLUMBING §§ 4, 5, 6 — el lote CANÓNICO de la
   * ejecución que envuelve a esta capa, resuelto perezosamente.
   *
   * Presente ⇒ lo gratuito y lo de pago de UNA misma búsqueda aterrizan en el
   * MISMO lote. Antes no había nada que pasar: esta capa corre antes de que el
   * wizard reservara su slot, así que el writer creaba lote propio y una sola
   * búsqueda podía terminar en dos.
   *
   * 🔴 Se resuelve SÓLO cuando de verdad hay empresas que persistir, y por eso es
   * una función y no un valor. Un `string` obligaría a materializar la fila del
   * lote en TODA corrida —incluidas las que la puerta descarta sin escribir nada,
   * que hoy no dejan lote— y eso convertiría un corte de fontanería en un cambio
   * de comportamiento observable.
   *
   * Ausente ⇒ el writer crea lote propio, byte por byte como antes. Es lo que
   * conserva intacta la ruta Lusha de `lusha-pending-review-actions`, que tiene
   * su propia superficie y NO forma parte de este corte (§ 9).
   */
  resolveBatchId?: () => Promise<string>;
};

export type PrePaidNoveltyDiscoveryOutcome = {
  /**
   * AGENT1-APOLLO-BENCHMARK-PARITY-CUT-2 § 3 — el objetivo del USUARIO, tal cual
   * entró.
   *
   * Viaja en el resultado porque `residualGap` por sí solo no es interpretable:
   * un hueco de 3 significa cosas distintas si el objetivo era 3 o si era 10, y el
   * consumidor que aplica la cota necesita las dos cifras para no reconstruir la
   * primera por su cuenta y equivocarse.
   */
  requestedTarget: number;
  residualGap: number;
  acceptedBeforeProvider: number;
  providerRequired: boolean;
  batchId: string | null;
  persistedCount: number;
  /**
   * Dominios que el proveedor puede excluir (§ 11). Vacío cuando la ruta no los
   * soporta o cuando no hay proveedor que los reciba.
   */
  exclusionDomains: readonly string[];
  /**
   * ADDENDUM PROVIDER-SEEN § 4 — memoria de corridas anteriores, consultable.
   * Vacía cuando no hay autoridad de persistencia todavía.
   */
  providerSeenMemory: ProviderSeenMemory;
  /** ADDENDUM PROVIDER-SEEN § 10 — qué rindió la carga de memoria previa. */
  providerSeenLoad: ProviderSeenLoadSummary;
  /** ADDENDUM PROVIDER-SEEN § 6 — el plan explicable con el que se pedirá. */
  providerExclusionPlan: ProviderExclusionPlan;
  /** Lo que la fuente gratuita rindió, para el bloque normalizado de § 10. */
  freeSource: PrePaidFreeSourceOutcome;
  telemetry: Record<string, unknown>;
};

/**
 * Ejecuta el descubrimiento gratuito y persiste lo aceptado por la ingesta
 * canónica de fuentes.
 *
 * Nunca lanza: un fallo cualquiera se degrada a «no aportó» y la ruta de pago
 * sigue con el objetivo entero (§ 12).
 */
export type PrePaidNoveltyDiscoveryDeps = {
  runGate: typeof runProductionPrePaidNoveltyGate;
  persist: typeof persistCountrySourceCandidates;
};

const PRODUCTION_DEPS: PrePaidNoveltyDiscoveryDeps = {
  runGate: runProductionPrePaidNoveltyGate,
  persist: persistCountrySourceCandidates,
};

export async function runPrePaidNoveltyDiscovery(
  client: SupabaseClient,
  input: PrePaidNoveltyDiscoveryInput,
  /** Inyectable SÓLO para pruebas. Producción usa siempre las reales. */
  deps: PrePaidNoveltyDiscoveryDeps = PRODUCTION_DEPS,
): Promise<PrePaidNoveltyDiscoveryOutcome> {
  /**
   * 🔴 AGENT1-APOLLO-BENCHMARK-PARITY-CUT-2 REVIEW-1 § 8 — lo que se DESCARTA aquí
   * es la CONTRIBUCIÓN de la capa gratuita, no su MEDICIÓN.
   *
   * `residualGap`, `acceptedBeforeProvider`, el lote y las filas vuelven a cero
   * porque nada de esto llega al usuario en esta corrida. La memoria provider-seen
   * es otra cosa: es una lectura que YA ocurrió, describe corridas ANTERIORES y no
   * depende de que ésta aporte. Sustituirla por `PROVIDER_SEEN_LOAD_UNAVAILABLE`
   * publicaría «no se pudo medir» sobre una medición que sí se hizo, y con la ruta
   * Apollo en todo-o-nada eso dejaría `provider_seen_hit` en null en TODAS las
   * corridas en las que Apollo llega a ejecutar — es decir, el embudo del corte 1
   * quedaría permanentemente ciego justo en el único caso que importa.
   *
   * Por eso el desenlace de la lectura viaja aparte y sobrevive al descarte. Los
   * valores por defecto son los de antes, para el llamador que no tenga nada.
   *
   * 🔴 AGENT1-LUSHA-MIXED-TWO-BATCH-CONTAINMENT-1 REVIEW-1 § 4 — el PLAN DE
   * EXCLUSIÓN ya resuelto viaja por el mismo sitio, y por el mismo motivo.
   *
   * Antes se reconstruía aquí como plan VACÍO. Con Apollo eso era verdad —su
   * capacidad de exclusión está apagada y nada viaja—, pero con Lusha era FALSO:
   * `exclusionDomains` sí sobrevivía al descarte y sí llegaba al cuerpo de la
   * petición como `excludeDomains`, así que la única vista MEDIBLE del envío
   * reportaba 0 sobre 3 dominios realmente enviados.
   *
   * 🔴 El plan NO se reconstruye a partir de los dominios: se ARRASTRA el que la
   * puerta ya resolvió. Reconstruirlo daría una segunda lista calculada aparte —
   * exactamente lo que `run-prepaid-novelty-gate` dejó de hacer al DERIVAR
   * `exclusionPlan` de `providerExclusionPlan.domains`— y dos listas que pueden
   * divergir cuando sólo una viaja al proveedor son el defecto, no el arreglo.
   *
   * El plan vacío sigue siendo el DEFECTO, y sólo para el llamador que no tiene
   * ninguna puerta resuelta de la que arrastrarlo: ahí «vacío» sí es la verdad.
   */
  const noContribution = (
    telemetry: Record<string, unknown>,
    exclusionDomains: readonly string[] = [],
    resolvedByGate: {
      providerSeenMemory: ProviderSeenMemory;
      providerSeenLoad: ProviderSeenLoadSummary;
      /**
       * 🔴 Obligatorio dentro del paquete a propósito: quien tiene puerta tiene
       * plan, y que el compilador lo exija impide que un llamador futuro arrastre
       * la memoria y se deje el plan atrás — que es precisamente el defecto que
       * este corte arregla.
       */
      providerExclusionPlan: ProviderExclusionPlan;
    } = {
      providerSeenMemory: EMPTY_PROVIDER_SEEN_MEMORY,
      providerSeenLoad: PROVIDER_SEEN_LOAD_UNAVAILABLE,
      providerExclusionPlan: planProviderExclusions(input.provider, {}),
    },
  ): PrePaidNoveltyDiscoveryOutcome => ({
    requestedTarget: input.requestedTarget,
    residualGap: input.requestedTarget,
    acceptedBeforeProvider: 0,
    providerRequired: true,
    batchId: null,
    persistedCount: 0,
    exclusionDomains,
    providerSeenMemory: resolvedByGate.providerSeenMemory,
    providerSeenLoad: resolvedByGate.providerSeenLoad,
    // 🔴 La MISMA autoridad que `exclusionDomains`, no una copia reconstruida: la
    // vista que se mide y la que viaja tienen que contar el mismo envío. Con
    // Apollo el plan arrastrado sigue saliendo con `sent: []` —su capacidad está
    // apagada por § 10 y ahí «vacío» es la verdad—; con Lusha sale con los
    // dominios que de verdad se piden.
    providerExclusionPlan: resolvedByGate.providerExclusionPlan,
    freeSource: notAttemptedFreeSourceOutcome(),
    telemetry,
  });

  const gate = await deps.runGate({
    provider: input.provider,
    countryCode: input.countryCode,
    macroIndustryKey: input.macroIndustryKey,
    requestedTarget: input.requestedTarget,
  });

  // Todo-o-nada: la ruta no puede reducir su objetivo y la fuente no lo cerró
  // entero ⇒ esta corrida no usa nada de la fuente. No se persiste, no se
  // descuenta, y no se gastó nada en averiguarlo.
  if (!input.partialGapSupported && gate.context.providerRequired) {
    return noContribution(gate.telemetry, gate.exclusionPlan.sent, {
      providerSeenMemory: gate.providerSeenMemory,
      providerSeenLoad: gate.providerSeen,
      // 🔴 El plan que la puerta YA resolvió, del que `gate.exclusionPlan.sent`
      // de la línea de arriba es la vista heredada de su dimensión de dominios.
      // Las dos salen de aquí, así que no hay dos listas que puedan divergir.
      providerExclusionPlan: gate.providerExclusionPlan,
    });
  }

  if (gate.acceptedCompanies.length === 0) {
    return {
      requestedTarget: gate.context.requestedTarget,
      residualGap: gate.context.residualGap,
      acceptedBeforeProvider: gate.context.acceptedBeforeProvider,
      providerRequired: gate.context.providerRequired,
      batchId: null,
      persistedCount: 0,
      exclusionDomains: gate.context.exclusionDomains,
      providerSeenMemory: gate.providerSeenMemory,
      providerSeenLoad: gate.providerSeen,
      providerExclusionPlan: gate.providerExclusionPlan,
      freeSource: gate.context.freeSource,
      telemetry: gate.telemetry,
    };
  }

  // CUT-5 §§ 5, 6 — el lote canónico se materializa AQUÍ y no antes: es el primer
  // punto de la capa gratuita en el que existe algo que escribir. Las dos salidas
  // anteriores —todo-o-nada descartado, y cero empresas aceptadas— ya devolvieron,
  // así que una corrida que no aporta sigue sin dejar lote.
  //
  // Fail-open, igual que el resto de esta capa (§ 12): si el lote canónico no se
  // puede resolver, se cae a `null` y el writer crea el suyo. Es el comportamiento
  // previo al corte, y es preferible a perder empresas ya descubiertas.
  const canonicalBatchId = input.resolveBatchId
    ? await input.resolveBatchId().catch(() => null)
    : null;

  const persistence = await deps.persist(client, {
    companies: gate.acceptedCompanies,
    countryCode: input.countryCode,
    countryName: input.countryName,
    macroIndustryKey: input.macroIndustryKey ?? '',
    requestedByUserId: input.requestedByUserId,
    batchId: canonicalBatchId,
    metadata: { prepaid_novelty: gate.telemetry },
  });

  // 🔴 § 13/§ 14 — sólo lo GUARDADO cierra hueco.
  const context = withFreeSourcePersistenceOutcome(gate.context, {
    persistedCount: persistence.writtenCount,
  });

  if (!input.partialGapSupported && context.providerRequired) {
    // La persistencia guardó menos de lo aceptado y el objetivo volvió a abrirse.
    // La ruta no puede repartirse el objetivo, así que se reporta como no
    // contribución: el proveedor corre entero y no se descuenta nada.
    return noContribution(
      buildPrePaidNoveltyTelemetry(context, gate.exclusionPlan, null),
      gate.exclusionPlan.sent,
      {
        providerSeenMemory: gate.providerSeenMemory,
        providerSeenLoad: gate.providerSeen,
        providerExclusionPlan: gate.providerExclusionPlan,
      },
    );
  }

  return {
    requestedTarget: context.requestedTarget,
    residualGap: context.residualGap,
    acceptedBeforeProvider: context.acceptedBeforeProvider,
    providerRequired: context.providerRequired,
    batchId: persistence.batchId,
    persistedCount: persistence.writtenCount,
    exclusionDomains: context.exclusionDomains,
    providerSeenMemory: gate.providerSeenMemory,
    providerSeenLoad: gate.providerSeen,
    providerExclusionPlan: gate.providerExclusionPlan,
    freeSource: context.freeSource,
    telemetry: buildPrePaidNoveltyTelemetry(context, gate.exclusionPlan, null),
  };
}
