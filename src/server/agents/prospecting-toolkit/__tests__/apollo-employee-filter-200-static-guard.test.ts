/**
 * A1-APOLLO-EMPLOYEE-FILTER-200-1 § 6 — VALLA ESTÁTICA del cableado.
 *
 * Por qué hace falta una valla y no bastan los tests funcionales:
 *
 *   El defecto no fue una traducción equivocada, fue una OMISIÓN. Cada tramo de
 *   la cadena construía su objeto por literal y el campo simplemente no estaba;
 *   TypeScript no protesta porque `targetEmployeeThreshold` es opcional en todos
 *   los tipos (y debe seguir siéndolo: Tavily y mock no lo tienen ni lo quieren).
 *
 *   Un test funcional prueba los constructores que hoy conoce. Esta valla cubre
 *   el caso que de verdad hizo daño: alguien añade MAÑANA un cuarto punto de
 *   construcción de `WebSearchInput` para Apollo y lo deja sin el umbral. Con
 *   sólo tests funcionales, esa omisión vuelve a salir en verde.
 *
 * 🔴 Todo se busca con los COMENTARIOS FUERA. Una valla que lea el cuerpo crudo
 * confunde «nombrar el campo en la prosa» con «usarlo», y ese falso positivo ya
 * ocurrió en este repo.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../../../..');

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

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

const WIZARD_EXECUTOR =
  'src/modules/prospect-batches/chat-wizard-execution/wizard-apollo-executor.ts';
const TWO_ROUND_RUNNER =
  'src/server/agents/prospecting-toolkit/apollo-two-round/production-runner.server.ts';
const WEB_SEARCH_TOOL = 'src/server/agents/prospecting-toolkit/web-search-tool.ts';
const QUERY_MAPPING = 'src/server/agents/prospecting-toolkit/apollo-organizations-query-mapping.ts';

/**
 * Todo archivo de PRODUCCIÓN que construya un `WebSearchInput` por literal.
 *
 * Si aparece un cuarto, este array se queda corto a propósito: el caso
 * «inventario incompleto» está cubierto por el test de barrido de abajo, que no
 * lee esta lista sino el árbol.
 */
const WEB_SEARCH_INPUT_CONSTRUCTORS = [WEB_SEARCH_TOOL, TWO_ROUND_RUNNER];

// ── § 6.1 — todo constructor de WebSearchInput menciona el umbral ────────────

test('§ 6.1 — cada constructor literal de WebSearchInput propaga targetEmployeeThreshold', () => {
  for (const rel of WEB_SEARCH_INPUT_CONSTRUCTORS) {
    const code = stripTsComments(read(rel));
    assert.ok(
      code.includes(': WebSearchInput = {'),
      `${rel} debería seguir construyendo un WebSearchInput por literal`,
    );
    assert.ok(
      code.includes('targetEmployeeThreshold'),
      `${rel} construye un WebSearchInput y NO propaga targetEmployeeThreshold`,
    );
  }
});

// ── § 6.2 — barrido del árbol: ningún constructor nuevo se escapa ────────────

test('§ 6.2 — barrido: ningún constructor de WebSearchInput en producción omite el umbral', async () => {
  const { readdirSync, statSync } = await import('node:fs');

  function walk(dir: string, acc: string[] = []): string[] {
    for (const entry of readdirSync(path.join(ROOT, dir))) {
      const rel = `${dir}/${entry}`;
      const full = path.join(ROOT, rel);
      if (statSync(full).isDirectory()) {
        // Los tests construyen inputs a propósito sin umbral para probar la
        // ausencia; la valla habla de PRODUCCIÓN.
        if (entry === '__tests__' || entry === 'node_modules') continue;
        walk(rel, acc);
      } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
        acc.push(rel);
      }
    }
    return acc;
  }

  const offenders: string[] = [];
  for (const rel of walk('src')) {
    const code = stripTsComments(read(rel));
    if (!code.includes(': WebSearchInput = {')) continue;
    // `{ ...input, query }` reenvía el objeto entero: propaga por spread y no
    // necesita nombrar el campo. Se reconoce por la forma, no por el archivo.
    const spreadsWholeInput = /:\s*WebSearchInput\s*=\s*\{\s*\.\.\.input/.test(code);
    if (spreadsWholeInput && !/:\s*WebSearchInput\s*=\s*\{\s*(?!\.\.\.input)/.test(code)) {
      continue;
    }
    if (!code.includes('targetEmployeeThreshold')) offenders.push(rel);
  }

  assert.deepEqual(
    offenders,
    [],
    `estos archivos construyen un WebSearchInput sin propagar targetEmployeeThreshold: ${offenders.join(', ')}`,
  );
});

// ── § 6.3 — el wizard lee la fuente VIVA, no una constante nueva ─────────────

test('§ 6.3 — el ejecutor del wizard lee systemControls.minimumEmployees en AMBAS rutas', () => {
  const code = stripTsComments(read(WIZARD_EXECUTOR));
  const matches = code.match(
    /targetEmployeeThreshold:\s*input\.resolved\.systemControls\.minimumEmployees/g,
  );

  assert.ok(matches, 'el ejecutor debe leer el umbral de systemControls');
  assert.equal(
    matches!.length,
    2,
    'las DOS rutas (two-round y legacy) deben propagar el umbral; encontradas: ' +
      String(matches!.length),
  );
});

test('§ 6.3b — el ejecutor NO hardcodea un 200 propio', () => {
  const code = stripTsComments(read(WIZARD_EXECUTOR));
  assert.ok(
    !/targetEmployeeThreshold:\s*\d+/.test(code),
    'un 200 literal aquí sería un segundo umbral capaz de divergir del del producto',
  );
});

// ── § 6.4 — un solo traductor en toda la cadena ──────────────────────────────

test('§ 6.4 — mapEmployeeThresholdToApolloRanges se DEFINE una sola vez', () => {
  const code = stripTsComments(read(QUERY_MAPPING));
  assert.ok(
    code.includes('export function mapEmployeeThresholdToApolloRanges'),
    'el traductor vive en el mapper',
  );

  // Nadie más puede definir su propia versión: dos traductores es cómo la
  // metadata acaba diciendo una cosa y el body otra.
  const definition = /(export\s+)?function\s+mapEmployeeThresholdToApolloRanges/;
  const consumersWithOwnCopy = [TWO_ROUND_RUNNER, WEB_SEARCH_TOOL, WIZARD_EXECUTOR].filter(
    (rel) => definition.test(stripTsComments(read(rel))),
  );
  assert.deepEqual(consumersWithOwnCopy, [], 'ningún consumidor redefine el traductor');
});

test('§ 6.5 — el queryContext de dos rondas deriva employeeRanges del traductor único', () => {
  const code = stripTsComments(read(TWO_ROUND_RUNNER));

  assert.ok(
    code.includes('employeeRanges: mapEmployeeThresholdToApolloRanges('),
    'el queryContext debe derivar los rangos del mapper, no reconstruirlos',
  );
  assert.ok(
    !/employeeRanges:\s*\[\s*\]/.test(code),
    'el queryContext no puede quedar fijado a [] mientras el body lleva rangos',
  );
});

// ── § 6.6 — el borde de 200 es >= y el techo no es abierto ───────────────────

test('§ 6.6 — el primer bucket incluye 200 y ningún bucket tiene extremo abierto', () => {
  const code = stripTsComments(read(QUERY_MAPPING));
  const block = code.slice(
    code.indexOf('APOLLO_EMPLOYEE_RANGES'),
    code.indexOf('APOLLO_EMPLOYEE_RANGES') + 400,
  );

  assert.ok(block.includes("'200,500'"), 'el primer bucket debe ser 200,500 (>= 200)');
  assert.ok(!block.includes("'201,500'"), 'el requisito es >= 200, no > 200');
  // Apollo no documenta extremo abierto; un `"50000,"` sería una invención.
  assert.ok(!/'\d+,'/.test(block), 'ningún bucket puede tener extremo abierto');
});
