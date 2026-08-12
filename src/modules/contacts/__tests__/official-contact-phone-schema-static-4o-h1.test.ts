/**
 * Static checks on supabase/migrations/114_official_contact_phones.sql
 * (Agente 2A · AGENT2A-PHONE-REVEAL-4O-H1)
 *
 * ═══════════════════════════════════════════════════════════════════
 * WHAT THIS SUITE IS FOR
 * ═══════════════════════════════════════════════════════════════════
 *
 * 114 creates the OFFICIAL multi-phone model and deliberately wires NOTHING. That makes
 * "nothing is wired" the main claim of the hito, and a claim nobody can verify by reading a
 * diff six months from now. So it is pinned here:
 *
 *   * the vocabularies match the TypeScript ones in BOTH directions, so a value can never be
 *     added on one side only and produce a CHECK violation at runtime;
 *   * the suppression vocabulary is 109's, character for character — not a second privacy
 *     taxonomy that would fail the CHECK on every row the way the 23514 of #238 did;
 *   * no cost column, no `account_id`, no DELETE grant, no business trigger, no RPC;
 *   * NO production runtime file reads or writes either table, which is what "inert" means;
 *   * `approveContactCandidate`, `createContact` and `updateContact` are untouched.
 *
 * These tests only read files from disk. They never connect to a database, never call a
 * provider, never spend a credit and never touch Production. The PostgreSQL guarantees —
 * constraints, RLS, grants — are measured in the sibling `…-postgres-4o-h1` suite, because
 * a CHECK is a property of PostgreSQL and only PostgreSQL can demonstrate it.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  CANDIDATE_PHONE_ACQUISITION_MODES,
  CANDIDATE_PHONE_PROVIDERS,
  CANDIDATE_PHONE_STATUSES,
  CANDIDATE_PHONE_TYPE_RANKING,
} from '../../contact-enrichment/phone-collection-core';

const here = dirname(fileURLToPath(import.meta.url));
// __tests__ → contacts → modules → src → repo root
const repoRoot = join(here, '..', '..', '..', '..');
const migrationsDir = join(repoRoot, 'supabase/migrations');
const srcDir = join(repoRoot, 'src');

const MIGRATION_FILE = '114_official_contact_phones.sql';
const MIGRATION_109 = '109_contact_enrichment_candidate_phones.sql';

const PHONES_TABLE = 'public.contact_phones';
const SOURCES_TABLE = 'public.contact_phone_sources';
const BARE_TABLES = ['contact_phones', 'contact_phone_sources'] as const;

const migrationSql = readFileSync(join(migrationsDir, MIGRATION_FILE), 'utf8');
const sql109 = readFileSync(join(migrationsDir, MIGRATION_109), 'utf8');

/** SQL ejecutable: el archivo sin las líneas de comentario `--`. */
function executable(source: string): string {
  return source
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
}

const executableSql = executable(migrationSql);
const executable109 = executable(sql109);

/**
 * SQL ESTRUCTURAL: lo ejecutable menos los `COMMENT ON … IS '…';`, que son prosa dentro de
 * una sentencia. Las aserciones de AUSENCIA ("no hay columna de coste", "no se toca
 * mobile_phone") tienen que leer esto y no lo ejecutable: los COMMENT explican precisamente
 * lo que la tabla NO hace, así que buscar la palabra en ellos hace pasar por infracción a la
 * frase que documenta que no la hay.
 */
const structuralSql = executableSql.replace(/COMMENT ON [\s\S]*?';\n/g, '');

/** Literales de un `CHECK (... IN (...))` leídos del SQL ejecutable. */
function checkVocabulary(source: string, constraintName: string): string[] {
  const statement = source.match(
    new RegExp(`CONSTRAINT ${constraintName}[\\s\\S]*?\\)\\s*[,\\)]`),
  );
  assert.ok(statement, `no se encontró el CHECK ${constraintName}`);
  return [...statement[0].matchAll(/'([a-z_0-9]+)'/g)].map((match) => match[1]);
}

/** Todos los archivos .ts/.tsx de `src`, con su ruta relativa al repo. */
function sourceFiles(): { path: string; body: string }[] {
  const out: { path: string; body: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.tsx?$/.test(entry.name)) {
        out.push({ path: full.slice(repoRoot.length + 1), body: readFileSync(full, 'utf8') });
      }
    }
  };
  walk(srcDir);
  return out;
}

const allSources = sourceFiles();

/** Un archivo es de PRUEBA cuando vive en `__tests__`. Todo lo demás es producción. */
const isTestFile = (path: string) => path.includes('__tests__');
const productionSources = allSources.filter((file) => !isTestFile(file.path));

// ═══════════════════════════════════════════════════════════════════
// Numeración y propiedad del esquema
// ═══════════════════════════════════════════════════════════════════

describe('114 — numeración', () => {
  it('el número 114 es único en supabase/migrations', () => {
    const numbered = readdirSync(migrationsDir).filter(
      (file) => file.endsWith('.sql') && /^114[_-]/.test(file),
    );
    assert.deepEqual(numbered, [MIGRATION_FILE]);
  });

  it('116 es el número más alto del repo', () => {
    // Si otra migración pasara a 115+ sin renumerar esta, dos archivos distintos
    // compartirían orden de aplicación — el defecto que la 109 evitó dejando un hueco.
    //
    // AGENT2A-PHONE-REVEAL-4O-H2 sube el techo a la 115: la PRIVACIDAD de este mismo
    // esquema (dos contadores en `phone_reveal_suppression_audit` y la función
    // `suppress_official_contact_phone_sources`). La 115 NO añade columna, constraint ni
    // índice a `contact_phones` ni a `contact_phone_sources` —el test siguiente sigue
    // exigiendo que la 114 sea su única dueña—, así que el número exacto se mantiene
    // fijado aquí y una migración por encima de la 115 rompe la guarda.
    const numbers = readdirSync(migrationsDir)
      .filter((file) => /^\d{3}[_-].*\.sql$/.test(file))
      .map((file) => Number(file.slice(0, 3)));
    // AGENT2A-PHONE-REVEAL-4O-H3 sube el techo a la 116: la APROBACIÓN atómica del candidato
    // sobre ese mismo esquema oficial (una sola función transaccional, `approve_contact_candidate_with_phones`). La 116 NO añade tabla, columna, constraint, índice ni GRANT:
    // sólo una función, que es lo que la hace retrocompatible con el runtime vivo.
    // AGENT1-MACRO-INDUSTRY-CATALOG-DISCOVERY-1 mueve el techo a la 119: catálogo de
    // Macro Industrias (siembra en `draft` y cutover), sin relación con teléfono.
    assert.equal(Math.max(...numbers), 119);
  });

  it('114 es la ÚNICA dueña de la forma de las dos tablas oficiales', () => {
    // Quien crea las tablas, sus índices, sus CHECK, su RLS y sus privilegios. Se mira DDL
    // y GRANT, no cualquier mención: una migración futura podrá escribir FILAS (eso es para
    // lo que existen), pero no redefinir la forma en otro archivo.
    const DDL = [
      'CREATE TABLE',
      'ALTER TABLE',
      'DROP TABLE',
      'CREATE INDEX',
      'CREATE UNIQUE INDEX',
      'DROP INDEX',
      'CREATE POLICY',
      'DROP POLICY',
      'GRANT',
      'REVOKE',
    ];
    for (const file of readdirSync(migrationsDir).filter((name) => name.endsWith('.sql'))) {
      if (file === MIGRATION_FILE) continue;
      const body = executable(readFileSync(join(migrationsDir, file), 'utf8'));
      for (const table of BARE_TABLES) {
        for (const statement of DDL) {
          const pattern = new RegExp(
            `${statement}[^;]{0,400}?\\bpublic\\.${table}\\b`,
            'i',
          );
          assert.equal(
            pattern.test(body),
            false,
            `${file} contiene "${statement}" sobre public.${table}`,
          );
        }
      }
    }
  });

  it('no edita las migraciones 109–113', () => {
    // Los encabezados obsoletos de 109/110/111/113 son una deuda declarada y SEPARADA
    // (MIGRATION_HEADERS_STALE_PENDING). Reescribirlos aquí mezclaría dos hitos y borraría
    // el rastro de qué se aplicó cuándo.
    for (const file of ['109', '110', '111', '112', '113']) {
      const found = readdirSync(migrationsDir).find((name) => name.startsWith(`${file}_`));
      assert.ok(found, `falta la migración ${file}`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// Vocabularios — pinneados en AMBAS direcciones
// ═══════════════════════════════════════════════════════════════════

describe('114 — vocabularios', () => {
  it('phone_type = el ranking canónico de PhoneType, sin miembros nuevos', () => {
    const sqlVocab = checkVocabulary(executableSql, 'contact_phones_phone_type_check');
    assert.deepEqual([...sqlVocab].sort(), [...CANDIDATE_PHONE_TYPE_RANKING].sort());
  });

  it('phone_type NO admite el vocabulario coloquial', () => {
    // `home` / `office` / `business` / `personal` son otra manera de decir lo mismo, y una
    // cuarta ortografía del mismo concepto es como dos columnas con el mismo nombre acaban
    // guardando valores distintos.
    const vocab = checkVocabulary(executableSql, 'contact_phones_phone_type_check');
    for (const forbidden of ['home', 'office', 'business', 'personal']) {
      assert.equal(vocab.includes(forbidden), false, `phone_type admite '${forbidden}'`);
    }
  });

  it('phone_status = CANDIDATE_PHONE_STATUSES', () => {
    const sqlVocab = checkVocabulary(executableSql, 'contact_phones_phone_status_check');
    assert.deepEqual([...sqlVocab].sort(), [...CANDIDATE_PHONE_STATUSES].sort());
  });

  it('provider = CANDIDATE_PHONE_PROVIDERS (identidad del proveedor, no procedencia fusionada)', () => {
    const sqlVocab = checkVocabulary(executableSql, 'contact_phone_sources_provider_check');
    assert.deepEqual([...sqlVocab].sort(), [...CANDIDATE_PHONE_PROVIDERS].sort());
  });

  it('provider NO usa el vocabulario escalar heredado de contacts.phone_source', () => {
    // `apollo_reveal` / `apollo_search` / `lusha_reveal` / `provider_payload` fusionan
    // proveedor y modo en un solo string. El valor heredado es DERIVABLE del par
    // (provider, acquisition_mode) — la 112 tiene el mapeo exhaustivo — y la inversa no.
    const vocab = checkVocabulary(executableSql, 'contact_phone_sources_provider_check');
    for (const fused of ['apollo_reveal', 'apollo_search', 'lusha_reveal', 'provider_payload']) {
      assert.equal(vocab.includes(fused), false, `provider admite el fusionado '${fused}'`);
    }
  });

  it('acquisition_mode = CANDIDATE_PHONE_ACQUISITION_MODES, como dimensión separada', () => {
    const sqlVocab = checkVocabulary(
      executableSql,
      'contact_phone_sources_acquisition_mode_check',
    );
    assert.deepEqual([...sqlVocab].sort(), [...CANDIDATE_PHONE_ACQUISITION_MODES].sort());
  });

  it('las dos dimensiones son columnas DISTINTAS', () => {
    assert.match(executableSql, /provider\s+text\s+NOT NULL/);
    assert.match(executableSql, /acquisition_mode\s+text\s+NOT NULL/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Privacidad — UNA sola taxonomía, la de la 109
// ═══════════════════════════════════════════════════════════════════

describe('114 — vocabulario de supresión', () => {
  it('es EXACTAMENTE el de la 109 en las dos tablas', () => {
    const expected = checkVocabulary(
      executable109,
      'contact_enrichment_candidate_phones_suppression_reason_check',
    );
    assert.deepEqual(expected.sort(), [
      'data_subject_request',
      'operator_request',
      'provider_retraction',
    ]);
    for (const constraint of [
      'contact_phones_suppression_reason_check',
      'contact_phone_sources_suppression_reason_check',
    ]) {
      assert.deepEqual(
        checkVocabulary(executableSql, constraint).sort(),
        expected,
        `${constraint} divergió de la 109`,
      );
    }
  });

  it('NO admite el vocabulario de caché/auditoría de la 099', () => {
    // Los dos conjuntos comparten CERO valores: uno dice QUIÉN ejerció la supresión, el
    // otro POR QUÉ se pidió. Un pass-through fallaría el CHECK en cada fila.
    const cacheVocabulary = [
      'dsar_erasure_request',
      'do_not_contact_request',
      'legal_privacy_request',
      'admin_privacy_correction',
      'test_synthetic',
    ];
    for (const constraint of [
      'contact_phones_suppression_reason_check',
      'contact_phone_sources_suppression_reason_check',
    ]) {
      const vocab = checkVocabulary(executableSql, constraint);
      for (const value of cacheVocabulary) {
        assert.equal(vocab.includes(value), false, `${constraint} admite '${value}'`);
      }
    }
  });

  it('la tríada de supresión existe en AMBAS tablas', () => {
    // La de las fuentes es la ADAPTACIÓN sobre la 109 que hace representable la borrada
    // por proveedor sin DELETE. Sin ella, H2 necesitaría columnas nuevas.
    for (const column of ['suppressed_at', 'suppression_reason', 'suppressed_by']) {
      const occurrences = executableSql.split(column).length - 1;
      assert.ok(
        occurrences >= 2,
        `${column} aparece ${occurrences} vez/veces: debe estar en las dos tablas`,
      );
    }
    assert.match(executableSql, /CONSTRAINT contact_phones_suppression_triad_coherent/);
    assert.match(
      executableSql,
      /CONSTRAINT contact_phone_sources_suppression_triad_coherent/,
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// Forma — lo que NO está es la mitad del contrato
// ═══════════════════════════════════════════════════════════════════

describe('114 — forma canónica', () => {
  it('la identidad durable es (contact_id, dedupe_key) y es UNIQUE', () => {
    assert.match(
      executableSql,
      /CONSTRAINT contact_phones_contact_dedupe_key_unique\s+UNIQUE \(contact_id, dedupe_key\)/,
    );
  });

  it('la FK oficial apunta a contacts, NUNCA a un candidato', () => {
    assert.match(
      executableSql,
      /contact_id\s+uuid\s+NOT NULL\s+REFERENCES public\.contacts\(id\) ON DELETE CASCADE/,
    );
    // La tabla canónica no puede colgar de staging: dos candidatos que resuelven a la misma
    // persona dejarían huérfana una colección ya pagada.
    assert.equal(
      /CREATE TABLE IF NOT EXISTS public\.contact_phones \([\s\S]*?\n\);/
        .exec(executableSql)![0]
        .includes('contact_enrichment_candidate'),
      false,
    );
  });

  it('NO hay account_id: la propiedad se deriva del contacto', () => {
    assert.equal(/\baccount_id\b/.test(structuralSql), false);
  });

  it('un solo principal por contacto, con índice UNIQUE parcial', () => {
    assert.match(
      executableSql,
      /CREATE UNIQUE INDEX IF NOT EXISTS contact_phones_one_primary_idx\s+ON public\.contact_phones \(contact_id\)\s+WHERE is_primary;/,
    );
  });

  it('el principal exige número vivo y no inválido', () => {
    const check = executableSql.match(
      /CONSTRAINT contact_phones_primary_requires_live_number[\s\S]*?\),/,
    );
    assert.ok(check);
    assert.match(check[0], /suppressed_at IS NULL/);
    assert.match(check[0], /normalized_phone IS NOT NULL/);
    assert.match(check[0], /phone_status <> 'invalid'/);
  });

  it('el tombstone se queda sin número, sin display, sin tipo y sin principal', () => {
    const check = executableSql.match(/CONSTRAINT contact_phones_tombstone_is_empty[\s\S]*?\),/);
    assert.ok(check);
    for (const cleared of [
      'normalized_phone IS NULL',
      'display_phone IS NULL',
      'phone_type IS NULL',
      'is_primary = false',
    ]) {
      assert.match(check[0], new RegExp(cleared.replace(/[()]/g, '\\$&')));
    }
    // Y conserva la clave: es lo que bloquea la reinserción.
    assert.equal(check[0].includes('dedupe_key IS NULL'), false);
  });

  it('la idempotencia de una procedencia es (contact_phone_id, source_event_key)', () => {
    assert.match(
      executableSql,
      /CONSTRAINT contact_phone_sources_event_key_unique\s+UNIQUE \(contact_phone_id, source_event_key\)/,
    );
  });

  it('el puntero a staging es SET NULL y nunca CASCADE', () => {
    // La fila oficial debe sobrevivir a que staging desaparezca. Con CASCADE, borrar un
    // candidato borraría la procedencia de un número ya pagado.
    assert.match(
      executableSql,
      /candidate_phone_id\s+uuid\s+NULL\s+REFERENCES public\.contact_enrichment_candidate_phones\(id\) ON DELETE SET NULL/,
    );
  });

  it('los punteros de contabilidad son nullable y SET NULL', () => {
    for (const [column, table] of [
      ['waterfall_run_id', 'phone_reveal_waterfall_runs'],
      ['reservation_id', 'phone_reveal_credit_reservations'],
      ['provider_usage_log_id', 'provider_usage_logs'],
    ] as const) {
      assert.match(
        executableSql,
        new RegExp(
          `${column}\\s+uuid\\s+NULL\\s+REFERENCES public\\.${table}\\(id\\) ON DELETE SET NULL`,
        ),
      );
    }
  });

  it('observed_at y created_at son columnas distintas', () => {
    assert.match(executableSql, /observed_at\s+timestamptz NOT NULL DEFAULT now\(\)/);
    assert.match(executableSql, /created_at\s+timestamptz NOT NULL DEFAULT now\(\)/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Dinero — la contabilidad NO se duplica por número
// ═══════════════════════════════════════════════════════════════════

describe('114 — sin contabilidad paralela', () => {
  it('ninguna columna de coste', () => {
    for (const forbidden of [
      'credits',
      'cost_credits',
      'provider_cost',
      'price',
      'billing_amount',
      'cost_source',
      'amount',
    ]) {
      assert.equal(
        new RegExp(`\\b${forbidden}\\b`).test(structuralSql),
        false,
        `114 declara una columna de coste: ${forbidden}`,
      );
    }
  });

  it('los punteros de contabilidad son punteros, no importes', () => {
    // Apuntar a la fila que pagó es lo contrario de reafirmar el importe.
    assert.match(executableSql, /REFERENCES public\.provider_usage_logs\(id\)/);
    assert.equal(/\bcredits?\s+(integer|numeric)/.test(structuralSql), false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Privilegios — DELETE a nadie, provenance inmutable por privilegio
// ═══════════════════════════════════════════════════════════════════

describe('114 — privilegios', () => {
  it('RLS habilitada en las dos tablas', () => {
    for (const table of [PHONES_TABLE, SOURCES_TABLE]) {
      assert.match(
        executableSql,
        new RegExp(`ALTER TABLE ${table.replace('.', '\\.')}\\s+ENABLE ROW LEVEL SECURITY`),
      );
    }
  });

  it('NO usa FORCE ROW LEVEL SECURITY (no es convención del repo)', () => {
    assert.equal(/FORCE ROW LEVEL SECURITY/.test(structuralSql), false);
  });

  it('revoca a PUBLIC, anon, authenticated y service_role antes de conceder', () => {
    for (const table of BARE_TABLES) {
      for (const role of ['PUBLIC', 'anon', 'authenticated', 'service_role']) {
        assert.match(
          executableSql,
          new RegExp(`REVOKE ALL PRIVILEGES ON TABLE public\\.${table} FROM ${role}`),
        );
      }
    }
  });

  it('authenticated recibe SELECT y NADA más', () => {
    for (const table of BARE_TABLES) {
      assert.match(
        executableSql,
        new RegExp(`GRANT SELECT ON TABLE public\\.${table} TO authenticated`),
      );
    }
    // Ni INSERT ni UPDATE ni DELETE para el navegador: un cliente no puede declarar
    // procedencia, porque «este número vino de Lusha» afirmado por el cliente no es
    // procedencia, es una afirmación no verificada sobre dinero que se gastó.
    assert.equal(
      /GRANT[^;']*(INSERT|UPDATE|DELETE)[^;']*TO authenticated/.test(executableSql),
      false,
    );
  });

  it('service_role: SELECT/INSERT/UPDATE en la canónica, sin DELETE', () => {
    assert.match(
      executableSql,
      /GRANT SELECT, INSERT, UPDATE ON TABLE public\.contact_phones TO service_role/,
    );
  });

  it('service_role: en las fuentes sólo SELECT/INSERT + UPDATE POR COLUMNA de la tríada', () => {
    assert.match(
      executableSql,
      /GRANT SELECT, INSERT ON TABLE public\.contact_phone_sources TO service_role/,
    );
    const columnGrant = executableSql.match(
      /GRANT UPDATE \(([^)]*)\)[\s\S]{0,120}?contact_phone_sources[\s\S]{0,40}?TO service_role/,
    );
    assert.ok(columnGrant, 'falta el GRANT UPDATE por columna en contact_phone_sources');
    const columns = columnGrant[1].split(',').map((value) => value.trim()).sort();
    assert.deepEqual(columns, ['suppressed_at', 'suppressed_by', 'suppression_reason']);
  });

  it('DELETE no se concede a NADIE en ninguna de las dos tablas', () => {
    assert.equal(/GRANT[^;']*\bDELETE\b/.test(executableSql), false);
  });

  it('TRUNCATE / REFERENCES / TRIGGER / MAINTAIN no se conceden a nadie', () => {
    for (const privilege of ['TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) {
      assert.equal(
        new RegExp(`GRANT[^;']*\\b${privilege}\\b`).test(executableSql),
        false,
        `114 concede ${privilege}`,
      );
    }
  });

  it('la política de authenticated deriva el alcance del CONTACTO padre', () => {
    // La regla vinculante: nadie puede SELECT un contact_phone si no puede SELECT su
    // contacto. Un `has_active_access` suelto sería una segunda declaración independiente
    // de quién puede leer un contacto, y las dos divergirían el día que `contacts` gane
    // alcance por cuenta.
    const phonePolicy = executableSql.match(
      /CREATE POLICY active_users_can_read_contact_phones[\s\S]*?\$policy\$/,
    );
    assert.ok(phonePolicy);
    assert.match(phonePolicy[0], /FOR SELECT TO authenticated/);
    assert.match(phonePolicy[0], /EXISTS \(/);
    assert.match(phonePolicy[0], /FROM public\.contacts/);
    assert.match(phonePolicy[0], /has_active_access\(auth\.uid\(\)\)/);

    // Las fuentes recorren la cadena COMPLETA: fuente → teléfono → contacto.
    const sourcePolicy = executableSql.match(
      /CREATE POLICY active_users_can_read_contact_phone_sources[\s\S]*?\$policy\$/,
    );
    assert.ok(sourcePolicy);
    assert.match(sourcePolicy[0], /FROM public\.contact_phones p/);
    assert.match(sourcePolicy[0], /JOIN public\.contacts c/);
  });

  it('no hay política de escritura para authenticated', () => {
    const writePolicies = [...executableSql.matchAll(/FOR (INSERT|UPDATE|DELETE) TO authenticated/g)];
    assert.deepEqual(writePolicies, []);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Inercia — H1 crea forma, no comportamiento
// ═══════════════════════════════════════════════════════════════════

describe('114 — inercia', () => {
  it('no crea NINGUNA función ni RPC', () => {
    assert.equal(/CREATE (OR REPLACE )?FUNCTION/.test(structuralSql), false);
  });

  it('el único trigger es set_updated_at, la convención de timestamps del repo', () => {
    const triggers = [...executableSql.matchAll(/CREATE TRIGGER (\w+)/g)].map((m) => m[1]);
    assert.deepEqual(triggers, ['contact_phones_set_updated_at']);
    assert.match(executableSql, /EXECUTE FUNCTION set_updated_at\(\)/);
  });

  it('ningún trigger de lógica de negocio', () => {
    // Elección de principal, sincronización del escalar, limpieza de fuentes y propagación
    // del tombstone son invariantes TRANSACCIONALES y pertenecen a los RPC de H2/H3.
    for (const forbidden of ['is_primary', 'contacts.phone', 'suppress']) {
      const triggerBlocks = [...executableSql.matchAll(/CREATE TRIGGER[\s\S]*?;/g)];
      for (const block of triggerBlocks) {
        assert.equal(
          block[0].includes(forbidden),
          false,
          `un trigger menciona ${forbidden}`,
        );
      }
    }
  });

  it('no inserta ni una fila', () => {
    assert.equal(/\bINSERT INTO\b/.test(structuralSql), false);
    assert.equal(/\bUPDATE public\./.test(structuralSql), false);
  });

  it('no toca contacts.phone ni el escalar móvil heredado', () => {
    assert.equal(/ALTER TABLE public\.contacts/.test(structuralSql), false);
    // Se lee el archivo COMPLETO, comentarios y COMMENT ON incluidos, y no sólo el SQL
    // estructural: la guarda hermana de 4O-E4.1 exige que la ÚNICA migración que nombre
    // esa columna sea la 039 que la declara. Cumplirla en la prosa además de en el DDL
    // cuesta una perífrasis y mantiene ese tripwire a plena potencia.
    assert.equal(/\bmobile_phone\b/.test(migrationSql), false);
  });

  it('no crea mobile_phone_source', () => {
    // 4O-H0 dejó el escalar móvil como heredado y transitorio hasta H5, y su procedencia
    // es deuda declarada (MOBILE_PHONE_PROVENANCE_PENDING).
    assert.equal(/mobile_phone_source/.test(migrationSql), false);
  });

  it('el encabezado declara que NO está aplicada en Producción', () => {
    assert.match(migrationSql, /APPLIED IN PRODUCTION: NO/);
    assert.equal(/APPLIED IN PRODUCTION: YES/.test(migrationSql), false);
    assert.equal(/✅ APPLIED IN PRODUCTION/.test(migrationSql), false);
  });

  it('es idempotente', () => {
    assert.match(executableSql, /CREATE TABLE IF NOT EXISTS public\.contact_phones/);
    assert.match(executableSql, /CREATE TABLE IF NOT EXISTS public\.contact_phone_sources/);
    for (const index of [
      'contact_phones_one_primary_idx',
      'contact_phones_contact_live_idx',
      'contact_phone_sources_phone_live_idx',
    ]) {
      assert.match(executableSql, new RegExp(`INDEX IF NOT EXISTS ${index}`));
    }
    // Las políticas se crean bajo guarda.
    const policies = [...executableSql.matchAll(/CREATE POLICY (\w+)/g)].map((m) => m[1]);
    assert.equal(policies.length, 4);
    for (const policy of policies) {
      assert.match(executableSql, new RegExp(`policyname = '${policy}'`));
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// Guarda de CERO escritores — lo que hace que «inerte» sea verificable
// ═══════════════════════════════════════════════════════════════════

describe('4O-H1 — cero lectores y cero escritores en runtime', () => {
  /**
   * AGENT2A-PHONE-REVEAL-4O-H2 — los ÚNICOS archivos de producción que pueden nombrar las
   * dos tablas oficiales. Lista EXACTA y ordenada: cualquier otro archivo que las nombre
   * rompe la guarda, y borrar uno de estos también.
   *
   * H1 declaró las tablas INERTES —0 lectores, 0 escritores— y esa era la afirmación
   * central del hito. 4O-H2 añade DELIBERADAMENTE el ÚNICO borrado, y lo añade ANTES de
   * que H3 permita que la aprobación las ESCRIBA: una colección que se puede escribir y no
   * se puede borrar es una colección que no puede honrar un DSAR. Por eso la privacidad
   * aterriza primero, con las dos tablas todavía vacías en todos los entornos.
   */
  const OFFICIAL_TABLE_NAMING_ALLOWLIST = [
    'src/modules/contact-enrichment/official-contact-phone-suppression-core.ts',
    'src/modules/contact-enrichment/phone-cache-suppression-actions.ts',
    'src/modules/contact-enrichment/phone-cache-suppression-core.ts',
  ];

  it('ningún archivo de producción nombra las tablas oficiales', () => {
    // Los dientes que QUEDAN: la aprobación (`candidate-review-core.ts`,
    // `approveContactCandidate`), `createContact`, `updateContact`, «Buscar más números» y
    // cualquier UI siguen sin poder nombrarlas —lo comprueban los tests de abajo— y ningún
    // archivo de producción puede hacer `from()`/`insert()`/`update()` sobre ellas: el
    // único acceso autorizado es la transacción de la 115 detrás de la RPC.
    const offenders = productionSources.filter((file) =>
      BARE_TABLES.some((table) => new RegExp(`['"\`]${table}['"\`]`).test(file.body)),
    );
    assert.deepEqual(
      offenders.map((file) => file.path).sort(),
      OFFICIAL_TABLE_NAMING_ALLOWLIST,
      'sólo el camino de PRIVACIDAD de 4O-H2 puede nombrar las tablas oficiales; el resto del runtime sigue sin conocerlas',
    );
    // Y la allowlist no se puede reutilizar por accidente: cada archivo admitido tiene que
    // declarar a qué hito pertenece.
    for (const path of OFFICIAL_TABLE_NAMING_ALLOWLIST) {
      const file = allSources.find((candidate) => candidate.path === path);
      assert.ok(file, `${path} debe existir`);
      assert.match(
        file.body,
        /4O-H2/,
        `${path} está en la allowlist: tiene que declarar que la nombra por 4O-H2`,
      );
    }
  });

  it('ningún archivo de producción hace from()/insert()/update() sobre ellas', () => {
    const offenders: string[] = [];
    for (const file of productionSources) {
      for (const table of BARE_TABLES) {
        if (new RegExp(`from\\(\\s*['"\`]${table}['"\`]`).test(file.body)) {
          offenders.push(`${file.path} → from('${table}')`);
        }
      }
    }
    assert.deepEqual(offenders, []);
  });

  it('la aprobación de candidatos no las conoce', () => {
    // `approveContactCandidate()` queda funcionalmente intacta: la propagación atómica es H3.
    const approvalFiles = productionSources.filter(
      (file) =>
        file.path.includes('candidate-review') ||
        (file.path.includes('contact-enrichment') && /approveContactCandidate/.test(file.body)),
    );
    assert.ok(approvalFiles.length > 0, 'no se encontró el camino de aprobación');
    for (const file of approvalFiles) {
      for (const table of BARE_TABLES) {
        assert.equal(
          file.body.includes(table),
          false,
          `${file.path} menciona ${table}: la propagación de la aprobación es H3`,
        );
      }
    }
  });

  it('createContact y updateContact siguen siendo escalares', () => {
    // H0.5 dejó la creación manual escribiendo número + procedencia en el MISMO INSERT
    // escalar. Escribir la colección es H5.
    const actions = allSources.find((file) => file.path === 'src/modules/contacts/actions.ts');
    assert.ok(actions, 'no se encontró src/modules/contacts/actions.ts');
    for (const table of BARE_TABLES) {
      assert.equal(actions.body.includes(table), false, `actions.ts menciona ${table}`);
    }
  });

  it('no hay un SEGUNDO normalizador de teléfonos oficiales', () => {
    // Un segundo normalizador significaría el mismo número con dos dedupe_key según qué
    // escritor lo vio: la deduplicación fallando en silencio, y el tombstone con ella.
    const producers = productionSources.filter((file) => /dedupeKey:\s*`/.test(file.body));
    assert.deepEqual(
      producers.map((file) => file.path),
      ['src/modules/contact-enrichment/phone-collection-core.ts'],
      'el único productor de dedupe_key debe seguir siendo phone-collection-core.ts',
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// Alcance — sin proveedores, sin presupuesto, sin flags
// ═══════════════════════════════════════════════════════════════════

describe('4O-H1 — alcance', () => {
  it('la migración no acopla ningún cliente de proveedor', () => {
    // El vocabulario de proveedor en un CHECK es dato; una LLAMADA a un proveedor no.
    for (const forbidden of ['http', 'https://', 'api.apollo', 'api.lusha', 'fetch']) {
      assert.equal(
        structuralSql.toLowerCase().includes(forbidden.toLowerCase()),
        false,
        `la migración menciona ${forbidden}`,
      );
    }
  });

  it('la migración no acopla presupuesto ni consumo', () => {
    for (const forbidden of [
      'budget',
      'effective_consumption',
      'credits_consumed',
      'credits_reserved',
      'monthly_budget',
    ]) {
      assert.equal(
        new RegExp(forbidden, 'i').test(structuralSql),
        false,
        `la migración menciona ${forbidden}`,
      );
    }
  });

  it('no activa ni lee ningún flag', () => {
    assert.equal(/ENABLE_[A-Z_]+/.test(structuralSql), false);
  });

  it('no toca HubSpot', () => {
    assert.equal(/hubspot/i.test(structuralSql), false);
  });

  it('la migración es el único archivo SQL del hito', () => {
    const h1Files = readdirSync(migrationsDir).filter((file) =>
      readFileSync(join(migrationsDir, file), 'utf8').includes('4O-H1'),
    );
    assert.deepEqual(h1Files, [MIGRATION_FILE]);
  });
});
