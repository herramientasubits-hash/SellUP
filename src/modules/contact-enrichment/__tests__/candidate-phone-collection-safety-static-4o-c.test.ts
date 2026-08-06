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
    const code = executable(sources[PERSISTENCE]);
    for (const forbidden of ['cost_credits', 'cost_usd', 'credits_consumed', 'credits:']) {
      assert.equal(code.includes(forbidden), false, `sin ${forbidden} en la fila`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// Sin migración y sin backfill
// ═══════════════════════════════════════════════════════════════════

describe('4O-C — sin migración y sin backfill', () => {
  it('no añade ninguna migración: 109 sigue siendo la última', () => {
    const migrations = readdirSync(join(repoRoot, 'supabase/migrations'))
      .filter((file) => /^\d+.*\.sql$/.test(file))
      .sort();
    const last = migrations[migrations.length - 1];
    assert.equal(last, '109_contact_enrichment_candidate_phones.sql');
    // Y ninguna migración 110+ existe.
    assert.equal(
      migrations.some((file) => /^1[1-9]\d/.test(file)),
      false,
    );
  });

  it('la persistencia no reescribe la migración 109 ni crea SQL suelto', () => {
    const code = executable(sources[PERSISTENCE]);
    assert.equal(/CREATE TABLE|ALTER TABLE|DROP TABLE|CREATE INDEX/i.test(code), false);
    assert.equal(/\.rpc\(/.test(code), false, 'no invoca funciones SQL nuevas');
  });

  it('no hay backfill: nada recorre históricos ni reconstruye el pasado', () => {
    for (const file of NEW_FILES) {
      const code = executable(sources[file]);
      assert.equal(/backfill/i.test(code), false, `${file} sin backfill`);
    }
    // La persistencia solo lee las filas DEL candidato que está escribiendo.
    const code = executable(sources[PERSISTENCE]);
    const selects = [...code.matchAll(/\.select\([^)]*\)/g)];
    assert.ok(selects.length > 0);
    assert.match(code, /\.eq\('candidate_id', request\.candidateId\)/);
  });

  it('no se concede a sí misma un DELETE que la migración le niega', () => {
    const code = executable(sources[PERSISTENCE]);
    assert.equal(/\.delete\(\)/.test(code), false, 'borrar una fila borra un tombstone');
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
