/**
 * AGENT1-CUT3B5 — trinquetes estáticos sobre la corrección de la 126.
 *
 * La prueba de COMPORTAMIENTO vive en
 * `cut3b5-m126-rls-search-path-postgres.test.ts`, contra PostgreSQL real. Este
 * archivo cubre lo que el comportamiento no puede: que el artefacto NO haya
 * crecido de tapadillo mientras se corregía.
 *
 * La 126 se fusionó ya revisada y se corrige ANTES de su primera aplicación. Ese
 * es exactamente el momento en el que resulta barato colar «una cosita más» que
 * nadie volvería a mirar. Cada aserción de aquí cierra una de esas puertas.
 *
 * 0 proveedores. 0 créditos. 0 red. Sólo se leen archivos del repositorio.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
// __tests__ → prospect-batches → server → src → repo root
const repoRoot = join(here, '..', '..', '..', '..');
const migrationsDir = join(repoRoot, 'supabase', 'migrations');

const M126 = '126_agent1_batch_identity_atomicity.sql';
const M124 = '124_cross_provider_phone_identity.sql';

const sql = readFileSync(join(migrationsDir, M126), 'utf8');

/**
 * El SQL EJECUTABLE: sin comentarios `--` y sin sentencias `COMMENT ON`.
 *
 * 🔴 Sin esto, un trinquete en negativo miente. La 126 es un documento con decenas
 * de líneas de prosa que NOMBRAN lo que la migración no hace («no se crea ningún
 * índice único», «la autoridad de TIER 0-5 vive en TypeScript»). Grepear el archivo
 * crudo confundiría NOMBRAR algo con HACERLO, y las aserciones de ausencia fallarían
 * por culpa de su propia documentación — que es exactamente lo que pasó la primera
 * vez que se ejecutó esta suite.
 *
 * Hay DOS superficies de prosa, no una:
 *
 *   1. los comentarios `--`, que se quitan por línea;
 *   2. las sentencias `COMMENT ON …`, cuya prosa vive dentro de literales de cadena
 *      y por tanto SOBREVIVE al primer paso. Un `COMMENT ON` es documentación que
 *      PostgreSQL almacena; no crea un índice, ni un disparador, ni política alguna.
 *
 * El segundo paso sólo se aplica FUERA de los bloques `$fn$…$fn$`: el cuerpo de las
 * funciones es código de verdad y tiene que seguir siendo medible (ahí viven el
 * `INSERT INTO public.prospect_candidates` y el `FOR UPDATE` que otros trinquetes
 * comprueban).
 */
const withoutLineComments = sql
  .split('\n')
  .map((line) => {
    const idx = line.indexOf('--');
    return idx === -1 ? line : line.slice(0, idx);
  })
  .join('\n');

const code = withoutLineComments
  .split('$fn$')
  // Índice par = fuera de un bloque con dolar-quoting; impar = cuerpo de función.
  .map((segment, i) => (i % 2 === 0 ? segment.replace(/COMMENT ON[\s\S]*?;/g, '') : segment))
  .join('$fn$');

const CORRECTED = 'SET search_path = pg_catalog, public, pg_temp';

describe('CUT-3B5 — trinquetes estáticos de la corrección de la 126', () => {
  // ═══════════════════════════════════════════════════════════════════════
  // § 1 — la corrección está, y es la correcta
  // ═══════════════════════════════════════════════════════════════════════

  describe('§ 1 — el `search_path`', () => {
    it('🔴 las DOS funciones declaran `pg_catalog, public, pg_temp`', () => {
      const occurrences = code.split(CORRECTED).length - 1;
      assert.equal(occurrences, 2, `se esperaban 2 declaraciones corregidas y hay ${occurrences}`);
    });

    it('🔴 no queda NINGUNA declaración con el camino que el preflight bloqueó', () => {
      assert.doesNotMatch(
        code,
        /SET\s+search_path\s*=\s*pg_catalog\s*,\s*pg_temp/,
        'sobrevive un `search_path` restringido: RLS volvería a fallar con 42P01',
      );
    });

    it('🔴 `pg_catalog` precede a `public` en todas las declaraciones', () => {
      const declarations = [...code.matchAll(/SET\s+search_path\s*=\s*([^\n]+)/g)].map((m) =>
        m[1].trim().split(',').map((s) => s.trim()),
      );
      assert.equal(declarations.length, 2, 'cambió el número de declaraciones de search_path');
      for (const path of declarations) {
        assert.equal(path[0], 'pg_catalog', `pg_catalog no va primero en: ${path.join(', ')}`);
        assert.ok(
          path.indexOf('pg_catalog') < path.indexOf('public'),
          `public precede a pg_catalog en: ${path.join(', ')}`,
        );
        assert.ok(path.includes('pg_temp'), `falta pg_temp en: ${path.join(', ')}`);
      }
    });

    it('ninguna función queda SIN `search_path` fijo', () => {
      const created = (code.match(/CREATE OR REPLACE FUNCTION/g) ?? []).length;
      const fixed = (code.match(/SET\s+search_path/g) ?? []).length;
      assert.equal(created, 2, 'cambió el número de funciones de la 126');
      assert.equal(fixed, created, 'una función quedó sin search_path fijo');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // § 2 — el privilegio NO se movió
  // ═══════════════════════════════════════════════════════════════════════

  describe('§ 2 — seguridad idéntica a la versión revisada', () => {
    it('🔴 las dos funciones siguen siendo SECURITY INVOKER', () => {
      const invoker = (code.match(/SECURITY INVOKER/g) ?? []).length;
      assert.equal(invoker, 2, 'alguna función dejó de ser SECURITY INVOKER');
    });

    it('🔴 NO aparece SECURITY DEFINER en ninguna parte', () => {
      assert.doesNotMatch(
        code,
        /SECURITY\s+DEFINER/i,
        'la corrección introdujo escalada de privilegio',
      );
    });

    it('PUBLIC y `anon` quedan REVOCADOS en las dos funciones', () => {
      for (const fn of ['read_batch_identity_snapshot', 'insert_fenced_prospect_candidates']) {
        assert.match(
          code,
          new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC`),
          `falta REVOKE de PUBLIC en ${fn}`,
        );
        assert.match(
          code,
          new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM anon`),
          `falta REVOKE de anon en ${fn}`,
        );
      }
    });

    it('🔴 EXECUTE se concede EXACTAMENTE a los tres roles ya revisados', () => {
      const grants = [...code.matchAll(/GRANT EXECUTE ON FUNCTION[\s\S]*?TO ([^;]+);/g)].map((m) =>
        m[1].split(',').map((r) => r.trim()).sort(),
      );
      assert.equal(grants.length, 2, 'cambió el número de GRANT EXECUTE');
      for (const roles of grants) {
        assert.deepEqual(
          roles,
          ['authenticated', 'postgres', 'service_role'],
          `el conjunto de roles con EXECUTE cambió: ${roles.join(', ')}`,
        );
      }
    });

    it('🔴 `anon` no recibe EXECUTE en ningún GRANT', () => {
      const grantBlocks = code.match(/GRANT EXECUTE ON FUNCTION[\s\S]*?;/g) ?? [];
      for (const block of grantBlocks) {
        assert.doesNotMatch(block, /\banon\b/, 'un GRANT concede EXECUTE a anon');
      }
    });

    it('las tablas de negocio siguen CUALIFICADAS con su esquema', () => {
      // `public` en el camino existe para la ejecución anidada de RLS, NO para que
      // esta migración empiece a resolver sus propias tablas por búsqueda.
      for (const bare of [
        /\bINSERT INTO\s+prospect_candidates\b/,
        /\bFROM\s+prospect_batches\b/,
        /\bFROM\s+prospect_candidates\b/,
        /\bUPDATE\s+prospect_batches\b/,
      ]) {
        assert.doesNotMatch(code, bare, `una tabla de negocio quedó sin cualificar: ${bare}`);
      }
      assert.match(code, /INSERT INTO public\.prospect_candidates/);
      assert.match(code, /FROM public\.prospect_batches b/);
      assert.match(code, /UPDATE public\.prospect_batches/);
    });

    it('no hay SQL dinámico', () => {
      assert.doesNotMatch(code, /\bEXECUTE\s+format\b/i);
      assert.doesNotMatch(code, /\bEXECUTE\s+'/i);
      assert.doesNotMatch(code, /\bEXECUTE\s+\w*sql\w*\b/i);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // § 3 — la recarga de PostgREST
  // ═══════════════════════════════════════════════════════════════════════

  describe('§ 3 — NOTIFY pgrst', () => {
    it('🔴 la 126 emite `NOTIFY pgrst, \'reload schema\';`', () => {
      assert.match(code, /NOTIFY\s+pgrst\s*,\s*'reload schema'\s*;/);
    });

    it('🔴 el NOTIFY va al FINAL: después de la columna, las funciones y los grants', () => {
      const notifyAt = code.search(/NOTIFY\s+pgrst/);
      assert.ok(notifyAt > -1, 'no hay NOTIFY');
      for (const [label, pattern] of [
        ['ADD COLUMN identity_epoch', /ADD COLUMN IF NOT EXISTS identity_epoch/],
        ['read_batch_identity_snapshot', /CREATE OR REPLACE FUNCTION public\.read_batch_identity_snapshot/],
        ['insert_fenced_prospect_candidates', /CREATE OR REPLACE FUNCTION public\.insert_fenced_prospect_candidates/],
        ['último GRANT EXECUTE', /GRANT EXECUTE ON FUNCTION public\.insert_fenced_prospect_candidates/],
      ] as const) {
        const at = code.search(pattern);
        assert.ok(at > -1, `no se encuentra ${label}`);
        assert.ok(at < notifyAt, `el NOTIFY precede a ${label}`);
      }
    });

    it('el NOTIFY aparece UNA sola vez', () => {
      assert.equal((code.match(/NOTIFY\s+pgrst/g) ?? []).length, 1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // § 4 — el alcance NO creció
  // ═══════════════════════════════════════════════════════════════════════

  describe('§ 4 — nada se coló con la corrección', () => {
    it('🔴 NO se creó una M127: esto es una corrección, no una migración nueva', () => {
      const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));
      const beyond126 = files.filter((f) => {
        const n = Number.parseInt(f.slice(0, 3), 10);
        return Number.isFinite(n) && n > 126;
      });
      assert.deepEqual(beyond126, [], `aparecieron migraciones por encima de la 126: ${beyond126.join(', ')}`);
    });

    it('la 126 sigue siendo el número de Agente 1', () => {
      const files = readdirSync(migrationsDir);
      assert.ok(files.includes(M126), 'la 126 de Agente 1 se renumeró');
    });

    it('🔴 la 124 (Agente 2A) NO se tocó', () => {
      // Es la última migración APLICADA en Producción. Modificarla reescribiría
      // historia ya ejecutada.
      const files = readdirSync(migrationsDir);
      assert.ok(files.includes(M124), 'la 124 desapareció o se renumeró');
    });

    it('🔴 NO se crea ningún índice', () => {
      assert.doesNotMatch(code, /CREATE\s+(UNIQUE\s+)?INDEX/i);
    });

    it('🔴 NO se añade ninguna restricción UNIQUE de identidad', () => {
      assert.doesNotMatch(code, /ADD\s+CONSTRAINT/i);
      assert.doesNotMatch(code, /\bUNIQUE\s*\(/i);
    });

    it('🔴 NO se añade ningún disparador', () => {
      assert.doesNotMatch(code, /CREATE\s+(OR REPLACE\s+)?TRIGGER/i);
    });

    it('🔴 NO aparece política de identidad TIER en SQL', () => {
      // La autoridad de TIER 0-5 vive entera en TypeScript. Una segunda copia en
      // SQL divergiría en la primera corrección.
      assert.doesNotMatch(code, /\bTIER\b/i);
      assert.doesNotMatch(code, /normaliz/i);
      assert.doesNotMatch(code, /\btax_identifier\s*=/i);
    });

    it('🔴 NO se toca `has_active_access` ni ninguna política de tabla', () => {
      // El endurecimiento del esquema de las ~25 políticas es un corte aparte.
      assert.doesNotMatch(code, /has_active_access/);
      assert.doesNotMatch(code, /CREATE\s+POLICY/i);
      assert.doesNotMatch(code, /ALTER\s+POLICY/i);
      assert.doesNotMatch(code, /DROP\s+POLICY/i);
      assert.doesNotMatch(code, /ROW LEVEL SECURITY/i);
    });

    it('🔴 NO hay backfill ni DML sobre datos históricos', () => {
      assert.doesNotMatch(code, /\bDELETE\s+FROM\b/i);
      assert.doesNotMatch(code, /\bTRUNCATE\b/i);
      assert.doesNotMatch(code, /\bDROP\s+(TABLE|COLUMN)\b/i);
    });

    it('la columna de época sigue siendo aditiva e idempotente', () => {
      assert.match(code, /ADD COLUMN IF NOT EXISTS identity_epoch BIGINT NOT NULL DEFAULT 0/);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // § 5 — la autoridad de TypeScript sigue intacta
  // ═══════════════════════════════════════════════════════════════════════

  describe('§ 5 — el predicado fail-closed y la dependencia de Lusha', () => {
    const persistence = readFileSync(
      join(repoRoot, 'src', 'server', 'prospect-batches', 'batch-identity-fenced-persistence.ts'),
      'utf8',
    );

    it('🔴 `isProvenFenceCapabilityAbsent` sigue exigiendo las TRES condiciones', () => {
      const body = persistence.slice(
        persistence.indexOf('export function isProvenFenceCapabilityAbsent'),
      );
      const fn = body.slice(0, body.indexOf('\n}') + 2);
      assert.match(fn, /snapshot\.epoch === null/);
      assert.match(fn, /snapshot\.fenceCapabilityAbsent === true/);
      assert.match(fn, /snapshot\.degraded === false/);
    });

    it('la ruta legada sólo se autoriza a través de ese predicado', () => {
      assert.match(
        persistence,
        /const legacyFallbackAllowed = isProvenFenceCapabilityAbsent\(args\.snapshot\)/,
      );
    });
  });
});
