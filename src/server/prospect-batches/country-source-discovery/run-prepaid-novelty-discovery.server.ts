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
 * La ruta Apollo/Tavily NO lo sabe todavía. Su objetivo de candidatos
 * persistibles vive dentro del orquestador de dos rondas y no viaja por
 * `ResolvedWizardExecution` (lo que sí viaja, `systemControls.targetCount`, es la
 * AMPLITUD de búsqueda —25—, no el objetivo de aceptación). Reducirlo requiere
 * abrir ese orquestador, que es trabajo aparte.
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
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { withFreeSourcePersistenceOutcome } from '@/modules/prospect-batches/prepaid-novelty/prepaid-novelty-context';
import { buildPrePaidNoveltyTelemetry } from '@/modules/prospect-batches/prepaid-novelty/prepaid-novelty-telemetry';
import { runProductionPrePaidNoveltyGate } from './prepaid-novelty-gate.server';
import { persistCountrySourceCandidates } from './persist-country-source-candidates';

export type PrePaidNoveltyDiscoveryInput = {
  countryCode: string;
  countryName: string;
  macroIndustryKey: string | null;
  requestedTarget: number;
  requestedByUserId: string;
  /**
   * ¿Puede el ejecutor de pago de esta ruta aceptar un objetivo REDUCIDO?
   *
   * `true`  (Lusha)         — un hueco parcial se aprovecha.
   * `false` (Apollo/Tavily) — todo o nada. Ver la cabecera.
   */
  partialGapSupported: boolean;
};

export type PrePaidNoveltyDiscoveryOutcome = {
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
  const noContribution = (
    telemetry: Record<string, unknown>,
    exclusionDomains: readonly string[] = [],
  ): PrePaidNoveltyDiscoveryOutcome => ({
    residualGap: input.requestedTarget,
    acceptedBeforeProvider: 0,
    providerRequired: true,
    batchId: null,
    persistedCount: 0,
    exclusionDomains,
    telemetry,
  });

  const gate = await deps.runGate({
    countryCode: input.countryCode,
    macroIndustryKey: input.macroIndustryKey,
    requestedTarget: input.requestedTarget,
  });

  // Todo-o-nada: la ruta no puede reducir su objetivo y la fuente no lo cerró
  // entero ⇒ esta corrida no usa nada de la fuente. No se persiste, no se
  // descuenta, y no se gastó nada en averiguarlo.
  if (!input.partialGapSupported && gate.context.providerRequired) {
    return noContribution(gate.telemetry, gate.exclusionPlan.sent);
  }

  if (gate.acceptedCompanies.length === 0) {
    return {
      residualGap: gate.context.residualGap,
      acceptedBeforeProvider: gate.context.acceptedBeforeProvider,
      providerRequired: gate.context.providerRequired,
      batchId: null,
      persistedCount: 0,
      exclusionDomains: gate.context.exclusionDomains,
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
    );
  }

  return {
    residualGap: context.residualGap,
    acceptedBeforeProvider: context.acceptedBeforeProvider,
    providerRequired: context.providerRequired,
    batchId: persistence.batchId,
    persistedCount: persistence.writtenCount,
    exclusionDomains: context.exclusionDomains,
    telemetry: buildPrePaidNoveltyTelemetry(context, gate.exclusionPlan, null),
  };
}
