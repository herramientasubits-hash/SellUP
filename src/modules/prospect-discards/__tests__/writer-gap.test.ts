// AGENT1-DISCARDED-TRACEABILITY-1 — reglas puras del veredicto del writer.
// Sin I/O, sin Supabase, sin proveedores.
//
// Run: node --import tsx --test <this file>

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  classifyPreWriterCandidatesAgainstWriter,
  summarizeWriterGapCauses,
} from "../writer-gap";

const reached = (key: string, name: string) => ({
  candidateKey: key,
  reachedWriterAsName: name,
});

describe("classifyPreWriterCandidatesAgainstWriter", () => {
  it("una candidata que nunca llegó al writer no pudo crearse", () => {
    const verdicts = classifyPreWriterCandidatesAgainstWriter(
      [{ candidateKey: "a", reachedWriterAsName: null }],
      { candidatesCreated: 5, skipped: [] },
    );
    assert.deepEqual(verdicts.get("a"), {
      kind: "not_created",
      evidence: "never_reached_writer",
      reason: null,
    });
  });

  it("el writer creó 0 filas ⇒ ninguna de las que llegaron se creó", () => {
    const verdicts = classifyPreWriterCandidatesAgainstWriter(
      [reached("a", "Alfa"), reached("b", "Beta")],
      { candidatesCreated: 0, skipped: [] },
    );
    assert.equal(verdicts.get("a")?.kind, "not_created");
    assert.equal(verdicts.get("b")?.kind, "not_created");
  });

  it("creó tantas como llegaron ⇒ todas creadas, ninguna a descartadas", () => {
    const verdicts = classifyPreWriterCandidatesAgainstWriter(
      [reached("a", "Alfa"), reached("b", "Beta")],
      { candidatesCreated: 2, skipped: [] },
    );
    assert.deepEqual(verdicts.get("a"), { kind: "created" });
    assert.deepEqual(verdicts.get("b"), { kind: "created" });
  });

  it("el motivo del writer se conserva tal cual, sin reinterpretarlo", () => {
    const verdicts = classifyPreWriterCandidatesAgainstWriter(
      [reached("a", "Alfa"), reached("b", "Beta")],
      {
        candidatesCreated: 1,
        skipped: [{ name: "Alfa", reason: "novelty_rejected" }],
      },
    );
    assert.deepEqual(verdicts.get("a"), {
      kind: "not_created",
      evidence: "writer_skipped",
      reason: "novelty_rejected",
    });
    assert.deepEqual(verdicts.get("b"), { kind: "created" });
  });

  it("el emparejamiento con `skipped` es UNO A UNO entre homónimas", () => {
    const verdicts = classifyPreWriterCandidatesAgainstWriter(
      [reached("a", "Homonima SAS"), reached("b", "Homonima SAS")],
      {
        candidatesCreated: 1,
        skipped: [{ name: "homonima sas", reason: "quality_rejected" }],
      },
    );
    // La primera consume la única entrada de `skipped`; la segunda no la reusa.
    assert.equal(verdicts.get("a")?.kind, "not_created");
    assert.equal(verdicts.get("b")?.kind, "created");
  });

  it("con `0 < creadas < llegaron` y sin `skipped` que distinga ⇒ indeterminado", () => {
    const verdicts = classifyPreWriterCandidatesAgainstWriter(
      [reached("a", "Alfa"), reached("b", "Beta"), reached("c", "Gamma")],
      { candidatesCreated: 2, skipped: [] },
    );
    // Nadie puede decir CUÁL de las tres se quedó fuera: no se inventa.
    assert.equal(verdicts.get("a")?.kind, "indeterminate");
    assert.equal(verdicts.get("b")?.kind, "indeterminate");
    assert.equal(verdicts.get("c")?.kind, "indeterminate");
  });
});

describe("summarizeWriterGapCauses", () => {
  it("agrega por cubeta, conservando el detalle fuera del recuento", () => {
    assert.deepEqual(
      summarizeWriterGapCauses([
        { reason: "persistence_failed:identity_fence_missing_candidate_id" },
        { reason: "persistence_failed:insert_error" },
        { reason: "novelty_rejected" },
      ]),
      { persistence_failed: 2, novelty_rejected: 1 },
    );
  });

  it("sin descartes del writer, el recuento está vacío", () => {
    assert.deepEqual(summarizeWriterGapCauses([]), {});
  });
});
