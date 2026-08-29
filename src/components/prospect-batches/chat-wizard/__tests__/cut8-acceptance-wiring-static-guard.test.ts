/**
 * cut8-acceptance-wiring-static-guard.test.ts — el cableado que ningún runner de
 * este repo ejecuta, con su prueba en NEGATIVO.
 *
 * AGENT1-LOCAL-CUT8-ACCEPTANCE-REPORTING-PROPAGATION §§ A, B, D, G, H, I, J, K.
 *
 * ── Por qué hace falta una guarda estática ──────────────────────────────────
 *
 * Tres tramos de este corte no se pueden demostrar ejecutándolos aquí:
 *
 *   · `result → dispatch`, dentro de un componente de React que este runner no
 *     monta — y es DONDE estaba el defecto: el despacho de éxito llevaba tres
 *     campos y tiraba las cifras;
 *   · `state → SuccessPanel`, la línea que pasaba el OBJETIVO como si fuera el
 *     conteo de candidatos;
 *   · la costura durable del writer, que sólo corre con Supabase delante.
 *
 * Una regresión en cualquiera de los tres dejaría VERDES todos los tests de
 * reducer y de copy, porque cada pieza seguiría siendo correcta por separado:
 * simplemente nadie le pasaría el dato.
 *
 * 🔴 Comentarios fuera antes de grepear. Este archivo y los que inspecciona
 * NOMBRAN en su prosa las mismas cadenas que se buscan, y confundir «citarlo»
 * con «usarlo» es el falso positivo que ya mordió antes en este repo.
 *
 * 🔴 Cada guarda va con la mutación que la pondría en rojo, sobre una COPIA en
 * memoria — nunca sobre el archivo.
 *
 * Sin DOM, sin red, sin Supabase, 0 créditos.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), 'utf8');

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

const WIZARD = 'src/components/prospect-batches/chat-wizard/prospect-chat-wizard.tsx';
const SUMMARY = 'src/components/prospect-batches/chat-wizard/wizard-conversation-summary.tsx';
const PANEL = 'src/components/prospect-batches/chat-wizard/wizard-execution-panels.tsx';
const REDUCER = 'src/modules/prospect-batches/chat-wizard/wizard-reducer.ts';
const ACTIONS = 'src/modules/prospect-batches/chat-wizard-execution/wizard-execution-actions.ts';
const WRITER = 'src/server/agents/prospecting-toolkit/candidate-writer.ts';
const INCREMENTAL = 'src/server/agents/prospecting-toolkit/incremental-search.ts';
const EFFECTIVENESS = 'src/modules/agent1-effectiveness/queries.ts';

const code = (rel: string): string => stripTsComments(read(rel));

/** La ventana de un despacho/llamada, no el archivo entero. */
function windowAt(src: string, anchor: string, span = 900): string {
  const at = src.indexOf(anchor);
  assert.ok(at > 0, `ancla no encontrada: ${anchor}`);
  return src.slice(at, at + span);
}

// ── § B · el despacho de éxito transporta las cifras ─────────────────────────

describe('CUT-8 § B — EXECUTION_SUCCEEDED lleva conteo durable y aceptación', () => {
  it('el despacho de éxito lee `result.candidateCount` y `result.acceptedForTarget`', () => {
    const w = windowAt(code(WIZARD), "type: 'EXECUTION_SUCCEEDED',");
    assert.match(w, /candidateCount:\s*result\.candidateCount/);
    assert.match(w, /acceptedForTarget:\s*result\.acceptedForTarget/);
    assert.match(
      w,
      /toAcceptedForTargetSummary\(/,
      'la proyección es la canónica, no un objeto armado a mano',
    );
  });

  it('🔴 § B EN NEGATIVO — la guarda detecta un despacho que vuelva a tirarlas', () => {
    const mutated = windowAt(code(WIZARD), "type: 'EXECUTION_SUCCEEDED',").replace(
      /candidateCount:\s*result\.candidateCount,?/,
      '',
    );
    assert.doesNotMatch(
      mutated,
      /candidateCount:\s*result\.candidateCount/,
      '🔴 con el campo fuera, la guarda de arriba se pondría roja',
    );
  });

  it('🔴 el cliente NO decide si el objetivo se alcanzó', () => {
    const w = windowAt(code(WIZARD), "type: 'EXECUTION_SUCCEEDED',");
    assert.doesNotMatch(w, />=/, 'ninguna comparación de objetivo en el despacho');
    assert.doesNotMatch(w, /targetReached:\s*[^r]/);
  });
});

// ── § A · la prohibición explícita del enunciado ─────────────────────────────

describe('CUT-8 § A — candidateCount JAMÁS es el objetivo', () => {
  it('ninguna superficie pasa `executionTargetPersistibleCandidates` como candidateCount', () => {
    const src = code(SUMMARY);
    assert.doesNotMatch(
      src,
      /candidateCount=\{state\.executionTargetPersistibleCandidates\}/,
      '🔴 ÉSTA era la línea del defecto',
    );
    assert.match(src, /candidateCount=\{state\.executionCandidateCount\}/);
    assert.match(src, /acceptedForTarget=\{state\.executionAcceptedForTarget\}/);
  });

  it('el campo de estado que permitía la confusión ya no existe', () => {
    const types = code('src/modules/prospect-batches/chat-wizard/wizard-types.ts');
    assert.doesNotMatch(types, /executionTargetPersistibleCandidates/);
    assert.doesNotMatch(
      types,
      /executionTargetReached/,
      '🔴 un segundo veredicto de objetivo en el estado puede discrepar del canónico',
    );
    assert.doesNotMatch(code(REDUCER), /executionTargetPersistibleCandidates/);
    assert.doesNotMatch(code(REDUCER), /executionTargetReached/);
  });

  it('🔴 § A EN NEGATIVO — restaurar el alias pondría roja la guarda', () => {
    const mutated = code(SUMMARY).replace(
      'candidateCount={state.executionCandidateCount}',
      'candidateCount={state.executionTargetPersistibleCandidates}',
    );
    assert.match(
      mutated,
      /candidateCount=\{state\.executionTargetPersistibleCandidates\}/,
      '🔴 así se vería la regresión que la guarda de arriba detiene',
    );
  });

  it('el panel ya no acepta el objetivo por una prop suelta', () => {
    assert.doesNotMatch(
      code(PANEL),
      /targetPersistibleCandidates/,
      '🔴 el objetivo viaja DENTRO del resumen canónico, no al lado',
    );
  });
});

// ── § D · el panel lee TODOS los campos transportados ────────────────────────

describe('CUT-8 § D — el panel no ignora el resumen canónico', () => {
  it('el panel construye y pinta las filas del resumen de aceptación', () => {
    const src = code(PANEL);
    assert.match(src, /buildWizardAcceptedForTargetSummary\(acceptedForTarget\)/);
    assert.match(src, /acceptedForTargetRows/);
    assert.match(src, /acceptedForTargetRows !== null && \(/);
  });

  it('🔴 § D EN NEGATIVO — un panel que ignorase el resumen no lo construiría', () => {
    const mutated = code(PANEL).replace(/buildWizardAcceptedForTargetSummary\([^)]*\)/g, 'null');
    assert.doesNotMatch(mutated, /buildWizardAcceptedForTargetSummary\(/);
  });

  /**
   * 🔴 CADA campo transportado tiene que llegar a la pantalla. Un campo que
   * viaja y nadie pinta es un cable muerto — exactamente lo que le pasaba a
   * `executionTargetReached` antes de este corte.
   */
  it('los seis campos del resumen se leen en el copy o en el panel', () => {
    const copy = code(
      'src/modules/prospect-batches/chat-wizard-execution/wizard-target-summary-copy.ts',
    );
    const builderAt = copy.indexOf('export function buildWizardAcceptedForTargetSummary');
    assert.ok(builderAt > 0);
    const builder = copy.slice(builderAt);
    for (const field of [
      'requestedTarget',
      'acceptedForTargetTotal',
      'remainingTarget',
      'targetReached',
      'persistedTotalCandidates',
      'paidAcceptanceMeasured',
    ]) {
      assert.match(
        builder,
        new RegExp(`input\\.${field}\\b`),
        `🔴 ${field} viaja hasta la UI y nadie lo pinta`,
      );
    }
    // Y el conteo durable, que viaja por su propia prop.
    assert.match(code(PANEL), /\$\{candidateCount\}/);
  });
});

// ── § G · la metadata durable usa el resolver canónico ───────────────────────

describe('CUT-8 § G — la metadata NO recalcula la aceptación', () => {
  it('el mago publica el bloque con las dos funciones de CUT-7 y con ninguna otra', () => {
    const src = code(ACTIONS);
    const at = src.indexOf('resolveAcceptedForTargetBatchMetadata');
    assert.ok(at > 0, 'la costura durable existe');
    const seam = src.slice(at, at + 700);
    assert.match(seam, /ACCEPTED_FOR_TARGET_METADATA_KEY/);
    assert.match(seam, /toAcceptedForTargetMetadata\(/);
    assert.match(seam, /resolveRunAcceptance\(/);
    // Sin aritmética propia dentro de la costura.
    assert.doesNotMatch(seam, /[+\-]\s*\d|Math\.(max|min)|>=/);
  });

  /**
   * 🔴 CUT-8B endureció esta guarda de 2 a 1. Antes del corte la rama
   * sólo-gratuita llamaba a `resolveAcceptedForTarget` por su cuenta y el helper
   * de corrida lo llamaba otra vez: dos entradas a la misma aritmética que hoy
   * coincidían y mañana podían separarse. Ahora las TRES lecturas de aceptación
   * de la corrida —la previa al pago, la durable y la del resultado— pasan por
   * `resolveRunAcceptance`, así que el mago invoca al resolver canónico UNA vez.
   */
  it('🔴 § 2 — existe UNA sola invocación del resolver de aceptación en el mago', () => {
    const src = code(ACTIONS);
    const calls = src.match(/resolveAcceptedForTarget\(\{/g) ?? [];
    assert.equal(
      calls.length,
      1,
      '🔴 sólo la del helper único de corrida. Una segunda sería una segunda aritmética',
    );
    const helper = src.match(/const resolveRunAcceptance = /g) ?? [];
    assert.equal(helper.length, 1);
  });

  it('🔴 § 2 EN NEGATIVO — una segunda llamada directa pondría roja la guarda', () => {
    const mutated =
      code(ACTIONS) +
      '\nconst rogue = resolveAcceptedForTarget({ demand, freePersistedCandidates: 0, paid });\n';
    const calls = mutated.match(/resolveAcceptedForTarget\(\{/g) ?? [];
    assert.equal(calls.length, 2, '🔴 así se vería la segunda aritmética que la guarda detiene');
  });

  /**
   * 🔴 DECISIÓN B — la prohibición no es «no escribir en el lote»: el mago sella
   * `status` en sitios legítimos y eso no cambia. Lo prohibido es una
   * publicación de metadata INDEPENDIENTE, por detrás de la que el writer hace.
   *
   * 🔴 CUT-8B redefine dónde está la línea, no la borra. La rama sólo-gratuita
   * no pasa por ningún writer de proveedor, así que su sellado terminal ES su
   * única publicación durable: carga `status` y `metadata` en el MISMO UPDATE,
   * exactamente como el sellado terminal de `candidate-writer` en la rama mixta.
   * Lo que sigue prohibido —y lo que estas guardas comprueban— es que aparezca
   * un UPDATE de metadata ADICIONAL, o un `metadata || ...` de Postgres.
   */
  it('🔴 § B — el mago publica metadata en UNA sola escritura terminal', () => {
    const src = code(ACTIONS);
    // El literal del UPDATE, no una ventana de caracteres: `[^}]*` se detiene en
    // la primera llave de cierre, así que `.update({ status })` no puede
    // arrastrar la escritura de al lado y contarse como publicación.
    const metadataWrites = src.match(/\.update\(\{[^}]*metadata/g) ?? [];
    assert.equal(
      metadataWrites.length,
      1,
      '🔴 UNA publicación independiente de metadata por ejecución, y ni una más',
    );
    assert.match(
      metadataWrites[0],
      /\.update\(\{\s*status,/,
      '🔴 una publicación que no selle estado sería una escritura aparte',
    );
    assert.doesNotMatch(
      src,
      /\.update\(\{\s*metadata/,
      '🔴 un UPDATE sólo de metadata es la segunda escritura que este corte prohíbe',
    );
    assert.match(
      src,
      /metadata: composeFreeOnlyTerminalBatchMetadata\(/,
      '🔴 la metadata se compone con el proyector nombrado, no a mano',
    );
    // Las escrituras que NO publican metadata siguen sellando estado y nada más.
    const statusOnly = src.match(/\.update\(\{ status \}\)/g) ?? [];
    assert.ok(statusOnly.length >= 2, 'los sellados de estado acotados siguen existiendo');
  });

  it('🔴 § P EN NEGATIVO — una segunda publicación pondría roja la guarda', () => {
    const mutated =
      code(ACTIONS) +
      "\nawait supabase.from('prospect_batches').update({ metadata: extra }).eq('id', batchId);\n";
    const metadataWrites = mutated.match(/\.update\(\{[^}]*metadata/g) ?? [];
    assert.equal(
      metadataWrites.length,
      2,
      '🔴 así se vería la segunda publicación que la guarda detiene',
    );
    assert.match(mutated, /\.update\(\{\s*metadata/);
  });

  it('🔴 el mago NUNCA fusiona metadata con `||` de Postgres', () => {
    const src = code(ACTIONS);
    assert.doesNotMatch(src, /metadata\s*\|\|\s*/, '🔴 el merge jsonb en SQL queda prohibido');
    assert.doesNotMatch(src, /jsonb_set|\bmetadata\s*=\s*metadata\b/);
  });

  it('el writer invoca la costura UNA vez, antes de su única publicación', () => {
    const src = code(WRITER);
    const resolveAt = src.indexOf('resolveExtraBatchMetadata({');
    const finalAt = src.indexOf('const finalMetadata = {');
    assert.ok(resolveAt > 0, 'el writer llama a la costura');
    assert.ok(finalAt > resolveAt, '🔴 se resuelve ANTES de componer la metadata final');
    const invocations = src.match(/resolveExtraBatchMetadata\(\{/g) ?? [];
    assert.equal(invocations.length, 1, '🔴 una sola invocación por ejecución');
  });

  it('🔴 la costura recibe `complete_valid_candidates` TAL CUAL, nunca las filas', () => {
    const src = code(WRITER);
    const seam = windowAt(src, 'resolveExtraBatchMetadata({', 600);
    assert.match(seam, /completeValidCandidates:\s*\n?\s*canonicalCompletenessCounters/);
    assert.doesNotMatch(
      seam,
      /completeValidCandidates:\s*createdCandidateIds/,
      '🔴 sustituir la medición por las filas reabriría el defecto de CUT-7 en la base',
    );
  });
});

// ── § H · adaptive_discovery deja de emitir veredicto de objetivo ────────────

describe('CUT-8 § H — la metadata de filas no reclama el objetivo', () => {
  it('el constructor de adaptive_discovery no deriva estado ni hueco de las filas', () => {
    const src = code(INCREMENTAL);
    const at = src.indexOf('const buildAdaptiveDiscovery =');
    assert.ok(at > 0);
    const builder = src.slice(at, src.indexOf('};', at) + 2);
    assert.doesNotMatch(builder, /success_target_reached/);
    assert.doesNotMatch(builder, /success_partial/);
    assert.doesNotMatch(builder, /remaining_to_target/);
    assert.match(builder, /persisted_count:/, 'el hecho de FILAS sí se conserva');
  });

  it('el writer no reintroduce el veredicto al reconciliar', () => {
    const src = code(WRITER);
    const at = src.indexOf('const reconciledAdaptiveForStorage');
    assert.ok(at > 0);
    const block = src.slice(at, at + 900);
    assert.doesNotMatch(block, /coherentStopReason/);
    assert.doesNotMatch(block, /resultStatus/);
    assert.match(block, /persisted_count: createdCandidateIds\.length/);
  });

  it('🔴 § H EN NEGATIVO — la guarda detectaría el regreso del veredicto por filas', () => {
    const at = code(INCREMENTAL).indexOf('const buildAdaptiveDiscovery =');
    const builder = code(INCREMENTAL).slice(at, at + 600);
    const mutated = builder.replace(
      'persisted_count: persistedCount,',
      "persisted_count: persistedCount,\n      result_status: persistedCount >= targetPersistibleCandidates ? 'success_target_reached' : 'success_partial',",
    );
    assert.match(mutated, /success_target_reached/, '🔴 así se vería la regresión');
  });
});

// ── § J · la semántica del tablero NO cambia ────────────────────────────────

describe('CUT-8 § J — «sin empresas nuevas» sigue significando lo mismo', () => {
  it('el respaldo histórico se lee primero y la metadata nueva usa persisted_count === 0', () => {
    const src = code(EFFECTIVENESS);
    const at = src.indexOf('function readAdaptiveResultStatus');
    assert.ok(at > 0);
    const fn = src.slice(at, src.indexOf('\n}', at));
    assert.match(fn, /adaptive\.result_status/, 'respaldo HISTÓRICO');
    assert.match(fn, /adaptive\.persisted_count/, 'metadata NUEVA');
    assert.match(fn, /persisted === 0 \? 'no_new_candidates' : null/);
    assert.doesNotMatch(
      fn,
      /success_target_reached|success_partial/,
      '🔴 esta capa no reconstruye un veredicto de objetivo desde filas',
    );
  });

  it('🔴 § J EN NEGATIVO — invertir el orden perdería la verdad histórica', () => {
    const at = code(EFFECTIVENESS).indexOf('function readAdaptiveResultStatus');
    const fn = code(EFFECTIVENESS).slice(at, at + 800);
    const statusAt = fn.indexOf('adaptive.result_status');
    const persistedAt = fn.indexOf('adaptive.persisted_count');
    assert.ok(
      statusAt < persistedAt,
      '🔴 con el orden invertido, un lote histórico con result_status y persisted_count>0 devolvería null',
    );
  });
});

// ── § K · la aceptación no toca el dinero ───────────────────────────────────

describe('CUT-8 § K — la aceptación no se filtra a presupuesto ni a reservas', () => {
  it('el bloque de aceptación no aparece en ninguna llamada de presupuesto', () => {
    const src = code(ACTIONS);
    for (const anchor of ['reserveBudget', 'releaseBudget', 'estimateCreditsForProvider']) {
      let from = 0;
      for (;;) {
        const at = src.indexOf(anchor, from);
        if (at < 0) break;
        const w = src.slice(at, at + 400);
        assert.doesNotMatch(
          w,
          /acceptedForTarget|acceptedForTargetTotal|resolveRunAcceptance/,
          `🔴 ${anchor} no puede ver la aceptación`,
        );
        from = at + anchor.length;
      }
    }
  });

  it('el corte no añade migración', () => {
    const src = code(ACTIONS) + code(WRITER) + code(INCREMENTAL);
    assert.doesNotMatch(src, /supabase\/migrations/);
  });
});
