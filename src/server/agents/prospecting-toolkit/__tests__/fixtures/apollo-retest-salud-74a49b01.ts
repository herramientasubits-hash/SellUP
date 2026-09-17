/**
 * Fixture — RETEST Salud, lote `74a49b01-aa34-4160-a59a-1c84a7f85e13`.
 *
 * AGENT1-APOLLO-BOOTSTRAP-PURCHASE-GATE-THREADING-1 · §§ 5, 13.
 *
 * La corrida live que descubrió el defecto (2026-08-12,
 * `wizard_run 09047e530a28b0db55ec4d003c3ec371`, SHA de producción
 * `6808835f71475e8bf58f73d497b25e1a01d9e9cc`, que YA incluía #274 y #276):
 *
 *   20 candidatos `bootstrap_eligible`
 *   5 `selected_for_enrichment`
 *   0 `enrichment_executed`
 *   0 créditos de `organization_enrichment`
 *
 * La causa, verificada con replay pinneado a ese mismo SHA: el runner llamaba al
 * cascade sin `sectorEvidenceBootstrap`, así que el gate que guarda la COMPRA
 * volvía a juzgar sin autorización, un sector sin política salía
 * `sector_not_mapped` y el cascade devolvía `eligibility_blocked`.
 *
 * ── Qué es dato exportado y qué es reconstrucción ─────────────────────────────
 *
 * DATO. Las VEINTE empresas son las mismas de RUN 1 (`f4c8a60f`): la forense
 * comparó las dos corridas y el solape fue 20/20, con 0 diferencias, pese a haber
 * cambiado una de las tres keywords específicas. Por eso este fichero reutiliza
 * `RUN1_SALUD_SNAPSHOTS` en vez de duplicar veinte filas: son literalmente las
 * mismas veinte, y tenerlas en un solo sitio es lo que impide que discrepen.
 *
 * DATO. Las subindustrias PEDIDAS, que NO fueron las de RUN 1 — el retest pidió
 * `Laboratorios Farmacéuticos` donde RUN 1 pidió `Laboratorios Clínicos y
 * Diagnóstico`. Las dos corridas no son un A/B limpio y no se presentan como tal.
 *
 * DATO. El desenlace y el reparto terminal 20/20 (`RETEST_SALUD_LIVE_OUTCOME`).
 *
 * RECONSTRUCCIÓN, declarada. Las claves de los 9 duplicados de HubSpot NO se
 * exportaron una a una. Para reproducir la COHORTE de 5 que compitió, este
 * fixture marca como no competidores a todos los candidatos que la selección live
 * dejó fuera y que no tienen ya una causa propia exportada (cooldown, país,
 * plataforma externa, duplicado en SellUp). Son 11 y no 9 porque los 2 que la
 * corrida live dejó en `enrichment_budget_exhausted` sí compitieron y perdieron
 * contra el cap; el cap tiene su propia prueba, con su propia cohorte, y no se
 * simula aquí. Lo que este fixture fija es QUIÉNES llegaron al gate de compra.
 *
 * Cero llamadas al proveedor, cero créditos, cero escrituras: este fichero existe
 * precisamente para no volver a gastar 20 créditos en descubrir lo mismo.
 */

import { RUN1_SALUD_SNAPSHOTS, type Run1SaludSnapshot } from './apollo-run1-salud-f4c8a60f';

/** Los VEINTE del retest son los VEINTE de RUN 1 — solape 20/20 verificado. */
export const RETEST_SALUD_SNAPSHOTS: readonly Run1SaludSnapshot[] = RUN1_SALUD_SNAPSHOTS;

/** Criterios EXACTOS del retest, tal como el wizard los envió. */
export const RETEST_SALUD_REQUEST = {
  batchId: '74a49b01-aa34-4160-a59a-1c84a7f85e13',
  wizardRunId: '09047e530a28b0db55ec4d003c3ec371',
  productionSha: '6808835f71475e8bf58f73d497b25e1a01d9e9cc',
  country: 'Colombia',
  countryCode: 'CO',
  industry: 'Salud',
  subindustries: [
    'Redes Hospitalarias y Clínicas',
    'Laboratorios Farmacéuticos',
    'Medicina Prepagada y EPS',
  ],
  /** 5/2/10/20/5 ⇒ cap de 25 créditos. */
  targetEligibleCompanies: 5,
  maxRoundsPerRun: 2,
  maxResultsPerRound: 10,
  maxRawResultsPerRun: 20,
  maxEnrichmentsPerRun: 5,
  reservedCredits: 25,
} as const;

/** Los CINCO que la corrida live seleccionó para enrichment, en su orden. */
export const RETEST_SALUD_SELECTED_DOMAINS: readonly string[] = [
  'astrazeneca.com',
  'novonordisk.com',
  'pmi.com',
  'deloitte.com',
  'kuehne-nagel.com',
];

/**
 * 🔴 AGENT1-OWNERSHIP-PRE-ENRICHMENT-X6.3 — de esos cinco, DOS no sobrevivían al
 * gate OBLIGATORIO de ownership.
 *
 * El gate es gratuito y sus dos entradas —nombre y dominio— ya venían de la
 * BÚSQUEDA, así que desde X6.3 se resuelve ANTES de la caja. El veredicto es el
 * de `evaluateCompanyOwnership` sobre el título REAL del snapshot, no una
 * suposición, y hasta X6.9 decía:
 *
 *   'Philip Morris International' ↔ pmi.com
 *     → reject · "pmi" no aparece en "philipmorrisinternational" (sigla)
 *   'KUEHNE + NAGEL COLOMB'       ↔ kuehne-nagel.com
 *     → reject · "kuehnenagelcolomb" vs "kuehnenagel" (el «COLOMB» truncado
 *       no es un sufijo que `COMPANY_SUFFIXES` sepa quitar)
 *
 * X6.3 ya declaró el segundo como FALSO NEGATIVO del gate, «de la familia que
 * audita X6.2-B».
 *
 * ── 🔴 AGENT1-OWNERSHIP-DOMAIN-TO-NAME-X6.9 — el conjunto queda VACÍO ────────
 *
 * Los dos eran falsos negativos, y X6.9 los corrige por dos reglas distintas.
 * No es una relajación: en ambos casos el dominio no dice NADA que el nombre no
 * diga, que es justo lo que la propiedad exige.
 *
 *   'Philip Morris International' ↔ pmi.com
 *     → allow · `institutional_acronym_domain_match`
 *       La etiqueta es EXACTAMENTE las iniciales p-m-i. La regla de sigla ya
 *       lo habría visto; no llegaba a ejecutarse porque estaba encerrada tras
 *       `looksLikeInstitutionalName`, y «Philip Morris» no es una institución.
 *
 *   'KUEHNE + NAGEL COLOMB'       ↔ kuehne-nagel.com
 *     → allow · `domain_explained_by_company_name`
 *       `kuehnenagel` = `kuehne` + `nagel`, dos tokens del nombre y en su
 *       orden. Que el nombre traiga además «COLOMB» no contradice nada: el
 *       nombre puede decir MÁS que el dominio; lo que no puede es decir menos.
 *
 * Consecuencia que este fixture existe para hacer visible: los dos vuelven a
 * competir por enrichment, así que en este escenario la caja pasa de 3 compras
 * a 5. Es la dirección buscada —recuperar recall perdido por falsos negativos—
 * pero es gasto, y por eso se declara aquí en vez de esconderse en un número.
 */
export const RETEST_SALUD_OWNERSHIP_REJECTED_DOMAINS: ReadonlySet<string> = new Set([]);

/** Los que HOY llegan a la caja: los live menos los que ownership rechaza. */
export const RETEST_SALUD_SELECTED_DOMAINS_AFTER_OWNERSHIP: readonly string[] =
  RETEST_SALUD_SELECTED_DOMAINS.filter(
    (domain) => !RETEST_SALUD_OWNERSHIP_REJECTED_DOMAINS.has(domain),
  );

/**
 * Causas propias EXPORTADAS de candidatos que no compitieron. No son
 * reconstrucción: cada una tiene su disposición terminal en la corrida live.
 */
export const RETEST_SALUD_COOLDOWN_DOMAINS: ReadonlySet<string> = new Set(['alpina.com']);
export const RETEST_SALUD_SELLUP_DUPLICATE_DOMAINS: ReadonlySet<string> = new Set(['huawei.com']);

/**
 * Los que el replay marca como duplicados de HubSpot para reproducir la cohorte
 * de 5. Ver la nota de RECONSTRUCCIÓN de la cabecera: 11 declarados frente a 9
 * live, porque los 2 de `enrichment_budget_exhausted` se prueban aparte.
 */
export const RETEST_SALUD_RECONSTRUCTED_HUBSPOT_DUPLICATE_DOMAINS: ReadonlySet<string> = new Set([
  'pwc.com',
  'chubb.com',
  'postobon.com',
  'coomeva.com.co',
  'bat.com',
  'colombina.com',
  'ajegroup.com',
  'cruzverde.com.co',
  'cushmanwakefield.com',
  'colsubsidio.com',
  'davivienda.com',
]);

/**
 * Desenlace REAL de la corrida, leído de `prospect_batches.metadata`.
 *
 * `enrichmentsExecuted: 0` con `selectedForEnrichment: 5` ES el defecto: cinco
 * cupos gastados en decidir a quién comprar, y ninguna compra.
 */
export const RETEST_SALUD_LIVE_OUTCOME = {
  searchCalls: 2,
  searchCredits: 20,
  bootstrapEligible: 20,
  selectedForEnrichment: 5,
  enrichmentsExecuted: 0,
  enrichmentCredits: 0,
  candidatesPersisted: 0,
  /** El motivo con que el cascade devolvió cada uno de los 5. */
  cascadeSkipReason: 'eligibility_blocked',
  /** Y el motivo fino del gate, que no se persistía en ningún sitio. */
  cascadeIneligibilityReason: 'sector_not_mapped',
  /** Reparto terminal 20/20, `unclassified_count = 0`. */
  terminalDispositions: {
    duplicate_in_hubspot: 9,
    insufficient_evidence_not_enriched: 5,
    enrichment_budget_exhausted: 2,
    cooldown: 1,
    country: 1,
    duplicate_in_sellup: 1,
    ownership: 1,
  },
} as const;

/**
 * Presupuesto de agosto tras el retest, verificado READ-ONLY. No se modifica.
 */
export const RETEST_SALUD_BUDGET_AFTER = {
  budgetCredits: 244,
  creditsConsumed: 239,
  creditsReserved: 0,
  available: 5,
} as const;
