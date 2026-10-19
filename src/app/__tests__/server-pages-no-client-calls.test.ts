/**
 * Guarda (Prod 19-10): una página del servidor no puede LLAMAR a una función exportada
 * por un archivo 'use client'. Next la convierte en una referencia de cliente y la
 * página entera cae con «Attempted to call toFirstCallContactOptions() from the server»
 * — así cayó la ficha de cualquier empresa desde #739. Los componentes sí se pueden
 * usar (se renderizan, no se llaman); las funciones puras van en un módulo sin la marca.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const APP_DIR = path.join(ROOT, 'src', 'app');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === '__tests__' ? [] : walk(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

function isClientModule(source: string): boolean {
  return /^\s*(?:\/\/[^\n]*\n\s*|\/\*[\s\S]*?\*\/\s*)*['"]use client['"]/.test(source);
}

function resolveImport(spec: string, from: string): string | null {
  const base = spec.startsWith('@/')
    ? path.join(ROOT, 'src', spec.slice(2))
    : spec.startsWith('.')
      ? path.resolve(path.dirname(from), spec)
      : null;
  if (!base) return null;
  return [`${base}.tsx`, `${base}.ts`, path.join(base, 'index.tsx'), path.join(base, 'index.ts')].find((c) => existsSync(c)) ?? null;
}

/** Funciones de un módulo 'use client' que el archivo del servidor llama como `nombre(`. */
export function clientFunctionCalls(source: string, file: string, readModule: (p: string) => string): string[] {
  const found: string[] = [];
  const importRe = /import\s+(type\s+)?\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(importRe)) {
    if (match[1]) continue;
    const target = resolveImport(match[3], file);
    if (!target || !isClientModule(readModule(target))) continue;
    for (const raw of match[2].split(',')) {
      const name = raw.trim();
      if (!name || name.startsWith('type ')) continue;
      const local = name.split(/\s+as\s+/).pop()!.trim();
      // Componentes (Mayúscula) se renderizan; una función en minúscula llamada es el defecto.
      if (/^[a-z]/.test(local) && new RegExp(`\\b${local}\\s*\\(`).test(source)) found.push(`${local} ← ${match[3]}`);
    }
  }
  return found;
}

describe('páginas del servidor sin llamadas a funciones de cliente', () => {
  const read = (p: string) => readFileSync(p, 'utf8');

  it('ninguna página, layout o ruta de src/app llama a una función de un archivo «use client»', () => {
    const offenders = walk(APP_DIR)
      .filter((file) => !isClientModule(read(file)))
      .flatMap((file) => clientFunctionCalls(read(file), file, read).map((hit) => `${path.relative(ROOT, file)}: ${hit}`));
    assert.deepEqual(offenders, []);
  });

  it('atrapa el caso de Prod (la ficha de empresa importando desde first-call-tab)', () => {
    const page = path.join(APP_DIR, '(sellup)', 'accounts', '[accountId]', 'page.tsx');
    const broken = [
      "import { FirstCallTab, hasFreshBrief, toFirstCallContactOptions } from '@/components/first-call/first-call-tab';",
      'const contacts = toFirstCallContactOptions(rows);',
      'const fresh = hasFreshBrief(state);',
    ].join('\n');
    assert.deepEqual(clientFunctionCalls(broken, page, read), [
      'hasFreshBrief ← @/components/first-call/first-call-tab',
      'toFirstCallContactOptions ← @/components/first-call/first-call-tab',
    ]);
  });
});
