/**
 * Agente 2A — guardas ESTÁTICAS del reveal post-aprobación
 * (AGENT2A-POST-APPROVAL-OFFICIAL-CONTACT-PHONE-REVEAL-1).
 *
 * ═══════════════════════════════════════════════════════════════════
 * QUÉ PROTEGE Y POR QUÉ NO BASTA UN TEST DE COMPORTAMIENTO
 * ═══════════════════════════════════════════════════════════════════
 *
 * Las promesas centrales de este hito son NEGATIVAS, y una promesa negativa no la puede sostener
 * un test de comportamiento: el runtime seguiría verde el día que alguien añada, junto a la
 * delegación, una llamada directa a Apollo «sólo para este caso».
 *
 *   * NO se construye un segundo waterfall. La única vía a un proveedor es
 *     `revealCandidatePhoneAction`, y eso se demuestra probando que la llamada que gastaría por su
 *     cuenta NO ESTÁ ESCRITA en ninguno de los archivos del hito.
 *   * NO se escribe en HubSpot (§8). Ninguna de las importaciones que lo permitirían existe.
 *   * NO se crea un contacto y NO se re-terminaliza un candidato (§7). Las dos sentencias que lo
 *     harían no están en la migración.
 *   * La lectura es lectura: el módulo de lecturas no contiene un `.insert()`, `.update()`,
 *     `.delete()` ni `.rpc()`.
 *   * La única escritura del hito es UNA llamada a la RPC de la 128.
 *
 * Determinista y offline: sólo lee archivos del disco. Sin red, sin Supabase, sin proveedores,
 * 0 créditos, 0 escrituras, 0 PII.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
// __tests__ → contact-enrichment → modules → src → repo root
const repoRoot = join(here, '..', '..', '..', '..');
const MIGRATIONS_DIR = join(repoRoot, 'supabase', 'migrations');

const read = (relative: string) => readFileSync(join(repoRoot, relative), 'utf8');

/** Comentarios fuera: una guarda de «esto NO existe» mira CÓDIGO, no prosa. */
const stripTsComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** SQL EJECUTABLE: sin líneas `--` y sin bloques `/* … *\/`. */
const executableSql = (source: string) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');

/**
 * SQL ESTRUCTURAL: lo ejecutable menos los `COMMENT ON … IS '…';`, que son prosa dentro de una
 * sentencia. Misma convención que las suites de 4O-H1/H2/E4.1. Sin esto, la migración fallaría
 * sus propias guardas por CITAR el límite que cumple, y la forma de aprobarlas sería borrar la
 * frase que lo declara.
 */
const structuralSql = (source: string) =>
  executableSql(source).replace(/COMMENT ON [\s\S]*?';\n/g, '');

const MIGRATION = '128_project_approved_candidate_phones_onto_contact.sql';
const FN = 'project_approved_candidate_phones_onto_contact';

const CORE = 'src/modules/contact-enrichment/post-approval-reveal-core.ts';
const RUNTIME = 'src/modules/contact-enrichment/post-approval-reveal-runtime.ts';
const READ = 'src/modules/contact-enrichment/post-approval-reveal-read.ts';
const PROJECTION = 'src/modules/contact-enrichment/post-approval-reveal-projection.ts';
const ACTIONS = 'src/modules/contact-enrichment/post-approval-reveal-actions.ts';
const COPY = 'src/components/contacts/post-approval-reveal-copy.ts';
const CTA = 'src/components/contacts/post-approval-reveal-cta.tsx';
const SHEET = 'src/components/contacts/contact-detail-sheet.tsx';
const BASIS = 'src/modules/contact-enrichment/phone-reveal-processing-basis.ts';

const ALL_FILES = [CORE, RUNTIME, READ, PROJECTION, ACTIONS, COPY, CTA, BASIS];

// ═══════════════════════════════════════════════════════════════
// 1. Los archivos del hito existen y ninguno puede gastar por su cuenta
// ═══════════════════════════════════════════════════════════════

describe('post-approval reveal — ninguna vía propia a un proveedor', () => {
  it('los archivos del hito existen', () => {
    for (const file of ALL_FILES) {
      assert.ok(read(file).length > 0, `${file} debe existir`);
    }
  });

  /**
   * Módulos cuya sola importación abriría un camino de gasto o de escritura fuera del hito. La
   * delegación NO necesita ninguno: `revealCandidatePhoneAction` los usa por dentro y es la única
   * puerta.
   */
  const FORBIDDEN_IMPORTS = [
    '@/server/integrations/apollo-client',
    'apollo-client',
    'lusha-client',
    'legacy-lusha-only-reveal-engine',
    'phone-reveal-credit-reservation',
    'phone-reveal-credit-budget',
    'logProviderUsage',
    'provider-usage',
    'hubspot',
    'startApolloPhoneReveal',
    'revealLushaPhone',
  ];

  for (const file of ALL_FILES) {
    it(`${file} no importa nada que gaste, registre uso o toque HubSpot`, () => {
      const code = stripTsComments(read(file));
      for (const forbidden of FORBIDDEN_IMPORTS) {
        assert.equal(
          code.includes(forbidden),
          false,
          `${file} nombra ${forbidden} en código: se abriría un camino de gasto propio`,
        );
      }
    });
  }

  it('HUBSPOT_WRITES = 0: ni una mención en CÓDIGO en ninguno de los archivos', () => {
    // Sobre el código EJECUTABLE, no sobre la prosa. El archivo de acciones DECLARA el límite del
    // §8 en su encabezado, y castigar esa frase empujaría a borrar exactamente lo que hace la
    // decisión revisable — es la misma lección que las guardas de `mobile_phone` ya aprendieron.
    // La declaración se exige en positivo justo debajo.
    for (const file of ALL_FILES) {
      assert.equal(
        /hubspot/i.test(stripTsComments(read(file))),
        false,
        `${file} nombra HubSpot en código: Approval → HubSpot es un contrato aparte`,
      );
    }
  });

  it('y el límite del §8 está DECLARADO donde se toma la decisión', () => {
    // En positivo: el archivo que cablea la operación tiene que decir que HubSpot queda fuera.
    // Una ausencia silenciosa se lee como un olvido; una declaración se puede revisar.
    assert.match(read(ACTIONS), /HUBSPOT/);
    assert.match(read(ACTIONS), /FUERA DE ALCANCE/);
  });

  it('la ÚNICA delegación es el pipeline del candidato, y está escrita', () => {
    const actions = stripTsComments(read(ACTIONS));
    assert.match(actions, /from '\.\/phone-reveal-actions'/);
    assert.match(actions, /revealCandidatePhoneAction\(/);
    assert.match(actions, /from '\.\/phone-reveal-waterfall-actions'/);
    assert.match(actions, /getPhoneRevealWaterfallAuthorizationPreviewAction\(/);
  });

  it('el tope de créditos NO se calcula en el hito: se pide al servidor', () => {
    // Un segundo cálculo del tope es exactamente lo que permitiría que la ficha prometiera 8
    // donde el servidor reserva 14. Ninguno de los archivos del hito puede contener la aritmética
    // de la modalidad ni sus tres cifras.
    for (const file of [CORE, RUNTIME, COPY, CTA]) {
      const code = stripTsComments(read(file));
      assert.equal(
        /resolvePhoneRevealWaterfallMaxCredits|evaluatePhoneRevealWaterfallLushaLeg/.test(code),
        false,
        `${file} no puede resolver la modalidad por su cuenta`,
      );
    }
  });

  it('la base de tratamiento es UNA constante compartida, no una copia', () => {
    const basis = read(BASIS);
    assert.match(basis, /legitimate_interest_b2b/);
    // Y las DOS pantallas la importan de ahí: el candidato y el contacto oficial.
    assert.match(
      read('src/components/contact-enrichment/contact-candidate-detail-sheet.tsx'),
      /phone-reveal-processing-basis/,
    );
    assert.match(read(CTA), /phone-reveal-processing-basis/);
    // Nadie del hito vuelve a escribir el literal.
    for (const file of [CORE, RUNTIME, READ, PROJECTION, ACTIONS, COPY, CTA]) {
      assert.equal(
        stripTsComments(read(file)).includes("'legitimate_interest_b2b'"),
        false,
        `${file} no puede volver a escribir la base legal: hay UNA fuente`,
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. La lectura es LECTURA, y la escritura es UNA
// ═══════════════════════════════════════════════════════════════

describe('post-approval reveal — la frontera lectura/escritura', () => {
  it('el módulo de lecturas no contiene insert/update/delete/rpc', () => {
    const code = stripTsComments(read(READ));
    for (const write of ['.insert(', '.update(', '.delete(', '.upsert(', '.rpc(']) {
      assert.equal(
        code.includes(write),
        false,
        `la lectura no puede contener ${write}: la garantía es que la llamada NO existe`,
      );
    }
  });

  it('el núcleo puro y el runtime no tocan Supabase ni el reloj de nadie', () => {
    for (const file of [CORE, RUNTIME]) {
      const code = stripTsComments(read(file));
      for (const forbidden of [
        '@/lib/supabase',
        'createClient',
        'createSupabaseAdminClient',
        'process.env',
        'fetch(',
        'new Date(',
        'Date.now(',
      ]) {
        assert.equal(
          code.includes(forbidden),
          false,
          `${file} debe ser puro: no puede nombrar ${forbidden}`,
        );
      }
    }
  });

  it('la proyección hace EXACTAMENTE una llamada, y es la RPC de la 128', () => {
    const code = stripTsComments(read(PROJECTION));
    const rpcCalls = code.match(/\.rpc\(/g) ?? [];
    assert.equal(rpcCalls.length, 1, 'una sola llamada, y ninguna escritura suelta');
    for (const write of ['.insert(', '.update(', '.delete(', '.upsert(', '.from(']) {
      assert.equal(
        code.includes(write),
        false,
        `la proyección no puede contener ${write}: la transacción es de la 128`,
      );
    }
    assert.match(code, /PROJECT_APPROVED_CANDIDATE_PHONES_FN/);
  });

  it('el mensaje del driver NUNCA se propaga (puede citar un teléfono)', () => {
    const code = stripTsComments(read(PROJECTION));
    assert.equal(
      /error\.message/.test(code),
      false,
      'PostgreSQL cita valores de la query en sus errores, y uno puede ser el número',
    );
  });

  it('el nombre de la función de la 128 vive en UNA constante, en UN archivo', () => {
    const core = stripTsComments(read(CORE));
    // El literal aparece en su constante y en los dos mensajes de error del parser del sobre,
    // que lo citan a propósito para que un fallo diga QUÉ RPC contestó raro. Lo que se fija es
    // que la DECLARACIÓN sea una y que ningún otro archivo del hito vuelva a escribirlo: dos
    // literales del nombre de una RPC es una llamada que PostgREST deja de resolver en silencio
    // el día que la firma cambie.
    const declarations = (
      core.match(/PROJECT_APPROVED_CANDIDATE_PHONES_FN =\s*\n?\s*'/g) ?? []
    ).length;
    assert.equal(declarations, 1, 'una sola declaración');
    for (const file of [RUNTIME, READ, ACTIONS, COPY, CTA]) {
      assert.equal(
        stripTsComments(read(file)).includes(FN),
        false,
        `${file} no puede volver a escribir el nombre de la RPC`,
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. El contrato del módulo 'use server' (P0-R4 / P342)
// ═══════════════════════════════════════════════════════════════

describe('post-approval reveal — el contrato de `use server`', () => {
  it('el archivo de acciones declara la directiva en la primera línea', () => {
    assert.match(read(ACTIONS).split('\n')[0], /^'use server';$/);
  });

  it('todas sus exportaciones son funciones async: ni un `export type`, ni una constante', () => {
    // P342 (PR #344): `export type { X };` LOCAL en un módulo `use server` tumbó /contacts en
    // Producción, porque Next lista las exportaciones por NOMBRE y exige que todas sean acciones.
    // Los tipos de este hito viven en el núcleo, que no lleva la directiva.
    const code = stripTsComments(read(ACTIONS));
    const exports = [...code.matchAll(/^export\s+(.*)$/gm)].map((m) => m[1]);
    assert.ok(exports.length > 0, 'debe exportar algo');
    for (const line of exports) {
      assert.match(
        line,
        /^async function \w+\(/,
        `exportación no permitida en un módulo 'use server': export ${line}`,
      );
    }
  });

  it('las tres acciones del hito existen con su nombre', () => {
    const code = read(ACTIONS);
    for (const name of [
      'getOfficialContactPhoneRevealOfferAction',
      'revealOfficialContactPhoneAction',
      'reconcileOfficialContactPhoneFromCandidateAction',
    ]) {
      assert.match(code, new RegExp(`export async function ${name}\\(`));
    }
  });

  it('ninguna acción devuelve el id del candidato fuente al navegador', () => {
    // El cliente manda un id de CONTACTO y el servidor resuelve el candidato. Devolverlo
    // permitiría a la UI apuntar el pipeline a un candidato elegido por ella.
    const core = read(CORE);
    const offerView = core.match(/interface OfficialContactPhoneRevealOfferView \{([\s\S]*?)\n\}/);
    assert.ok(offerView, 'la vista de la oferta debe existir');
    assert.equal(/candidateId/.test(offerView[1]), false);
    const startResult = core.match(
      /interface OfficialContactPhoneRevealStartResult \{([\s\S]*?)\n\}/,
    );
    assert.ok(startResult, 'el resultado del clic debe existir');
    assert.equal(/candidateId/.test(startResult[1]), false);
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. La UI
// ═══════════════════════════════════════════════════════════════

describe('post-approval reveal — la UI', () => {
  it('el CTA está cableado en la ficha del contacto', () => {
    const sheet = read(SHEET);
    assert.match(sheet, /OfficialContactPhoneRevealCta/);
    assert.match(sheet, /post-approval-reveal-cta/);
  });

  it('el CTA no imprime en consola (AGENT2A-PROD-INCIDENT #279)', () => {
    const code = stripTsComments(read(CTA));
    assert.equal(/console\./.test(code), false);
  });

  it('el CTA no llama a ninguna acción que no sea de este hito', () => {
    const code = stripTsComments(read(CTA));
    const actions = [...code.matchAll(/\b(\w+Action)\(/g)].map((m) => m[1]).sort();
    assert.deepEqual([...new Set(actions)], [
      'getOfficialContactPhoneRevealOfferAction',
      'reconcileOfficialContactPhoneFromCandidateAction',
      'revealOfficialContactPhoneAction',
    ]);
  });

  it('el polling reutiliza el refresco acotado del subsistema, no uno propio', () => {
    const code = stripTsComments(read(CTA));
    assert.match(code, /usePhoneRevealLiveRefresh/);
    for (const forbidden of ['setInterval(', 'setTimeout(']) {
      assert.equal(
        code.includes(forbidden),
        false,
        `el CTA no puede programar su propio ciclo: ${forbidden}`,
      );
    }
  });

  it('el copy NUNCA afirma un tope que el servidor no dio', () => {
    const copy = read(COPY);
    // Sin cifra del servidor, el texto lo dice; no cae a un suelo inventado.
    assert.match(copy, /maxCredits === null/);
    assert.equal(/\?\?\s*8\b|\?\?\s*13\b|\?\?\s*14\b/.test(stripTsComments(copy)), false);
  });
});

// ═══════════════════════════════════════════════════════════════
// 5. La migración 128
// ═══════════════════════════════════════════════════════════════

describe('la migración 128 — su contrato', () => {
  const raw = () => readFileSync(join(MIGRATIONS_DIR, MIGRATION), 'utf8');

  it('declara UNA función, y es la del hito', () => {
    const sql = structuralSql(raw());
    const created = [
      ...sql.matchAll(/CREATE (?:OR REPLACE )?FUNCTION public\.([a-z_]+)/g),
    ].map((m) => m[1]);
    assert.deepEqual(created, [FN]);
  });

  it('es SECURITY INVOKER, con el search_path de sus hermanas', () => {
    const sql = structuralSql(raw());
    assert.match(sql, /SECURITY INVOKER/);
    assert.match(sql, /SET search_path = pg_catalog, pg_temp/);
    assert.equal(/SECURITY DEFINER/.test(sql), false);
  });

  it('cero DDL, cero backfill: ni tabla, ni columna, ni índice, ni policy, ni trigger', () => {
    const sql = structuralSql(raw());
    for (const verb of [
      'CREATE TABLE',
      'ALTER TABLE',
      'DROP TABLE',
      'CREATE INDEX',
      'CREATE UNIQUE INDEX',
      'CREATE POLICY',
      'CREATE TRIGGER',
      'TRUNCATE',
    ]) {
      assert.equal(new RegExp(verb, 'i').test(sql), false, `la 128 no puede ejecutar ${verb}`);
    }
  });

  it('NO crea contactos y NO re-terminaliza candidatos (§7)', () => {
    const sql = structuralSql(raw());
    assert.equal(
      /INSERT\s+INTO\s+public\.contacts\b/i.test(sql),
      false,
      'crear un contacto es de la 116, y duplicarlo es lo que este hito promete no hacer',
    );
    assert.equal(
      /UPDATE\s+public\.contact_enrichment_candidates\b/i.test(sql),
      false,
      'el veredicto del candidato lo escribió una persona: no se reescribe',
    );
  });

  it('no borra nada: un tombstone no se puede resucitar ni saltar', () => {
    const sql = structuralSql(raw());
    assert.equal(/\bDELETE\b/i.test(sql), false);
    assert.equal(/suppressed_at\s*=\s*NULL/i.test(sql), false);
  });

  it('cada INSERT es idempotente por clave única', () => {
    const sql = structuralSql(raw());
    const inserts = sql.match(/INSERT INTO public\.contact_phone/g) ?? [];
    const doNothings = sql.match(/ON CONFLICT \([^)]*\) DO NOTHING/g) ?? [];
    assert.ok(inserts.length >= 3, 'la promoción, su procedencia y el escalar');
    assert.ok(
      doNothings.length >= inserts.length,
      'cada INSERT necesita su DO NOTHING: sin él, re-proyectar duplicaría o resucitaría',
    );
    assert.equal(/ON CONFLICT[^;]*DO UPDATE/i.test(sql), false, 'nunca un UPSERT');
  });

  it('la procedencia promovida reutiliza el namespace de la 116', () => {
    assert.match(structuralSql(raw()), /'v1:promoted:'/);
  });

  it('sólo actúa sobre un candidato APROBADO y sobre SU contacto (guarda IDOR)', () => {
    const sql = structuralSql(raw());
    assert.match(sql, /c_projectable\s+text\[\]\s*:=\s*ARRAY\['approved'\]/);
    assert.match(sql, /matched_contacts_id IS DISTINCT FROM p_contact_id/);
    assert.match(sql, /'contact_link_mismatch'/);
  });

  it('re-comprueba la supresión POR PERSONA con los helpers de la 113', () => {
    const sql = structuralSql(raw());
    assert.match(sql, /public\.phone_reveal_person_suppression_exists\(/);
    assert.match(sql, /public\.phone_reveal_normalized_apollo_person_id\(/);
    assert.match(sql, /'person_suppressed'/);
    // Y no inventa un segundo modelo de identidad por parecido.
    for (const inference of ['ILIKE', 'similarity(', 'soundex', 'lower(c.email)']) {
      assert.equal(
        sql.includes(inference),
        false,
        `la 128 no puede emparejar personas por ${inference}`,
      );
    }
  });

  it('toma los locks en el orden de 112/115/116/117', () => {
    const sql = structuralSql(raw());
    const candidateLock = sql.indexOf('FROM public.contact_enrichment_candidates c');
    const contactLock = sql.indexOf('FROM public.contacts ct');
    assert.ok(candidateLock > -1 && contactLock > -1);
    assert.ok(candidateLock < contactLock, 'candidato → contacto, nunca al revés');
    assert.equal((sql.match(/FOR UPDATE/g) ?? []).length, 2);
  });

  it('el escalar heredado se escribe SÓLO si estaba en NULL y el principal es nuevo', () => {
    const sql = structuralSql(raw());
    assert.match(sql, /IF v_primary_new AND NULLIF\(BTRIM\(COALESCE\(v_contact\.phone/);
    // Y el estado que se refusa outright, en vez de bootstrappear una procedencia inventada.
    assert.match(sql, /'scalar_incumbent_unprojectable'/);
  });

  it('NUNCA toca mobile_phone ni phone_confidence', () => {
    const sql = structuralSql(raw());
    assert.equal(/mobile_phone/.test(sql), false);
    assert.equal(/phone_confidence/.test(sql), false);
  });

  it('los privilegios son los de sus hermanas: PUBLIC/anon/authenticated revocados', () => {
    const sql = structuralSql(raw());
    for (const role of ['PUBLIC', 'anon', 'authenticated']) {
      assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION[\\s\\S]*?FROM ${role};`));
    }
    assert.match(sql, /GRANT EXECUTE ON FUNCTION[\s\S]*?TO postgres, service_role;/);
  });

  it('el sobre no puede llevar PII: sólo conteos, banderas e ids opacos', () => {
    const sql = structuralSql(raw());
    const envelope = sql.slice(sql.lastIndexOf('RETURN jsonb_build_object'));
    for (const leak of ['display_phone', 'normalized_phone', 'full_name', 'email']) {
      assert.equal(
        envelope.includes(leak),
        false,
        `el sobre no puede llevar ${leak}: sale por PostgREST hacia el servidor`,
      );
    }
    assert.match(envelope, /'primary_dedupe_key'/);
  });

  it('es la ÚLTIMA migración del repo, existe una sola vez y no hay huecos', () => {
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => /^\d{3}_.*\.sql$/.test(f))
      .sort();
    assert.equal(files[files.length - 1], MIGRATION);
    assert.equal(files.filter((f) => f.startsWith('128')).length, 1);
    const numbers = files.map((f) => Number.parseInt(f.slice(0, 3), 10));
    assert.equal(Math.max(...numbers), 128);
    assert.equal(files.length, 128, 'techo y conteo coinciden: ni un hueco');
  });

  it('no edita ninguna migración anterior de la cadena de teléfono', () => {
    // La cadena que este hito LEE pero no reescribe. Si alguna llevara el marcador de este
    // hito, dejaría de ser cierto que el reveal y la aprobación existentes quedan intactos.
    for (const file of [
      '109_contact_enrichment_candidate_phones.sql',
      '110_persist_candidate_apollo_phone_reveal_result.sql',
      '111_persist_candidate_lusha_phone_reveal_result.sql',
      '114_official_contact_phones.sql',
      '115_official_contact_phone_privacy.sql',
      '116_approve_candidate_with_official_phones.sql',
      '117_merge_candidate_into_existing_contact.sql',
    ]) {
      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
      assert.equal(
        sql.includes('POST-APPROVAL-OFFICIAL-CONTACT-PHONE-REVEAL'),
        false,
        `${file} fue tocada por este hito`,
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 6. Flags y cableado de CI
// ═══════════════════════════════════════════════════════════════

describe('post-approval reveal — flags y CI', () => {
  it('no introduce ningún feature flag propio', () => {
    for (const file of ALL_FILES) {
      const code = stripTsComments(read(file));
      assert.equal(
        /process\.env|isEnabled\(|Enabled\(\)/.test(code),
        false,
        `${file} lee un flag: este hito no añade ninguno y no gobierna nada con uno`,
      );
    }
    // Y `feature-flags.server.ts` no gana una entrada de este hito. Se busca el marcador del
    // hito, no la palabra `POST_APPROVAL`: ya existe un flag ajeno con ese prefijo
    // (`ENABLE_POST_APPROVAL_SOURCE_ENRICHMENT`, del enriquecimiento de fuentes) y confundirlo
    // con uno propio sería medir la cosa equivocada.
    assert.equal(
      /OFFICIAL_CONTACT_PHONE_REVEAL|POST_APPROVAL_REVEAL/.test(
        read('src/lib/feature-flags.server.ts'),
      ),
      false,
    );
  });

  it('las suites del hito están cableadas al check obligatorio', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    const script = pkg.scripts['test:agent2a:post-approval-reveal'];
    assert.ok(script, 'el script del hito debe existir');
    for (const suite of [
      'post-approval-reveal-core.test.ts',
      'post-approval-reveal-priscilla.test.ts',
      'post-approval-reveal-static.test.ts',
      'post-approval-reveal-copy.test.ts',
    ]) {
      assert.ok(script.includes(suite), `el script debe correr ${suite}`);
    }
    const workflow = read('.github/workflows/automatic-routing-tests.yml');
    assert.match(workflow, /npm run test:agent2a:post-approval-reveal\b/);
    // Y la suite de PostgreSQL REAL tiene su propio script, FUERA del check obligatorio (exige
    // un binario que se descarga), igual que sus hermanas 4O-E2/E3/E4/H1/H2/H3/H3-B/H4.
    assert.ok(pkg.scripts['test:agent2a:post-approval-reveal:postgres']);
    // Y no hay un PASO que la ejecute. Se busca la línea `run:`, no la mención: el propio paso
    // del check documenta en prosa cómo correrla a mano, y prohibir esa frase empujaría a
    // borrar la única instrucción que dice dónde se miden las garantías de PostgreSQL.
    assert.equal(
      /^\s*run:\s*npm run test:agent2a:post-approval-reveal:postgres\s*$/m.test(workflow),
      false,
      'la suite de PostgreSQL real no puede entrar al check obligatorio',
    );
  });
});
