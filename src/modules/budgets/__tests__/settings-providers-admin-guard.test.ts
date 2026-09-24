/**
 * SETTINGS-PROVIDERS-ADMIN-GUARD-1 — ninguna server action de Configuración lee
 * o escribe con el cliente de servicio sin comprobar antes que quien llama es
 * administrador.
 *
 * Una server action es un endpoint: cualquier sesión que conozca su id puede
 * invocarla sin pasar por la página (que sí redirige a quien no es admin). Lo
 * que estas pruebas fijan:
 *
 *   § 1 · en cada fichero `'use server'` de Configuración y presupuestos, TODA
 *         función exportada llama a `isCurrentUserAdmin()` ANTES de su primer
 *         acceso a datos o a otra acción;
 *   § 2 · `budget-resolution.ts` ya no es un módulo de acciones, y sus funciones
 *         no salen por el índice que importan los componentes cliente.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(path.join(ROOT, dir))) {
    const rel = path.join(dir, name);
    if (name === '__tests__' || name === 'node_modules') continue;
    if (statSync(path.join(ROOT, rel)).isDirectory()) out.push(...listFiles(rel));
    else if (/\.(ts|tsx)$/.test(name)) out.push(rel);
  }
  return out;
}

const USE_SERVER = /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*['"]use server['"]/;
const SERVER_ACTION_FILES = [
  ...listFiles('src/modules/budgets'),
  ...listFiles('src/app/(sellup)/settings'),
].filter((f) => USE_SERVER.test(read(f)));

/** Cuerpo de cada `export async function` (hasta la siguiente función exportada). */
function exportedFunctions(source: string): { name: string; body: string }[] {
  const re = /export async function (\w+)\s*\(/g;
  const starts = [...source.matchAll(re)].map((m) => ({ name: m[1]!, index: m.index! }));
  return starts.map((s, i) => ({
    name: s.name,
    body: source.slice(s.index, starts[i + 1]?.index ?? source.length),
  }));
}

describe('§ 1 — admin antes de tocar datos', () => {
  it('hay ficheros de acciones que auditar (la guarda no está vacía)', () => {
    assert.ok(SERVER_ACTION_FILES.length >= 5, SERVER_ACTION_FILES.join(', '));
  });

  for (const file of SERVER_ACTION_FILES) {
    it(`🔴 ${file}: cada acción exportada exige admin primero`, () => {
      for (const fn of exportedFunctions(read(file))) {
        const guard = fn.body.search(/isCurrentUserAdmin\(\)/);
        assert.ok(guard > 0, `${fn.name} no comprueba admin`);
        // Primer acceso a datos u otra acción: cualquier `await` que no sea la
        // propia comprobación.
        const firstAwait = [...fn.body.matchAll(/await\s+(?!isCurrentUserAdmin\()/g)][0]?.index;
        assert.ok(
          firstAwait === undefined || guard < firstAwait,
          `${fn.name} hace un await antes de comprobar admin`,
        );
      }
    });
  }
});

describe('§ 2 — budget-resolution no es un endpoint', () => {
  it('🔴 budget-resolution.ts ya no es `use server`', () => {
    assert.equal(USE_SERVER.test(read('src/modules/budgets/budget-resolution.ts')), false);
  });

  it('el índice de budgets no reexporta sus funciones (lo importan componentes cliente)', () => {
    const index = read('src/modules/budgets/index.ts');
    assert.doesNotMatch(
      index,
      /export\s*\{[^}]*\b(checkBudget|getAdminBudgetSummary|checkProviderQuotaAvailable)\b[^}]*\}\s*from\s*'\.\/budget-resolution'/,
    );
  });

  it('ningún componente cliente importa esas funciones', () => {
    const clientFiles = listFiles('src').filter((f) => /^\s*['"]use client['"]/.test(read(f)));
    for (const f of clientFiles) {
      assert.doesNotMatch(
        read(f),
        /\b(checkBudget|getAdminBudgetSummary|checkProviderQuotaAvailable)\b[\s\S]{0,200}from\s*'@\/modules\/budgets/,
        f,
      );
    }
  });
});
