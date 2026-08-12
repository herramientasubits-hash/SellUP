/**
 * Estáticas de supabase/migrations/115_official_contact_phone_privacy.sql y del cableado
 * (Agente 2A · AGENT2A-PHONE-REVEAL-4O-H2).
 *
 * ═══════════════════════════════════════════════════════════════════
 * QUÉ FIJA ESTA SUITE
 * ═══════════════════════════════════════════════════════════════════
 *
 *   * que la 115 NO cambia la FORMA de las dos tablas oficiales: H1 la cerró, y si H2 hubiera
 *     necesitado una columna allí lo correcto era PARAR. Cero ADD COLUMN, cero CONSTRAINT,
 *     cero índice sobre `contact_phones` / `contact_phone_sources`;
 *   * que NADA borra: ni DELETE ni TRUNCATE en SQL ejecutable, porque borrar un tombstone
 *     desbloquearía el número suprimido;
 *   * que la función es SECURITY INVOKER con `search_path` fijado — no DEFINER, que se
 *     regalaría el DELETE y el UPDATE de procedencia que la 114 le niega;
 *   * que el predicado de suprimibilidad del SQL es EXACTAMENTE el conjunto derivado en
 *     TypeScript, en AMBAS direcciones;
 *   * que los rangos de reelección son los de la 112 verbatim, con `manual` como TIER previo;
 *   * que el ORDEN del cableado es candidato → escalar heredado → oficial, que es lo que hace
 *     este hito estrictamente aditivo sobre E1–E4.1;
 *   * el ALCANCE: la aprobación, `createContact`, `updateContact`, «Buscar más números», la UI
 *     y HubSpot siguen sin enterarse; ningún flag nuevo; cero backfill.
 *
 * Sólo lee archivos del disco. Sin red, sin Supabase, sin proveedores, 0 créditos, y NO toca
 * Producción. Las GARANTÍAS —CHECKs, locks, concurrencia, privilegios reales— se miden en
 * `…-postgres-4o-h2`, porque son propiedades de PostgreSQL.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  deriveLegacyPhoneSource,
  OFFICIAL_PHONE_ACQUISITION_MODES,
  OFFICIAL_PHONE_PROVIDERS,
  suppressibleOfficialSourcePairs,
} from '../official-contact-phone-suppression-core';

const here = dirname(fileURLToPath(import.meta.url));
// __tests__ → contact-enrichment → modules → src → repo root
const repoRoot = join(here, '..', '..', '..', '..');
const migrationsDir = join(repoRoot, 'supabase/migrations');
const srcDir = join(repoRoot, 'src');

const MIGRATION_FILE = '115_official_contact_phone_privacy.sql';
const MIGRATION_112 = '112_suppress_candidate_phone_collection.sql';
const MIGRATION_114 = '114_official_contact_phones.sql';

const FN = 'suppress_official_contact_phone_sources';

const read = (...parts: string[]) => readFileSync(join(repoRoot, ...parts), 'utf8');

const migrationSql = readFileSync(join(migrationsDir, MIGRATION_FILE), 'utf8');
const sql112 = readFileSync(join(migrationsDir, MIGRATION_112), 'utf8');
const sql114 = readFileSync(join(migrationsDir, MIGRATION_114), 'utf8');

/** SQL EJECUTABLE: el archivo sin las líneas de comentario `--`. */
function executable(source: string): string {
  return source
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
}

const executableSql = executable(migrationSql);

/**
 * SQL ESTRUCTURAL: lo ejecutable menos los `COMMENT ON … IS '…';`, que son prosa dentro de una
 * sentencia. Las aserciones de AUSENCIA tienen que leer esto y no lo ejecutable: los COMMENT
 * explican precisamente lo que la migración NO hace, así que buscar la palabra en ellos hace
 * pasar por infracción a la frase que documenta que no la hay. Convención de la suite de H1.
 */
const structuralSql = executableSql.replace(/COMMENT ON [\s\S]*?';\n/g, '');

/** Cuerpo de la función bajo prueba, sin comentarios. */
const fnBody = (() => {
  const match = structuralSql.match(
    new RegExp(`CREATE OR REPLACE FUNCTION public\\.${FN}[\\s\\S]*?\\n\\$function\\$;`),
  );
  assert.ok(match, 'no se encontró el cuerpo de la función');
  return match[0];
})();

function stripTsComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** Todos los .ts/.tsx de `src`, con su ruta relativa al repo. */
function sourceFiles(): { path: string; body: string }[] {
  const out: { path: string; body: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name)) {
        out.push({ path: full.slice(repoRoot.length + 1), body: readFileSync(full, 'utf8') });
      }
    }
  };
  walk(srcDir);
  return out;
}

const productionSources = sourceFiles().filter((f) => !f.path.includes('__tests__'));

// ═══════════════════════════════════════════════════════════════════
// Numeración
// ═══════════════════════════════════════════════════════════════════

describe('115 — numeración', () => {
  it('el número 115 es único en supabase/migrations', () => {
    const numbered = readdirSync(migrationsDir).filter(
      (file) => file.endsWith('.sql') && /^115[_-]/.test(file),
    );
    assert.deepEqual(numbered, [MIGRATION_FILE]);
  });

  it('115 es el número más alto del repo', () => {
    const numbers = readdirSync(migrationsDir)
      .filter((file) => /^\d{3}[_-].*\.sql$/.test(file))
      .map((file) => Number(file.slice(0, 3)));
    assert.equal(Math.max(...numbers), 115);
  });

  it('declara NO estar aplicada en Producción', () => {
    // El merge no autoriza el apply: es una decisión aparte y explícita de la dueña.
    assert.match(migrationSql, /APPLIED IN PRODUCTION:\s*NO/);
  });

  it('H2 aporta EXACTAMENTE una migración', () => {
    const mine = readdirSync(migrationsDir).filter((file) =>
      /4O-H2/.test(readFileSync(join(migrationsDir, file), 'utf8')),
    );
    assert.deepEqual(mine, [MIGRATION_FILE]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// H1 cerró la FORMA: la 115 no la toca
// ═══════════════════════════════════════════════════════════════════

describe('115 — no contradice a H1', () => {
  it('NO añade columnas, constraints ni índices a las dos tablas oficiales', () => {
    // Si H2 hubiera necesitado esquema nuevo allí, el hito tenía que PARAR: sería contradecir
    // a H1 en la misma cadena que lo declaró cerrado.
    assert.doesNotMatch(structuralSql, /ALTER TABLE\s+public\.contact_phones\b/i);
    assert.doesNotMatch(structuralSql, /ALTER TABLE\s+public\.contact_phone_sources\b/i);
    assert.doesNotMatch(structuralSql, /CREATE\s+(UNIQUE\s+)?INDEX[\s\S]*?ON\s+public\.contact_phone/i);
    assert.doesNotMatch(structuralSql, /CREATE TABLE[\s\S]*?contact_phone/i);
  });

  it('la 114 sigue siendo la ÚNICA que crea las dos tablas', () => {
    const creators = readdirSync(migrationsDir).filter((file) => {
      if (!file.endsWith('.sql')) return false;
      const sql = executable(readFileSync(join(migrationsDir, file), 'utf8'));
      return /CREATE TABLE IF NOT EXISTS public\.contact_phones\b/.test(sql);
    });
    assert.deepEqual(creators, [MIGRATION_114]);
  });

  it('NO redefine ni reemplaza ninguna política RLS de la 114', () => {
    assert.doesNotMatch(structuralSql, /CREATE POLICY/i);
    assert.doesNotMatch(structuralSql, /DROP POLICY/i);
    assert.doesNotMatch(structuralSql, /ROW LEVEL SECURITY/i);
  });

  it('NO ensancha ningún GRANT de tabla de la 114', () => {
    // Los únicos GRANT/REVOKE de la 115 son sobre la FUNCIÓN.
    const grants = [...structuralSql.matchAll(/(GRANT|REVOKE)[^;]*;/gi)].map((m) => m[0]);
    assert.ok(grants.length > 0, 'la 115 debe conceder EXECUTE de su función');
    for (const statement of grants) {
      assert.match(
        statement,
        /ON FUNCTION/i,
        `la 115 sólo toca privilegios de FUNCIÓN, y este no: ${statement.slice(0, 90)}`,
      );
    }
    assert.doesNotMatch(structuralSql, /ON TABLE\s+public\.contact_phone/i);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Nada borra
// ═══════════════════════════════════════════════════════════════════

describe('115 — la supresión es un TOMBSTONE, nunca un DELETE', () => {
  it('no hay DELETE ni TRUNCATE en SQL ejecutable', () => {
    // Borrar un tombstone desbloquearía el número: la siguiente observación lo reinsertaría
    // como si la supresión no hubiera existido.
    assert.doesNotMatch(structuralSql, /\bDELETE\s+FROM\b/i);
    assert.doesNotMatch(structuralSql, /\bTRUNCATE\b/i);
  });

  it('el tombstone canónico NULA número, display, tipo y principal', () => {
    // Es la CHECK `contact_phones_tombstone_is_empty` de la 114, restablecida por el writer:
    // una fila «suprimida» que conservara el número sería una bandera, no una supresión.
    const update = fnBody.match(
      /UPDATE public\.contact_phones p\n\s+SET normalized_phone[\s\S]*?GET DIAGNOSTICS v_tombstoned/,
    );
    assert.ok(update, 'no se encontró el UPDATE de tombstone canónico');
    for (const column of ['normalized_phone', 'display_phone', 'phone_type']) {
      assert.match(update[0], new RegExp(`${column}\\s*=\\s*NULL`));
    }
    assert.match(update[0], /is_primary\s*=\s*false/);
  });

  it('la `dedupe_key` NO se limpia: es lo que bloquea la reinserción', () => {
    assert.doesNotMatch(fnBody, /dedupe_key\s*=\s*NULL/);
  });

  it('la retirada de una procedencia escribe SÓLO la tríada de supresión', () => {
    // La 114 concede UPDATE por COLUMNA sobre exactamente estas tres. Cualquier otra columna
    // en este SET sería un 42501 en ejecución en vez de un fallo en revisión.
    const update = fnBody.match(
      /UPDATE public\.contact_phone_sources s\n\s+SET[\s\S]*?GET DIAGNOSTICS v_sources_suppressed/,
    );
    assert.ok(update, 'no se encontró el UPDATE de retirada de procedencia');
    const setClause = update[0].slice(0, update[0].indexOf('WHERE'));
    const assigned = [...setClause.matchAll(/^\s+(?:SET\s+)?([a-z_]+)\s*=/gm)].map((m) => m[1]);
    assert.deepEqual(assigned.sort(), [
      'suppressed_at',
      'suppressed_by',
      'suppression_reason',
    ]);
  });

  it('nunca escribe `provider`, `acquisition_mode` ni `source_event_key`', () => {
    for (const column of [
      'provider',
      'acquisition_mode',
      'raw_provider_type',
      'raw_provider_status',
      'source_event_key',
      'observed_at',
      'candidate_phone_id',
      'waterfall_run_id',
      'reservation_id',
      'provider_usage_log_id',
    ]) {
      assert.doesNotMatch(
        fnBody,
        new RegExp(`^\\s+${column}\\s*=\\s*(?!ANY)`, 'm'),
        `la procedencia es inmutable: ${column} no puede aparecer en un SET`,
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// Privilegios
// ═══════════════════════════════════════════════════════════════════

describe('115 — privilegios de la función', () => {
  it('es SECURITY INVOKER y NO DEFINER', () => {
    // DEFINER se regalaría el DELETE y el UPDATE completo de procedencia, en la única
    // operación cuyo propósito entero es el borrado.
    assert.match(fnBody, /SECURITY INVOKER/);
    assert.doesNotMatch(structuralSql, /SECURITY DEFINER/i);
  });

  it('fija `search_path` y NO incluye `public`', () => {
    assert.match(fnBody, /SET search_path = pg_catalog, pg_temp/);
  });

  it('todas las referencias están cualificadas con esquema', () => {
    for (const table of [
      'contact_phones',
      'contact_phone_sources',
      'contacts',
    ]) {
      const bare = new RegExp(`(FROM|UPDATE|JOIN|INTO)\\s+${table}\\b`, 'g');
      assert.doesNotMatch(fnBody, bare, `${table} debe ir siempre como public.${table}`);
    }
  });

  it('no hay SQL dinámico', () => {
    assert.doesNotMatch(fnBody, /\bEXECUTE\s+(format|'|")/i);
    assert.doesNotMatch(fnBody, /\bquote_ident\b|\bquote_literal\b/i);
  });

  it('REVOKE a PUBLIC, anon y authenticated; GRANT sólo a postgres y service_role', () => {
    // PostgreSQL concede EXECUTE a PUBLIC en toda función nueva, y para una función de BORRADO
    // eso significa alcanzabilidad por PostgREST con la clave anon. La alcanzabilidad ES el
    // defecto, independientemente de que la RLS rechazara después cada sentencia.
    for (const role of ['PUBLIC', 'anon', 'authenticated']) {
      assert.match(
        structuralSql,
        new RegExp(`REVOKE ALL ON FUNCTION public\\.${FN}\\([^)]*\\)\\s*FROM ${role};`),
        `falta el REVOKE de ${role}`,
      );
    }
    assert.match(
      structuralSql,
      new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${FN}\\([^)]*\\)\\s*TO postgres, service_role;`),
    );
    // Y a nadie más.
    const granted = [...structuralSql.matchAll(/GRANT EXECUTE ON FUNCTION[\s\S]*?TO ([^;]+);/g)].map(
      (m) => m[1].trim(),
    );
    assert.deepEqual(granted, ['postgres, service_role']);
  });

  it('la firma de los REVOKE/GRANT coincide con la de la función', () => {
    // Un tipo distinto crearía una SOBRECARGA nueva: los REVOKE apuntarían a una función que
    // no existe y la real nacería con EXECUTE para PUBLIC.
    const signature = 'uuid, text, text, text, text, uuid, timestamptz';
    const occurrences = [
      ...structuralSql.matchAll(new RegExp(`public\\.${FN}\\(\\s*([^)]*?)\\s*\\)`, 'g')),
    ].map((m) => m[1].replace(/\s+/g, ' ').trim());
    assert.equal(
      occurrences.filter((s) => s === signature).length,
      4,
      'los 3 REVOKE y el GRANT deben nombrar la MISMA firma',
    );
    // El COMMENT vive fuera de `structuralSql` (es prosa dentro de una sentencia), así que se
    // comprueba aparte: si nombrara otra firma documentaría una función que no existe.
    assert.match(
      executableSql,
      new RegExp(`COMMENT ON FUNCTION public\\.${FN}\\(\\s*${signature}\\s*\\)`),
    );
    // La definición declara los MISMOS siete tipos, en el mismo orden.
    const create = structuralSql.match(
      new RegExp(`CREATE OR REPLACE FUNCTION public\\.${FN}\\(([\\s\\S]*?)\\)\\s*\\nRETURNS`),
    );
    assert.ok(create, 'no se encontró la definición');
    const declaredTypes = create[1]
      .split(',')
      .map((line) => line.trim().split(/\s+/).slice(1).join(' '))
      .join(', ');
    assert.equal(declaredTypes, signature);
  });
});

// ═══════════════════════════════════════════════════════════════════
// El predicado de suprimibilidad — paridad con TypeScript
// ═══════════════════════════════════════════════════════════════════

describe('115 — la suprimibilidad del SQL es la DERIVADA en TypeScript', () => {
  /**
   * El `WHERE` de la retirada, reimplementado literalmente a partir del SQL para poder
   * evaluarlo sobre los 25 pares representables. Se lee del archivo y NO se copia a mano: si
   * la 115 ensanchara su predicado, la extracción cambia y la paridad falla.
   */
  const predicate = (() => {
    const update = fnBody.match(
      /UPDATE public\.contact_phone_sources s\n\s+SET[\s\S]*?GET DIAGNOSTICS v_sources_suppressed/,
    );
    assert.ok(update);
    const tail = update[0];
    const block = tail.slice(tail.lastIndexOf('AND ('));
    return block;
  })();

  it('el SQL nombra exactamente las tres ramas positivas', () => {
    assert.match(predicate, /s\.provider = 'apollo_cache'/);
    assert.match(predicate, /s\.provider = 'lusha'/);
    assert.match(
      predicate,
      /s\.provider = 'apollo' AND s\.acquisition_mode IN \('reveal', 'waterfall'\)/,
    );
  });

  it('el SQL NO nombra `manual` ni `unknown` como suprimibles', () => {
    assert.doesNotMatch(predicate, /'manual'/);
    assert.doesNotMatch(predicate, /'unknown'/);
    assert.doesNotMatch(predicate, /'search'/);
  });

  it('AMBAS direcciones: SQL ⇔ TypeScript sobre los 25 pares', () => {
    // Evaluación del predicado SQL extraído, rama por rama, contra el derivado de TS.
    const sqlSays = (provider: string, mode: string): boolean =>
      provider === 'apollo_cache' ||
      provider === 'lusha' ||
      (provider === 'apollo' && (mode === 'reveal' || mode === 'waterfall'));

    const derived = new Set(
      suppressibleOfficialSourcePairs().map((p) => `${p.provider}:${p.acquisitionMode}`),
    );

    let checked = 0;
    for (const provider of OFFICIAL_PHONE_PROVIDERS) {
      for (const mode of OFFICIAL_PHONE_ACQUISITION_MODES) {
        checked += 1;
        assert.equal(
          sqlSays(provider, mode),
          derived.has(`${provider}:${mode}`),
          `(${provider}, ${mode}) discrepa entre la 115 y el core`,
        );
      }
    }
    assert.equal(checked, 25, 'deben evaluarse los 25 pares representables');
  });

  it('la allowlist heredada del escalar viaja en el SQL sin inventar miembros', () => {
    const array = structuralSql.match(
      /c_suppressible_legacy_sources text\[\] := ARRAY\[([\s\S]*?)\]/,
    );
    assert.ok(array, 'no se encontró la allowlist heredada en el SQL');
    const values = [...array[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    assert.deepEqual(values, ['apollo_cache', 'apollo_reveal', 'lusha_reveal']);
    // Y son EXACTAMENTE los tres que el mapeo derivado produce para pares suprimibles.
    const derivedValues = [
      ...new Set(
        suppressibleOfficialSourcePairs().map((p) =>
          deriveLegacyPhoneSource(p.provider, p.acquisitionMode),
        ),
      ),
    ].sort();
    assert.deepEqual(values, derivedValues);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Reelección — la 112 verbatim, con `manual` como TIER previo
// ═══════════════════════════════════════════════════════════════════

describe('115 — el ranking de reelección', () => {
  const arrayOf = (source: string, name: string): string[] => {
    const match = source.match(new RegExp(`${name}\\s+text\\[\\] := ARRAY\\[([\\s\\S]*?)\\]`));
    assert.ok(match, `no se encontró ${name}`);
    return [...match[1].matchAll(/'([a-z_:]+)'/g)].map((m) => m[1]);
  };

  it('el ranking de tipo es el de la 112, en el MISMO orden', () => {
    // Dos rankings sobre el mismo vocabulario es como el candidato y la colección oficial
    // acaban eligiendo principales distintos para la misma persona.
    assert.deepEqual(
      arrayOf(structuralSql, 'c_type_ranking'),
      arrayOf(executable(sql112), 'c_type_ranking'),
    );
  });

  it('el ranking de procedencia es el de la 112, en el MISMO orden', () => {
    assert.deepEqual(
      arrayOf(structuralSql, 'c_source_ranking'),
      arrayOf(executable(sql112), 'c_source_ranking'),
    );
  });

  it('`manual` NO está en el ranking de procedencia: es un TIER previo', () => {
    // Un `work` manual tiene que ganar a un `personal_mobile` de proveedor, y ninguna
    // reordenación de una sola escalera puede expresar eso.
    assert.equal(
      arrayOf(structuralSql, 'c_source_ranking').some((v) => v.startsWith('manual')),
      false,
    );
    const order = fnBody.slice(fnBody.indexOf('ORDER BY', fnBody.indexOf('v_incumbent_live THEN')));
    const manualTier = order.indexOf("s.provider = 'manual'");
    const typeTier = order.indexOf('c_type_ranking');
    assert.ok(manualTier > -1, 'falta el tier de precedencia manual');
    assert.ok(
      manualTier < typeTier,
      'el tier manual debe evaluarse ANTES que la escalera de tipo',
    );
  });

  it('el tier manual sólo cuenta procedencias VIVAS', () => {
    const tier = fnBody.match(/CASE WHEN EXISTS \([\s\S]*?THEN 0 ELSE 1 END/);
    assert.ok(tier);
    assert.match(tier[0], /s\.suppressed_at IS NULL/);
    assert.match(tier[0], /s\.provider = 'manual'/);
  });

  it('el desempate final es `dedupe_key ASC`, que hace el comparador TOTAL', () => {
    // Sin un comparador total, la «reelección determinista» de dos filas empatadas sería lo
    // que el planificador devolviera ese día.
    assert.match(fnBody, /p\.last_seen_at DESC,\s*\n\s*p\.dedupe_key ASC/);
  });

  it('la elegibilidad restablece la CHECK de la 114', () => {
    assert.match(
      fnBody,
      /p\.suppressed_at IS NULL\s*\n\s*AND p\.normalized_phone IS NOT NULL\s*\n\s*AND p\.phone_status <> 'invalid'/,
    );
  });

  it('demota ANTES de promover', () => {
    // El índice único parcial no tolera dos principales ni por una sentencia.
    const demote = fnBody.indexOf('SET is_primary = false\n       WHERE contact_id = p_contact_id\n         AND is_primary\n         AND id <> v_primary_id');
    const promote = fnBody.indexOf('SET is_primary = true');
    assert.ok(demote > -1 && promote > -1);
    assert.ok(demote < promote, 'demotar después de promover deja dos principales');
  });

  it('la ESTABILIDAD del titular está implementada explícitamente', () => {
    // H2 sólo cambia el principal cuando el titular deja de estar vivo: reordenar en cada
    // borrado movería el número que el producto entero muestra por razones ajenas a la petición.
    assert.match(fnBody, /v_incumbent_live/);
    assert.match(fnBody, /IF v_incumbent_live THEN\s*\n\s*v_primary_id\s*:=\s*v_incumbent_id;/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Vocabulario de motivos y escalar
// ═══════════════════════════════════════════════════════════════════

describe('115 — vocabularios y escalar heredado', () => {
  it('el motivo es el de la 114 (= 109) y NO el de caché/auditoría de la 099', () => {
    const reasons = structuralSql.match(/c_reasons\s+text\[\] := ARRAY\[([\s\S]*?)\]/);
    assert.ok(reasons);
    const values = [...reasons[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    assert.deepEqual(values, [
      'data_subject_request',
      'operator_request',
      'provider_retraction',
    ]);
    // Los dos conjuntos comparten CERO valores: un pass-through fallaría la CHECK en el 100%
    // de las filas, que es el 23514 de #238.
    for (const cacheReason of [
      'dsar_erasure_request',
      'do_not_contact_request',
      'legal_privacy_request',
      'admin_privacy_correction',
      'test_synthetic',
    ]) {
      assert.equal(values.includes(cacheReason), false);
    }
  });

  it('el vocabulario coincide con el CHECK de la 114 carácter por carácter', () => {
    const check114 = sql114.match(
      /CONSTRAINT contact_phones_suppression_reason_check[\s\S]*?\)\s*,/,
    );
    assert.ok(check114);
    const from114 = [...check114[0].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    const reasons = structuralSql.match(/c_reasons\s+text\[\] := ARRAY\[([\s\S]*?)\]/);
    assert.ok(reasons);
    assert.deepEqual(
      [...reasons[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort(),
      from114,
    );
  });

  it('el mapeo par → escalar es el `CASE` de la 112, verbatim', () => {
    const caseOf = (source: string) => {
      const match = source.match(/WHEN v_src\.provider = 'apollo_cache'[\s\S]*?END;/);
      assert.ok(match, 'no se encontró el CASE de procedencia');
      return match[0].replace(/\s+/g, ' ').trim();
    };
    assert.equal(caseOf(structuralSql), caseOf(executable(sql112)));
  });

  it('el escalar se proyecta con `COALESCE(display, normalized)`', () => {
    assert.match(
      fnBody,
      /v_scalar\s*:=\s*COALESCE\(v_primary\.display_phone, v_primary\.normalized_phone\)/,
    );
  });

  it('la procedencia proyectada sólo mira fuentes VIVAS', () => {
    // §23: un escalar nunca puede afirmar una procedencia ya retirada. Es lo que convierte
    // `apollo_reveal` en `lusha_reveal` en la misma transacción.
    const projection = fnBody.slice(fnBody.indexOf('SELECT s.provider, s.acquisition_mode'));
    assert.match(projection.slice(0, 400), /AND s\.suppressed_at IS NULL/);
  });

  it('la guarda del escalar usa la allowlist heredada', () => {
    assert.match(
      fnBody,
      /IF NOT \(COALESCE\(BTRIM\(v_contact\.phone_source\), ''\) = ANY \(c_suppressible_legacy_sources\)\) THEN\s*\n\s*v_scalar_guarded := true;/,
    );
  });

  it('NO toca `mobile_phone` en SQL ejecutable', () => {
    // No tiene columna de procedencia (4O-E4.1): un borrado por proveedor no puede saber si el
    // número vino del proveedor que borra o de una persona.
    assert.doesNotMatch(structuralSql, /mobile_phone\s*=/);
    const contactsUpdate = fnBody.match(/UPDATE public\.contacts\n\s+SET[\s\S]*?GET DIAGNOSTICS v_contact_rows/);
    assert.ok(contactsUpdate);
    assert.doesNotMatch(contactsUpdate[0], /mobile_phone/);
  });

  it('el UPDATE del escalar toca EXACTAMENTE las 7 columnas del patch de 4O-E4', () => {
    const contactsUpdate = fnBody.match(/UPDATE public\.contacts\n\s+SET([\s\S]*?)WHERE id = p_contact_id/);
    assert.ok(contactsUpdate);
    const assigned = [...contactsUpdate[1].matchAll(/^\s+([a-z_]+)\s*=/gm)].map((m) => m[1]);
    assert.deepEqual(assigned.sort(), [
      'phone',
      'phone_confidence',
      'phone_processing_basis',
      'phone_raw_type',
      'phone_revealed_at',
      'phone_source',
      'phone_type',
    ]);
  });

  it('NUNCA puebla `phone_confidence`: sigue muerta', () => {
    assert.match(fnBody, /phone_confidence\s*=\s*NULL/);
    assert.doesNotMatch(fnBody, /phone_confidence\s*=\s*(?!NULL)v_/);
  });

  it('`phone_processing_basis` se limpia y no se fabrica', () => {
    assert.match(fnBody, /phone_processing_basis\s*=\s*NULL/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Transaccionalidad, locks e inercia
// ═══════════════════════════════════════════════════════════════════

describe('115 — transacción y locks', () => {
  it('bloquea el contacto con FOR UPDATE, y es el punto de serialización', () => {
    assert.match(
      fnBody,
      /FROM public\.contacts c\s*\n\s*WHERE c\.id = p_contact_id\s*\n\s*FOR UPDATE;/,
    );
  });

  it('bloquea las filas canónicas en orden de `id`', () => {
    // Dos operaciones sobre la misma colección no pueden tomar los mismos locks en órdenes
    // opuestos: eso es el deadlock.
    assert.match(
      fnBody,
      /FROM public\.contact_phones p\s*\n\s*WHERE p\.contact_id = p_contact_id\s*\n\s*ORDER BY p\.id\s*\n\s*FOR UPDATE;/,
    );
  });

  it('NO abre ni cierra transacciones a mano', () => {
    // La función ES la transacción; un COMMIT interno partiría la atomicidad que justifica que
    // exista.
    assert.doesNotMatch(fnBody, /\bCOMMIT\b|\bROLLBACK\b|\bBEGIN TRANSACTION\b|SAVEPOINT/i);
  });

  it('la regla del ÚLTIMO ORIGEN se evalúa con NOT EXISTS sobre fuentes vivas', () => {
    const tombstone = fnBody.match(/UPDATE public\.contact_phones p\n\s+SET normalized_phone[\s\S]*?GET DIAGNOSTICS v_tombstoned/);
    assert.ok(tombstone);
    assert.match(tombstone[0], /AND NOT EXISTS \(\s*\n\s*SELECT 1 FROM public\.contact_phone_sources s/);
    assert.match(tombstone[0], /AND s\.suppressed_at IS NULL/);
  });

  it('la IDEMPOTENCIA está en el `WHERE suppressed_at IS NULL`', () => {
    const update = fnBody.match(/UPDATE public\.contact_phone_sources s\n\s+SET[\s\S]*?GET DIAGNOSTICS/);
    assert.ok(update);
    assert.match(update[0], /WHERE s\.suppressed_at IS NULL/);
  });

  it('sin colección oficial la función NO escribe nada', () => {
    // Es la inercia en Producción, donde `contact_phones` tiene 0 filas: la 115 no puede
    // reproyectar `contacts.phone` desde un conjunto vacío y convertir privacidad en pérdida
    // de datos. 4O-E4 sigue siendo el único dueño del escalar hasta H3.
    const guard = fnBody.match(/IF v_official_rows = 0 THEN[\s\S]*?END IF;/);
    assert.ok(guard, 'falta la guarda de colección vacía');
    assert.match(guard[0], /'no_official_collection'/);
    assert.doesNotMatch(guard[0], /UPDATE|INSERT|DELETE/i);
    // Y ocurre ANTES de cualquier escritura.
    assert.ok(
      fnBody.indexOf("'no_official_collection'") <
        fnBody.indexOf('UPDATE public.contact_phone_sources'),
    );
  });

  it('valida TODO antes de la primera escritura', () => {
    const firstWrite = Math.min(
      ...['UPDATE public.contact_phone_sources', 'UPDATE public.contact_phones', 'UPDATE public.contacts']
        .map((needle) => fnBody.indexOf(needle))
        .filter((index) => index > -1),
    );
    for (const detail of [
      'contact_id_missing',
      'provider_scope_unknown',
      'provider_unknown',
      'provider_not_allowed',
      'dedupe_key_blank',
      'suppression_reason_unknown',
      'suppressed_at_missing',
    ]) {
      const at = fnBody.indexOf(`'${detail}'`);
      assert.ok(at > -1, `falta la validación ${detail}`);
      assert.ok(at < firstWrite, `${detail} se valida después de escribir`);
    }
  });

  it('un alcance desconocido es un ERROR y nunca una coincidencia vacía', () => {
    // Un borrado que casara cero filas por un alcance mal escrito reportaría éxito dejando el
    // número vivo.
    assert.match(fnBody, /NOT \(p_provider_scope = ANY \(c_scopes\)\)[\s\S]*?'provider_scope_unknown'/);
  });

  it('el sobre NO devuelve ningún número', () => {
    const envelope = fnBody.slice(fnBody.lastIndexOf('RETURN jsonb_build_object'));
    for (const forbidden of ['display_phone', 'normalized_phone', 'v_scalar']) {
      assert.doesNotMatch(
        envelope,
        new RegExp(`\\b${forbidden}\\b`),
        `el sobre no puede llevar ${forbidden}`,
      );
    }
    assert.match(envelope, /'primary_dedupe_key',\s*v_primary_key/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Auditoría
// ═══════════════════════════════════════════════════════════════════

describe('115 — contadores de auditoría', () => {
  it('añade las dos columnas de forma aditiva y con CHECK `>= 0`', () => {
    for (const column of [
      'official_phone_sources_suppressed',
      'official_phone_rows_tombstoned',
    ]) {
      assert.match(
        structuralSql,
        new RegExp(
          `ADD COLUMN IF NOT EXISTS ${column} integer NOT NULL DEFAULT 0`,
        ),
        `falta la columna ${column}`,
      );
      assert.match(
        structuralSql,
        new RegExp(`CHECK \\(${column} >= 0\\)`),
        `falta la CHECK de ${column}`,
      );
    }
  });

  it('las CHECK se añaden bajo guarda de `pg_constraint` (reaplicable)', () => {
    const checks = [...structuralSql.matchAll(/IF NOT EXISTS \(\s*\n\s*SELECT 1 FROM pg_constraint/g)];
    assert.equal(checks.length, 2);
  });

  it('NO restablece los grants de la tabla de auditoría', () => {
    // Sigue siendo append-only: `service_role` tiene SELECT + INSERT y deliberadamente ni
    // UPDATE ni DELETE (107). Una auditoría que la app puede reescribir no es una auditoría.
    assert.doesNotMatch(structuralSql, /ON TABLE public\.phone_reveal_suppression_audit/);
  });

  it('los dos contadores son columnas TIPADAS y no claves de `metadata`', () => {
    const core = read('src', 'modules', 'contact-enrichment', 'phone-cache-suppression-core.ts');
    const row = core.match(/interface PhoneCacheSuppressionAuditRow \{([\s\S]*?)\n\}/);
    assert.ok(row);
    const beforeMetadata = row[1].slice(0, row[1].indexOf('metadata:'));
    assert.match(beforeMetadata, /official_phone_sources_suppressed: number;/);
    assert.match(beforeMetadata, /official_phone_rows_tombstoned: number;/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Cableado y ORDEN
// ═══════════════════════════════════════════════════════════════════

describe('4O-H2 — cableado del camino de privacidad', () => {
  const actions = read(
    'src',
    'modules',
    'contact-enrichment',
    'phone-cache-suppression-actions.ts',
  );
  const actionsCode = stripTsComments(actions);

  it('la server action de privacidad llama a la RPC oficial', () => {
    assert.match(actionsCode, /suppressOfficialContactPhoneSources\(/);
  });

  it('NO se crea un segundo endpoint ni un segundo botón de DSAR', () => {
    // Un segundo camino de borrado es un camino que se olvida de una superficie.
    const callers = productionSources.filter(
      (file) =>
        /suppressOfficialContactPhoneSources/.test(stripTsComments(file.body)) &&
        !file.path.endsWith('official-contact-phone-suppression-persistence.ts'),
    );
    assert.deepEqual(callers.map((f) => f.path), [
      'src/modules/contact-enrichment/phone-cache-suppression-actions.ts',
    ]);
  });

  it('usa el alcance de PERSONA y no el de un proveedor', () => {
    assert.match(actionsCode, /DSAR_OFFICIAL_PHONE_SUPPRESSION_SCOPE/);
    assert.doesNotMatch(actionsCode, /scope:\s*'single_provider'/);
  });

  it('itera `officialContactTargets` y NO `contactPatches`', () => {
    // La allowlist de `phone_source` protege el ESCALAR y no autoriza la colección oficial: un
    // contacto con un número manual puede tener filas oficiales de Apollo ya pagadas.
    assert.match(actionsCode, /for \(const \{ contactId \} of plan\.officialContactTargets\)/);
  });

  it('el borrado OFICIAL va DESPUÉS del escalar heredado', () => {
    // Es lo que hace el hito estrictamente aditivo: 2d se comporta exactamente como hoy y la
    // 115 encuentra `phone_source = NULL`, que su guarda respeta. Al revés, el modelo oficial
    // pasaría a ser autoritativo sobre el escalar ANTES de que H3 lo poblara.
    const legacy = actionsCode.indexOf(".eq('phone_source', observedPhoneSource)");
    const official = actionsCode.indexOf('suppressOfficialContactPhoneSources(');
    assert.ok(legacy > -1 && official > -1);
    assert.ok(legacy < official, 'el escalar heredado debe borrarse antes del oficial');
  });

  it('un fallo oficial NO se reporta como éxito', () => {
    assert.match(actionsCode, /failureCode = failureCode \?\? 'official_phone_suppression_failed'/);
    assert.match(actionsCode, /ok: failureCode === null/);
  });

  it('el fallo oficial tiene código PROPIO', () => {
    const core = stripTsComments(
      read('src', 'modules', 'contact-enrichment', 'phone-cache-suppression-core.ts'),
    );
    assert.match(core, /\| 'official_phone_suppression_failed'/);
  });

  it('el catch NO propaga el mensaje del driver', () => {
    // PostgreSQL cita valores de la query en sus errores, y uno de ellos es un teléfono.
    const block = actionsCode.slice(
      actionsCode.indexOf('suppressOfficialContactPhoneSources('),
    );
    const catchBlock = block.slice(block.indexOf('} catch'), block.indexOf('}\n  }'));
    assert.doesNotMatch(catchBlock, /error\.message|String\(error\)|\$\{error/);
  });

  it('la persistencia hace UNA sola RPC y ninguna escritura por PostgREST', () => {
    const persistence = stripTsComments(
      read(
        'src',
        'modules',
        'contact-enrichment',
        'official-contact-phone-suppression-persistence.ts',
      ),
    );
    assert.equal((persistence.match(/admin\.rpc\(/g) ?? []).length, 1);
    for (const forbidden of ['.insert(', '.update(', '.delete(', '.upsert(', '.select(']) {
      assert.equal(
        persistence.includes(forbidden),
        false,
        `la persistencia no puede usar ${forbidden}`,
      );
    }
  });

  it('el error del driver se recorta antes de propagarse', () => {
    const persistence = read(
      'src',
      'modules',
      'contact-enrichment',
      'official-contact-phone-suppression-persistence.ts',
    );
    assert.match(persistence, /error\.message\.slice\(\s*0,\s*MAX_ERROR_DETAIL,?\s*\)/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Alcance — lo que H2 NO hace
// ═══════════════════════════════════════════════════════════════════

describe('4O-H2 — alcance', () => {
  const h2Files = [
    'src/modules/contact-enrichment/official-contact-phone-suppression-core.ts',
    'src/modules/contact-enrichment/official-contact-phone-suppression-persistence.ts',
    'src/modules/contact-enrichment/phone-cache-suppression-core.ts',
    'src/modules/contact-enrichment/phone-cache-suppression-actions.ts',
  ];

  it('ni proveedores ni HubSpot en el camino de privacidad', () => {
    for (const path of h2Files) {
      const body = stripTsComments(read(...path.split('/')));
      for (const forbidden of [
        'fetch(',
        'apolloClient',
        'lushaClient',
        'revealPhone',
        'hubspot',
        'HubSpot',
      ]) {
        assert.equal(
          body.includes(forbidden),
          false,
          `${path} no puede contener ${forbidden}`,
        );
      }
    }
  });

  it('ni créditos ni reservas ni usage logs', () => {
    for (const path of h2Files) {
      const body = stripTsComments(read(...path.split('/')));
      for (const forbidden of [
        'reserveCredits',
        'provider_usage_logs',
        'phone_reveal_credit_reservations',
        'phone_reveal_waterfall_runs',
        'budget',
      ]) {
        assert.equal(body.includes(forbidden), false, `${path} no puede contener ${forbidden}`);
      }
    }
    assert.doesNotMatch(structuralSql, /provider_usage_logs|credit_reservations|waterfall_runs/);
  });

  it('la privacidad NO depende de ningún flag', () => {
    // Es infraestructura obligatoria: una supresión que un flag puede apagar no es una
    // garantía.
    for (const path of h2Files) {
      const body = stripTsComments(read(...path.split('/')));
      for (const flag of [
        'ENABLE_PHONE_REVEAL_WATERFALL',
        'ENABLE_LUSHA_PHONE_REVEAL_FALLBACK',
        'ENABLE_APOLLO_PHONE_REVEAL',
        'isFeatureEnabled',
        'process.env',
      ]) {
        assert.equal(body.includes(flag), false, `${path} no puede leer ${flag}`);
      }
    }
    assert.doesNotMatch(structuralSql, /feature_flag|ENABLE_/);
  });

  it('H2 NO toca la aprobación (eso es H3)', () => {
    const reviewCore = stripTsComments(
      read('src', 'modules', 'contact-enrichment', 'candidate-review-core.ts'),
    );
    assert.equal(/contact_phones|contact_phone_sources/.test(reviewCore), false);
    assert.equal(/official-contact-phone/.test(reviewCore), false);
  });

  it('H2 NO toca la creación ni la edición manual (eso es H5)', () => {
    const contactActions = stripTsComments(read('src', 'modules', 'contacts', 'actions.ts'));
    assert.equal(/contact_phones|contact_phone_sources/.test(contactActions), false);
    assert.equal(/official-contact-phone/.test(contactActions), false);
  });

  it('cero UI: ningún .tsx nombra el camino oficial de privacidad', () => {
    const offenders = productionSources.filter(
      (file) =>
        file.path.endsWith('.tsx') &&
        /official-contact-phone|suppressOfficialContactPhoneSources|contact_phone_sources/.test(
          stripTsComments(file.body),
        ),
    );
    assert.deepEqual(offenders.map((f) => f.path), []);
  });

  it('cero backfill: la 115 no inserta ni una fila', () => {
    assert.doesNotMatch(structuralSql, /\bINSERT INTO\b/i);
    assert.doesNotMatch(structuralSql, /\bUPDATE public\.contact_phones\s+SET[^;]*?FROM\b/i);
  });

  it('la 115 no crea ninguna otra función', () => {
    const created = [
      ...structuralSql.matchAll(/CREATE (?:OR REPLACE )?FUNCTION public\.([a-z_]+)/g),
    ].map((m) => m[1]);
    assert.deepEqual(created, [FN]);
  });

  it('«Buscar más números» sigue sin existir', () => {
    const offenders = productionSources.filter((file) =>
      /buscar_mas_numeros|searchMorePhones|search_more_phones/i.test(file.body),
    );
    assert.deepEqual(offenders.map((f) => f.path), []);
  });

  it('las deudas fuera de alcance siguen DECLARADAS', () => {
    // Que sigan escritas es lo que impide que se cierren por olvido.
    assert.match(migrationSql, /MOBILE_PHONE_PROVENANCE_PENDING|mobile_phone/);
    assert.match(migrationSql, /H3/);
    assert.match(migrationSql, /phone_confidence/);
  });
});
