// Guarda de eliminación real de reglas de presupuesto.
//
// NO replica la lógica: lee el CÓDIGO FUENTE real de rule-actions.ts y de los
// dos consumidores de UI. Una réplica inline pasaría en verde aunque producción
// volviera al soft-delete — que es exactamente el defecto que este archivo
// existe para impedir.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..', '..', '..');

function readSource(relPath: string): string {
  return readFileSync(join(ROOT, relPath), 'utf8');
}

/** Quita comentarios: nombrar algo en un comentario no es usarlo. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const RULE_ACTIONS_PATH = 'src/modules/budgets/rule-actions.ts';
const CONSUMER_PATHS = [
  'src/app/(sellup)/settings/budget-credits/rules/budget-rules-client.tsx',
  'src/app/(sellup)/settings/providers/provider-detail-sidepanel.tsx',
];

describe('rule-actions: deleteBudgetRule borra de verdad', () => {
  const src = stripComments(readSource(RULE_ACTIONS_PATH));

  it('exporta deleteBudgetRule', () => {
    assert.match(src, /export async function deleteBudgetRule\(/);
  });

  it('ya no exporta archiveBudgetRule (el soft-delete quedó eliminado)', () => {
    assert.doesNotMatch(src, /export async function archiveBudgetRule\(/);
  });

  it('usa DELETE sobre budget_rules, no UPDATE is_active=false', () => {
    const body = src.slice(src.indexOf('export async function deleteBudgetRule('));
    const end = body.indexOf('\n}\n');
    const fn = end === -1 ? body : body.slice(0, end);

    assert.match(fn, /\.delete\(\)/, 'deleteBudgetRule debe llamar .delete()');
    assert.doesNotMatch(
      fn,
      /is_active:\s*false/,
      'deleteBudgetRule no debe volver al soft-delete is_active=false',
    );
  });

  it('sigue exigiendo admin antes de borrar', () => {
    const body = src.slice(src.indexOf('export async function deleteBudgetRule('));
    const fn = body.slice(0, body.indexOf('\n}\n'));
    assert.match(fn, /isCurrentUserAdmin\(\)/);
    assert.match(fn, /No autorizado/);
  });

  it('toggleBudgetRuleStatus sigue existiendo como vía para desactivar sin borrar', () => {
    assert.match(src, /export async function toggleBudgetRuleStatus\(/);
    assert.match(src, /is_active:\s*isActive/);
  });
});

describe('consumidores de UI: no ignoran el error de borrado', () => {
  for (const path of CONSUMER_PATHS) {
    const src = stripComments(readSource(path));

    it(`${path} importa deleteBudgetRule y no archiveBudgetRule`, () => {
      assert.match(src, /deleteBudgetRule/);
      assert.doesNotMatch(src, /archiveBudgetRule/);
    });

    it(`${path} captura el resultado de deleteBudgetRule (no lo descarta)`, () => {
      // `await deleteBudgetRule(...)` a secas descarta el ActionResult: la UI
      // recargaría como si hubiera borrado incluso cuando la acción falló.
      const calls = src.match(/^[^\n]*deleteBudgetRule\([^)]*\)/gm) ?? [];
      const invocations = calls.filter((line) => !line.includes('import'));

      assert.ok(invocations.length > 0, 'debe invocar deleteBudgetRule');

      for (const line of invocations) {
        assert.match(
          line,
          /=\s*await\s+deleteBudgetRule\(/,
          `resultado descartado en: ${line.trim()}`,
        );
      }
    });

    it(`${path} ramifica sobre !result.success antes de continuar`, () => {
      assert.match(src, /if\s*\(!result\.success\)/);
    });
  }
});
