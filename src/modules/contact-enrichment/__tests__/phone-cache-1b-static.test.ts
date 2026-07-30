/**
 * Agente 2A — Apollo Phone Cache STATIC GUARDS (APOLLO-PHONE-CACHE-1b)
 *
 * Guards estáticos que leen los archivos en disco. Sin red, sin DB, sin
 * proveedor. Protegen las invariantes que no se pueden expresar como una
 * aserción de runtime:
 *
 *   - la migración 099 crea la caché con el alcance y las restricciones exactas;
 *   - `apollo_cache` está en PhoneSource, ContactPhoneSource, la allowlist de
 *     aprobación y el CHECK de contacts;
 *   - el flag ENABLE_APOLLO_PHONE_CACHE es server-only y su default es OFF;
 *   - la caché NUNCA toca Lusha;
 *   - no existe endpoint ni acción de caché en lote;
 *   - los módulos de caché no imprimen teléfono / email / nombre / linkedin.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  APOLLO_PHONE_CACHE_FLAG,
  isApolloPhoneCacheEnabled,
} from '@/lib/feature-flags.server';
import {
  PHONE_CACHE_SUPPRESSION_AUDIT_TABLE,
  PHONE_CACHE_SUPPRESSION_REASON_CODES,
} from '../phone-cache-suppression-core';

const HERE = dirname(fileURLToPath(import.meta.url));
// __tests__ → contact-enrichment → modules → src → repo root
const REPO_ROOT = join(HERE, '..', '..', '..', '..');
function readRepo(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), 'utf8');
}

/**
 * Cuerpo COMPLETO de una función top-level: desde su declaración hasta la llave
 * de cierre en columna 0 seguida de línea en blanco. Un `\n}` simple no sirve: un
 * bloque de parámetros desestructurados ya cierra con `}` al inicio de línea y
 * truncaría el cuerpo justo antes de lo que hay que verificar.
 */
function functionBody(source: string, declaration: RegExp): string {
  const start = source.search(declaration);
  assert.notEqual(start, -1, `no se encontró ${String(declaration)}`);
  const end = source.indexOf('\n}\n\n', start);
  assert.notEqual(end, -1, 'no se encontró el cierre de la función');
  return source.slice(start, end);
}

/** Quita comentarios TS/JS para comparar CAPACIDAD, no documentación. */
function stripJsComments(raw: string): string {
  return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const MIGRATION_REL = 'supabase/migrations/099_apollo_phone_reveal_cache.sql';

function stripSqlComments(raw: string): string {
  return raw
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

// ── Migración 099 ──────────────────────────────────────────────

describe('CACHE-1b migración 099 — forma de la tabla', () => {
  const sql = stripSqlComments(readRepo(MIGRATION_REL));

  it('la migración existe con el nombre esperado', () => {
    assert.equal(existsSync(join(REPO_ROOT, MIGRATION_REL)), true);
  });

  it('el número 099 no colisiona con otra migración', () => {
    const collisions = readdirSync(join(REPO_ROOT, 'supabase/migrations')).filter(
      (f) => f.startsWith('099_'),
    );
    assert.deepEqual(collisions, ['099_apollo_phone_reveal_cache.sql']);
  });

  it('crea la tabla phone_reveal_cache de forma idempotente', () => {
    assert.match(sql, /CREATE TABLE IF NOT EXISTS\s+public\.phone_reveal_cache/i);
  });

  it('el proveedor está restringido a apollo (sin Lusha)', () => {
    assert.match(sql, /CHECK\s*\(provider IN \('apollo'\)\)/i);
  });

  it('solo un reveal pagado es cacheable: phone_source restringido', () => {
    // El CHECK de la CACHÉ admite exactamente un valor: apollo_reveal. (El CHECK
    // de `contacts`, más abajo en la misma migración, es otro y sí es ancho.)
    assert.match(
      sql,
      /phone_reveal_cache_phone_source_check\s*CHECK\s*\(phone_source IN \('apollo_reveal'\)\)/i,
    );
  });

  it('account_id y country_code son NOT NULL (alcance obligatorio)', () => {
    assert.match(sql, /account_id\s+uuid\s+NOT NULL/i);
    assert.match(sql, /country_code\s+text\s+NOT NULL/i);
  });

  it('country_code solo admite ISO-2 en mayúsculas', () => {
    assert.match(sql, /country_code\s*~\s*'\^\[A-Z\]\{2\}\$'/i);
  });

  it('la unicidad está scoped por cuenta (no hay fila cross-account)', () => {
    assert.match(
      sql,
      /CREATE UNIQUE INDEX IF NOT EXISTS[\s\S]*?\(provider,\s*provider_person_id,\s*account_id\)/i,
    );
  });

  it('el índice de lectura activa excluye suprimidas y sin teléfono', () => {
    assert.match(sql, /WHERE suppressed_at IS NULL AND normalized_phone IS NOT NULL/i);
  });

  it('una fila suprimida no puede conservar teléfono (CHECK)', () => {
    assert.match(sql, /phone_reveal_cache_suppressed_is_phone_free/i);
    assert.match(
      sql,
      /suppressed_at IS NULL\s*OR\s*\(normalized_phone IS NULL AND phone_type IS NULL\)/i,
    );
  });

  it('un tombstone siempre lleva motivo', () => {
    assert.match(sql, /suppressed_at IS NULL OR suppression_reason IS NOT NULL/i);
  });

  it('la tabla tiene RLS habilitada y solo política de service_role', () => {
    assert.match(sql, /ALTER TABLE public\.phone_reveal_cache ENABLE ROW LEVEL SECURITY/i);
    assert.match(sql, /FOR ALL TO service_role/i);
    assert.equal(/TO authenticated/i.test(sql), false);
    assert.equal(/TO anon/i.test(sql), false);
  });
});

describe('CACHE-1b migración 099 — sin datos, sin backfill, sin PII', () => {
  const sql = stripSqlComments(readRepo(MIGRATION_REL));

  it('no inserta ninguna fila (la caché arranca vacía)', () => {
    assert.equal(/\bINSERT\s+INTO\b/i.test(sql), false);
  });

  it('no hace backfill ni UPDATE de datos existentes', () => {
    assert.equal(/\bUPDATE\s+public\./i.test(sql), false);
  });

  it('no es destructiva (sin DROP TABLE/COLUMN, DELETE, TRUNCATE)', () => {
    assert.equal(/\bDROP\s+(TABLE|COLUMN)\b/i.test(sql), false);
    assert.equal(/\bDELETE\s+FROM\b/i.test(sql), false);
    assert.equal(/\bTRUNCATE\b/i.test(sql), false);
  });

  it('no contiene teléfonos, emails ni URLs de LinkedIn de ejemplo', () => {
    assert.equal(/\+\d{7,}/.test(sql), false);
    assert.equal(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(sql), false);
    assert.equal(/linkedin\.com/i.test(sql), false);
  });

  it('la tabla de caché no admite Lusha por ninguna vía', () => {
    // `lusha_reveal` solo puede aparecer en el CHECK de `contacts`, que este
    // hito reemplaza conservando el vocabulario preexistente. Todo lo que
    // define la CACHÉ (antes de ese bloque) debe estar libre de Lusha.
    const contactsConstraintAt = sql.search(/ADD CONSTRAINT contacts_phone_source_check/i);
    assert.notEqual(contactsConstraintAt, -1);
    // `COMMENT ON` es documentación, no capacidad: se excluye del análisis.
    const cacheSection = sql
      .slice(0, contactsConstraintAt)
      .replace(/COMMENT ON[\s\S]*?;/gi, '');
    assert.equal(/lusha/i.test(cacheSection), false);

    // El único valor Lusha de toda la migración es el legado de `contacts`.
    const ddl = sql.replace(/COMMENT ON[\s\S]*?;/gi, '');
    const mentions = [...ddl.matchAll(/lusha\w*/gi)].map((m) => m[0].toLowerCase());
    assert.deepEqual([...new Set(mentions)], ['lusha_reveal']);
  });

  it('el único constraint preexistente que toca es contacts_phone_source_check', () => {
    const dropped = [...sql.matchAll(/DROP CONSTRAINT\s+([a-z0-9_]+)/gi)].map((m) =>
      m[1].toLowerCase(),
    );
    assert.deepEqual(dropped, ['contacts_phone_source_check']);
  });

  it('el CHECK de contacts se reemplaza por uno más ancho, con apollo_cache y NOT VALID', () => {
    assert.match(sql, /'apollo_cache'/);
    for (const value of [
      'apollo_search',
      'apollo_reveal',
      'lusha_reveal',
      'provider_payload',
      'manual',
      'unknown',
    ]) {
      assert.match(sql, new RegExp(`'${value}'`));
    }
    assert.match(sql, /ADD CONSTRAINT contacts_phone_source_check[\s\S]*?NOT VALID/i);
  });
});

// ── FIX M5: motivo de supresión = vocabulario cerrado ──────────

describe('CACHE-1b migración 099 — FIX M5 motivo de supresión acotado', () => {
  const sql = stripSqlComments(readRepo(MIGRATION_REL));

  it('suppression_reason está restringido por CHECK a la allowlist', () => {
    assert.match(sql, /phone_reveal_cache_suppression_reason_check/);
    for (const code of PHONE_CACHE_SUPPRESSION_REASON_CODES) {
      assert.match(sql, new RegExp(`'${code}'`), `falta el código ${code}`);
    }
  });

  it('el vocabulario del CHECK de la caché y el del core coinciden', () => {
    const block = sql.match(
      /phone_reveal_cache_suppression_reason_check[\s\S]*?\)\s*\)/,
    );
    assert.ok(block, 'no se encontró el CHECK del motivo');
    const codes = [...(block[0].matchAll(/'([a-z_]+)'/g))].map((m) => m[1]).sort();
    assert.deepEqual(codes, [...PHONE_CACHE_SUPPRESSION_REASON_CODES].sort());
  });
});

// ── FIX H3: auditoría durable sin PII ──────────────────────────

describe('CACHE-1b migración 099 — FIX H3 tabla de auditoría durable', () => {
  const sql = stripSqlComments(readRepo(MIGRATION_REL));

  it('crea phone_reveal_suppression_audit de forma idempotente', () => {
    assert.match(
      sql,
      /CREATE TABLE IF NOT EXISTS\s+public\.phone_reveal_suppression_audit/i,
    );
    assert.equal(PHONE_CACHE_SUPPRESSION_AUDIT_TABLE, 'phone_reveal_suppression_audit');
  });

  it('el person id solo cabe hasheado (SHA-256 hex, 64 chars)', () => {
    assert.match(sql, /provider_person_id_hash\s+text\s+NOT NULL/i);
    assert.match(sql, /provider_person_id_hash\s*~\s*'\^\[0-9a-f\]\{64\}\$'/i);
  });

  it('no existe ninguna columna capaz de guardar PII', () => {
    const table = sql.slice(
      sql.search(/CREATE TABLE IF NOT EXISTS\s+public\.phone_reveal_suppression_audit/i),
    );
    const definition = table.slice(0, table.indexOf(');'));
    for (const banned of [
      'phone',
      'email',
      'linkedin',
      'full_name',
      'first_name',
      'last_name',
      'raw',
    ]) {
      assert.equal(
        new RegExp(`^\\s*${banned}`, 'im').test(definition),
        false,
        `la auditoría no debe tener columna ${banned}`,
      );
    }
    // `provider_person_id` en claro tampoco: solo el hash.
    assert.equal(/provider_person_id\s+text/i.test(definition), false);
  });

  it('reason_code usa la misma allowlist cerrada', () => {
    assert.match(sql, /phone_reveal_suppression_audit_reason_code_check/);
  });

  it('registra conteos y si el tombstone se creó de cero', () => {
    for (const column of [
      'candidates_cleared',
      'contacts_cleared',
      'cache_rows_suppressed',
      'tombstone_created',
    ]) {
      assert.match(sql, new RegExp(column), `falta la columna ${column}`);
    }
  });

  it('la auditoría es service-role only (RLS habilitada, sin authenticated)', () => {
    assert.match(
      sql,
      /ALTER TABLE public\.phone_reveal_suppression_audit ENABLE ROW LEVEL SECURITY/i,
    );
    assert.match(sql, /service_role_all_phone_reveal_suppression_audit/);
  });
});

// ── Vocabularios ───────────────────────────────────────────────

describe('CACHE-1b — apollo_cache en todos los vocabularios', () => {
  it('PhoneSource incluye apollo_cache', () => {
    const src = readRepo(
      'src/server/agents/contact-enrichment-toolkit/phone-classification.ts',
    );
    assert.match(src, /export type PhoneSource =[\s\S]*?'apollo_cache'/);
  });

  it('ContactPhoneSource incluye apollo_cache', () => {
    const src = readRepo('src/modules/contacts/types.ts');
    assert.match(src, /export type ContactPhoneSource =[\s\S]*?'apollo_cache'/);
  });

  it('la allowlist de aprobación conserva apollo_cache hacia el contacto oficial', () => {
    const src = readRepo('src/modules/contact-enrichment/candidate-review-core.ts');
    assert.match(src, /ALLOWED_PHONE_SOURCES[\s\S]*?'apollo_cache'/);
  });

  it('la UI etiqueta el reuso de forma explícita', () => {
    const src = readRepo(
      'src/components/contact-enrichment/contact-candidate-detail-sheet.tsx',
    );
    assert.match(src, /apollo_cache:\s*'Apollo reveal reutilizado'/);
  });
});

// ── Feature flag ───────────────────────────────────────────────

describe('CACHE-1b — feature flag OFF por defecto', () => {
  it('el flag se llama ENABLE_APOLLO_PHONE_CACHE y es server-only', () => {
    assert.equal(APOLLO_PHONE_CACHE_FLAG, 'ENABLE_APOLLO_PHONE_CACHE');
    assert.equal(APOLLO_PHONE_CACHE_FLAG.startsWith('NEXT_PUBLIC_'), false);
  });

  it('sin la env definida el flag está apagado (fail-closed)', () => {
    const previous = process.env[APOLLO_PHONE_CACHE_FLAG];
    delete process.env[APOLLO_PHONE_CACHE_FLAG];
    try {
      assert.equal(isApolloPhoneCacheEnabled(), false);
    } finally {
      if (previous !== undefined) process.env[APOLLO_PHONE_CACHE_FLAG] = previous;
    }
  });

  it('solo el literal "true" lo enciende', () => {
    const previous = process.env[APOLLO_PHONE_CACHE_FLAG];
    try {
      for (const value of ['false', '1', 'yes', 'TRUE ', '']) {
        process.env[APOLLO_PHONE_CACHE_FLAG] = value;
        assert.equal(
          isApolloPhoneCacheEnabled(),
          value.trim().toLowerCase() === 'true',
          `valor inesperado para "${value}"`,
        );
      }
    } finally {
      if (previous === undefined) delete process.env[APOLLO_PHONE_CACHE_FLAG];
      else process.env[APOLLO_PHONE_CACHE_FLAG] = previous;
    }
  });

  it('el flag no se activa en ningún archivo del repo', () => {
    const envFiles = ['.env.example', '.env.local.example'].filter((f) =>
      existsSync(join(REPO_ROOT, f)),
    );
    for (const file of envFiles) {
      assert.equal(
        /ENABLE_APOLLO_PHONE_CACHE\s*=\s*true/i.test(readRepo(file)),
        false,
        `${file} no debe activar el flag`,
      );
    }
  });
});

// ── Sin Lusha, sin bulk, sin PII ───────────────────────────────

const CACHE_MODULES = [
  'src/modules/contact-enrichment/phone-cache-core.ts',
  'src/modules/contact-enrichment/phone-cache-store.ts',
  'src/modules/contact-enrichment/phone-cache-suppression-core.ts',
  'src/modules/contact-enrichment/phone-cache-suppression-actions.ts',
  // FIX 5 — monitoreo de las supresiones no evaluables. Entra aquí para heredar
  // los tres guards de este bloque: sin Lusha, sin bulk y sin PII en console.
  'src/modules/contact-enrichment/phone-suppression-monitoring-core.ts',
  'src/modules/contact-enrichment/phone-suppression-monitoring-queries.ts',
];

describe('CACHE-1b — sin Lusha', () => {
  it('ningún módulo de caché importa nada de Lusha', () => {
    for (const rel of CACHE_MODULES) {
      const src = readRepo(rel);
      const imports = [...src.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
      for (const spec of imports) {
        assert.equal(/lusha/i.test(spec), false, `${rel} importa ${spec}`);
      }
    }
  });

  it('el core declara Apollo como único proveedor cacheable', () => {
    const src = readRepo('src/modules/contact-enrichment/phone-cache-core.ts');
    assert.match(src, /PHONE_CACHE_PROVIDER = 'apollo'/);
  });
});

describe('CACHE-1b — sin bulk', () => {
  it('no existe ninguna ruta de API de caché de teléfonos', () => {
    const apiRoot = join(REPO_ROOT, 'src/app/api');
    const stack = [apiRoot];
    const found: string[] = [];
    while (stack.length > 0) {
      const dir = stack.pop() as string;
      for (const item of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, item.name);
        if (item.isDirectory()) stack.push(full);
        // Relativo al repo: la ruta absoluta contiene el nombre del worktree y
        // produciría falsos positivos.
        else if (/phone-?cache/i.test(full.slice(apiRoot.length))) found.push(full);
      }
    }
    assert.deepEqual(found, []);
  });

  it('las acciones de caché reciben un único candidato/persona, nunca arrays', () => {
    const suppression = readRepo(
      'src/modules/contact-enrichment/phone-cache-suppression-actions.ts',
    );
    assert.equal(/candidateIds\s*:\s*string\[\]/.test(suppression), false);
    assert.equal(/providerPersonIds/.test(suppression), false);
    assert.equal(/\bbulk\b/i.test(suppression.replace(/NO bulk|no bulk/gi, '')), false);
  });
});

describe('CACHE-1b — los módulos de caché no imprimen PII', () => {
  it('ningún console.* incluye teléfono, email, nombre o linkedin', () => {
    for (const rel of CACHE_MODULES) {
      const src = readRepo(rel);
      const consoleCalls = [...src.matchAll(/console\.\w+\(([^\n]*)\)/g)].map((m) => m[1]);
      for (const call of consoleCalls) {
        for (const banned of [
          'normalizedPhone',
          'normalized_phone',
          'phone,',
          'email',
          'linkedin',
          'full_name',
          'providerPersonId',
        ]) {
          assert.equal(
            call.includes(banned),
            false,
            `${rel}: console.* no debe imprimir ${banned} → ${call}`,
          );
        }
      }
    }
  });

  it('el usage-log del hit publica el person id solo hasheado', () => {
    const src = readRepo('src/modules/contact-enrichment/phone-cache-core.ts');
    assert.match(src, /provider_person_id_hash:\s*string/);
    assert.equal(/provider_person_id:\s*string;/.test(src.split('PhoneCacheHitUsageLogEntry')[1] ?? ''), false);
  });
});

// ── FIX H4-b: los efectos posteriores al hit no pueden lanzar ───
// El fast path decide el hit y DESPUÉS ejecuta tres efectos (persistir, usage-log,
// telemetría). Si alguno propaga la excepción, escapa del server action y termina
// en 500 — sin decirle al operador que no se llamó a Apollo ni se cobró nada. Este
// guard congela la forma: los tres van dentro de try, y ninguno vuelve a quedar
// como un `await deps.<efecto>(...)` desnudo.

describe('CACHE-1b — FIX H4-b efectos del cache hit acotados', () => {
  const core = readRepo('src/modules/contact-enrichment/phone-reveal-core.ts');

  /** Bloque completo del fast path, para no mirar el resto del core. */
  const fastPath =
    core.split('async function tryServeFromPhoneCache')[1]?.split(
      '\n// ── Constructor del log de uso',
    )[0] ?? '';

  it('el fast path existe y se puede inspeccionar', () => {
    assert.notEqual(fastPath, '', 'no se encontró tryServeFromPhoneCache');
  });

  it('ningún efecto del hit queda como await desnudo (sin try)', () => {
    for (const dep of ['persistCacheHit', 'logCacheHitUsage', 'touchPhoneCacheEntry']) {
      const calls = [...fastPath.matchAll(new RegExp(`deps\\.${dep}\\(`, 'g'))];
      assert.equal(calls.length, 1, `${dep} debe invocarse exactamente una vez`);
      // La invocación tiene que estar precedida por un `try {` sin `}` de cierre
      // intermedio en las líneas inmediatamente anteriores.
      const before = fastPath.slice(0, calls[0]?.index ?? 0);
      const lastTry = before.lastIndexOf('try {');
      assert.notEqual(lastTry, -1, `${dep} no está dentro de un try`);
      assert.equal(
        before.slice(lastTry).includes('} catch'),
        false,
        `${dep} quedó fuera del try (hay un catch intermedio)`,
      );
    }
  });

  it('un fallo de persistencia devuelve estado seguro y NO llama a Apollo', () => {
    assert.match(fastPath, /errorCode: 'cache_persist_failed'/);
    assert.match(fastPath, /status: 'cache_unavailable'/);
    // El return del catch corta el fast path: nunca cae al START de Apollo.
    const persistCatch =
      fastPath.split('deps.persistCacheHit(')[1]?.split('}\n')[0] ?? '';
    assert.equal(/startRevealViaApollo/.test(persistCatch), false);
  });

  it('los notificadores reciben un mensaje redactado, nunca el error crudo', () => {
    for (const notifier of [
      'onCacheLookupUnavailable',
      'onCacheHitPersistFailed',
      'onCacheHitUsageLogFailed',
    ]) {
      assert.match(
        fastPath,
        new RegExp(`deps\\.${notifier}\\?\\.\\(redactDriverMessage\\(err\\)\\)`),
        `${notifier} debe pasar por redactDriverMessage`,
      );
    }
    // Y el core no vuelve a filtrar `err.message` en claro dentro del fast path.
    assert.equal(/err\.message/.test(fastPath), false);
  });

  it('el redactor borra teléfono, email, id de persona y linkedin', () => {
    const redactor = core.split('function redactDriverMessage')[1]?.split('\n}')[0] ?? '';
    assert.notEqual(redactor, '', 'falta redactDriverMessage');
    assert.match(redactor, /redacted-email/);
    assert.match(redactor, /redacted-number/);
    assert.match(redactor, /redacted-id/);
    assert.match(redactor, /redacted-url/);
  });
});

// ── FIX B2: la acción crea el tombstone cuando no había fila ────
// El core construye la fila; lo que solo se puede comprobar en la acción es el
// cableado: que el upsert se ejecute cuando el UPDATE no tocó nada, y que su
// clave de conflicto sea EXACTAMENTE la única de la migración 099 (si divergen,
// una DSAR sobre caché vacía fallaría en runtime en vez de bloquear).

describe('CACHE-1b — FIX B2 tombstone insertado por la acción', () => {
  const suppression = readRepo(
    'src/modules/contact-enrichment/phone-cache-suppression-actions.ts',
  );
  const ONCONFLICT = 'provider,provider_person_id,account_id';

  it('inserta la fila de tombstone que construyó el core', () => {
    assert.match(suppression, /\.upsert\(tombstone\.tombstoneInsertRow,/);
  });

  it('solo inserta cuando el UPDATE del tombstone no tocó ninguna fila', () => {
    const guardAt = suppression.search(/if \(cacheEntriesSuppressed === 0\) \{/);
    const upsertAt = suppression.search(/\.upsert\(tombstone\.tombstoneInsertRow,/);
    assert.notEqual(guardAt, -1, 'falta el guard de "no había fila de caché"');
    assert.ok(guardAt < upsertAt, 'el upsert debe estar dentro del guard');
  });

  it('la clave de conflicto coincide con la única de la migración 099', () => {
    assert.match(suppression, new RegExp(`onConflict:\\s*'${ONCONFLICT}'`));
    const sql = stripSqlComments(readRepo(MIGRATION_REL));
    const unique = sql.match(
      /CREATE UNIQUE INDEX[\s\S]*?ON public\.phone_reveal_cache\s*\(([^)]*)\)/,
    );
    assert.ok(unique, 'no se encontró el índice único de la caché');
    const columns = unique[1]
      .split(',')
      .map((c) => c.trim())
      .join(',');
    assert.equal(columns, ONCONFLICT);
  });

  it('tombstoneCreated se deriva de lo que la DB reportó, no del plan', () => {
    assert.match(suppression, /tombstoneCreated = cacheEntriesSuppressed > 0/);
  });

  it('un fallo al insertar el tombstone no se reporta como éxito', () => {
    assert.match(suppression, /suppression tombstone insert failed/);
    assert.match(suppression, /return failed\('cache_tombstone_failed'\)/);
  });
});

// ── FIX M4: sin filtro JSON path no probado ────────────────────

describe('CACHE-1b — FIX M4 descubrimiento de contactos sin filtro JSON', () => {
  const suppression = readRepo(
    'src/modules/contact-enrichment/phone-cache-suppression-actions.ts',
  );

  it('no usa `metadata->>source_candidate_id` como filtro de PostgREST', () => {
    assert.equal(/metadata->>/.test(suppression), false);
  });

  it('descubre los contactos por id (columna real, indexada)', () => {
    assert.match(suppression, /\.in\('id',\s*linkedContactIds\)/);
    assert.match(suppression, /\.eq\('account_id',\s*tombstone\.accountId\)/);
  });

  it('el UPDATE de contacts repite el filtro de procedencia (FIX M1)', () => {
    assert.match(
      suppression,
      /\.in\('phone_source',\s*\['apollo_reveal',\s*'apollo_cache'\]\)/,
    );
  });

  it('el UPDATE de contacts sigue acotado por cuenta', () => {
    // El UPDATE de contacts y la lectura previa usan la MISMA cuenta validada.
    const updateBlock = suppression.match(
      /\.from\('contacts'\)\s*\n\s*\.update\(patch\)([\s\S]*?)\.select\('id'\)/,
    );
    assert.ok(updateBlock, 'no se encontró el UPDATE de contacts');
    assert.match(updateBlock[1], /\.eq\('account_id',\s*tombstone\.accountId\)/);
  });

  it('el tombstone se escribe ANTES de leer candidatos o contactos', () => {
    const tombstoneAt = suppression.search(/\.update\(tombstone\.cacheEntryPatch\)/);
    const candidateReadAt = suppression.search(
      /\.eq\('apollo_person_id',\s*tombstone\.providerPersonId\)/,
    );
    const contactReadAt = suppression.search(/\.in\('id',\s*linkedContactIds\)/);
    assert.notEqual(tombstoneAt, -1);
    assert.ok(tombstoneAt < candidateReadAt, 'el tombstone debe precederse a la lectura de candidatos');
    assert.ok(tombstoneAt < contactReadAt, 'el tombstone debe precederse a la lectura de contactos');
  });

  it('un fallo de lectura de candidatos/contactos NO impide el tombstone', () => {
    // Las lecturas registran failureCode en vez de lanzar, así que el tombstone
    // ya escrito sobrevive y la supresión se reporta como incompleta.
    assert.match(suppression, /suppression candidate read failed/);
    assert.match(suppression, /suppression contact read failed/);
    assert.equal(/throw new Error\(candidateError\.message\)/.test(suppression), false);
    assert.equal(/throw new Error\(contactError\.message\)/.test(suppression), false);
  });
});

// ── FIX H3: la auditoría durable se intenta SIEMPRE y su fallo no rompe ──
// El contrato de la fila (hash, motivo, conteos, sin PII) está probado en
// phone-cache-suppression-1b.test.ts sobre el core puro. Lo que solo se puede
// comprobar en la acción es la DURABILIDAD: que se inserte en la tabla, que se
// intente incluso tras un fallo parcial, y que un error de auditoría no lance.

describe('CACHE-1b — FIX H3 auditoría durable en la acción', () => {
  const suppression = readRepo(
    'src/modules/contact-enrichment/phone-cache-suppression-actions.ts',
  );

  it('la auditoría se INSERTA en la tabla durable, no solo se imprime', () => {
    assert.match(
      suppression,
      /\.from\(PHONE_CACHE_SUPPRESSION_AUDIT_TABLE\)\s*\n?\s*\.insert\(auditRow\)/,
    );
    // El nombre de la tabla viene del core, nunca de un literal suelto.
    assert.equal(
      suppression.includes(`'${PHONE_CACHE_SUPPRESSION_AUDIT_TABLE}'`),
      false,
      'la tabla de auditoría debe referenciarse por la constante del core',
    );
  });

  it('la supresión no deja console.info como única evidencia DSAR', () => {
    assert.equal(/console\.info/.test(suppression), false);
  });

  it('los conteos auditados son los reales, no las longitudes del plan', () => {
    const call = suppression.match(
      /buildPhoneCacheSuppressionAuditRow\(\{([\s\S]*?)\}\);/,
    );
    assert.ok(call, 'no se encontró la construcción de la fila de auditoría');
    assert.match(call[1], /candidatesCleared,/);
    assert.match(call[1], /contactsCleared,/);
    assert.match(call[1], /hashProviderPersonId\(tombstone\.providerPersonId\)/);
    // Nunca `plan.candidatePatches.length` / `plan.contactPatches.length`.
    assert.equal(/PatchesableLength|Patches\.length/.test(call[1]), false);
  });

  it('la auditoría se intenta también tras un fallo parcial (sin return previo)', () => {
    const clearsAt = suppression.search(/suppression contact clear failed/);
    const auditAt = suppression.search(/buildPhoneCacheSuppressionAuditRow\(\{/);
    assert.notEqual(clearsAt, -1);
    assert.notEqual(auditAt, -1);
    assert.ok(clearsAt < auditAt, 'la auditoría debe ir después de los borrados');
    // Entre el último borrado y la auditoría no puede haber un `return`: si lo
    // hubiera, una supresión parcial se quedaría sin constancia.
    const between = suppression.slice(clearsAt, auditAt);
    assert.equal(/\n\s*return /.test(between), false);
  });

  it('un fallo de auditoría no lanza: se reporta como audit_write_failed', () => {
    assert.match(suppression, /suppression audit write failed/);
    assert.match(suppression, /auditPersisted = false/);
    assert.match(suppression, /'audit_write_failed'/);
    assert.equal(/throw new Error\(auditError\.message\)/.test(suppression), false);
  });
});

// ── FIX H2: la UI mapea los estados nuevos ─────────────────────

describe('CACHE-1b — FIX H2 estados nuevos mapeados en la UI', () => {
  const sheet = readRepo(
    'src/components/contact-enrichment/contact-candidate-detail-sheet.tsx',
  );

  /** Cuerpo de un `case '<status>':` dentro de applyPhoneRevealResult. */
  function caseBody(status: string): string {
    const match = sheet.match(
      new RegExp(`case '${status}':([\\s\\S]*?)return;`),
    );
    return match ? match[1] : '';
  }

  it('revealed_from_cache es un caso explícito, no cae en el default de error', () => {
    const body = caseBody('revealed_from_cache');
    assert.notEqual(body, '', 'falta el case revealed_from_cache');
    assert.equal(/setPhoneRevealError/.test(body), false);
  });

  it('revealed_from_cache muestra éxito y recarga el candidato', () => {
    const body = caseBody('revealed_from_cache');
    assert.match(body, /toast\.success/);
    assert.match(body, /reloadCandidate\(\)/);
  });

  it('blocked_suppressed explica la supresión y no es un fallo genérico', () => {
    const body = caseBody('blocked_suppressed');
    assert.notEqual(body, '', 'falta el case blocked_suppressed');
    assert.match(body, /supresión registrada/);
    assert.equal(/reloadCandidate\(\)/.test(body), false);
  });

  it('cache_unavailable da un mensaje operativo seguro y reintentable', () => {
    const body = caseBody('cache_unavailable');
    assert.notEqual(body, '', 'falta el case cache_unavailable');
    assert.match(body, /setPhoneRevealError/);
    assert.match(body, /intenta de nuevo/i);
  });

  it('suppression_check_unavailable es explícito, seguro y reintentable (FIX 2)', () => {
    const body = caseBody('suppression_check_unavailable');
    assert.notEqual(body, '', 'falta el case suppression_check_unavailable');
    assert.match(body, /setPhoneRevealError/);
    assert.match(body, /supresión/i);
    assert.match(body, /intenta de nuevo/i);
    // No es un éxito: no recarga el candidato ni muestra un toast de éxito.
    assert.equal(/reloadCandidate\(\)/.test(body), false);
    assert.equal(/toast\.success/.test(body), false);
  });

  it('los mensajes nuevos no exponen teléfono, email ni linkedin', () => {
    for (const status of [
      'revealed_from_cache',
      'blocked_suppressed',
      'cache_unavailable',
      'suppression_check_unavailable',
    ]) {
      const body = caseBody(status);
      for (const banned of ['phoneNumber', 'phoneMeta?.number', 'email', 'linkedin']) {
        assert.equal(
          body.includes(banned),
          false,
          `el case ${status} no debe exponer ${banned}`,
        );
      }
    }
  });
});

// ── FIX 1: la supresión de contacts exige procedencia probada ────

describe('CACHE-1b — FIX 1 solo procedencia creado/promovido borra contacts', () => {
  const core = readRepo(
    'src/modules/contact-enrichment/phone-cache-suppression-core.ts',
  );
  const actions = readRepo(
    'src/modules/contact-enrichment/phone-cache-suppression-actions.ts',
  );

  it('el nivel `strong_duplicate` ya no existe en el core', () => {
    // Ni en el código ni en los comentarios: la documentación no debe seguir
    // afirmando que un duplicado fuerte es erase-safe.
    assert.equal(/strong_duplicate/.test(core), false);
    assert.equal(/strong_duplicate/.test(actions), false);
  });

  it('la fuerza del vínculo solo admite provenance_proven o weak', () => {
    const union = core.match(
      /export type CandidateContactLinkStrength =([\s\S]*?);/,
    );
    assert.ok(union, 'no se encontró el tipo de fuerza de vínculo');
    const values = [...union[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    assert.deepEqual(values, ['provenance_proven', 'weak']);
  });

  it('la decisión de borrado NO lee evidencia de duplicado', () => {
    // duplicate_status / matched_by ya no participan: identifican a la persona,
    // no demuestran que este candidato pusiera el teléfono en esa fila.
    const code = stripJsComments(core);
    assert.equal(/duplicateStatus/.test(code), false);
    assert.equal(/matchedBy/.test(code), false);
    assert.equal(/exact_duplicate/.test(code), false);
    assert.equal(/possible_duplicate/.test(code), false);
  });

  it('la acción tampoco consulta duplicate_status ni matched_by en la DB', () => {
    // Se comparan solo instrucciones: los comentarios explican qué dejó de
    // leerse y mencionarlo ahí no es una capacidad.
    const code = stripJsComments(actions);
    assert.equal(/duplicate_status/.test(code), false);
    assert.equal(/matched_by/.test(code), false);
  });

  it('el resolver exige metadata.source_candidate_id del propio contacto', () => {
    const body = functionBody(
      core,
      /export function resolveContactErasureProvenance\(/,
    );
    assert.match(body, /sourceCandidateId/);
    assert.match(body, /suppressedCandidateIds\.has\(sourceCandidateId\)/);
  });

  it('sigue sin existir matching difuso por teléfono, email o nombre', () => {
    // Solo construcciones de código: `fuzzy` aparece en la prosa que explica
    // precisamente que NO se usa, así que buscarlo daría un falso positivo.
    for (const banned of ['levenshtein', 'similarity', '\\.ilike\\(', '\\.like\\(']) {
      assert.equal(
        new RegExp(banned, 'i').test(core + actions),
        false,
        `no debe aparecer ${banned}`,
      );
    }
  });
});

// ── FIX 2: la supresión no depende del flag de caché ────────────

describe('CACHE-1b — FIX 2 el tombstone se comprueba con el flag apagado', () => {
  const revealActions = readRepo(
    'src/modules/contact-enrichment/phone-reveal-actions.ts',
  );
  const revealCore = readRepo('src/modules/contact-enrichment/phone-reveal-core.ts');
  const store = readRepo('src/modules/contact-enrichment/phone-cache-store.ts');

  it('el wrapper cablea la comprobación SIEMPRE, no detrás del flag', () => {
    assert.match(revealActions, /lookupPhoneCacheSuppression:\s*readPhoneCacheSuppression/);
    // El flag solo alimenta `cacheEnabled` (reutilización), nunca la supresión.
    const flagUses = [...revealActions.matchAll(/isApolloPhoneCacheEnabled\(\)/g)];
    assert.equal(flagUses.length, 1);
    assert.match(revealActions, /cacheEnabled:\s*isApolloPhoneCacheEnabled\(\)/);
  });

  it('la comprobación corre ANTES del fast path de caché y de Apollo', () => {
    const suppressionAt = revealCore.search(/enforcePhoneRevealSuppression\(\{/);
    const cacheAt = revealCore.search(/tryServeFromPhoneCache\(\{/);
    const apolloAt = revealCore.search(/await deps\.startRevealViaApollo/);
    assert.notEqual(suppressionAt, -1);
    assert.ok(suppressionAt < cacheAt, 'la supresión debe preceder al fast path');
    assert.ok(suppressionAt < apolloAt, 'la supresión debe preceder a Apollo');
  });

  it('la comprobación NO está condicionada por cacheEnabled', () => {
    const body = functionBody(
      revealCore,
      /async function enforcePhoneRevealSuppression\(/,
    );
    // Sanity: el cuerpo capturado llega hasta el final real de la función.
    assert.match(body, /return null;/);
    assert.equal(/cacheEnabled/.test(body), false);
  });

  it('la lectura del tombstone no pide el teléfono (flag OFF ⇒ 0 números leídos)', () => {
    const body = functionBody(
      store,
      /export async function readPhoneCacheSuppression\(/,
    );
    assert.match(body, /\.select\('suppressed_at'\)/);
    assert.equal(/normalized_phone/.test(body), false);
    assert.equal(/phone_type/.test(body), false);
  });

  it('la clave del tombstone no incluye país (no se puede esquivar por país)', () => {
    const key = revealCore.match(/export interface PhoneCacheSuppressionLookupKey/);
    assert.equal(key, null, 'la clave vive en phone-cache-core, no en el reveal');
    const cacheCore = readRepo('src/modules/contact-enrichment/phone-cache-core.ts');
    const block = cacheCore.match(
      /export interface PhoneCacheSuppressionLookupKey \{([\s\S]*?)\}/,
    );
    assert.ok(block, 'no se encontró PhoneCacheSuppressionLookupKey');
    assert.equal(/countryCode/.test(block[1]), false);
    assert.match(block[1], /providerPersonId/);
    assert.match(block[1], /accountId/);
  });

  it('un fallo de la comprobación no puede degradar a "no suprimido"', () => {
    const body = functionBody(
      revealCore,
      /async function enforcePhoneRevealSuppression\(/,
    );
    // El catch devuelve el estado seguro; nunca `return null` (que continuaría).
    assert.match(body, /catch[\s\S]*?return unavailable\(/);
    assert.match(body, /suppression_check_unavailable/);
    // Y la dep ausente también corta: no hay reveal sin comprobar la supresión.
    assert.match(body, /if \(!deps\.lookupPhoneCacheSuppression\)[\s\S]*?return unavailable\(/);
  });

  // FIX H4-c: el catch reenviaba `err.message` en claro al notificador. Postgres
  // cita los valores de la query en sus errores, así que ese mensaje podía llevar
  // el providerPersonId (o PII de una fila vecina) hasta el log.
  it('el fallo de la comprobación se redacta con el redactor compartido (H4-c)', () => {
    const body = functionBody(
      revealCore,
      /async function enforcePhoneRevealSuppression\(/,
    );
    assert.match(body, /return unavailable\(redactDriverMessage\(err\)\)/);
    // Ningún error crudo sobrevive en el bloque de supresión.
    assert.equal(/err\.message/.test(body), false);
    assert.equal(/error\.message/.test(body), false);
  });

  it('la acción de supresión sigue sin estar gateada por el flag de caché', () => {
    const suppression = readRepo(
      'src/modules/contact-enrichment/phone-cache-suppression-actions.ts',
    );
    assert.equal(/isApolloPhoneCacheEnabled/.test(suppression), false);
  });
});
