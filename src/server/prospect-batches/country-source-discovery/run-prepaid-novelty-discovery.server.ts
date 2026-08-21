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
 * 🔴 AGENT1-APOLLO-BENCHMARK-PARITY-CUT-2 REVIEW-1 § 2 — la ruta Apollo YA SABE
 * aceptar un objetivo reducido. El motivo textual de antes —«su objetivo de
 * candidatos persistibles vive dentro del orquestador de dos rondas y no viaja por
 * `ResolvedWizardExecution`»— dejó de ser cierto: `resultDemand` viaja por su
 * propio campo hasta el orquestador y hasta `targetPersistibleCandidates`, y
 * `boundByRemainingTarget` es su única cota.
 *
 * Lo que sigue en `false` es la ACTIVACIÓN, y por una razón distinta y de PRODUCTO:
 * un aporte parcial gratuito se persiste en su PROPIO lote (esta capa corre antes
 * de la reserva), así que con `true` una sola búsqueda del usuario terminaría en
 * DOS lotes —7 gratis + 3 de Apollo con objetivo 10— y la redirección apuntaría al
 * segundo. La invariante de § 14 se cumple; la experiencia de resultado único no.
 * El hito que lo diseña es `AGENT1-MIXED-FREE-PAID-SINGLE-BATCH-1`.
 *
 * El valor vivo de la ruta Apollo se decide en UN sitio,
 * `WIZARD_APOLLO_PARTIAL_GAP_SUPPORTED`. Aquí sólo se obedece.
 *
 * Consecuencia, y por qué esta bandera existe en vez de un apaño: con
 * `partialGapSupported: false` la capa gratuita es TODO-O-NADA. O cierra el
 * objetivo entero —y entonces el proveedor no corre y no se persiste nada de
 * pago— o no aporta a ESTA corrida y el proveedor corre con el objetivo completo.
 * Lo que NO hace es persistir 2 empresas gratis y dejar que Apollo persista 10
 * más: eso rompería la invariante y el usuario recibiría 12 donde pidió 10.
 *
 * 🔴 Un hueco parcial en Apollo se DESCARTA, no se guarda a medias. Descartarlo
 * no cuesta nada —la lectura fue local y gratuita— mientras que guardarlo
 * rompería un contrato de producto.
 *
 * 🔴 Lo que el descarte NO tira es la MEDICIÓN: la memoria provider-seen leída con
 * éxito sobrevive al descarte y llega a la ruta de pago. Ver `noContribution`.
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
   * 🔴 AGENT1-LUSHA-MIXED-TWO-BATCH-CONTAINMENT-1 § 4 — HOY las DOS rutas vivas
   * pasan `false`: Apollo por `WIZARD_APOLLO_PARTIAL_GAP_SUPPORTED` y Lusha por
   * `LUSHA_PENDING_REVIEW_PARTIAL_GAP_SUPPORTED`. La CAPACIDAD de este parámetro
   * sigue entera y probada —hay suites que lo invocan con `true` a propósito—;
   * lo que está apagado es la ACTIVACIÓN en producción, en las dos rutas y por
   * la misma razón de producto. Este runner sólo obedece.
   */
  partialGapSupported: boolean;
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
   */
  const noContribution = (
    telemetry: Record<string, unknown>,
    exclusionDomains: readonly string[] = [],
    measurement: {
      providerSeenMemory: ProviderSeenMemory;
      providerSeenLoad: ProviderSeenLoadSummary;
    } = {
      providerSeenMemory: EMPTY_PROVIDER_SEEN_MEMORY,
      providerSeenLoad: PROVIDER_SEEN_LOAD_UNAVAILABLE,
    },
  ): PrePaidNoveltyDiscoveryOutcome => ({
    requestedTarget: input.requestedTarget,
    residualGap: input.requestedTarget,
    acceptedBeforeProvider: 0,
    providerRequired: true,
    batchId: null,
    persistedCount: 0,
    exclusionDomains,
    providerSeenMemory: measurement.providerSeenMemory,
    providerSeenLoad: measurement.providerSeenLoad,
    // 🔴 El PLAN sigue vacío a propósito: § 10 mantiene las exclusiones de Apollo
    // apagadas, y un plan derivado de una corrida que no aportó nada describiría
    // un envío que no va a ocurrir. La memoria de arriba es sólo para MEDIR.
    providerExclusionPlan: planProviderExclusions(input.provider, {}),
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

  const persistence = await deps.persist(client, {
    companies: gate.acceptedCompanies,
    countryCode: input.countryCode,
    countryName: input.countryName,
    macroIndustryKey: input.macroIndustryKey ?? '',
    requestedByUserId: input.requestedByUserId,
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
      { providerSeenMemory: gate.providerSeenMemory, providerSeenLoad: gate.providerSeen },
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
