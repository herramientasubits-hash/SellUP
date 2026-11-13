// Regresión: las reglas con alcance de persona mostraban «Usuario (desconocido)»
// porque la lectura de personas filtraba por access_status = 'approved',
// estado que no existe (válidos: pending_approval, active, rejected,
// suspended, archived).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  buildBudgetRuleUserMap,
  resolveBudgetRuleScopeLabel,
} from '../rule-queries';

const SRC = readFileSync(path.join(process.cwd(), 'src/modules/budgets/rule-queries.ts'), 'utf8');

test('rule-queries no filtra personas por el estado inexistente «approved»', () => {
  assert.doesNotMatch(SRC, /access_status['"]\s*,\s*['"]approved/);
});

test('una regla de persona suspendida o archivada resuelve su nombre', () => {
  const userMap = buildBudgetRuleUserMap([
    { id: 'u1', full_name: 'Ana Pérez', email: 'ana@x.co' },
    { id: 'u2', full_name: null, email: 'sin-nombre@x.co' },
  ]);
  const maps = { roleMap: new Map(), groupMap: new Map(), userMap };
  assert.equal(resolveBudgetRuleScopeLabel('user', 'u1', maps), 'Ana Pérez · ana@x.co');
  assert.equal(resolveBudgetRuleScopeLabel('user', 'u2', maps), 'sin-nombre@x.co');
  assert.equal(resolveBudgetRuleScopeLabel('user', 'u3', maps), 'Usuario (desconocido)');
});

test('buildBudgetRuleUserMap tolera datos vacíos', () => {
  assert.equal(buildBudgetRuleUserMap(null).size, 0);
});
