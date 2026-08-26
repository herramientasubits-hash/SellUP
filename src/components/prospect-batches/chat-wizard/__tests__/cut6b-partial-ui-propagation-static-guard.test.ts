/**
 * cut6b-partial-ui-propagation-static-guard.test.ts — el cableado que va del
 * RESULTADO del servidor al estado del mago, con su prueba en NEGATIVO.
 *
 * AGENT1-LOCAL-CUT6B-PARTIAL-UI-PROPAGATION §§ 3, 4, 6.
 *
 * ── Por qué hace falta una guarda estática aquí ─────────────────────────────
 *
 * El tramo `EXECUTION_FAILED → reducer → copy` se demuestra ejecutándolo (suite
 * hermana). El tramo anterior —`result.freeContribution` → el despacho— vive
 * dentro de un componente de React que este runner no monta, y es EXACTAMENTE
 * donde estaba el defecto que CUT-6B cierra: la rama `else` leía sólo
 * `result.code` y tiraba el resto. Una regresión ahí no rompería ningún test de
 * reducer, porque el reducer seguiría siendo correcto: nadie le pasaría el dato.
 *
 * 🔴 Comentarios fuera antes de grepear: este archivo y los que inspecciona
 * NOMBRAN en su prosa las mismas cadenas que se buscan, y confundir «citarlo» con
 * «usarlo» es el falso positivo que ya mordió antes en este repo.
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
const PANEL = 'src/components/prospect-batches/chat-wizard/wizard-conversation-summary.tsx';
const REDUCER = 'src/modules/prospect-batches/chat-wizard/wizard-reducer.ts';
const TYPES = 'src/modules/prospect-batches/chat-wizard-execution/wizard-execution-types.ts';

const code = (rel: string): string => stripTsComments(read(rel));

// ── A · el componente NO puede volver a tirar el aporte ──────────────────────

describe('CUT-6B § 3 · A — el despacho de fallo transporta freeContribution', () => {
  it('la rama de fallo lee `result.freeContribution` y lo pasa a la acción', () => {
    const src = code(WIZARD);
    const dispatchAt = src.indexOf("type: 'EXECUTION_FAILED',");
    assert.ok(dispatchAt > 0, 'el despacho de fallo existe');
    // La ventana del despacho, no el archivo entero: encontrar la cadena en
    // cualquier otro sitio no probaría que ESTE despacho la lleva.
    const window = src.slice(dispatchAt, dispatchAt + 400);
    assert.ok(
      window.includes('result.freeContribution'),
      '🔴 NEGATIVO A — sin esto el campo vuelve a ser write-only',
    );
  });

  it('🔴 EN NEGATIVO — la guarda detecta un despacho que lo omite', () => {
    const src = code(WIZARD);
    // Mutante: el despacho anterior a CUT-6B, tal cual estaba.
    const mutated = src.replace(
      /\.\.\.\(result\.freeContribution \? \{ freeContribution: result\.freeContribution \} : \{\}\),\n/,
      '',
    );
    assert.notEqual(mutated, src, 'la mutación se aplicó sobre la copia');
    const at = mutated.indexOf("type: 'EXECUTION_FAILED',");
    assert.ok(
      !mutated.slice(at, at + 400).includes('result.freeContribution'),
      '🔴 la guarda vería el defecto original en rojo',
    );
  });

  it('🔴 el batchId sale del aporte, nunca de una heurística de «último lote»', () => {
    const src = code(WIZARD) + code(PANEL) + code(REDUCER);
    for (const forbidden of ['latestBatch', 'lastBatchId', 'mostRecentBatch']) {
      assert.ok(!src.includes(forbidden), `🔴 ${forbidden} señalaría a otra corrida`);
    }
    assert.ok(
      code(REDUCER).includes('action.freeContribution ?? null'),
      '🔴 el reducer copia el aporte de la acción y no lo reconstruye',
    );
  });
});

// ── B · el panel tiene que PINTARLO ──────────────────────────────────────────

describe('CUT-6B § 4 · B — el panel de error muestra el aporte', () => {
  it('recibe el aporte desde el estado y resuelve el copy con la función pura', () => {
    const src = code(PANEL);
    assert.ok(src.includes('freeContribution={state.executionFreeContribution}'));
    assert.ok(src.includes('presentFreeContribution(freeContribution)'));
    assert.ok(src.includes('data-testid="wizard-free-contribution-notice"'));
  });

  it('🔴 NEGATIVO C — la guarda detecta un panel que recibe el aporte y no lo pinta', () => {
    const src = code(PANEL);
    const mutated = src.replace(/data-testid="wizard-free-contribution-notice"/, '');
    assert.notEqual(mutated, src);
    assert.ok(!mutated.includes('data-testid="wizard-free-contribution-notice"'));
  });

  it('🔴 el panel NO decide el texto por su cuenta', () => {
    const src = code(PANEL);
    for (const forbidden of ['quedaron guardadas', 'quedó guardada']) {
      assert.ok(
        !src.includes(forbidden),
        `🔴 «${forbidden}» escrito aquí sería una segunda copia del copy`,
      );
    }
  });
});

// ── C · el alcance: CUT-6B es UI y estado, nada más ──────────────────────────

describe('CUT-6B § 6 · C — el alcance queda acotado', () => {
  it('la forma del aporte es la del SERVIDOR, no una segunda del frontend', () => {
    assert.ok(
      code(TYPES).includes('export type WizardFreeContribution'),
      'el tipo compartido existe en el módulo del servidor',
    );
    const src = code(PANEL) + code(REDUCER);
    assert.ok(
      !/persistedCandidates:\s*number;[\s\S]{0,80}redirectPath:\s*string;/.test(src),
      '🔴 una forma escrita a mano en la UI podría quedarse atrás de la del servidor',
    );
  });

  it('🔴 sin CTA al lote mientras el destino no se declare veraz', () => {
    const src = code(PANEL);
    const at = src.indexOf('presentFreeContribution(freeContribution)');
    assert.ok(at > 0);
    // El aviso no puede llevar navegación todavía: el conteo de la ficha del
    // lote es un hilo aparte (CUT-4 GATE-0) y una UI limitada pero verdadera es
    // preferible a un enlace que pueda contradecir la frase anterior.
    const noticeBlock = src.slice(src.indexOf('wizard-free-contribution-notice') - 400,
      src.indexOf('wizard-free-contribution-notice') + 400);
    for (const forbidden of ['router.push', '<Link', 'href=']) {
      assert.ok(
        !noticeBlock.includes(forbidden),
        `🔴 ${forbidden} dentro del aviso sería el CTA que CUT-6B aplaza`,
      );
    }
  });

  it('🔴 el reintento no cambia: el componente no ejecuta por su cuenta', () => {
    const src = code(WIZARD);
    const at = src.indexOf("type: 'EXECUTION_FAILED',");
    const window = src.slice(at, at + 400);
    for (const forbidden of ['executeProspectWizardGenerationAction(', 'ok: true']) {
      assert.ok(
        !window.includes(forbidden),
        `🔴 ${forbidden} convertiría el fallo en otra cosa`,
      );
    }
  });
});
