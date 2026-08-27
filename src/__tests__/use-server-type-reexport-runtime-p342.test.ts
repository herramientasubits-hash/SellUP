/**
 * AGENTE 2A — P342: la reexportación de TIPO dentro de un módulo `'use server'`
 *
 * ── QUÉ TUMBÓ PRODUCCIÓN ───────────────────────────────────────
 *
 * PR #342 movió `LegacyPhoneRevealWaterfallActionStatus` a un módulo puro y, por
 * comodidad, dejó en la acción `'use server'` una reexportación de TIPO de la
 * ligadura LOCAL:
 *
 *     import { …, type LegacyPhoneRevealWaterfallActionStatus } from './…-start-gate';
 *     export type { LegacyPhoneRevealWaterfallActionStatus };
 *
 * TypeScript borra esa línea, `tsc --noEmit` pasa, `eslint` pasa y `next build`
 * TERMINA CON ÉXITO. Pero el flight loader de Next construye la lista de
 * exportaciones del módulo a partir de los NOMBRES exportados, y metió el del tipo
 * en la llamada que inyecta al final de todo módulo `'use server'`:
 *
 *     (0,bw.ensureServerEntryExports)([cK, LegacyPhoneRevealWaterfallActionStatus])
 *
 * Las ligaduras reales salieron minificadas (`cK`); el nombre del tipo sobrevivió
 * literal porque no es ninguna ligadura. Esa llamada corre al EVALUAR el módulo,
 * ANTES que cualquier acción, así que se llevó por delante el chunk entero de
 * acciones de /contacts:
 *
 *     ReferenceError: LegacyPhoneRevealWaterfallActionStatus is not defined
 *
 * (ruta /contacts, deployment dpl_HU81h4qbBvFPr2iSM8mTqJPXDaBF). Los drawers de
 * candidato fallaban antes siquiera de cargar el candidato.
 *
 * ── POR QUÉ NO BASTABA EL RATCHET QUE YA EXISTÍA ───────────────
 *
 * `use-server-export-contract-p0-r4.test.ts` hace `continue` en cuanto una
 * `ExportDeclaration` es `isTypeOnly`, y bajo la semántica de TypeScript eso es
 * CORRECTO: una exportación de tipo no existe en ejecución. La clase nueva es que
 * Next NO respeta esa distinción al listar las exportaciones. Por eso este fichero
 * se suma al anterior en vez de sustituirlo: son dos reglas distintas.
 *
 * ── LAS DOS CAPAS ──────────────────────────────────────────────
 *
 * A · AST, todo el repositorio, sin build: prohíbe la forma que rompe.
 * B · ARTEFACTOS REALES de `next build`: evalúa los grafos de acciones de página
 *     ya construidos. Es la única capa que reproduce el fallo tal cual — un grep
 *     no lo habría visto, porque el símbolo culpable es indistinguible de una
 *     mención en un comentario hasta que el bundle se ejecuta.
 *
 * La forma CON especificador (`export type { X } from './y'`) sí se borra entera:
 * se comprobó en el bundle real de este mismo incidente y NO aparece ni una vez.
 * Por eso se permite y no se toca — `accounts/actions.ts` y `contacts/actions.ts`
 * la usan desde antes y son inocentes.
 *
 * ── AGENT2A-POST-APPROVAL-RESCUE-PARITY ────────────────────────
 *
 * El módulo del incidente (`phone-reveal-waterfall-legacy-actions.ts`) ganó una segunda vía
 * de entrada y pasó de un chunk de acciones de UNA página a un chunk COMPARTIDO entre dos.
 * `chunksContainingSource` busca ahora en TODO chunk `.js` de `ssr/`, no sólo en los nombrados
 * `_page_actions_*`, y `evaluateChunk` lee el factory como el ÚLTIMO elemento del array —la
 * posición que las dos formas de chunk comparten— en vez de asumir siempre el segundo. El resto
 * de Capa B sigue viendo exactamente los mismos chunks de página que veía antes.
 *
 * Determinista y offline: sólo lee ficheros y evalúa bundles con un contexto de
 * módulos falso. Sin red, sin Supabase, sin proveedores, 0 créditos, 0 escrituras
 * y 0 PII.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const srcRoot = join(repoRoot, 'src');

const SOURCE_EXTENSIONS = ['.ts', '.tsx'] as const;

/** El símbolo exacto que tumbó /contacts. Se nombra para que el fallo se lea solo. */
const P342_SYMBOL = 'LegacyPhoneRevealWaterfallActionStatus';
/** El módulo `'use server'` que lo reexportaba. */
const P342_ACTION_MODULE =
  'src/modules/contact-enrichment/phone-reveal-waterfall-legacy-actions.ts';
/** El módulo PURO donde el tipo se declara y del que debe importarse. */
const P342_PURE_MODULE =
  'src/modules/contact-enrichment/phone-reveal-waterfall-legacy-start-gate.ts';

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next') continue;
      sourceFiles(full, acc);
      continue;
    }
    if (SOURCE_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) acc.push(full);
  }
  return acc;
}

function parse(absolutePath: string): ts.SourceFile {
  return ts.createSourceFile(
    absolutePath,
    readFileSync(absolutePath, 'utf8'),
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    absolutePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

/** ¿Lleva el módulo la directiva `'use server'` a NIVEL DE FICHERO? */
function hasFileLevelUseServer(sourceFile: ts.SourceFile): boolean {
  for (const statement of sourceFile.statements) {
    if (
      !ts.isExpressionStatement(statement) ||
      !ts.isStringLiteralLike(statement.expression)
    ) {
      return false;
    }
    if (statement.expression.text === 'use server') return true;
  }
  return false;
}

type Violation = { readonly file: string; readonly symbol: string; readonly form: string };

/**
 * Reexportaciones de TIPO de una ligadura LOCAL — las que Next mete en
 * `ensureServerEntryExports` como identificador colgante.
 *
 * Sólo cuenta la ausencia de `moduleSpecifier`: con especificador el bundle no
 * conserva nada, y está demostrado sobre el artefacto real de este incidente.
 */
function collectLocalTypeReexports(
  sourceFile: ts.SourceFile,
  relativePath: string,
): Violation[] {
  const violations: Violation[] = [];

  for (const statement of sourceFile.statements) {
    if (!ts.isExportDeclaration(statement)) continue;
    if (statement.moduleSpecifier) continue; // `export … from './y'`: se borra entero
    if (!statement.exportClause || !ts.isNamedExports(statement.exportClause)) continue;

    for (const element of statement.exportClause.elements) {
      // `export type { X };` marca la declaración; `export { type X };` el elemento.
      if (!statement.isTypeOnly && !element.isTypeOnly) continue;
      violations.push({
        file: relativePath,
        symbol: element.name.text,
        form: statement.isTypeOnly ? 'export type { X }' : 'export { type X }',
      });
    }
  }

  return violations;
}

const useServerModules = sourceFiles(srcRoot)
  .filter((absolute) => hasFileLevelUseServer(parse(absolute)))
  .map((absolute) => relative(repoRoot, absolute))
  .sort();

// ═══════════════════════════════════════════════════════════════
// Capa A · el AST: la forma que rompe no vuelve a entrar
// ═══════════════════════════════════════════════════════════════

describe("P342 — capa A · un módulo 'use server' no reexporta tipos de ligaduras locales", () => {
  it('el barrido encuentra los módulos que hay que vigilar', () => {
    assert.ok(
      useServerModules.length >= 40,
      `sólo se detectaron ${useServerModules.length} módulos 'use server'`,
    );
    assert.ok(
      useServerModules.includes(P342_ACTION_MODULE),
      `${P342_ACTION_MODULE} —el módulo del incidente— debe estar en el barrido`,
    );
  });

  it('ningún módulo reexporta un tipo desde una ligadura local', () => {
    const violations = useServerModules.flatMap((relativePath) =>
      collectLocalTypeReexports(parse(join(repoRoot, relativePath)), relativePath),
    );

    assert.deepEqual(
      violations,
      [],
      `Reexportación de TIPO local en un módulo 'use server'. TypeScript la borra, pero el ` +
        `flight loader de Next mete el NOMBRE en ensureServerEntryExports([...]) y el módulo ` +
        `revienta al evaluarse con «X is not defined», tumbando TODAS las acciones de la ` +
        `página:\n` +
        violations.map((v) => `  · ${v.file} → ${v.symbol} (${v.form})`).join('\n') +
        `\nQuien necesite el tipo lo importa DIRECTAMENTE del módulo puro donde se declara. ` +
        `No lo conviertas en enum ni en const: eso crea un valor de ejecución y viola P0-R4.`,
    );
  });

  it(`el tipo del incidente se declara en el módulo puro y la acción sólo lo importa`, () => {
    const pure = readFileSync(join(repoRoot, P342_PURE_MODULE), 'utf8');
    assert.match(
      pure,
      new RegExp(`export type ${P342_SYMBOL}\\b`),
      `${P342_PURE_MODULE} debe seguir siendo quien DECLARA ${P342_SYMBOL}`,
    );

    const action = parse(join(repoRoot, P342_ACTION_MODULE));
    const reexported = collectLocalTypeReexports(action, P342_ACTION_MODULE).some(
      (v) => v.symbol === P342_SYMBOL,
    );
    assert.equal(
      reexported,
      false,
      `${P342_ACTION_MODULE} no puede reexportar ${P342_SYMBOL}: es exactamente la línea que ` +
        `tumbó /contacts en Producción.`,
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// Capa B · el bundle REAL: los grafos de acciones evalúan sin ReferenceError
// ═══════════════════════════════════════════════════════════════

/**
 * Un chunk de turbopack es `module.exports = [<id>, <factory>]`. La factory recibe
 * el contexto de módulos (`a.i(id)` resuelve una importación). Se ejecuta con un
 * contexto FALSO: lo que se está comprobando no es lo que hacen las dependencias,
 * sino que el cuerpo del módulo pueda EVALUARSE — que es justo lo que Producción no
 * pudo hacer.
 */
function makeStub(): unknown {
  const target = function () {};
  return new Proxy(target, {
    get(_t, key) {
      if (key === 'then') return undefined; // que no lo confundan con un thenable
      if (key === Symbol.toPrimitive) return () => '';
      if (key === 'toString' || key === 'valueOf') return () => '';
      if (key === Symbol.toStringTag) return 'Stub';
      return makeStub();
    },
    apply: () => makeStub(),
    construct: () => makeStub() as object,
    set: () => true,
    defineProperty: () => true,
  });
}

function evaluateChunk(absolutePath: string): void {
  const source = readFileSync(absolutePath, 'utf8');
  const shim: { exports: unknown } = { exports: {} };

  new Function('module', 'exports', 'require', source)(shim, shim.exports, () => makeStub());

  const chunk = shim.exports;
  // AGENT2A-POST-APPROVAL-RESCUE-PARITY — el factory es el ÚLTIMO elemento, no siempre el
  // segundo. Un chunk de acciones de UNA página es `[id, factory]`, pero Turbopack también
  // MERGE-a las acciones de varios módulos `'use server'` compartidos entre páginas en un solo
  // chunk `[id1, id2, …, idN, factory]` cuando ese módulo deja de ser exclusivo de una ruta. Las
  // dos formas comparten la propiedad que de verdad importa aquí —el factory está en la última
  // posición—, así que generalizar la lectura no relaja la comprobación: sigue siendo la MISMA
  // llamada, `factory(contexto)`, y sigue reventando exactamente igual si el símbolo colgante
  // vuelve a aparecer.
  const factory = Array.isArray(chunk) ? chunk[chunk.length - 1] : undefined;
  assert.ok(
    Array.isArray(chunk) && chunk.length >= 2 && typeof factory === 'function',
    `${absolutePath} no tiene la forma [id(s)…, factory] de un chunk de turbopack`,
  );

  (factory as (context: unknown) => void)(new Proxy({}, { get: () => makeStub() }));
}

const ssrChunkDir = join(repoRoot, '.next', 'server', 'chunks', 'ssr');
const buildIsPresent = existsSync(ssrChunkDir);

const pageActionChunks = buildIsPresent
  ? readdirSync(ssrChunkDir)
      .filter((name) => /_page_actions_.*\.js$/.test(name))
      .sort()
  : [];

// AGENT2A-POST-APPROVAL-RESCUE-PARITY — universo COMPLETO de chunks SSR, para
// `chunksContainingSource`. `pageActionChunks` sigue siendo el universo de las otras tres
// comprobaciones de Capa B («TODOS los grafos de acciones de página evalúan», el escaneo de
// `ensureServerEntryExports`): su alcance no cambia, y las dos siguen viendo exactamente los
// mismos ficheros que antes.
//
// ── OLD_ASSERTION ────────────────────────────────────────────
// «El módulo del incidente vive en el chunk de acciones de UNA página, así que buscarlo dentro
// de `pageActionChunks` basta.»
//
// ── WHY_OBSOLETE ─────────────────────────────────────────────
// `phone-reveal-waterfall-legacy-actions.ts` pasó a ser alcanzable desde DOS páginas
// (`/contacts` y `/accounts`, vía `ContactDetailSheet` compuesto en las dos) cuando
// AGENT2A-POST-APPROVAL-RESCUE-PARITY le añadió una segunda vía de entrada
// (`post-approval-reveal-actions.ts`, para la continuación a Lusha del contacto oficial).
// Turbopack respondió MOVIENDO el módulo a un chunk COMPARTIDO —ya no nombrado
// `_page_actions_*`— para no duplicarlo en cada página. `chunksContainingSource` dejó de
// encontrarlo, y con `carriers` vacío la comprobación de evaluación de más abajo pasaba EN
// VACÍO: exactamente el escenario que el comentario original de esta suite advertía.
//
// ── NEW_INVARIANT ────────────────────────────────────────────
// `chunksContainingSource` busca en TODO chunk `.js` de `ssr/` con sourcemap, sea cual sea su
// nombre. Sigue siendo una búsqueda TEXTUAL sobre la ruta fuente declarada —no adivina nada
// sobre la forma del chunk—, y `evaluateChunk` ya sabe leer las dos formas que Turbopack
// produce. El resto de Capa B no se toca: sigue verificando exactamente los mismos chunks de
// página que verificaba antes.
const allSsrChunkFiles = buildIsPresent
  ? readdirSync(ssrChunkDir)
      .filter((name) => name.endsWith('.js'))
      .sort()
  : [];

/** Chunks cuyo sourcemap declara un módulo fuente dado. Universo COMPLETO, no sólo páginas. */
function chunksContainingSource(needle: string): string[] {
  return allSsrChunkFiles.filter((name) => {
    const map = join(ssrChunkDir, `${name}.map`);
    if (!existsSync(map)) return false;
    try {
      const sources: unknown = JSON.parse(readFileSync(map, 'utf8')).sources;
      return (
        Array.isArray(sources) &&
        sources.some((s) => typeof s === 'string' && s.endsWith(needle))
      );
    } catch {
      return false;
    }
  });
}

describe('P342 — capa B · el bundle de `next build` evalúa sin ReferenceError', () => {
  it('hay artefactos de build que comprobar', () => {
    // Fail-closed a propósito: sin build esta capa no demuestra NADA, y un test verde
    // que no comprueba nada es peor que uno rojo. Correr `npm run build` antes.
    assert.ok(
      buildIsPresent,
      `no existe ${relative(repoRoot, ssrChunkDir)}. Esta suite comprueba el BUNDLE REAL: ` +
        `ejecuta \`npm run build\` antes (o usa \`npm run test:agent2a:p342-contacts-runtime\`).`,
    );
    assert.ok(
      pageActionChunks.length > 0,
      'no se encontró ningún grafo de acciones de página en el build',
    );
  });

  it('el grafo de acciones de /contacts incluye el módulo legacy del incidente', () => {
    // Sin esto la capa B podría pasar en vacío si el módulo dejara de entrar en el
    // grafo: estaríamos celebrando que no revienta algo que ya no se construye.
    const carriers = chunksContainingSource(
      'src/modules/contact-enrichment/phone-reveal-waterfall-legacy-actions.ts',
    );
    assert.ok(
      carriers.length > 0,
      `ningún grafo de acciones de página arrastra ${P342_ACTION_MODULE}; la comprobación ` +
        `de evaluación sería vacua`,
    );
  });

  it('el grafo de acciones de /contacts evalúa (el fallo real de Producción)', () => {
    const carriers = chunksContainingSource(
      'src/modules/contact-enrichment/phone-reveal-waterfall-legacy-actions.ts',
    );

    for (const name of carriers) {
      assert.doesNotThrow(
        () => evaluateChunk(join(ssrChunkDir, name)),
        `${name} no evalúa. Es el fallo de dpl_HU81h4qbBvFPr2iSM8mTqJPXDaBF: el módulo ` +
          `'use server' revienta ANTES de cualquier acción y /contacts se queda sin ninguna.`,
      );
    }
  });

  it('TODOS los grafos de acciones de página evalúan', () => {
    const broken: string[] = [];
    for (const name of pageActionChunks) {
      try {
        evaluateChunk(join(ssrChunkDir, name));
      } catch (error) {
        broken.push(`  · ${name} → ${(error as Error).message}`);
      }
    }
    assert.deepEqual(
      broken,
      [],
      `Grafos de acciones que no evalúan — cada uno deja su página sin server actions:\n${broken.join('\n')}`,
    );
  });

  it(`ningún ensureServerEntryExports arrastra el identificador ${P342_SYMBOL}`, () => {
    // Comprobación directa sobre el bundle: el síntoma exacto, por si algún día la
    // evaluación dejara de alcanzar la línea.
    const offenders = pageActionChunks.filter((name) => {
      const source = readFileSync(join(ssrChunkDir, name), 'utf8');
      return /ensureServerEntryExports\)?\(\[[^\]]*\b/.test(source)
        ? (source.match(/ensureServerEntryExports\)?\(\[[^\]]*\]/g) ?? []).some((call) =>
            call.includes(P342_SYMBOL),
          )
        : false;
    });

    assert.deepEqual(
      offenders,
      [],
      `${P342_SYMBOL} volvió a la lista de exportaciones de un módulo 'use server': ` +
        `${offenders.join(', ')}`,
    );
  });
});
