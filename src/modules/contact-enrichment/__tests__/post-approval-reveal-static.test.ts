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
const FINAL_MIGRATION = '131_agent2_post_approval_reveal_stale_producer.sql';

/**
 * Sólo el cuerpo EJECUTABLE de las funciones de una migración, sin comentarios de línea y sin el
 * `COMMENT ON FUNCTION`. Mismo extractor que usa la matriz de escritores de CUT-3A, y existe por
 * la misma razón: una guarda que grepea el archivo entero confunde NOMBRAR algo con HACERLO, y
 * acaba castigando la prosa que declara la ausencia.
 */
function sqlFunctionBodies(sql: string): string {
  const parts: string[] = [];
  let from = 0;
  for (;;) {
    const start = sql.indexOf('AS $function$', from);
    if (start < 0) break;
    const end = sql.indexOf('$function$;', start);
    if (end < 0) break;
    parts.push(sql.slice(start, end));
    from = end + 1;
  }
  return parts
    .join('\n')
    .split('\n')
    .map((line) => {
      const at = line.indexOf('--');
      return at === -1 ? line : line.slice(0, at);
    })
    .join('\n');
}
const FN = 'project_approved_candidate_phones_onto_contact';

const CORE = 'src/modules/contact-enrichment/post-approval-reveal-core.ts';
const RUNTIME = 'src/modules/contact-enrichment/post-approval-reveal-runtime.ts';
const READ = 'src/modules/contact-enrichment/post-approval-reveal-read.ts';
const PROJECTION = 'src/modules/contact-enrichment/post-approval-reveal-projection.ts';
const CAPABILITY = 'src/modules/contact-enrichment/post-approval-reveal-capability.ts';
const ACTIONS = 'src/modules/contact-enrichment/post-approval-reveal-actions.ts';
const COPY = 'src/components/contacts/post-approval-reveal-copy.ts';
const CTA = 'src/components/contacts/post-approval-reveal-cta.tsx';
const SHEET = 'src/components/contacts/contact-detail-sheet.tsx';
const BASIS = 'src/modules/contact-enrichment/phone-reveal-processing-basis.ts';
// PARIDAD DE RESCATE — las tres salidas que el contacto oficial no tenía. Entran en la MISMA
// lista a propósito: sus garantías negativas son idénticas —ninguna puede abrirse una vía propia
// a un proveedor ni construir una petición a HubSpot— y dejarlas fuera de la guarda habría hecho
// que el hito creciera precisamente por el lado no vigilado.
const RESCUE_CORE = 'src/modules/contact-enrichment/post-approval-rescue-core.ts';
const RESCUE_RUNTIME = 'src/modules/contact-enrichment/post-approval-rescue-runtime.ts';
const RESCUE_COPY = 'src/components/contacts/post-approval-rescue-copy.ts';
const RESCUE_PANEL = 'src/components/contacts/post-approval-rescue-panel.tsx';

const ALL_FILES = [
  CORE,
  RUNTIME,
  READ,
  PROJECTION,
  CAPABILITY,
  ACTIONS,
  COPY,
  CTA,
  BASIS,
  RESCUE_CORE,
  RESCUE_RUNTIME,
  RESCUE_COPY,
  RESCUE_PANEL,
];

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
    'startApolloPhoneReveal',
    'revealLushaPhone',
  ];

  /**
   * AGENT2-POST-APPROVAL-REVEAL-STALE-PRODUCER-FINAL-CUT — la superficie de HubSpot que sigue
   * PROHIBIDA en TODOS los archivos del hito, incluido el que cablea la fase 2.
   *
   * Ésta es la lista que de verdad importa. Lo que hay que impedir no es que la palabra
   * «HubSpot» aparezca: es que este hito pueda CONSTRUIR una petición al CRM del cliente —elegir
   * el cuerpo del PATCH, leer la conexión, decidir qué teléfono viaja o cómo se borra—. Todo eso
   * vive en el motor compartido y tiene sus propias pruebas; si alguno de estos símbolos entrara
   * aquí, existiría una SEGUNDA implementación del envío, y el día que divergiera una de las dos
   * borraría en HubSpot un número que SellUp sí tiene.
   */
  const FORBIDDEN_HUBSPOT_SURFACE = [
    '@/server/integrations/hubspot-contact-sync',
    'hubspot-contact-sync',
    'contact-hubspot-sync-core',
    'runSyncContactToHubSpot',
    'updateHubSpotContact',
    'createHubSpotContact',
    'findHubSpotContactByEmail',
    'associateHubSpotContactWithCompany',
    'getHubSpotContactSyncConnection',
    'buildContactHubSpotSyncDeps',
    'persistContactMetadata',
    'writeHubSpotSyncState',
    'HUBSPOT_CONTACT_AUTO_PHONE_UPDATE',
  ];

  for (const file of ALL_FILES) {
    it(`${file} no importa nada que gaste ni registre uso`, () => {
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

  // ═══════════════════════════════════════════════════════════════
  // HubSpot — la guarda, RE-AFILADA por el FINAL CUT
  // ═══════════════════════════════════════════════════════════════
  //
  // ── OLD_ASSERTION ────────────────────────────────────────────
  // `HUBSPOT_WRITES = 0: ni una mención en CÓDIGO en ninguno de los archivos` — un `/hubspot/i`
  // sobre el código ejecutable de los nueve archivos del hito.
  //
  // ── WHY_OBSOLETE ─────────────────────────────────────────────
  // Protegía el §8 de #352, donde la proyección post-aprobación no producía estado durable de
  // HubSpot y por tanto no tenía nada que decirle. CUT-3A/CUT-3C cambiaron ese hecho: la 128
  // escribe `contacts.phone` de un contacto que PUEDE estar vinculado y `synced`, así que el
  // silencio dejó de ser una separación de contratos y pasó a ser el defecto — HubSpot conserva
  // el número viejo y la ficha afirma estar al día.
  //
  // Además la guarda medía lo que no era: confundía NOMBRAR con PODER. Un `import type` —que se
  // borra al compilar— y un campo del sobre llamado `hubspot_sync_transition` la rompían igual
  // que un cliente HTTP, mientras que un módulo llamado `crm-followup.ts` la habría pasado
  // entera. Un umbral léxico premia el eufemismo y castiga la claridad.
  //
  // ── NEW_INVARIANT ────────────────────────────────────────────
  // Tres afirmaciones, sobre CAPACIDAD y no sobre vocabulario:
  //
  //   1. NINGÚN archivo del hito puede construir una petición a HubSpot: la superficie del
  //      cliente y del motor (`FORBIDDEN_HUBSPOT_SURFACE`) sigue prohibida en los diez, el que
  //      cablea la fase 2 incluido;
  //   2. EXACTAMENTE UN archivo puede importar un símbolo de HubSpot en runtime, y sólo puede
  //      ser `runContactHubSpotAutoPhoneUpdateWired`: el entrypoint único que ya usan la edición
  //      manual y el merge, con su bandera y su rechazo de la procedencia `privacy` dentro;
  //   3. el núcleo y el runtime pueden NOMBRAR HubSpot únicamente en el vocabulario del sobre y
  //      en un `import type`, que no es una arista de runtime.

  const HUBSPOT_WIRING_FILE = ACTIONS;
  const HUBSPOT_ENTRYPOINT = 'runContactHubSpotAutoPhoneUpdateWired';
  const HUBSPOT_ENTRYPOINT_MODULE = '@/modules/contacts/contact-hubspot-sync-runner';
  /** Tipos y campos: nombran HubSpot sin poder alcanzarlo. */
  const HUBSPOT_TYPE_ONLY_TOKENS = [
    'ContactAutoPhoneUpdateReport',
    '@/modules/contacts/contact-hubspot-auto-phone-update-core',
    'hubspotSyncTransition',
    'hubspot_sync_transition',
    'ProjectionHubSpotSyncTransition',
    'didProjectionLeaveHubSpotPendingChange',
    'runHubSpotPhoneSyncFollowUp',
    'hubspotAutoUpdate',
  ];

  for (const file of ALL_FILES) {
    it(`${file} no puede CONSTRUIR una petición a HubSpot`, () => {
      const code = stripTsComments(read(file));
      for (const forbidden of FORBIDDEN_HUBSPOT_SURFACE) {
        assert.equal(
          code.includes(forbidden),
          false,
          `${file} nombra ${forbidden}: sería una segunda implementación del envío`,
        );
      }
    });
  }

  it('control NEGATIVO: la lista prohibida SÍ atrapa un cliente de HubSpot real', () => {
    // Sin esto, la prueba de arriba pasaría igual si la lista estuviera vacía o mal escrita.
    const fake = "import { updateHubSpotContact } from '@/server/integrations/hubspot-contact-sync';";
    assert.ok(
      FORBIDDEN_HUBSPOT_SURFACE.some((f) => fake.includes(f)),
      'la lista no atrapa el import que existe de verdad en el motor',
    );
  });

  it('EXACTAMENTE UN archivo del hito importa HubSpot en runtime, y es el entrypoint único', () => {
    const importers = ALL_FILES.filter((file) => {
      const code = stripTsComments(read(file));
      // `import type … from` se descarta: se borra al compilar y no puede llamar a nada.
      const runtimeImports = code
        .split('\n')
        .filter((line) => /^\s*import\s/.test(line) && !/^\s*import\s+type\s/.test(line));
      return runtimeImports.some((line) => /hubspot/i.test(line));
    });
    assert.deepEqual(importers, [HUBSPOT_WIRING_FILE], 'la fase 2 se cablea en UN solo sitio');

    const wiring = stripTsComments(read(HUBSPOT_WIRING_FILE));
    assert.match(
      wiring,
      new RegExp(`import \\{ ${HUBSPOT_ENTRYPOINT} \\} from '${HUBSPOT_ENTRYPOINT_MODULE.replace(/\//g, '\\/')}'`),
      'el único import de HubSpot tiene que ser el entrypoint, y sólo él',
    );
    // Y una sola llamada: la fase 2 no se dispara dos veces desde el cableado.
    assert.equal((wiring.match(new RegExp(`${HUBSPOT_ENTRYPOINT}\\(`, 'g')) ?? []).length, 1);
  });

  it('el núcleo y el runtime nombran HubSpot SÓLO como tipo o como vocabulario del sobre', () => {
    for (const file of [CORE, RUNTIME]) {
      const code = stripTsComments(read(file));
      const lines = code.split('\n').filter((line) => /hubspot/i.test(line));
      const unexplained = lines.filter(
        (line) => !HUBSPOT_TYPE_ONLY_TOKENS.some((token) => line.includes(token)),
      );
      assert.deepEqual(unexplained, [], `${file} nombra HubSpot fuera del vocabulario declarado`);

      // Y la única arista hacia el módulo de HubSpot es `import type`, que no existe en runtime.
      for (const line of lines.filter((l) =>
        l.includes('@/modules/contacts/contact-hubspot-auto-phone-update-core'),
      )) {
        assert.match(line, /^import type /, `${file}: la importación tiene que ser type-only`);
      }
    }
  });

  it('SQL — la migración final no alcanza ninguna red', () => {
    // La transición durable la escribe SQL, y desde SQL no hay CRM alcanzable. Se afirma en vez
    // de suponerse: una extensión HTTP en una migración sería una escritura al CRM del cliente
    // dentro de una transacción, sin bandera y sin nadie mirando.
    //
    // Se mide sobre el CUERPO EJECUTABLE, no sobre el archivo. La cabecera y el COMMENT DECLARAN
    // la ausencia —«no se llama a `http`, ni a `pg_net`»— y una guarda cruda castigaría esa frase,
    // empujando a borrar exactamente lo que hace la decisión revisable. Nombrar no es hacer.
    const body = sqlFunctionBodies(read(`supabase/migrations/${FINAL_MIGRATION}`));
    for (const forbidden of ['pg_net', 'net.http', 'http_post', 'http_get', 'dblink']) {
      assert.equal(body.includes(forbidden), false, `la migración LLAMA a ${forbidden}`);
    }
    // Control NEGATIVO: el extractor de cuerpo devuelve algo y sabe ver una llamada real.
    assert.ok(body.includes('mark_contact_hubspot_sync_stale_for_phone'), 'el cuerpo se extrajo');
    assert.ok(
      ['pg_net', 'dblink'].some((f) => `${body}\n  PERFORM pg_net.http_post();`.includes(f)),
      'el detector no vería una llamada de red aunque existiera',
    );
  });

  it('y el nuevo límite está DECLARADO donde se toma la decisión', () => {
    // En positivo, igual que antes: el archivo que cablea la operación tiene que decir qué queda
    // dentro y qué queda fuera. Una ausencia silenciosa se lee como un olvido; una declaración se
    // puede revisar.
    assert.match(read(ACTIONS), /HUBSPOT/);
    assert.match(read(ACTIONS), /FUERA DE ALCANCE SIGUE ESTANDO/);
    assert.match(read(ACTIONS), /SEGUNDA fase/);
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

  it('el capability gate hace EXACTAMENTE una llamada, y es la MISMA RPC de la 128', () => {
    // Es una comprobación REAL, no un proxy: la sonda es la propia RPC de la 128, no una consulta
    // a `pg_proc`/`information_schema` ni un número de migración. Que sea la misma función que
    // `PROJECTION` invoca es lo que garantiza que «existe» aquí signifique «existe» allá.
    const code = stripTsComments(read(CAPABILITY));
    const rpcCalls = code.match(/\.rpc\(/g) ?? [];
    assert.equal(rpcCalls.length, 1, 'una sola llamada de sonda, sin escritura suelta');
    for (const write of ['.insert(', '.update(', '.delete(', '.upsert(', '.from(']) {
      assert.equal(code.includes(write), false, `el capability gate no puede contener ${write}`);
    }
    assert.match(code, /PROJECT_APPROVED_CANDIDATE_PHONES_FN/);
    assert.match(code, /parseProjectApprovedCandidatePhonesEnvelope/);
  });

  it('el capability gate es fail-closed: nunca `true` por defecto ni por catch', () => {
    const code = stripTsComments(read(CAPABILITY));
    assert.match(code, /if \(error\) return false;/);
    assert.match(code, /catch \{\s*\n?\s*return false;/);
    // Y no puede depender de un flag ni de un número de migración: eso es exactamente lo que la
    // corrección prohíbe usar como proxy de capacidad.
    assert.equal(/process\.env|isEnabled\(|MIGRATION_1\d\d/.test(code), false);
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
    for (const file of [RUNTIME, READ, CAPABILITY, ACTIONS, COPY, CTA]) {
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

  it('sin tablas, columnas, índices, triggers ni policies nuevas: sólo función y permisos', () => {
    // `CREATE OR REPLACE FUNCTION` SÍ es un cambio de esquema, así que la 128 no se describe
    // como «sin DDL». Lo que se afirma aquí es lo comprobable: no crea NINGUNA estructura
    // nueva —ni tabla, ni columna, ni índice, ni policy, ni trigger— y no hace backfill.
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

  it('existe una sola vez, no hay huecos, y la re-emite el tramo 129–132', () => {
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => /^\d{3}_.*\.sql$/.test(f))
      .sort();
    // AGENT2-FINAL-INTEGRATION-PREPARATION-LOCAL-1 dejó de ser la ÚLTIMA: la 128 es ahora la
    // base de la 131, que la re-emite entera con cinco splices declarados para que la proyección
    // PRODUZCA además el estado durable de HubSpot. Que ya no sea el techo no afloja nada — el
    // techo se sigue fijando EXACTO, con nombre y conteo, y la 128 se sigue exigiendo presente y
    // única, que es lo que esta suite necesita: el generador de la 131 deriva su cuerpo de ella.
    assert.ok(files.includes(MIGRATION), 'la 128 tiene que seguir existiendo: la 131 la deriva');
    assert.equal(files.filter((f) => f.startsWith('128')).length, 1);
    // BR-PRODUCTION-RELEASE mueve el techo a la 133: `133_br_candidate_identity_promotion.sql`,
    // la promoción VALLADA de la identidad fiscal resuelta de una candidata brasileña
    // (BR-SOURCE CUT D), numerada al volver ese trabajo a GitHub después de haber vivido en local
    // sin número mientras el espacio de nombres estaba en disputa. Crea UNA función
    // (`promote_candidate_fiscal_identity_fenced`) y sus permisos: sin tabla, sin columna, sin
    // índice, sin constraint y sin backfill. NO es de teléfono y no nombra ninguna tabla, columna
    // ni función de teléfono, que es lo que esta guarda vigila. AUTORADA y NO APLICADA.
    // BR-COMPACT-SNAPSHOT-PRODUCTIZATION mueve el techo a la 134:
    // `134_br_receita_compact_snapshot.sql`, la tabla dedicada y particionada del snapshot
    // nacional de Brasil. NO es de teléfono, no nombra ninguna tabla, columna ni función de
    // teléfono, y no edita el archivo de ninguna migración anterior. AUTORADA y NO APLICADA.
    // 🔴 AGENT1-LUSHA-CUT-L3 mueve el techo a la 135 (renumerada desde la 134 al integrarse en
    // serie después de que BR-COMPACT-SNAPSHOT-PRODUCTIZATION llegara primero a main con ese
    // número): `135_agent1_lusha_prospecting_request_fence.sql`, la valla DURABLE de una
    // petición de Lusha Company Prospecting: una tabla (`lusha_prospecting_request_fence`) y
    // tres funciones que se escriben ANTES del envío, para que una caída dura no repita una
    // petición que el proveedor quizá ya cobró. Es de Agente 1 y de seguridad de GASTO: no es de
    // teléfono, no es del catálogo y no nombra ninguna tabla, columna ni función de las cadenas
    // que esta guarda vigila. AUTORADA y NO APLICADA.
    assert.equal(files[files.length - 1], '135_agent1_lusha_prospecting_request_fence.sql');
    const numbers = files.map((f) => Number.parseInt(f.slice(0, 3), 10));
    assert.equal(Math.max(...numbers), 135);
    assert.equal(files.length, 135, 'techo y conteo coinciden: ni un hueco');
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
      // DURABLE RESUME + PARIDAD DE RESCATE: las salidas nuevas viajan en el MISMO check
      // obligatorio, sin tocar el workflow — el paso que ya lo ejecuta no cambia.
      'post-approval-reveal-durable-resume.test.ts',
      'post-approval-rescue-parity.test.ts',
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
