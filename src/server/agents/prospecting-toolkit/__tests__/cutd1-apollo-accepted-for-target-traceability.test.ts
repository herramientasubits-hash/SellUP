/**
 * A1-APOLLO-ACCEPTED-FOR-TARGET-TRACEABILITY § D.1 — la aceptación deja de ser
 * un contador y pasa a ser trazable hasta la decisión REAL del writer.
 *
 * ── El defecto que esta suite fija ───────────────────────────────────────────
 *
 * El writer YA decidía por candidato (`targetEligibility.countsTowardTarget`) y
 * tiraba el veredicto: el `push` a `persistedTargetEligibilities` era el único
 * instante en que el veredicto y el `createdCandidateId` coexistían, y ahí se
 * separaban. Su único consumidor los colapsaba a `complete_valid_candidates`.
 *
 * Consecuencia medida en Producción: `apollo_benchmark_funnel.accepted_for_target`
 * en `null` en 16/16 filas, y ninguna forma de preguntar por UNA empresa.
 *
 * ── Casos exigidos por el alcance ────────────────────────────────────────────
 *
 *   A  candidato aceptado           → accepted_for_target = true
 *   B  candidato rechazado          → false
 *   C  descartada ANTES del writer  → no aparece, no cuenta
 *   D  posible duplicado            → no cuenta
 *   E  rechazo por ICP              → no cuenta
 *   F  target overflow              → no cuenta
 *   G  varios candidatos de la MISMA búsqueda → correlación correcta
 *   H  la aceptación NO se puede inventar desde un contador agregado
 *   I  si se rompe la correlación → la prueba cae
 *   J  el replay de datos almacenados NO llama al proveedor
 *
 * 0 llamadas a proveedor · 0 escrituras · 0 migraciones · 0 créditos · 0 flags.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildCandidateAcceptedForTargetTrace,
  countAcceptedFromTraces,
  CANDIDATE_ACCEPTED_FOR_TARGET_TRACE_KEY,
  ACCEPTED_FOR_TARGET_DECIDED_BY,
  type PersistedCandidateAcceptance,
} from '../candidate-accepted-for-target-trace';
import {
  replayApolloRunAcceptance,
  readStoredCandidateAcceptance,
  type StoredCandidateRow,
  type StoredApolloUsageRow,
} from '../apollo-accepted-for-target-replay';
import { buildCandidateCompletenessCounters } from '../candidate-completeness-contract';

// ── Fixtures ─────────────────────────────────────────────────────────────────

/** La elegibilidad tal como el writer la produce. */
function eligibility(countsTowardTarget: boolean, failedConditions: string[] = []) {
  return { countsTowardTarget, failedConditions };
}

/** Una fila almacenada con el veredicto sellado, como la escribe el writer. */
function storedRow(id: string, accepted: boolean, reasons: string[] = []): StoredCandidateRow {
  return {
    id,
    source_trace: {
      sourceProvider: 'apollo',
      [CANDIDATE_ACCEPTED_FOR_TARGET_TRACE_KEY]: buildCandidateAcceptedForTargetTrace(
        eligibility(accepted, reasons),
      ),
    },
  };
}

/** Las DOS filas de búsqueda que una corrida real de Apollo produce. */
function usageRows(
  perRow: ReadonlyArray<{ credits: number; paidRaw: number; rejected: number }>,
): StoredApolloUsageRow[] {
  return perRow.map((r) => ({
    credits_used: r.credits,
    metadata: {
      apollo_benchmark_funnel: {
        paid_raw: r.paidRaw,
        precision_rejected: r.rejected,
        accepted_for_target: null,
      },
    },
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// A/B · el veredicto por candidato
// ─────────────────────────────────────────────────────────────────────────────

describe('CUT-D.1 § A/B — veredicto por candidato', () => {
  it('A — un candidato REALMENTE aceptado ⇒ accepted_for_target = true', () => {
    const trace = buildCandidateAcceptedForTargetTrace(eligibility(true));
    assert.equal(trace.acceptedForTarget, true);
    assert.deepEqual([...trace.blockingReasons], []);
  });

  it('B — un candidato rechazado ⇒ false, con sus motivos', () => {
    const trace = buildCandidateAcceptedForTargetTrace(
      eligibility(false, ['employee_count', 'subindustry_match']),
    );
    assert.equal(trace.acceptedForTarget, false);
    assert.deepEqual([...trace.blockingReasons], ['employee_count', 'subindustry_match']);
  });

  it('el veredicto sale del writer VERBATIM, no de los motivos', () => {
    // Un rechazo SIN motivos declarados sigue siendo rechazo: la autoridad es
    // `countsTowardTarget`, no la longitud de la lista.
    assert.equal(buildCandidateAcceptedForTargetTrace(eligibility(false)).acceptedForTarget, false);
    // Y un aceptado no arrastra motivos aunque se los pasen.
    const contradictorio = buildCandidateAcceptedForTargetTrace(eligibility(true, ['icp_size']));
    assert.equal(contradictorio.acceptedForTarget, true);
    assert.deepEqual([...contradictorio.blockingReasons], []);
  });

  it('la traza declara QUIÉN decidió, y es una constante', () => {
    assert.equal(
      buildCandidateAcceptedForTargetTrace(eligibility(true)).decidedBy,
      'candidate_target_eligibility',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C/D/E/F · lo que NO puede contar como aceptado
// ─────────────────────────────────────────────────────────────────────────────

describe('CUT-D.1 § C/D/E/F — lo que no cuenta', () => {
  it('C — una empresa descartada ANTES del writer no deja fila, así que no cuenta', () => {
    // El writer sólo sella lo que escribió. Una empresa rechazada por el gate de
    // admisión nunca llega aquí: el replay la ve como ausencia, no como false.
    const replay = replayApolloRunAcceptance({
      usageRows: usageRows([{ credits: 1, paidRaw: 10, rejected: 7 }]),
      candidateRows: [storedRow('c1', true), storedRow('c2', true)],
      contractAcceptedCount: 2,
    });
    assert.equal(replay.candidatesPersisted, 2, 'sólo las escritas existen como fila');
    assert.equal(replay.candidatesAccepted, 2);
    // Las 7 rechazadas antes del writer viven en el embudo, no entre los candidatos.
    assert.equal(replay.companiesRejected, 7);
    assert.equal(replay.companiesFound, 10);
  });

  for (const [caso, motivo] of [
    ['D — posible duplicado', 'duplicate_status'],
    ['E — rechazo por ICP', 'employee_count'],
    ['F — target overflow', 'target_overflow'],
  ] as const) {
    it(`${caso} ⇒ no cuenta como aceptado`, () => {
      const replay = replayApolloRunAcceptance({
        usageRows: usageRows([{ credits: 1, paidRaw: 5, rejected: 0 }]),
        candidateRows: [storedRow('ok', true), storedRow('no', false, [motivo])],
        contractAcceptedCount: 1,
      });
      assert.equal(replay.candidatesAccepted, 1, `${caso} no puede contar`);
      assert.equal(replay.candidatesPersisted, 2, 'la fila SIGUE existiendo');
      assert.equal(replay.correlationBroken, false);
      // Y el motivo queda legible sin volver a preguntarle al proveedor.
      const trace = (storedRow('no', false, [motivo]).source_trace as Record<string, never>)[
        CANDIDATE_ACCEPTED_FOR_TARGET_TRACE_KEY
      ] as unknown as { blockingReasons: string[] };
      assert.deepEqual(trace.blockingReasons, [motivo]);
    });
  }

  it('persistido ≠ aceptado: el universo durable no se recorta', () => {
    const replay = replayApolloRunAcceptance({
      usageRows: usageRows([{ credits: 2, paidRaw: 9, rejected: 1 }]),
      candidateRows: [
        storedRow('a', true),
        storedRow('b', false, ['duplicate_status']),
        storedRow('c', false, ['employee_count']),
      ],
      contractAcceptedCount: 1,
    });
    assert.equal(replay.candidatesPersisted, 3);
    assert.equal(replay.candidatesAccepted, 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// G · correlación con varios candidatos y varias filas de búsqueda
// ─────────────────────────────────────────────────────────────────────────────

describe('CUT-D.1 § G — correlación', () => {
  it('varios candidatos de la MISMA corrida se correlacionan uno a uno', () => {
    const acceptances: PersistedCandidateAcceptance[] = [
      { candidateId: 'c1', trace: buildCandidateAcceptedForTargetTrace(eligibility(true)) },
      { candidateId: 'c2', trace: buildCandidateAcceptedForTargetTrace(eligibility(false, ['x'])) },
      { candidateId: 'c3', trace: buildCandidateAcceptedForTargetTrace(eligibility(true)) },
    ];
    assert.equal(countAcceptedFromTraces(acceptances), 2);
    // Cada id conserva SU veredicto: no hay reparto ni promedio.
    assert.equal(acceptances.find((a) => a.candidateId === 'c2')?.trace.acceptedForTarget, false);
    assert.equal(new Set(acceptances.map((a) => a.candidateId)).size, 3);
  });

  it('🔴 la aceptación es DE LA CORRIDA: dos filas de búsqueda no la duplican', () => {
    // La forma REAL de Producción: 8 corridas, 2 filas de `organizations_search`
    // cada una. El lote `483f3584` tiene 5 aceptadas; estampar el total en cada
    // fila reportaría 10.
    const replay = replayApolloRunAcceptance({
      usageRows: usageRows([
        { credits: 1, paidRaw: 3, rejected: 0 },
        { credits: 5, paidRaw: 7, rejected: 0 },
      ]),
      candidateRows: ['c1', 'c2', 'c3', 'c4', 'c5'].map((id) => storedRow(id, true)),
      contractAcceptedCount: 5,
    });
    assert.equal(replay.candidatesAccepted, 5, 'JAMÁS 10');
    // Los créditos SÍ se suman entre las filas de la corrida.
    assert.equal(replay.creditsUsed, 6);
    assert.equal(replay.companiesFound, 10);
    assert.equal(replay.creditsPerAccepted, 6 / 5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// H · no se puede inventar desde un contador agregado
// ─────────────────────────────────────────────────────────────────────────────

describe('CUT-D.1 § H — la aceptación no se infiere', () => {
  it('sin traza por candidato, `candidatesAccepted` es null AUNQUE haya contador', () => {
    // Ésta es la corrida pre-D.1: hay filas, hay contador del contrato… y la
    // pregunta «¿fue aceptada ESTA empresa?» sigue sin respuesta.
    const replay = replayApolloRunAcceptance({
      usageRows: usageRows([{ credits: 1, paidRaw: 3, rejected: 0 }]),
      candidateRows: [
        { id: 'c1', source_trace: { sourceProvider: 'apollo' } },
        { id: 'c2', source_trace: null },
      ],
      contractAcceptedCount: 2,
    });
    assert.equal(replay.candidatesWithTrace, 0);
    assert.equal(replay.candidatesAccepted, null, 'un contador NO produce veredictos');
    assert.equal(replay.creditsPerAccepted, null);
    // …y no se declara roto: no medir no es discrepar.
    assert.equal(replay.correlationBroken, false);
  });

  it('una traza sin `decidedBy` del writer NO se acepta como veredicto', () => {
    // La defensa contra que otra capa escriba un booleano con el mismo nombre.
    assert.equal(
      readStoredCandidateAcceptance({
        id: 'c1',
        source_trace: {
          [CANDIDATE_ACCEPTED_FOR_TARGET_TRACE_KEY]: {
            acceptedForTarget: true,
            decidedBy: 'alguna_otra_capa',
            blockingReasons: [],
          },
        },
      }),
      null,
    );
  });

  it('0 aceptadas ⇒ coste por aceptada null, nunca 0', () => {
    const replay = replayApolloRunAcceptance({
      usageRows: usageRows([{ credits: 5, paidRaw: 7, rejected: 7 }]),
      candidateRows: [storedRow('c1', false, ['icp'])],
      contractAcceptedCount: 0,
    });
    assert.equal(replay.candidatesAccepted, 0, '0 medido es 0');
    assert.equal(replay.creditsPerAccepted, null, 'dividir entre 0 no es gratis');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// I · si se rompe la correlación, la prueba cae
// ─────────────────────────────────────────────────────────────────────────────

describe('CUT-D.1 § I — correlación rota', () => {
  it('veredictos y contador del contrato que discrepan ⇒ `correlationBroken`', () => {
    const replay = replayApolloRunAcceptance({
      usageRows: usageRows([{ credits: 1, paidRaw: 5, rejected: 0 }]),
      candidateRows: [storedRow('c1', true), storedRow('c2', true)],
      // El contrato dice 1 y las trazas dicen 2: algo se rompió.
      contractAcceptedCount: 1,
    });
    assert.equal(replay.correlationBroken, true);
    // 🔴 No se resuelve eligiendo una: las dos viajan.
    assert.equal(replay.candidatesAccepted, 2);
    assert.equal(replay.contractAcceptedCount, 1);
  });

  it('la suma de trazas coincide con el contador del contrato en el camino sano', () => {
    const eligibilities = [
      eligibility(true),
      eligibility(false, ['employee_count']),
      eligibility(true),
      eligibility(false, ['duplicate_status']),
    ];
    // La MISMA lista por las dos vías: el contador canónico del contrato…
    const counters = buildCandidateCompletenessCounters(eligibilities);
    // …y la suma de los veredictos por candidato.
    const acceptances = eligibilities.map((e, i) => ({
      candidateId: `c${i}`,
      trace: buildCandidateAcceptedForTargetTrace(e),
    }));
    assert.equal(counters.complete_valid_candidates, 2);
    assert.equal(countAcceptedFromTraces(acceptances), counters.complete_valid_candidates);
    assert.equal(counters.target_count, countAcceptedFromTraces(acceptances));
  });

  it('GUARDA ESTÁTICA — el writer real sella el veredicto y lo devuelve', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/server/agents/prospecting-toolkit/candidate-writer.ts'),
      'utf8',
    );
    const code = src
      .split('\n')
      .filter((l) => {
        const t = l.trim();
        return t.length > 0 && !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*');
      })
      .join('\n');
    // El sello en la fila…
    assert.ok(
      code.includes('CANDIDATE_ACCEPTED_FOR_TARGET_TRACE_KEY'),
      'el writer dejó de sellar el veredicto en `source_trace`',
    );
    // …el emparejado con el id…
    assert.ok(
      /persistedCandidateAcceptances\.push\(\{\s*candidateId: createdCandidateId/.test(code),
      'el writer dejó de emparejar el veredicto con el id de la fila',
    );
    // …y la salida.
    assert.ok(
      code.includes('acceptedForTargetByCandidate: persistedCandidateAcceptances'),
      'el writer dejó de devolver los veredictos por candidato',
    );
    // 🔴 Y el veredicto se LEE, no se recalcula: el sello recibe la elegibilidad
    // del writer y nada más.
    assert.ok(
      code.includes('buildCandidateAcceptedForTargetTrace(targetEligibility)'),
      'el sello dejó de usar la elegibilidad REAL del writer',
    );
  });

  it('GUARDA ESTÁTICA — el sello es SÓLO de Apollo: Lusha y Tavily no cambian', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/server/agents/prospecting-toolkit/candidate-writer.ts'),
      'utf8',
    );
    // El sello vive DENTRO de la rama `apolloProviderTrace ? … : candidateInsertBase`,
    // así que la rama del else queda intacta.
    const start = src.indexOf('const candidateInsertWithTrace = apolloProviderTrace');
    assert.ok(start > 0, 'la rama de sellado de Apollo cambió de forma');
    const block = src.slice(start, src.indexOf(': candidateInsertBase;', start));
    // 🔴 Se busca el IDENTIFICADOR en el fuente, no el valor de la constante:
    // el writer escribe `[CANDIDATE_ACCEPTED_FOR_TARGET_TRACE_KEY]`, no el
    // literal `'acceptedForTarget'`.
    assert.ok(
      block.includes('CANDIDATE_ACCEPTED_FOR_TARGET_TRACE_KEY'),
      'el sello salió de la rama de Apollo',
    );
    // Y el else sigue siendo la base sin tocar.
    assert.match(src.slice(start), /: candidateInsertBase;/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// J · el replay no llama al proveedor
// ─────────────────────────────────────────────────────────────────────────────

describe('CUT-D.1 § J — replay sin proveedor', () => {
  it('el replay responde las SEIS preguntas desde filas almacenadas', () => {
    const replay = replayApolloRunAcceptance({
      usageRows: usageRows([
        { credits: 1, paidRaw: 3, rejected: 0 },
        { credits: 5, paidRaw: 7, rejected: 2 },
      ]),
      candidateRows: [
        storedRow('c1', true),
        storedRow('c2', true),
        storedRow('c3', false, ['employee_count']),
      ],
      contractAcceptedCount: 2,
    });
    assert.equal(replay.companiesFound, 10);      // 1
    assert.equal(replay.companiesRejected, 2);    // 2
    assert.equal(replay.candidatesPersisted, 3);  // 3
    assert.equal(replay.candidatesAccepted, 2);   // 4
    assert.equal(replay.creditsUsed, 6);          // 5
    assert.equal(replay.creditsPerAccepted, 3);   // 6
  });

  it('GUARDA ESTÁTICA — los dos módulos de D.1 no pueden llamar a nadie', () => {
    for (const file of [
      'src/server/agents/prospecting-toolkit/candidate-accepted-for-target-trace.ts',
      'src/server/agents/prospecting-toolkit/apollo-accepted-for-target-replay.ts',
    ]) {
      const src = fs.readFileSync(path.join(process.cwd(), file), 'utf8');
      for (const forbidden of [
        'fetch(',
        'createClient',
        'supabase',
        'apiKey',
        'insert(',
        'upsert(',
        'update(',
        'process.env',
      ]) {
        assert.ok(!src.includes(forbidden), `${file} contiene \`${forbidden}\``);
      }
    }
  });
});
