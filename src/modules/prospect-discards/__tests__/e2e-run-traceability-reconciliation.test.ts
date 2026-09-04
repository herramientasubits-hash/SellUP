// AGENT1-DISCARDED-TRACEABILITY-DIAG-1 — reproducción EXACTA del primer E2E real
// de Apollo tras la migración 138, como test de reconciliación.
//
// Corrida observada (2026-09-04):
//
//   17 empresas únicas
//    2 hubspot_duplicate
//    1 cooldown_active
//    1 country_rejected
//    3 sector_rejected
//    2 ownership_domain_rejected
//    7 enrichment_budget_exhausted
//    0 candidatos creados
//    5 organization_enrichment PAGADOS (11 créditos con 2 organizations_search)
//
//   prospect_discarded_dispositions → 16 filas.  17 − 16 = 1 empresa sin destino.
//
// Este archivo NO llama a Apollo/Lusha/Tavily/HubSpot, no toca presupuesto y no
// escribe en Production: el único Supabase alcanzable es el doble de abajo, que
// sólo registra el payload del `.upsert()`.
//
// Ejecuta la función PURA real (`evaluateApolloCandidateFinalDispositions`) y el
// escritor REAL (`persistApolloRejectedDispositions`) — nada está reimplementado.
//
// Run: node --import tsx --experimental-test-module-mocks --test <this file>

import { describe, it, mock, before } from "node:test";
import assert from "node:assert/strict";
import { evaluateApolloCandidateFinalDispositions } from "@/server/agents/prospecting-toolkit/apollo-two-round/candidate-final-disposition";
import type { ApolloTwoRoundRunResult } from "@/server/agents/prospecting-toolkit/apollo-two-round/orchestrator";
import type { persistApolloRejectedDispositions as PersistFn } from "../pipeline-writer.server";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://fake.supabase.local";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-service-role-key";

// ─── Doble de Supabase: la ÚNICA superficie de escritura alcanzable ───────────

let upsertPayload: Record<string, unknown>[] = [];

mock.module("@supabase/supabase-js", {
  namedExports: {
    createClient: () => ({
      from: () => ({
        upsert: (payload: Record<string, unknown>[]) => {
          upsertPayload = payload;
          return {
            select: () =>
              Promise.resolve({
                data: payload.map((_, i) => ({ id: `row-${i}` })),
                error: null,
              }),
          };
        },
      }),
    }),
  },
});

let persistApolloRejectedDispositions: typeof PersistFn;
before(async () => {
  ({ persistApolloRejectedDispositions } =
    await import("../pipeline-writer.server"));
});

// ─── El universo de 17 de la corrida real ────────────────────────────────────

const BATCH_ID = "00000000-0000-4000-8000-0000000000e2";

/** Una empresa del universo observado, con el destino que la corrida le dio. */
type ObservedCompany = {
  key: string;
  name: string;
  domain: string;
  providerOrganizationId: string;
  round: 1 | 2;
  /** Grupo del orquestador al que pertenece al cerrar la corrida. */
  bucket:
    | "definitively_rejected"
    | "enrichment_skipped"
    | "persisted_pending_writer";
  rejectionReason?: string;
  skippedReason?: string;
  /** ¿El orquestador ejecutó (y Apollo cobró) un organization_enrichment? */
  enrichmentExecuted: boolean;
};

/**
 * 17 empresas: 9 rechazadas por los gates baratos, 7 que perdieron su cupo de
 * enrichment por el cap, y 1 que el orquestador entregó al writer.
 *
 * Los 5 enrichments pagados: los 3 rechazos sectoriales llegaron DESPUÉS de
 * comprar el perfil, más la que fue al writer y una de las que el cap dejó
 * fuera en un reintento posterior.
 */
const UNIVERSE: readonly ObservedCompany[] = [
  // 2 · ya existentes en HubSpot
  {
    key: "k01",
    name: "Alfa Retail SAS",
    domain: "alfaretail.co",
    providerOrganizationId: "apo_01",
    round: 1,
    bucket: "definitively_rejected",
    rejectionReason: "duplicate_in_hubspot",
    enrichmentExecuted: false,
  },
  {
    key: "k02",
    name: "Beta Logistica SAS",
    domain: "betalogistica.co",
    providerOrganizationId: "apo_02",
    round: 1,
    bucket: "definitively_rejected",
    rejectionReason: "duplicate_in_hubspot",
    enrichmentExecuted: false,
  },
  // 1 · cooldown
  {
    key: "k03",
    name: "Gamma Alimentos SAS",
    domain: "gammaalimentos.co",
    providerOrganizationId: "apo_03",
    round: 1,
    bucket: "definitively_rejected",
    rejectionReason: "cooldown_or_prior_suggestion",
    enrichmentExecuted: false,
  },
  // 1 · país
  {
    key: "k04",
    name: "Delta Foods Inc",
    domain: "deltafoods.com",
    providerOrganizationId: "apo_04",
    round: 1,
    bucket: "definitively_rejected",
    rejectionReason: "country_incompatible",
    enrichmentExecuted: false,
  },
  // 3 · sector — los tres PAGARON enrichment y el sector siguió sin mapear
  {
    key: "k05",
    name: "Epsilon Servicios SAS",
    domain: "epsilonservicios.co",
    providerOrganizationId: "apo_05",
    round: 1,
    bucket: "definitively_rejected",
    rejectionReason: "sector_not_mapped",
    enrichmentExecuted: true,
  },
  {
    key: "k06",
    name: "Zeta Consultores SAS",
    domain: "zetaconsultores.co",
    providerOrganizationId: "apo_06",
    round: 1,
    bucket: "definitively_rejected",
    rejectionReason: "sector_not_mapped",
    enrichmentExecuted: true,
  },
  {
    key: "k07",
    name: "Eta Industrial SAS",
    domain: "etaindustrial.co",
    providerOrganizationId: "apo_07",
    round: 1,
    bucket: "definitively_rejected",
    rejectionReason: "sector_not_mapped",
    enrichmentExecuted: true,
  },
  // 2 · el dominio no acredita a la empresa
  {
    key: "k08",
    name: "Theta Comercial SAS",
    domain: "facebook.com",
    providerOrganizationId: "apo_08",
    round: 1,
    bucket: "definitively_rejected",
    rejectionReason: "external_platform_domain",
    enrichmentExecuted: false,
  },
  {
    key: "k09",
    name: "Iota Distribuciones SAS",
    domain: "iotadist.com.co",
    providerOrganizationId: "apo_09",
    round: 1,
    bucket: "definitively_rejected",
    rejectionReason: "ownership_mismatch",
    enrichmentExecuted: false,
  },
  // 7 · perdieron su cupo de enrichment por el cap de la corrida
  {
    key: "k10",
    name: "Kappa Textiles SAS",
    domain: "kappatextiles.co",
    providerOrganizationId: "apo_10",
    round: 2,
    bucket: "enrichment_skipped",
    skippedReason: "enrichment_cap_reached",
    enrichmentExecuted: false,
  },
  {
    key: "k11",
    name: "Lambda Quimicos SAS",
    domain: "lambdaquimicos.co",
    providerOrganizationId: "apo_11",
    round: 2,
    bucket: "enrichment_skipped",
    skippedReason: "enrichment_cap_reached",
    enrichmentExecuted: false,
  },
  {
    key: "k12",
    name: "Mu Transportes SAS",
    domain: "mutransportes.co",
    providerOrganizationId: "apo_12",
    round: 2,
    bucket: "enrichment_skipped",
    skippedReason: "enrichment_cap_reached",
    enrichmentExecuted: false,
  },
  {
    key: "k13",
    name: "Nu Metalmecanica SAS",
    domain: "numetalmecanica.co",
    providerOrganizationId: "apo_13",
    round: 2,
    bucket: "enrichment_skipped",
    skippedReason: "enrichment_cap_reached",
    enrichmentExecuted: false,
  },
  {
    key: "k14",
    name: "Xi Agroindustria SAS",
    domain: "xiagro.co",
    providerOrganizationId: "apo_14",
    round: 2,
    bucket: "enrichment_skipped",
    skippedReason: "enrichment_cap_reached",
    enrichmentExecuted: false,
  },
  {
    key: "k15",
    name: "Omicron Plasticos SAS",
    domain: "omicronplasticos.co",
    providerOrganizationId: "apo_15",
    round: 2,
    bucket: "enrichment_skipped",
    skippedReason: "enrichment_cap_reached",
    enrichmentExecuted: false,
  },
  // ── ESTA sí pagó un enrichment y AUN ASÍ el cap la dejó fuera en el reintento.
  //    Su fila de disposición dice `enrichment_budget_exhausted`, que se lee como
  //    "no se gastó nada en ella". Es el caso B disfrazado de caso A.
  {
    key: "k16",
    name: "Pi Empaques SAS",
    domain: "piempaques.co",
    providerOrganizationId: "apo_16",
    round: 2,
    bucket: "enrichment_skipped",
    skippedReason: "enrichment_cap_reached",
    enrichmentExecuted: true,
  },
  // 1 · el orquestador la entregó al writer… y el writer creó 0 candidatos.
  //    Es la empresa #17: no hay fila de candidato NI fila de disposición.
  {
    key: "k17",
    name: "Rho Manufacturas SAS",
    domain: "rhomanufacturas.co",
    providerOrganizationId: "apo_17",
    round: 2,
    bucket: "persisted_pending_writer",
    enrichmentExecuted: true,
  },
];

/** Lo que el writer de candidatos observó de verdad: 0 filas creadas. */
const WRITER_CREATED_CANDIDATE_IDS: readonly string[] = [];

/** Los 5 `organization_enrichment` que Apollo cobró, por dominio (el mismo campo
 *  que `provider_usage_logs.metadata.domain` lleva en la ruta de dos rondas). */
const PAID_ENRICHMENT_DOMAINS: readonly string[] = UNIVERSE.filter(
  (c) => c.enrichmentExecuted,
).map((c) => c.domain);

function buildRunResult(
  reviewOnlyKeys: readonly string[] = [],
): ApolloTwoRoundRunResult {
  const evaluatedCandidates = UNIVERSE.map((company) => ({
    candidateKey: company.key,
    roundNumber: company.round,
    providerRank: 1,
    identity: {
      providerOrganizationId: company.providerOrganizationId,
      normalizedDomain: company.domain,
      canonicalName: company.name,
      normalizedLinkedinUrl: null,
    },
    assessment: {},
    sectorEvidenceState: "sector_evidence_missing_needs_enrichment",
    eligible: company.bucket === "persisted_pending_writer",
    becameEligibleAfterEnrichment: false,
    enrichmentExecuted: company.enrichmentExecuted,
    finallyRejectedOrDuplicated: company.bucket === "definitively_rejected",
    definitivelyRejected: company.bucket === "definitively_rejected",
    definitiveRejectionReason: company.rejectionReason ?? null,
  }));

  return {
    persisted: UNIVERSE.filter(
      (c) =>
        c.bucket === "persisted_pending_writer" &&
        !reviewOnlyKeys.includes(c.key),
    ).map((c) => ({ candidateKey: c.key })),
    reviewOnly: UNIVERSE.filter(
      (c) =>
        c.bucket === "persisted_pending_writer" &&
        reviewOnlyKeys.includes(c.key),
    ).map((c) => ({ candidateKey: c.key })),
    notPersisted: [],
    enrichmentSkips: UNIVERSE.filter((c) => c.skippedReason).map((c) => ({
      candidateKey: c.key,
      skippedReason: c.skippedReason,
    })),
    evaluatedCandidates,
  } as unknown as ApolloTwoRoundRunResult;
}

/**
 * Espeja el call site real: `writerResult.candidatesCreated` + `skipped[]`, y la
 * lista de candidatas pre-writer con el nombre con el que llegaron al writer.
 */
type WriterObservation = {
  candidatesCreated: number;
  skipped: { name: string; reason: string }[];
  /** Claves pre-writer cuya evidencia NO se pudo rehidratar (nunca llegaron). */
  neverReachedKeys?: string[];
};

const WRITER_CREATED_NONE: WriterObservation = {
  candidatesCreated: 0,
  skipped: [],
};

async function runPipelineWriter(
  writer: WriterObservation = WRITER_CREATED_NONE,
  reviewOnlyKeys: readonly string[] = [],
) {
  upsertPayload = [];
  const runResult = buildRunResult(reviewOnlyKeys);
  const preWriterKeys = [...runResult.persisted, ...runResult.reviewOnly].map(
    (c) => c.candidateKey,
  );
  const neverReached = new Set(writer.neverReachedKeys ?? []);
  const summary = await persistApolloRejectedDispositions({
    batchId: BATCH_ID,
    requestedCountryCode: "CO",
    requestedIndustry: "Manufactura",
    sourcePrimary: "apollo",
    // Espeja EXACTAMENTE lo que `production-runner.server.ts` le pasa al
    // escritor, incluida la contabilidad de enrichment por candidato.
    evaluatedCandidates: runResult.evaluatedCandidates.map((c) => ({
      candidateKey: c.candidateKey,
      identity: {
        providerOrganizationId: c.identity.providerOrganizationId,
        normalizedDomain: c.identity.normalizedDomain,
        canonicalName: c.identity.canonicalName,
      },
      enrichment: {
        attempted: c.enrichmentExecuted === true,
        status: c.enrichmentExecuted === true ? "executed" : "not_attempted",
        recordedCredits: c.enrichmentExecuted === true ? 1 : 0,
        operationIds:
          c.enrichmentExecuted === true ? [`op_${c.candidateKey}`] : [],
      },
    })),
    finalDispositions: evaluateApolloCandidateFinalDispositions(runResult),
    writerOutcome: {
      candidatesCreated: writer.candidatesCreated,
      skipped: writer.skipped,
      preWriterCandidates: preWriterKeys.map((key) => ({
        candidateKey: key,
        reachedWriterAsName: neverReached.has(key)
          ? null
          : (UNIVERSE.find((c) => c.key === key)?.name ?? null),
      })),
    },
  });
  return { summary, rows: upsertPayload };
}

// ─── OBJETIVO 1 · el universo de 17 tiene que cerrar ─────────────────────────

describe("E2E real 2026-09-04 — reconciliación del universo de 17", () => {
  it("la taxonomía pura sí nombra a las 17 (el defecto no está aquí)", () => {
    const entries = evaluateApolloCandidateFinalDispositions(buildRunResult());
    assert.equal(
      entries.length,
      17,
      "la taxonomía pura cubre todo el universo",
    );
    assert.equal(new Set(entries.map((e) => e.candidateKey)).size, 17);
  });

  it("T1 · cada una de las 17 empresas tiene EXACTAMENTE un destino persistido", async () => {
    const { rows } = await runPipelineWriter();

    const persistedSourceKeys = new Set(rows.map((r) => String(r.source_key)));
    const accountedFor =
      persistedSourceKeys.size + WRITER_CREATED_CANDIDATE_IDS.length;

    const unaccounted = UNIVERSE.filter(
      (c) => !persistedSourceKeys.has(`domain:${c.domain}`),
    ).map((c) => `${c.name} <${c.domain}> [${c.bucket}]`);

    assert.deepEqual(
      unaccounted,
      [],
      `empresas descubiertas sin ningún destino terminal persistido:\n  ${unaccounted.join("\n  ")}`,
    );
    assert.equal(
      accountedFor,
      17,
      `contabilizadas ${accountedFor} de 17 empresas únicas`,
    );
  });

  it("T5 · la que el writer no creó termina como `final_validation_rejected`", async () => {
    const { rows, summary } = await runPipelineWriter();
    const row = rows.find((r) => r.domain === "rhomanufacturas.co");

    assert.ok(row, "la empresa #17 tiene fila");
    assert.equal(row.disposition, "final_validation_rejected");
    // La disposición ORIGINAL del orquestador se conserva sin reinterpretar.
    assert.equal(
      row.reason_code,
      "provisionally_persisted_pending_writer_final",
    );
    assert.equal(summary.writerGapRows, 1);

    const evidence = (row.evidence ?? {}) as Record<string, unknown>;
    const gap = evidence.writer_gap as Record<string, unknown>;
    assert.equal(gap.evidence, "writer_created_none");
    // No se inventa un motivo: el writer no nombró ninguno para esta fila.
    assert.equal(gap.reason, null);
    assert.equal(
      gap.original_final_disposition,
      "provisionally_persisted_pending_writer_final",
    );
  });

  it("T6 · `0 candidatos creados` sigue siendo 0 — no se crea ninguna fila de candidato", async () => {
    const { rows } = await runPipelineWriter();
    assert.equal(
      WRITER_CREATED_CANDIDATE_IDS.length,
      0,
      "este escritor jamás crea filas en prospect_candidates",
    );
    // Toda fila emitida va a la tabla de descartes, ninguna a candidatos.
    assert.ok(rows.every((r) => typeof r.disposition === "string"));
  });

  it("T7 · ninguna `source_key` se repite en el payload (idempotencia)", async () => {
    const { rows } = await runPipelineWriter();
    const keys = rows.map((r) => String(r.source_key));
    assert.equal(
      new Set(keys).size,
      keys.length,
      `source_key duplicadas: ${keys.join(", ")}`,
    );
    assert.equal(rows.length, 17);
  });

  it("T8 · una candidata que SÍ fue creada por el writer no aparece en descartadas", async () => {
    // El writer creó la única candidata pre-writer que llegó: 1 de 1.
    const { rows, summary } = await runPipelineWriter({
      candidatesCreated: 1,
      skipped: [],
    });

    assert.equal(
      rows.find((r) => r.domain === "rhomanufacturas.co"),
      undefined,
      "una empresa creada de verdad NO puede aparecer como descartada",
    );
    assert.equal(rows.length, 16, "las 16 rechazadas siguen ahí, la creada no");
    assert.equal(summary.writerGapRows, 0);
    assert.equal(summary.writerGapIndeterminate, 0);
  });

  it("T9 · el motivo REAL del writer viaja a la fila cuando el writer lo nombra", async () => {
    const { rows } = await runPipelineWriter({
      candidatesCreated: 0,
      skipped: [
        {
          name: "Rho Manufacturas SAS",
          reason: "quality_rejected:incomplete_contract",
        },
      ],
    });
    const row = rows.find((r) => r.domain === "rhomanufacturas.co");
    assert.ok(row);
    assert.equal(row.disposition, "final_validation_rejected");
    assert.equal(row.reason_detail, "quality_rejected:incomplete_contract");

    const evidence = (row.evidence ?? {}) as Record<string, unknown>;
    const gap = evidence.writer_gap as Record<string, unknown>;
    assert.equal(gap.evidence, "writer_skipped");
    assert.equal(gap.reason, "quality_rejected:incomplete_contract");
    assert.deepEqual(evidence.writer_gap_causes, { quality_rejected: 1 });
  });

  it("T10 · una pre-writer que nunca llegó al writer también recupera destino", async () => {
    const { rows } = await runPipelineWriter({
      candidatesCreated: 0,
      skipped: [],
      neverReachedKeys: ["k17"],
    });
    const row = rows.find((r) => r.domain === "rhomanufacturas.co");
    assert.ok(row);
    const gap = ((row.evidence ?? {}) as Record<string, unknown>)
      .writer_gap as Record<string, unknown>;
    assert.equal(gap.evidence, "never_reached_writer");
  });
});

// ─── OBJETIVO 2 · trazabilidad del enrichment pagado ─────────────────────────

describe("E2E real 2026-09-04 — trazabilidad de los 5 enrichments pagados", () => {
  it("T2 · cada enrichment pagado se puede atribuir a una empresa con destino persistido", async () => {
    const { rows } = await runPipelineWriter();
    const persistedDomains = new Set(rows.map((r) => String(r.domain)));

    const untraceable = PAID_ENRICHMENT_DOMAINS.filter(
      (d) => !persistedDomains.has(d),
    );
    assert.deepEqual(
      untraceable,
      [],
      `enrichments pagados que no se pueden atar a ningún destino persistido: ${untraceable.join(", ")}`,
    );
  });

  it("T3 · la fila de disposición declara si hubo intento de enrichment (A vs B)", async () => {
    const { rows } = await runPipelineWriter();

    const withoutAttemptFlag = rows.filter((row) => {
      const evidence = (row.evidence ?? {}) as Record<string, unknown>;
      return typeof evidence.enrichment_attempted !== "boolean";
    });

    assert.equal(
      withoutAttemptFlag.length,
      0,
      `${withoutAttemptFlag.length}/${rows.length} filas no dicen si se intentó un enrichment: ` +
        "A (presupuesto agotado ANTES del intento) es indistinguible de B (se intentó y Apollo cobró)",
    );
  });

  it("T4 · una empresa que PAGÓ y quedó `enrichment_budget_exhausted` no se declara sin gasto", async () => {
    const { rows } = await runPipelineWriter();
    const paidButExhausted = rows.find((r) => r.domain === "piempaques.co");

    assert.ok(
      paidButExhausted,
      "la empresa que pagó y quedó fuera por el cap tiene fila",
    );
    const evidence = (paidButExhausted.evidence ?? {}) as Record<
      string,
      unknown
    >;
    assert.equal(
      evidence.enrichment_attempted,
      true,
      "su fila dice `enrichment_budget_exhausted` sin registrar que Apollo YA le cobró un enrichment",
    );
  });
});

// ─── `persisted_review_only_final` — la otra disposición PRE-writer ──────────

describe("E2E real 2026-09-04 — `persisted_review_only_final` no se duplica", () => {
  it("T11 · si el writer SÍ creó la fila needs_review, no hay descarte", async () => {
    const { rows, summary } = await runPipelineWriter(
      { candidatesCreated: 1, skipped: [] },
      ["k17"],
    );

    assert.equal(
      rows.find((r) => r.domain === "rhomanufacturas.co"),
      undefined,
      "una needs_review realmente creada no puede duplicarse como descarte",
    );
    assert.equal(rows.length, 16);
    assert.equal(summary.writerGapRows, 0);
  });

  it("T12 · si el writer NO la creó, recupera destino con su disposición original", async () => {
    const { rows, summary } = await runPipelineWriter(WRITER_CREATED_NONE, [
      "k17",
    ]);
    const row = rows.find((r) => r.domain === "rhomanufacturas.co");

    assert.ok(row);
    assert.equal(row.disposition, "final_validation_rejected");
    assert.equal(row.reason_code, "persisted_review_only_final");
    assert.equal(summary.writerGapRows, 1);
    assert.equal(rows.length, 17);
  });
});

// ─── A / B / C / D / E diferenciables ───────────────────────────────────────

describe("E2E real 2026-09-04 — A/B/C/D/E son distinguibles en lo persistido", () => {
  /** Lee el caso de una fila con el vocabulario del diagnóstico. */
  function classify(
    row: Record<string, unknown>,
  ): "A" | "B" | "C" | "D" | "E" | "UNKNOWN" {
    const evidence = (row.evidence ?? {}) as Record<string, unknown>;
    const attempted = evidence.enrichment_attempted;
    if (typeof attempted !== "boolean") return "UNKNOWN";
    const credits = evidence.enrichment_recorded_credits;
    if (!attempted) return "A"; // no se pudo enriquecer: presupuesto agotado antes del intento
    if (credits === null) return "E"; // se intentó y el cobro quedó indeterminado
    if (row.disposition === "final_validation_rejected") return "D"; // enriquecida y sin candidato por hueco del writer
    return "C"; // enrichment exitoso y posteriormente descartada
  }

  it("T13 · toda fila declara su caso; ninguna queda como UNKNOWN", async () => {
    const { rows } = await runPipelineWriter();
    const unknown = rows.filter((r) => classify(r) === "UNKNOWN");
    assert.deepEqual(
      unknown.map((r) => r.domain),
      [],
    );
  });

  it("T14 · el reparto de casos es el de la corrida real", async () => {
    const { rows } = await runPipelineWriter();
    const tally = rows.reduce<Record<string, number>>((acc, row) => {
      const kind = classify(row);
      acc[kind] = (acc[kind] ?? 0) + 1;
      return acc;
    }, {});

    // A = 12 sin enrichment (2 hubspot + 1 cooldown + 1 país + 2 ownership + 6 cap)
    // C = 4 pagaron y acabaron descartadas (3 sector + 1 que el cap dejó fuera)
    // D = 1 pagó, el writer no la creó
    assert.deepEqual(tally, { A: 12, C: 4, D: 1 });
  });

  it("T15 · B (se intentó y Apollo cobró) nunca se lee como A", async () => {
    const { rows } = await runPipelineWriter();
    const paidButExhausted = rows.find((r) => r.domain === "piempaques.co");
    assert.ok(paidButExhausted);
    assert.equal(paidButExhausted.disposition, "enrichment_budget_exhausted");
    assert.notEqual(
      classify(paidButExhausted),
      "A",
      '`enrichment_budget_exhausted` con enrichment pagado no puede leerse como "no se gastó nada"',
    );
  });
});
