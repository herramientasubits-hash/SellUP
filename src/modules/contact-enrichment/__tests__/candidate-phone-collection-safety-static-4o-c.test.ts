/**
 * Agente 2A — Guardas ESTÁTICAS del alcance de 4O-C
 * (AGENT2A-PHONE-REVEAL-4O-C)
 *
 * Estas pruebas solo LEEN archivos del disco: no conectan con ninguna base, no
 * llaman a ningún proveedor y no gastan un crédito. Su trabajo es que el alcance
 * autorizado —capturar los teléfonos que ya llegan en el webhook y en el
 * recovery— no se ensanche en silencio en un cambio posterior.
 *
 * Cada aserción vale por lo que PROHÍBE, no por lo que confirma.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
// __tests__ → contact-enrichment → modules → src → raíz del repo
const repoRoot = join(here, '..', '..', '..', '..');
const moduleDir = join(repoRoot, 'src/modules/contact-enrichment');

const CAPTURE = 'apollo-phone-collection-capture.ts';
const WRITER = 'candidate-phone-collection-writer.ts';
const PERSISTENCE = 'candidate-phone-collection-persistence.ts';

/** Los archivos NUEVOS del hito. */
const NEW_FILES = [CAPTURE, WRITER, PERSISTENCE] as const;

function read(file: string): string {
  return readFileSync(join(moduleDir, file), 'utf8');
}

/** El archivo sin comentarios: lo que realmente se ejecuta. */
function executable(source: string): string {
  return source
    .split('\n')
    .filter((line) => {
      const trimmed = line.trimStart();
      return (
        !trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*')
      );
    })
    .join('\n');
}

const sources = Object.fromEntries(
  NEW_FILES.map((file) => [file, read(file)]),
) as Record<(typeof NEW_FILES)[number], string>;

const webhookCore = read('phone-reveal-webhook-core.ts');
const recoveryCore = read('phone-reveal-recovery-core.ts');

// ═══════════════════════════════════════════════════════════════════
// Lo que el hito NO toca
// ═══════════════════════════════════════════════════════════════════

describe('4O-C — alcance: proveedores', () => {
  it('ningún archivo nuevo importa ni menciona Lusha', () => {
    for (const file of NEW_FILES) {
      const code = executable(sources[file]);
      assert.equal(/lusha/i.test(code), false, `${file} no debe tocar Lusha`);
    }
  });

  it('ningún archivo nuevo llama al cliente de Apollo ni hace red', () => {
    for (const file of NEW_FILES) {
      const code = executable(sources[file]);
      assert.equal(/apollo-client|fetchApollo|\bfetch\s*\(/.test(code), false, file);
      assert.equal(/from '@\/server\/integrations/.test(code), false, file);
      assert.equal(/axios|node-fetch|https?:\/\//.test(code), false, file);
    }
  });

  it('la captura y el contrato son PUROS: sin Supabase, sin env, sin reloj', () => {
    for (const file of [CAPTURE, WRITER] as const) {
      const code = executable(sources[file]);
      assert.equal(/supabase|createClient/i.test(code), false, `${file} sin Supabase`);
      assert.equal(/process\.env/.test(code), false, `${file} sin env`);
      assert.equal(/Date\.now\(\)|new Date\(\)/.test(code), false, `${file} sin reloj`);
    }
  });

  it('la persistencia usa la factoría admin canónica, no un createClient inline', () => {
    const code = executable(sources[PERSISTENCE]);
    assert.match(code, /createSupabaseAdminClient/);
    assert.equal(/createClient\s*\(/.test(code), false);
  });
});

describe('4O-C — alcance: superficies fuera de contrato', () => {
  it('ningún archivo nuevo toca contactos oficiales, HubSpot ni la UI', () => {
    for (const file of NEW_FILES) {
      const code = executable(sources[file]);
      assert.equal(/hubspot/i.test(code), false, `${file} sin HubSpot`);
      assert.equal(/\bfrom 'contacts'|\.from\('contacts'\)/.test(code), false, file);
      assert.equal(/mobile_phone/.test(code), false, `${file} sin contacts.mobile_phone`);
      assert.equal(/contact_phones\b/.test(code), false, `${file} sin contact_phones`);
      assert.equal(/\breact\b|tsx|useState|className/i.test(code), false, `${file} sin UI`);
    }
  });

  it('ningún archivo nuevo lee un feature flag', () => {
    // La captura NO es una optimización que se pueda apagar: es la única forma de
    // que los números ya pagados dejen de perderse. Un flag aquí solo serviría
    // para volver a perderlos.
    for (const file of NEW_FILES) {
      const code = executable(sources[file]);
      assert.equal(/ENABLE_[A-Z_]+/.test(code), false, `${file} sin flags`);
      assert.equal(/feature-flags/.test(code), false, `${file} sin feature-flags`);
    }
  });

  it('ningún archivo nuevo toca presupuestos, reservas ni límites', () => {
    for (const file of NEW_FILES) {
      const code = executable(sources[file]);
      assert.equal(/budget_rules|budgets|reserveCredits/i.test(code), false, file);
      assert.equal(
        /\.from\('phone_reveal_credit_reservations'\)/.test(code),
        false,
        file,
      );
    }
  });

  it('ninguna fila de la colección lleva una columna de costo', () => {
    // El dinero vive en la reserva, la corrida y el usage-log. Una segunda
    // contabilidad por número sería una cifra que nadie cobró.
    //
    // 4O-C-R1: `phone_reveal_cost_credits` / `_cost_source` SÍ aparecen ahora en
    // este archivo, porque la misma transacción escribe el estado terminal del
    // CANDIDATO — que es donde esas columnas ya vivían antes del hito. Lo prohibido
    // sigue siendo idéntico: una columna de costo en una fila de TELÉFONO. Por eso
    // la guarda se aplica al payload de la colección, no al archivo entero.
    const code = executable(sources[PERSISTENCE]);
    const phonePayload = code.slice(
      code.indexOf('const phones = request.phones.map'),
      code.indexOf('const params = {'),
    );
    assert.ok(phonePayload.length > 0, 'el payload de la colección debe ser localizable');
    for (const forbidden of ['cost_credits', 'cost_usd', 'credits_consumed', 'credits:']) {
      assert.equal(
        phonePayload.includes(forbidden),
        false,
        `sin ${forbidden} en la fila de teléfono`,
      );
    }
    // Y ninguna de las dos tablas de la 109 recibe una columna de costo por su
    // nombre en ningún punto del archivo.
    assert.equal(/candidate_phone[a-z_]*\s*:\s*\{[^}]*cost/i.test(code), false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Sin migración y sin backfill
// ═══════════════════════════════════════════════════════════════════

describe('4O-C-R1 — exactamente UNA migración nueva, y sin backfill', () => {
  const migrations = () =>
    readdirSync(join(repoRoot, 'supabase/migrations'))
      .filter((file) => /^\d+.*\.sql$/.test(file))
      .sort();

  it('la 110 sigue siendo la única migración de este hito, y el techo no se ha abierto', () => {
    // 4O-C no podía añadir migración y por eso su persistencia no era
    // transaccional. 4O-C-R1 añade UNA —la función de la 110— y esta guarda pasa de
    // «ninguna» a «exactamente esa»: sigue siendo una guarda, no una puerta abierta.
    //
    // AGENT2A-PHONE-REVEAL-4O-D subió el techo a la 111 (la función equivalente para
    // el otro proveedor de teléfono, con su propia guarda estática en
    // candidate-lusha-phone-persistence-static-4o-d.test.ts) y
    // AGENT2A-PHONE-REVEAL-4O-E2 a la 112 (la propagación de la supresión a la
    // colección, con su guarda en
    // candidate-phone-collection-suppression-static-4o-e2.test.ts). Lo que esta
    // guarda protege NO es el número más alto del directorio, que sube cada vez que un
    // bloque autorizado añade la suya: es que 4O-C-R1 aportó SOLO la 110 y que nadie
    // ha colado una migración por encima del último hito conocido.
    //
    // AGENT2A-PHONE-REVEAL-4O-H1 sube el techo a la 114: el esquema OFICIAL de
    // múltiples teléfonos (`contact_phones` + `contact_phone_sources`), creado INERTE y
    // con su propia guarda estática en
    // src/modules/contacts/__tests__/official-contact-phone-schema-static-4o-h1.test.ts,
    // que es la que fija su forma, sus vocabularios y sus privilegios. La 114 NO edita
    // la 110 ni ninguna otra de la cadena 109–113, que es la propiedad que esta guarda
    // vigila desde 4O-C-R1.
    //
    // AGENT2A-PHONE-REVEAL-4O-H2 sube el techo a la 115: la PRIVACIDAD de ese esquema
    // oficial (dos contadores de auditoría sobre `phone_reveal_suppression_audit` y la
    // función transaccional `suppress_official_contact_phone_sources`), con su propia
    // guarda estática. Tampoco edita la 110 ni ninguna otra de la cadena 109–114: 4O-C-R1
    // sigue aportando EXACTAMENTE la 110, que es lo único que esta guarda afirma.
    const files = migrations();
    assert.ok(files.includes('109_contact_enrichment_candidate_phones.sql'));
    assert.ok(files.includes('110_persist_candidate_apollo_phone_reveal_result.sql'));
    assert.equal(
      files.filter((file) => /^110/.test(file)).length,
      1,
      '4O-C-R1 aporta exactamente una migración',
    );
    assert.equal(
      files[files.length - 1],
      // AGENT2A-PHONE-REVEAL-4O-H3 subió el techo a la 116: la APROBACIÓN atómica del
      // candidato sobre ese mismo esquema oficial (una sola función transaccional,
      // `approve_contact_candidate_with_phones`, con su propia guarda estática). Tampoco
      // edita la 110 ni ninguna otra de la cadena 109–115.
      '116_approve_candidate_with_official_phones.sql',
      'el techo conocido es la 116 (4O-H3), que añade la aprobación atómica sin editar la 110',
    );
    assert.equal(
      files.some((file) => /^1(1[7-9]|[2-9]\d)/.test(file)),
      false,
      'ninguna migración 117 o superior',
    );
  });

  it('la 110 no crea, altera ni borra ninguna tabla: solo una función', () => {
    const sql = readFileSync(
      join(repoRoot, 'supabase/migrations/110_persist_candidate_apollo_phone_reveal_result.sql'),
      'utf8',
    );
    const statements = sql
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n');
    for (const forbidden of [
      'CREATE TABLE',
      'ALTER TABLE',
      'DROP TABLE',
      'CREATE INDEX',
      'CREATE TRIGGER',
      'TRUNCATE',
    ]) {
      assert.equal(
        new RegExp(forbidden, 'i').test(statements),
        false,
        `la 110 no debe contener ${forbidden}`,
      );
    }
  });

  it('la persistencia no arma SQL: invoca la función de la 110 y nada más', () => {
    const code = executable(sources[PERSISTENCE]);
    assert.equal(/CREATE TABLE|ALTER TABLE|DROP TABLE|CREATE INDEX/i.test(code), false);
    // Exactamente UNA llamada, y a la función nombrada por su constante.
    assert.equal((code.match(/\.rpc\(/g) ?? []).length, 1, 'exactamente una llamada RPC');
    assert.match(code, /PERSIST_CANDIDATE_APOLLO_PHONE_REVEAL_RESULT_FN/);
    // Y ya no queda NINGUNA escritura suelta: eso es lo que hace la transacción
    // posible. Un `.insert()` sobreviviente sería un write fuera de ella.
    for (const write of ['.insert(', '.update(', '.upsert(', '.delete(']) {
      assert.equal(code.includes(write), false, `sin ${write} fuera de la transacción`);
    }
  });

  it('no hay backfill: nada recorre históricos ni reconstruye el pasado', () => {
    for (const file of NEW_FILES) {
      const code = executable(sources[file]);
      assert.equal(/backfill/i.test(code), false, `${file} sin backfill`);
    }
    // La persistencia solo habla de UN candidato: el que está escribiendo.
    const code = executable(sources[PERSISTENCE]);
    assert.match(code, /p_candidate_id: request\.candidateId/);
    // Y la función SQL toca UN candidato: el del parámetro. Se mira el SQL
    // EJECUTABLE, no los comentarios — que sí usan la palabra «backfill», porque
    // explicar por qué no hay backfill exige nombrarlo.
    const sql = readFileSync(
      join(repoRoot, 'supabase/migrations/110_persist_candidate_apollo_phone_reveal_result.sql'),
      'utf8',
    );
    const statements = sql
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n');
    assert.equal(/backfill/i.test(statements), false, 'sin backfill en el SQL ejecutable');
    // Cada escritura está acotada al candidato o a una fila suya por id.
    assert.match(statements, /WHERE c\.id = p_candidate_id\s*\n\s*FOR UPDATE/);
    assert.match(statements, /UPDATE public\.contact_enrichment_candidates[\s\S]*WHERE id = p_candidate_id/);
    // Ningún UPDATE de la tabla canónica sin acotar a este candidato o a una fila.
    for (const clause of [...statements.matchAll(/UPDATE public\.contact_enrichment_candidate_phones[\s\S]{0,400}?;/g)]) {
      assert.ok(
        /candidate_id = p_candidate_id|id = v_primary_id/.test(clause[0]),
        'todo UPDATE de teléfonos queda acotado al candidato',
      );
    }
  });

  it('la 110 no se concede el DELETE ni el UPDATE que la 109 le niega', () => {
    const sql = readFileSync(
      join(repoRoot, 'supabase/migrations/110_persist_candidate_apollo_phone_reveal_result.sql'),
      'utf8',
    );
    const statements = sql
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n');
    // SECURITY INVOKER es lo que mantiene el techo de la 109 en pie: la función no
    // puede borrar una fila de teléfono (borrar una fila borra un tombstone) ni
    // reescribir una procedencia.
    assert.match(statements, /SECURITY INVOKER/);
    assert.equal(/SECURITY DEFINER/.test(statements), false);
    assert.equal(
      /DELETE FROM public\.contact_enrichment_candidate_phones/i.test(statements),
      false,
      'borrar una fila borra un tombstone',
    );
    assert.equal(
      /UPDATE public\.contact_enrichment_candidate_phone_sources/i.test(statements),
      false,
      'una procedencia que su writer puede reescribir no es procedencia',
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// Alcanzabilidad: solo desde los dos caminos autorizados
// ═══════════════════════════════════════════════════════════════════

describe('4O-C — la captura solo es alcanzable desde webhook y recovery', () => {
  /** Todos los .ts/.tsx del repo, excluyendo tests y node_modules. */
  function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
        sourceFiles(full, out);
        continue;
      }
      if (/\.tsx?$/.test(entry.name)) out.push(full);
    }
    return out;
  }

  const allSources = sourceFiles(join(repoRoot, 'src'));

  it('solo el webhook core y el recovery core construyen la captura', () => {
    const importers = allSources.filter((file) =>
      readFileSync(file, 'utf8').includes('buildApolloPhoneCollectionCapture'),
    );
    assert.deepEqual(
      importers.map((file) => file.replace(`${repoRoot}/`, '')).sort(),
      [
        'src/modules/contact-enrichment/apollo-phone-collection-capture.ts',
        'src/modules/contact-enrichment/phone-reveal-webhook-core.ts',
        'src/modules/contact-enrichment/phone-reveal-recovery-core.ts',
      ].sort(),
    );
  });

  it('solo el webhook route y las deps del recovery cablean el writer real', () => {
    const importers = allSources.filter((file) =>
      readFileSync(file, 'utf8').includes(
        "from '@/modules/contact-enrichment/candidate-phone-collection-persistence'",
      ) ||
      readFileSync(file, 'utf8').includes("from './candidate-phone-collection-persistence'"),
    );
    assert.deepEqual(
      importers.map((file) => file.replace(`${repoRoot}/`, '')).sort(),
      [
        'src/app/api/integrations/apollo/phone-reveal/webhook/route.ts',
        'src/modules/contact-enrichment/phone-reveal-recovery-deps.ts',
      ].sort(),
    );
  });

  it('la captura NO se cablea en el search/discovery de Apollo', () => {
    // El search también entrega teléfonos y también los pierde, pero capturarlos
    // NO está autorizado en este hito.
    const searchSurfaces = allSources.filter((file) =>
      /prospecting-toolkit|apollo-company|apollo-people|contact-normalizer/.test(file),
    );
    assert.ok(searchSurfaces.length > 0, 'debe haber superficies de search que revisar');
    for (const file of searchSurfaces) {
      const code = readFileSync(file, 'utf8');
      assert.equal(
        /apollo-phone-collection-capture|candidate-phone-collection/.test(code),
        false,
        `${file} no debe capturar la colección`,
      );
    }
  });

  it('la captura NO se cablea en el camino de CACHÉ', () => {
    // Un teléfono servido desde la caché no es una observación nueva del
    // proveedor; capturarlo como tal falsearía la procedencia.
    for (const file of ['phone-cache-core.ts', 'phone-cache-store.ts']) {
      const code = readFileSync(join(moduleDir, file), 'utf8');
      assert.equal(
        /apollo-phone-collection-capture|candidate-phone-collection/.test(code),
        false,
        `${file} no debe capturar la colección`,
      );
    }
  });

  it('el writer solo se invoca desde el camino terminal `revealed` de cada core', () => {
    for (const [name, code] of [
      ['webhook', webhookCore],
      ['recovery', recoveryCore],
    ] as const) {
      const calls = [...code.matchAll(/deps\.persistCandidatePhoneCollection\(/g)];
      assert.equal(calls.length, 1, `${name}: exactamente UNA invocación`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// Privacidad estática
// ═══════════════════════════════════════════════════════════════════

describe('4O-C — privacidad', () => {
  it('los archivos nuevos no imprimen nada', () => {
    for (const file of NEW_FILES) {
      const code = executable(sources[file]);
      assert.equal(/console\.(log|warn|error|info|debug)/.test(code), false, file);
    }
  });

  it('ningún archivo nuevo contiene un teléfono, un correo ni un LinkedIn literal', () => {
    for (const file of NEW_FILES) {
      const code = sources[file];
      assert.equal(/'\+?\d{7,}'/.test(code), false, `${file} sin teléfono literal`);
      assert.equal(/linkedin\.com/i.test(code), false, `${file} sin LinkedIn`);
      assert.equal(/@[a-z0-9-]+\.[a-z]{2,}'/i.test(code), false, `${file} sin correo`);
    }
  });

  it('la metadata del usage-log se construye SOLO con el descriptor cerrado', () => {
    // Si algún camino armara `phone_collection` a mano, podría colar un número.
    for (const [name, code] of [
      ['webhook', webhookCore],
      ['recovery', recoveryCore],
    ] as const) {
      const assignments = [...code.matchAll(/phone_collection:\s*([A-Za-z.]+)/g)].map(
        (match) => match[1],
      );
      assert.ok(assignments.length > 0, `${name} debe registrar la colección`);
      for (const value of assignments) {
        assert.match(
          value,
          /^(describeCandidatePhoneCollectionWrite|collectionFields|args\.collectionFields)$/,
          `${name}: phone_collection solo del descriptor cerrado`,
        );
      }
    }
  });

  it('los cores no meten el número, el display ni la dedupe_key en la metadata', () => {
    for (const code of [webhookCore, recoveryCore]) {
      const metadataBlocks = [...code.matchAll(/metadata:\s*\{[\s\S]{0,1400}?\n\s{4,}\}/g)];
      assert.ok(metadataBlocks.length > 0);
      for (const [block] of metadataBlocks) {
        for (const forbidden of [
          'dedupeKey',
          'dedupe_key',
          'normalizedPhone',
          'displayPhone',
          'raw_number',
          'sanitized_number',
        ]) {
          assert.equal(
            block.includes(forbidden),
            false,
            `la metadata no debe llevar ${forbidden}`,
          );
        }
      }
    }
  });

  it('el descriptor cerrado devuelve solo cifras y banderas', () => {
    const code = executable(sources[WRITER]);
    const descriptor = code.match(
      /export function describeCandidatePhoneCollectionWrite[\s\S]*?\n\}/,
    );
    assert.ok(descriptor);
    for (const forbidden of ['normalizedPhone', 'displayPhone', 'dedupeKey']) {
      assert.equal(descriptor[0].includes(forbidden), false, `sin ${forbidden}`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// Compatibilidad con 4O-B
// ═══════════════════════════════════════════════════════════════════

describe('4O-C — no rompe el contrato de 4O-B', () => {
  it('el módulo de 4O-B sigue existiendo y sigue siendo la única fuente del ranking', () => {
    assert.ok(existsSync(join(moduleDir, 'phone-collection-core.ts')));
    const capture = executable(sources[CAPTURE]);
    // La captura no reescribe el ranking: lo importa.
    assert.match(capture, /from '\.\/phone-collection-core'/);
    assert.equal(
      /const [A-Z_]*RANKING[A-Z_]*\s*[:=]/.test(capture),
      false,
      'la captura no debe declarar un ranking propio',
    );
  });

  it('el discriminante es OPCIONAL: sin él la clave de 4O-B no cambia', () => {
    const core = readFileSync(join(moduleDir, 'phone-collection-core.ts'), 'utf8');
    assert.match(core, /observationDiscriminator\?:/);
    assert.match(core, /return discriminator \? `\$\{base\}:\$\{discriminator\}` : base;/);
  });
});
