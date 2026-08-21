/**
 * AGENTE 2A — P0-R4: el contrato de exportación de los módulos `'use server'`
 *
 * ── QUÉ PROTEGE ────────────────────────────────────────────────
 *
 * Next.js envuelve TODA exportación de un módulo con la directiva `'use server'`
 * como Server Action, y valida en tiempo de EJECUCIÓN que cada una sea una
 * función:
 *
 *     A "use server" file can only export async functions, found object.
 *
 * (`ensureServerEntryExports`, en `next-flight-loader/action-validate`.)
 *
 * Esa validación corre cuando el módulo se evalúa en el servidor —es decir, al
 * invocar cualquier acción de la página— y NO en `next build`, ni en `tsc`, ni en
 * `eslint`. Un `export const` de un array o de un objeto compila, tipa, lintea,
 * construye y despliega sin una sola advertencia, y después tumba con 500 TODAS
 * las acciones de la página que lo arrastra, no sólo la exportación culpable: el
 * módulo entero deja de evaluarse.
 *
 * Por eso este fichero existe. La clase de fallo ya ocurrió dos veces —
 * `REVIEWABLE_CONTACT_CANDIDATE_STATUSES` (4O-H3-B R1) y
 * `CANDIDATE_STORED_PHONES_AUTHORIZED_ROLE_KEYS` (4O-G, el 500 de Producción del
 * 2026-08-13)— y ninguna de las dos veces la atrapó una comprobación automática.
 * Un test por símbolo habría dejado pasar el segundo; este barre TODOS los
 * módulos `'use server'` del repositorio, hoy y los que se escriban mañana.
 *
 * ── EL CRITERIO ────────────────────────────────────────────────
 *
 * Sólo pueden escapar de un módulo `'use server'`:
 *
 *   · funciones `async` (declaración, arrow o expresión), y
 *   · exportaciones de TIPO, que no existen en tiempo de ejecución.
 *
 * Todo lo demás —constantes, arrays, objetos, esquemas, clases, enums, funciones
 * SÍNCRONAS— pertenece a un módulo vecino SIN la directiva, del que tanto la
 * acción como el resto del código pueden importarlo. Mover el símbolo no cambia
 * ninguna semántica: cambia dónde vive.
 *
 * Una función síncrona no revienta la validación de Next (su `typeof` sí es
 * `'function'`), pero es igual de inválida: se publicaría como Server Action
 * devolviendo algo que no es una promesa. Se prohíbe aquí porque el próximo
 * refactor que la convierta en objeto sí sería el 500, y para entonces nadie
 * recordará por qué estaba ahí.
 *
 * ── CÓMO SE ANALIZA ────────────────────────────────────────────
 *
 * Con el compilador de TypeScript, no con expresiones regulares: el conjunto de
 * exportaciones de un módulo se decide en el AST. Las reexportaciones
 * (`export { x }`, `export { x } from './y'`) se RESUELVEN hasta la declaración
 * real; cuando la resolución no es posible (por ejemplo `export * from`), el test
 * FALLA. Es deliberado: lo que no se puede demostrar seguro se trata como
 * inseguro, porque el precio de equivocarse es un 500 en Producción.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const here = dirname(fileURLToPath(import.meta.url));
// __tests__ → src → raíz del repo
const repoRoot = join(here, '..', '..');
const srcRoot = join(repoRoot, 'src');

const SOURCE_EXTENSIONS = ['.ts', '.tsx'] as const;

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

/**
 * ¿El módulo lleva la directiva `'use server'` a NIVEL DE FICHERO?
 *
 * Sólo cuenta el prólogo de directivas (las sentencias de cadena literal que
 * abren el módulo). Un `'use server'` dentro de una función marca esa función,
 * no el módulo, y no impone este contrato al resto de exportaciones.
 */
function hasFileLevelUseServer(sourceFile: ts.SourceFile): boolean {
  for (const statement of sourceFile.statements) {
    if (
      !ts.isExpressionStatement(statement) ||
      !ts.isStringLiteralLike(statement.expression)
    ) {
      return false; // se acabó el prólogo
    }
    if (statement.expression.text === 'use server') return true;
  }
  return false;
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node)
    ? (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === kind)
    : false;
}

const isExported = (node: ts.Node) => hasModifier(node, ts.SyntaxKind.ExportKeyword);
const isAsync = (node: ts.Node) => hasModifier(node, ts.SyntaxKind.AsyncKeyword);

type Violation = { readonly file: string; readonly symbol: string; readonly kind: string };

function describeInitializer(node: ts.Node | undefined): string {
  if (!node) return 'sin inicializador';
  if (ts.isArrayLiteralExpression(node)) return 'array';
  if (ts.isObjectLiteralExpression(node)) return 'object';
  if (ts.isStringLiteralLike(node)) return 'string';
  if (ts.isNumericLiteral(node)) return 'number';
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return 'función síncrona';
  if (ts.isCallExpression(node) || ts.isNewExpression(node)) return 'valor de una llamada';
  if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) {
    return describeInitializer(node.expression);
  }
  return 'valor no-función';
}

/** Resuelve un especificador relativo a un fichero del repositorio, o `null`. */
function resolveModule(fromFile: string, specifier: string): string | null {
  const base = specifier.startsWith('.')
    ? resolve(dirname(fromFile), specifier)
    : specifier.startsWith('@/')
      ? join(srcRoot, specifier.slice(2))
      : null;
  if (!base) return null;

  for (const candidate of [
    ...SOURCE_EXTENSIONS.map((extension) => `${base}${extension}`),
    ...SOURCE_EXTENSIONS.map((extension) => join(base, `index${extension}`)),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * ¿La declaración de `name` dentro de `sourceFile` es una función `async`?
 *
 * Devuelve `null` cuando el símbolo no se puede resolver con certeza: quien
 * llama lo trata como violación.
 */
function isAsyncFunctionDeclaration(
  sourceFile: ts.SourceFile,
  name: string,
  seen: ReadonlySet<string> = new Set(),
): boolean | null {
  if (seen.has(`${sourceFile.fileName}#${name}`)) return null; // ciclo
  const nextSeen = new Set([...seen, `${sourceFile.fileName}#${name}`]);

  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) {
      return isAsync(statement);
    }

    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || declaration.name.text !== name) continue;
        const initializer = declaration.initializer;
        if (
          initializer &&
          (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
        ) {
          return isAsync(initializer);
        }
        return false;
      }
    }

    // `import { name } from './otro'` → seguir hasta la declaración real.
    if (
      ts.isImportDeclaration(statement) &&
      statement.importClause &&
      !statement.importClause.isTypeOnly &&
      statement.importClause.namedBindings &&
      ts.isNamedImports(statement.importClause.namedBindings) &&
      ts.isStringLiteralLike(statement.moduleSpecifier)
    ) {
      for (const element of statement.importClause.namedBindings.elements) {
        if (element.isTypeOnly || element.name.text !== name) continue;
        const target = resolveModule(sourceFile.fileName, statement.moduleSpecifier.text);
        if (!target) return null;
        const original = (element.propertyName ?? element.name).text;
        return isAsyncFunctionDeclaration(parse(target), original, nextSeen);
      }
    }
  }

  return null;
}

/** Todo lo que escapa del módulo y NO es una función `async`. */
function collectViolations(sourceFile: ts.SourceFile, relativePath: string): Violation[] {
  const violations: Violation[] = [];
  const flag = (symbol: string, kind: string) =>
    violations.push({ file: relativePath, symbol, kind });

  for (const statement of sourceFile.statements) {
    // `export type` / `export interface`: se borran al compilar.
    if (ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) continue;

    if (ts.isFunctionDeclaration(statement) && isExported(statement)) {
      if (!isAsync(statement)) {
        flag(statement.name?.text ?? '(default)', 'función síncrona');
      }
      continue;
    }

    if (ts.isVariableStatement(statement) && isExported(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const name = ts.isIdentifier(declaration.name)
          ? declaration.name.text
          : declaration.name.getText(sourceFile);
        const initializer = declaration.initializer;
        if (
          initializer &&
          (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) &&
          isAsync(initializer)
        ) {
          continue;
        }
        flag(name, describeInitializer(initializer));
      }
      continue;
    }

    if (
      (ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) &&
      isExported(statement)
    ) {
      flag(statement.name?.text ?? '(default)', ts.isEnumDeclaration(statement) ? 'enum' : 'clase');
      continue;
    }

    if (ts.isExportAssignment(statement)) {
      const expression = statement.expression;
      const ok =
        (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) &&
        isAsync(expression);
      if (!ok) flag('default', describeInitializer(expression));
      continue;
    }

    if (ts.isExportDeclaration(statement)) {
      if (statement.isTypeOnly) continue;

      const from =
        statement.moduleSpecifier && ts.isStringLiteralLike(statement.moduleSpecifier)
          ? statement.moduleSpecifier.text
          : null;

      // `export * from './x'`: el conjunto exportado no es decidible aquí.
      if (!statement.exportClause) {
        flag(`* from '${from ?? '?'}'`, 'reexportación total (no verificable)');
        continue;
      }
      if (ts.isNamespaceExport(statement.exportClause)) {
        flag(statement.exportClause.name.text, 'reexportación de namespace');
        continue;
      }

      for (const element of statement.exportClause.elements) {
        if (element.isTypeOnly) continue;
        const local = (element.propertyName ?? element.name).text;

        const target = from ? resolveModule(sourceFile.fileName, from) : sourceFile.fileName;
        if (!target) {
          flag(element.name.text, `reexportación desde '${from}' (no resoluble)`);
          continue;
        }
        const resolved = isAsyncFunctionDeclaration(
          target === sourceFile.fileName ? sourceFile : parse(target),
          local,
        );
        if (resolved === true) continue;
        flag(
          element.name.text,
          resolved === false ? 'reexportación de valor no-async' : 'reexportación no resoluble',
        );
      }
    }
  }

  return violations;
}

// ═══════════════════════════════════════════════════════════════
// El barrido
// ═══════════════════════════════════════════════════════════════

const useServerModules = sourceFiles(srcRoot)
  .filter((absolute) => hasFileLevelUseServer(parse(absolute)))
  .map((absolute) => relative(repoRoot, absolute))
  .sort();

describe("P0-R4 — un módulo 'use server' sólo exporta funciones async", () => {
  it('el barrido encuentra los módulos que hay que vigilar', () => {
    // Si esto llega a cero, el filtro se rompió y el resto del fichero pasaría
    // vacío: un test verde que no comprueba nada es peor que uno rojo.
    assert.ok(
      useServerModules.length >= 40,
      `sólo se detectaron ${useServerModules.length} módulos 'use server'`,
    );
    assert.ok(
      useServerModules.includes('src/modules/contacts/actions.ts'),
      'el módulo de acciones de contactos debe estar en el barrido',
    );
    assert.ok(
      useServerModules.includes(
        'src/modules/contact-enrichment/candidate-stored-phones-actions.ts',
      ),
      'el módulo que tumbó Producción debe estar en el barrido',
    );
  });

  it('ninguna exportación es un valor de ejecución distinto de una función async', () => {
    const violations = useServerModules.flatMap((relativePath) =>
      collectViolations(parse(join(repoRoot, relativePath)), relativePath),
    );

    assert.deepEqual(
      violations,
      [],
      `Exportaciones inválidas en módulos 'use server' — Next lanza en tiempo de ejecución ` +
        `«A "use server" file can only export async functions» y deja la página entera en 500:\n` +
        violations
          .map((v) => `  · ${v.file} → ${v.symbol} (${v.kind})`)
          .join('\n') +
        `\nMueve el símbolo a un módulo vecino SIN la directiva e impórtalo desde la acción.`,
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// La misma comprobación que corre Producción, sobre los tres flujos que cayeron
// ═══════════════════════════════════════════════════════════════

/**
 * Lo de arriba lee el código; esto EJECUTA el validador real de Next
 * (`ensureServerEntryExports`, el que lanzó los cuatro 500 del 2026-08-13
 * 14:46 UTC) sobre los módulos de acciones ya evaluados. No es redundante: el
 * barrido estático demuestra que la forma es correcta, y esto demuestra que la
 * pieza concreta de Next que juzga esa forma la acepta.
 *
 * Los tres módulos son las tres entradas que la QA de la dueña encontró rotas:
 * el detalle del contacto aprobado, el detalle del candidato pendiente y la
 * resolución de empresa.
 */
const AFFECTED_ENTRY_POINTS = [
  {
    flow: 'A · detalle del contacto aprobado',
    specifier: '@/modules/contacts/actions',
    entryPoint: 'getContactById',
  },
  {
    flow: 'B · detalle del candidato pendiente',
    specifier: '@/modules/contact-enrichment/candidate-stored-phones-actions',
    entryPoint: 'getCandidateStoredPhoneSummaryAction',
  },
  {
    flow: 'C · resolución de empresa',
    specifier: '@/modules/contact-enrichment/actions',
    entryPoint: 'resolveContactEnrichmentCompanyAction',
  },
] as const;

describe('P0-R4 — los módulos que Producción devolvía en 500 evalúan y pasan el validador de Next', () => {
  for (const { flow, specifier, entryPoint } of AFFECTED_ENTRY_POINTS) {
    it(`${flow}: el módulo se evalúa y Next acepta todas sus exportaciones`, async () => {
      const { ensureServerEntryExports } = await import(
        'next/dist/build/webpack/loaders/next-flight-loader/action-validate.js'
      );

      const moduleNamespace: Record<string, unknown> = await import(specifier);

      // Exactamente lo que Next inyecta al final de un módulo `'use server'`.
      ensureServerEntryExports(Object.values(moduleNamespace));

      assert.equal(
        typeof moduleNamespace[entryPoint],
        'function',
        `${specifier} debe seguir exportando ${entryPoint}`,
      );
    });
  }
});
