/**
 * Agente 2A — Guardas ESTÁTICAS de 4O-D
 * (AGENT2A-PHONE-REVEAL-4O-D)
 *
 * Dos cosas distintas, en un solo archivo porque comparten el modo de lectura:
 *
 *   1. la forma de la migración 111 — privilegios, SECURITY INVOKER, search_path,
 *      lock, ausencia de SQL dinámico, ausencia de contabilidad;
 *   2. el CONTROL DE ALCANCE — que este hito no tocó el otro proveedor, ni la UI,
 *      ni los contactos, ni HubSpot, ni los flags, ni el search de Lusha.
 *
 * Leen archivos de disco y comprueban invariantes. Sin red, sin base de datos, sin
 * proveedores. Misma convención que las guardas estáticas de los hitos anteriores.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
// __tests__ → contact-enrichment → modules → src → repo root
const repoRoot = join(here, '..', '..', '..', '..');

function readRepo(relative: string): string {
  return readFileSync(join(repoRoot, relative), 'utf8');
}

/**
 * Rutas relativas al repo de TODOS los `.ts`/`.tsx` bajo un directorio. Recorrido
 * propio y sin procesos externos: el barrido tiene que dar el mismo resultado en
 * cualquier máquina y no depender de que `git` exista en el runner.
 */
function listRepoSourceFiles(relativeDir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(repoRoot, relativeDir), { withFileTypes: true })) {
    const relative = `${relativeDir}/${entry.name}`;
    if (entry.isDirectory()) {
      // Las suites quedan fuera: nombran el cableado para afirmarlo, y contarlas
      // como puntos de inyección convertiría cada test nuevo en un falso positivo.
      if (entry.name === '__tests__') continue;
      out.push(...listRepoSourceFiles(relative));
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(relative);
    }
  }
  return out;
}

/** Quita comentarios para que las aserciones miren código y no prosa. */
function stripSqlComments(source: string): string {
  return source.replace(/^\s*--.*$/gm, '');
}

function stripTsComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

const MIGRATION = 'supabase/migrations/111_persist_candidate_lusha_phone_reveal_result.sql';
const FN = 'persist_candidate_lusha_phone_reveal_result';
const APOLLO_FN = 'persist_candidate_apollo_phone_reveal_result';

// ═══════════════════════════════════════════════════════════════
// 1. Forma de la migración
// ═══════════════════════════════════════════════════════════════

describe('4O-D migración 111 — forma y seguridad', () => {
  const sql = readRepo(MIGRATION);
  const code = stripSqlComments(sql);

  it('crea exactamente UNA función, y es la de Lusha', () => {
    const created = code.match(/CREATE OR REPLACE FUNCTION public\.(\w+)/g) ?? [];
    assert.equal(created.length, 1);
    assert.ok(created[0].includes(FN));
  });

  it('es SECURITY INVOKER, nunca DEFINER', () => {
    assert.ok(/SECURITY INVOKER/.test(code));
    assert.equal(/SECURITY DEFINER/.test(code), false);
  });

  it('fija search_path a pg_catalog, pg_temp', () => {
    assert.ok(/SET search_path = pg_catalog, pg_temp/.test(code));
  });

  it('bloquea el candidato con SELECT … FOR UPDATE', () => {
    assert.ok(/FROM public\.contact_enrichment_candidates c\s+WHERE c\.id = p_candidate_id\s+FOR UPDATE/.test(code));
  });

  it('no usa SQL dinámico', () => {
    assert.equal(/\bEXECUTE\s+format\s*\(/i.test(code), false);
    assert.equal(/\bEXECUTE\s+'/i.test(code), false);
    assert.equal(/\bEXECUTE\s+\w*sql\w*/i.test(code), false);
  });

  it('revoca EXECUTE de PUBLIC, anon y authenticated, y lo concede solo a service_role/postgres', () => {
    assert.ok(new RegExp(`REVOKE ALL ON FUNCTION public\\.${FN}[\\s\\S]*?FROM PUBLIC`).test(code));
    assert.ok(new RegExp(`REVOKE ALL ON FUNCTION public\\.${FN}[\\s\\S]*?FROM anon`).test(code));
    assert.ok(new RegExp(`REVOKE ALL ON FUNCTION public\\.${FN}[\\s\\S]*?FROM authenticated`).test(code));
    assert.ok(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${FN}[\\s\\S]*?TO postgres, service_role`).test(code));
  });

  it('no crea, altera ni borra tablas, y no hace backfill', () => {
    assert.equal(/CREATE TABLE/i.test(code), false);
    assert.equal(/ALTER TABLE/i.test(code), false);
    assert.equal(/DROP TABLE/i.test(code), false);
    assert.equal(/CREATE TRIGGER/i.test(code), false);
    assert.equal(/INSERT INTO public\.contact_enrichment_candidates\b/i.test(code), false);
  });

  it('NO escribe contabilidad: ni usage log, ni reserva, ni corrida', () => {
    for (const table of [
      'provider_usage_logs',
      'phone_reveal_credit_reservations',
      'phone_reveal_waterfall_runs',
      'phone_reveal_cache',
    ]) {
      assert.equal(
        new RegExp(`(INSERT INTO|UPDATE)\\s+public\\.${table}`, 'i').test(code),
        false,
        `${table} no debe escribirse dentro de la transacción`,
      );
    }
  });

  it('nunca borra una fila de teléfono ni actualiza una procedencia', () => {
    assert.equal(/DELETE\s+FROM\s+public\.contact_enrichment_candidate_phones/i.test(code), false);
    assert.equal(
      /UPDATE\s+public\.contact_enrichment_candidate_phone_sources/i.test(code),
      false,
    );
  });

  it('acepta SOLO el estado revealed y SOLO el proveedor lusha', () => {
    assert.ok(/p_phone_reveal_status IS DISTINCT FROM 'revealed'/.test(code));
    assert.ok(/p_phone_reveal_provider IS DISTINCT FROM 'lusha'/.test(code));
  });

  it('acepta SOLO procedencia lusha adquirida como reveal', () => {
    assert.ok(/s\.provider IS DISTINCT FROM 'lusha'/.test(code));
    assert.ok(/s\.acquisition_mode IS DISTINCT FROM 'reveal'/.test(code));
  });

  it('el ranking de tipos es el mismo que el de la capa pura', () => {
    assert.ok(
      /'personal_mobile',\s*'mobile',\s*'direct_dial',\s*'work',\s*'hq',\s*'other',\s*'unknown'/.test(
        code,
      ),
    );
  });

  it('el guard de tombstone está en el ON CONFLICT, no solo en el conteo previo', () => {
    assert.ok(/ON CONFLICT \(candidate_id, dedupe_key\) DO UPDATE[\s\S]*?WHERE t\.suppressed_at IS NULL/.test(code));
  });

  it('la procedencia es append-only e idempotente', () => {
    assert.ok(/ON CONFLICT \(candidate_phone_id, source_event_key\) DO NOTHING/.test(code));
  });

  it('promueve el principal solo tras degradar, nunca al revés', () => {
    const demote = code.indexOf('SET is_primary = false');
    const promote = code.indexOf('SET is_primary = true');
    assert.ok(demote >= 0 && promote >= 0);
    assert.ok(demote < promote, 'demote debe preceder a promote');
  });

  it('compara contra el incumbente antes de promover', () => {
    assert.ok(
      /\(v_chosen_rank, v_chosen_status_rank\) >= \(v_inc_rank, v_inc_status_rank\)/.test(code),
    );
  });

  it('escribe phone_reveal_request_id sin COALESCE: el NULL debe LIMPIAR', () => {
    assert.ok(/phone_reveal_request_id\s*=\s*p_phone_reveal_request_id/.test(code));
    assert.equal(
      /phone_reveal_request_id\s*=\s*COALESCE\(/.test(code),
      false,
      'un COALESCE dejaría vivo el id del intento anterior',
    );
  });

  it('declara que NO está aplicada', () => {
    assert.ok(/NOT APPLIED/.test(sql));
  });

  it('ningún mensaje de excepción se construye con un valor de columna', () => {
    const raises = sql.match(/RAISE EXCEPTION [^;]+/g) ?? [];
    assert.ok(raises.length > 0);
    for (const raise of raises) {
      assert.equal(/%/.test(raise), false, `RAISE con interpolación: ${raise}`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. La migración 110 no se tocó
// ═══════════════════════════════════════════════════════════════

describe('4O-D — la ruta del otro proveedor queda intacta', () => {
  it('la 111 no menciona la función del otro proveedor en su código', () => {
    const code = stripSqlComments(readRepo(MIGRATION));
    assert.equal(code.includes(APOLLO_FN), false);
  });

  it('la 110 sigue siendo la única que define su propia función', () => {
    const sql110 = readRepo('supabase/migrations/110_persist_candidate_apollo_phone_reveal_result.sql');
    assert.ok(sql110.includes(`CREATE OR REPLACE FUNCTION public.${APOLLO_FN}`));
    assert.equal(sql110.includes(FN), false);
  });

  it('el writer de Lusha llama a SU función y nunca a la del otro proveedor', () => {
    const source = readRepo(
      'src/modules/contact-enrichment/candidate-lusha-phone-collection-persistence.ts',
    );
    assert.ok(source.includes(FN));
    assert.equal(stripTsComments(source).includes(APOLLO_FN), false);
  });

  it('la captura de Lusha no importa la captura del otro proveedor', () => {
    const source = stripTsComments(
      readRepo('src/modules/contact-enrichment/lusha-phone-collection-capture.ts'),
    );
    assert.equal(/from ['"].*apollo/i.test(source), false);
  });

  it('el webhook y el recovery del otro proveedor no conocen nada de Lusha', () => {
    for (const rel of [
      'src/modules/contact-enrichment/phone-reveal-webhook-core.ts',
      'src/modules/contact-enrichment/phone-reveal-recovery-core.ts',
      'src/modules/contact-enrichment/apollo-phone-collection-capture.ts',
      'src/modules/contact-enrichment/candidate-phone-collection-persistence.ts',
    ]) {
      const code = stripTsComments(readRepo(rel));
      assert.equal(
        code.includes('persistCandidateLushaPhoneCollection'),
        false,
        `${rel} no debe alcanzar el writer de Lusha`,
      );
      assert.equal(
        code.includes('buildLushaPhoneCollectionCapture'),
        false,
        `${rel} no debe alcanzar la captura de Lusha`,
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. La escritura nueva solo es alcanzable desde las rutas autorizadas
// ═══════════════════════════════════════════════════════════════
//
// AGENT2A-PHONE-REVEAL-4O-F. Este bloque se escribió en 4O-D con DOS rutas
// autorizadas y una tercera —el disparo manual de administración— explícitamente
// fuera de alcance. 4O-F la autoriza, así que los asserts se INVIERTEN en vez de
// borrarse: lo que se sigue protegiendo es que el writer transaccional se cablee
// SOLO en los puntos declarados, y que ninguno de ellos arme SQL por su cuenta.

/** Los ÚNICOS módulos del repositorio autorizados a inyectar el writer. */
const AUTHORIZED_COLLECTION_WIRING_MODULES = [
  // Waterfall completo + continuación legacy, ambos vía `callLushaFallbackLeg` (4O-D).
  'src/modules/contact-enrichment/phone-reveal-waterfall-deps.ts',
  // Disparo manual de administración (4O-F).
  'src/modules/contact-enrichment/lusha-phone-fallback-actions.ts',
] as const;

describe('4O-D/4O-F — alcance de la nueva escritura', () => {
  for (const modulePath of AUTHORIZED_COLLECTION_WIRING_MODULES) {
    it(`${modulePath.split('/').pop()} inyecta el writer transaccional exactamente una vez`, () => {
      const wiring = readRepo(modulePath);
      const occurrences =
        wiring.match(/persistPhoneCollection:\s*persistCandidateLushaPhoneCollection/g) ?? [];
      assert.equal(occurrences.length, 1);
    });
  }

  it('la acción manual lo inyecta y ya NO cae al UPDATE escalar suelto (4O-F)', () => {
    const action = readRepo('src/modules/contact-enrichment/lusha-phone-fallback-actions.ts');
    assert.ok(
      action.includes('persistPhoneCollection: persistCandidateLushaPhoneCollection'),
      'MANUAL_LUSHA_MULTI_PHONE_PENDING queda cerrado cableando la MISMA transacción',
    );
    assert.ok(
      action.includes('phoneCollectionReservationId: null'),
      'el disparo manual no pertenece a ninguna reserva: null explícito, no inventado',
    );
    assert.ok(
      action.includes('phoneRevealWaterfallId: null'),
      'el disparo manual no pertenece a ninguna corrida: null explícito, no inventado',
    );
  });

  it('el writer transaccional se inyecta SOLO en los módulos autorizados', () => {
    // Barrido REAL de `src/`, no una lista de sospechosos: si mañana aparece un
    // tercer punto de cableado, este assert lo ve aunque nadie actualice el test.
    const hits = listRepoSourceFiles('src')
      .filter((relative) =>
        readRepo(relative).includes(
          'persistPhoneCollection: persistCandidateLushaPhoneCollection',
        ),
      )
      .sort();
    assert.deepEqual(hits, [...AUTHORIZED_COLLECTION_WIRING_MODULES].sort());
  });

  it('el core solo persiste colección cuando la dep está presente', () => {
    const core = readRepo('src/modules/contact-enrichment/lusha-phone-fallback-core.ts');
    assert.ok(core.includes('if (deps.persistPhoneCollection) {'));
  });

  it('el writer no tiene fallback secuencial: ni insert, ni update, ni select sueltos', () => {
    const code = stripTsComments(
      readRepo('src/modules/contact-enrichment/candidate-lusha-phone-collection-persistence.ts'),
    );
    assert.equal(/\.insert\(/.test(code), false);
    assert.equal(/\.update\(/.test(code), false);
    assert.equal(/\.select\(/.test(code), false);
    // Exactamente una llamada, y es la RPC.
    assert.equal((code.match(/admin\.rpc\(/g) ?? []).length, 1);
  });

  it('el writer no reintenta', () => {
    const code = stripTsComments(
      readRepo('src/modules/contact-enrichment/candidate-lusha-phone-collection-persistence.ts'),
    );
    assert.equal(/retry|for\s*\(|while\s*\(/i.test(code), false);
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. Superficies que este hito NO toca
// ═══════════════════════════════════════════════════════════════

describe('4O-D — superficies intactas', () => {
  const NEW_FILES: readonly string[] = [
    'src/server/integrations/lusha-phone-fallback-phones.ts',
    'src/modules/contact-enrichment/lusha-phone-collection-capture.ts',
    'src/modules/contact-enrichment/candidate-lusha-phone-collection-writer.ts',
    'src/modules/contact-enrichment/candidate-lusha-phone-collection-persistence.ts',
  ];

  for (const rel of NEW_FILES) {
    it(`${rel} no toca HubSpot ni la tabla de contactos`, () => {
      const code = stripTsComments(readRepo(rel));
      assert.equal(/hubspot/i.test(code), false);
      assert.equal(/\bcontacts\b/.test(code), false);
      assert.equal(/mobile_phone/.test(code), false);
    });

    it(`${rel} no lee un flag ni cambia un presupuesto`, () => {
      const code = stripTsComments(readRepo(rel));
      assert.equal(/process\.env/.test(code), false);
      assert.equal(/feature-flags/.test(code), false);
      assert.equal(/budget_rules|budgets/i.test(code), false);
    });
  }

  it('la nueva migración no toca contacts ni contact_phones', () => {
    const code = stripSqlComments(readRepo(MIGRATION));
    assert.equal(/\bpublic\.contacts\b/.test(code), false);
    assert.equal(/contact_phones\b(?!_)/.test(code.replace(/candidate_phones/g, '')), false);
  });

  it('no se creó ninguna superficie de UI', () => {
    const core = readRepo('src/modules/contact-enrichment/lusha-phone-fallback-core.ts');
    assert.equal(/Ver más números|Buscar más números/.test(core), false);
  });
});

// ═══════════════════════════════════════════════════════════════
// 5. El search/enrich general de Lusha sigue prohibido para teléfonos
// ═══════════════════════════════════════════════════════════════

describe('4O-D — la prohibición de teléfonos en el search de Lusha no se movió', () => {
  const clientSource = readRepo('src/server/integrations/lusha-client.ts');

  it('enrichLushaContactsV3 sigue rechazando reveal con "phones"', () => {
    assert.ok(clientSource.includes(`input.reveal as string[]`));
    assert.ok(clientSource.includes(`includes('phones')`));
  });

  it('su firma sigue tipando reveal como solo emails', () => {
    const signature = clientSource.match(
      /export async function enrichLushaContactsV3\(input: \{[\s\S]*?\}\):/,
    );
    assert.ok(signature);
    assert.ok(signature![0].includes(`reveal: Array<'emails'>`));
  });

  it('sus resultados siguen forzando hasPhone: false', () => {
    assert.ok(clientSource.includes('hasPhone: false as const'));
  });

  it('el adaptador de personas de Lusha sigue devolviendo phone: null', () => {
    const adapter = readRepo('src/server/agents/contact-enrichment-toolkit/lusha-people-adapter.ts');
    assert.ok(/phone:\s*null/.test(adapter));
  });

  it('el módulo nuevo de lectura de teléfonos NO conoce el shape del search general', () => {
    const code = stripTsComments(
      readRepo('src/server/integrations/lusha-phone-fallback-phones.ts'),
    );
    assert.equal(/phoneNumbers/.test(code), false);
    assert.equal(/localizedNumber/.test(code), false);
    assert.equal(/enrichLushaContactsV3/.test(code), false);
  });

  it('el módulo nuevo es puro: sin fetch, sin env, sin console', () => {
    const code = stripTsComments(
      readRepo('src/server/integrations/lusha-phone-fallback-phones.ts'),
    );
    assert.equal(/fetch\(/.test(code), false);
    assert.equal(/process\.env/.test(code), false);
    assert.equal(/console\./.test(code), false);
  });
});
