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

const HERE = dirname(fileURLToPath(import.meta.url));
// __tests__ → contact-enrichment → modules → src → repo root
const REPO_ROOT = join(HERE, '..', '..', '..', '..');
function readRepo(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), 'utf8');
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
