/**
 * Regla `voz-rumbo` (check-design-system): la IA se llama «Rumbo» en lo que ve
 * quien prospecta. Casos fijos: dispara con el nombre del modelo y calla en
 * comentarios, logs y con «Rumbo».
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { VOICE_SCOPE, findVoiceIssues } from '../design-system-voice.mjs';

const lines = (text: string) => findVoiceIssues(text).map((issue) => issue.line);

describe('voz-rumbo', () => {
  it('marca el nombre del modelo en un texto, en JSX o en una plantilla', () => {
    const text = [
      "claude_review: 'Claude está revisando las empresas encontradas',",
      '<p>Usa el consumo de Anthropic.</p>',
      'const label = `${n} con GPT`;',
    ].join('\n');
    assert.deepEqual(lines(text), [1, 2, 3]);
  });

  it('calla con «Rumbo», en comentarios y en los logs', () => {
    const text = [
      "claude_review: 'Rumbo está revisando las empresas encontradas',",
      '// Claude revisa lo que trajo la web',
      ' * Claude elige las que compiten',
      "console.error('[Agent1Wizard] la búsqueda de Claude falló:', err);",
    ].join('\n');
    assert.deepEqual(lines(text), []);
  });

  it('calla dentro de un comentario de varias líneas, también el de JSX', () => {
    const text = [
      '{/* Sin «Completar con Claude» en el lote.',
      '    El rescate con Claude corre solo. */}',
      "<p>Claude</p>",
    ].join('\n');
    assert.deepEqual(lines(text), [3]);
  });

  it('no confunde identificadores en minúscula ni palabras que lo contienen', () => {
    assert.deepEqual(lines("import { runClaudeReview } from './claude-review';\nconst x = 'ChatGPT';"), []);
  });

  it('cubre lo que ve quien prospecta, no las pantallas de admin', () => {
    const inScope = (file: string) => VOICE_SCOPE.some((re) => re.test(file));
    assert.equal(inScope('src/modules/prospect-batches/chat-wizard-execution/run-progress.ts'), true);
    assert.equal(inScope('src/app/(sellup)/growth/page.tsx'), true);
    assert.equal(inScope('src/app/(sellup)/settings/providers/page.tsx'), false);
  });
});
