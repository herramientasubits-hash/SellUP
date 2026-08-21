/**
 * ADDENDUM PROVIDER-SEEN §§ 5, 9, 13 y §§ 11.20-11.22, 11.26, 11.27 — garantías
 * ESTÁTICAS: el orden en el que nace la memoria, y las cosas que este PR no puede
 * haber tocado.
 *
 * 🔴 Todo se busca con los COMENTARIOS FUERA. Una guarda que lea el cuerpo crudo
 * convierte «citar un nombre en la prosa» en «usarlo», y ese falso positivo ya
 * ocurrió en este repo (AGENT2A-SEARCH-MORE-PHONES-1G).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../../../..');

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

function stripTsComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('//');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');
}

const PURE_DIR = 'src/modules/prospect-batches/provider-seen';
const SERVER_DIR = 'src/server/prospect-batches/provider-seen';
const EXECUTOR = 'src/server/prospect-batches/lusha-pending-review.ts';
const LUSHA_ACTION = 'src/modules/prospect-batches/lusha-pending-review-actions.ts';
const LUSHA_PREVIEW = 'src/server/prospect-batches/lusha-preview.ts';

function listSources(dir: string): string[] {
  return readdirSync(path.join(ROOT, dir))
    .filter((f) => f.endsWith('.ts'))
    .map((f) => `${dir}/${f}`);
}

const PROVIDER_SEEN_SOURCES = [...listSources(PURE_DIR), ...listSources(SERVER_DIR)];

test('§ 4 — el orden es RESPUESTA VÁLIDA → recordar → filtrar, sobre el ejecutor real', () => {
  const code = stripTsComments(read(EXECUTOR));

  const okGuard = code.indexOf('if (!search.ok)');
  const record = code.indexOf('planProviderSeenRecording(');
  const dedupe = code.indexOf('dedupeLushaCompaniesByIdentity(search.results');

  assert.ok(okGuard > 0, 'la guarda de respuesta válida existe');
  assert.ok(record > 0, 'la memoria se planifica en el ejecutor');
  assert.ok(dedupe > 0, 'el dedupe de la corrida existe');

  // 🔴 Si la memoria se escribiera después del dedupe heredaría sus criterios y
  // volvería a olvidar justo lo que hay que recordar. Ese es el defecto entero.
  assert.ok(okGuard < record, 'recordar ocurre DESPUÉS de comprobar `ok`');
  assert.ok(record < dedupe, 'recordar ocurre ANTES del dedupe local');
});

test('§ 4 — la validez no se deriva del tamaño de la lista en el punto de registro', () => {
  const code = stripTsComments(read(EXECUTOR));
  const start = code.indexOf('planProviderSeenRecording(');
  const block = code.slice(start, start + 600);

  assert.ok(block.includes('responseValid: true'), 'la validez es la del `ok` ya comprobado');
  for (const forbidden of ['results.length >', 'length > 0 ?', 'results?.length']) {
    assert.ok(!block.includes(forbidden), `la validez no puede salir de un tamaño (${forbidden})`);
  }
});

test('§ 9 / § 11.26 — la memoria NO es un ledger: no puede alcanzar la liquidación', () => {
  const forbidden = [
    'settleReservationObservably',
    'wizard_budget_reservations',
    'wizard_monthly_budget_periods',
    'reserveWizardPilotCredits',
    'creditsReserved',
    'estimateLushaRunCredits',
  ];
  for (const rel of PROVIDER_SEEN_SOURCES) {
    const code = stripTsComments(read(rel));
    for (const needle of forbidden) {
      assert.ok(!code.includes(needle), `${rel} no puede tocar la autoridad económica (${needle})`);
    }
  }
});

test('§ 9 / § 11.27 — la memoria NO es observabilidad de gasto: no escribe uso de proveedor', () => {
  const forbidden = ['provider_usage_logs', 'logProviderUsage', 'billing_state', 'usage_key'];
  for (const rel of PROVIDER_SEEN_SOURCES) {
    const code = stripTsComments(read(rel));
    for (const needle of forbidden) {
      assert.ok(!code.includes(needle), `${rel} no puede escribir uso de proveedor (${needle})`);
    }
  }
});

test('§ 11.26 / § 11.27 — la acción sigue liquidando y registrando uso, en ese orden', () => {
  const code = stripTsComments(read(LUSHA_ACTION));
  const settle = code.indexOf('settleReservationObservably(');
  const usage = code.indexOf('recordRunUsageObservably(');

  assert.ok(settle > 0 && usage > 0, 'las dos siguen existiendo');
  assert.ok(settle < usage, 'la observabilidad va después de una liquidación terminal');
});

test('§ 9 — no se fabrica economía derivada en ninguna parte de la memoria', () => {
  for (const rel of PROVIDER_SEEN_SOURCES) {
    const code = stripTsComments(read(rel));
    for (const needle of ['credits_saved', 'usd_saved', 'creditsSaved', 'usdSaved']) {
      assert.ok(!code.includes(needle), `${rel} publica un ahorro sin contrafactual (${needle})`);
    }
  }
});

test('§ 5 — la petición a Lusha sigue emitiendo SÓLO `exclude.domains`', () => {
  const code = stripTsComments(read(LUSHA_PREVIEW));

  assert.ok(code.includes('exclude: { domains: excludeDomains }'), 'la exclusión por dominios sigue');
  for (const forbidden of ['exclude.ids', 'exclude: { ids', 'excludeIds', 'excludeCompanyIds']) {
    assert.ok(
      !code.includes(forbidden),
      `el contrato de ids está congelado hasta la confirmación escrita (${forbidden})`,
    );
  }
});

test('§ 11.21 — no hay topes numéricos inventados en la memoria ni en el planificador', () => {
  // Los únicos números permitidos son los DECLARADOS del repo. Cualquier literal
  // suelto de tres cifras o más en estos módulos sería un límite mágico.
  const declared = new Set(['100', '500']);
  for (const rel of PROVIDER_SEEN_SOURCES) {
    const code = stripTsComments(read(rel));
    for (const match of code.matchAll(/(?<![\w.])(\d{3,})(?![\w.])/g)) {
      assert.ok(
        declared.has(match[1]!),
        `${rel} introduce un límite numérico sin declarar: ${match[1]}`,
      );
    }
  }
});

/**
 * 🔴 RATCHET INVERTIDO POR SEGUNDA VEZ, NO BORRADO (AGENT1-PROVIDER-SEEN-MEMORY-3).
 *
 * Gate 1: «no existe ninguna migración de provider-seen».
 * Gate 2: «existe UNA, declarada NO aplicada, y el runtime no persiste».
 * Gate 3 (aquí): la dueña la APLICÓ en Producción —versión `20260820153919`— y el
 * runtime ya persiste.
 *
 * La superficie protegida no se mueve: sigue siendo que el archivo diga la VERDAD
 * sobre Producción. Cambia de lado porque la verdad cambió. 🔴 Y el peligro se
 * invierte con ella: este repo arrastra diez migraciones cuyo encabezado sigue
 * diciendo «APPLIED IN PRODUCTION: NO» estando aplicadas
 * (`docs/agent2a/README.md`), y cada una de ellas es una invitación a aplicar por
 * segunda vez algo que ya corrió. Esta prueba impide que la 123 se sume a esa lista.
 */
test('§ 13 — la migración está APLICADA en Producción, declarada como tal, y es UNA sola', () => {
  const migrations = readdirSync(path.join(ROOT, 'supabase/migrations')).filter((f) =>
    f.endsWith('.sql'),
  );
  const providerSeen = migrations.filter((f) => f.toLowerCase().includes('provider_seen'));

  assert.deepEqual(
    providerSeen,
    ['123_provider_seen_entities.sql'],
    'exactamente una migración de provider-seen, con el número libre desde main',
  );

  // 🔴 El encabezado es la única declaración legible por un humano que va a decidir
  // si la aplica. Ahora que YA está aplicada, dejarlo diciendo «NO» invitaría a
  // aplicarla otra vez.
  const sql = read(`supabase/migrations/${providerSeen[0]}`);
  assert.ok(
    !sql.includes('APPLIED IN PRODUCTION: NO'),
    'la migración ya no puede declararse NO aplicada: lo está',
  );
  assert.ok(
    sql.includes('✅ APPLIED IN PRODUCTION'),
    'la migración tiene que declararse aplicada',
  );
  // La versión del ledger es lo que permite comprobarlo contra Producción sin creer
  // al archivo. Sin ella, «aplicada» es una afirmación que nadie puede verificar.
  assert.ok(
    sql.includes('20260820153919'),
    'la declaración tiene que llevar la versión EXACTA del ledger',
  );

  // Crear una tabla vacía es reversible; rellenarla desde otra tabla no lo es, y
  // además fabricaría memoria de empresas cuya observación nadie presenció.
  for (const forbidden of ['INSERT INTO public.prospect_candidates', 'DROP TABLE', 'DELETE FROM']) {
    assert.ok(!sql.includes(forbidden), `la migración no puede ${forbidden}`);
  }

  assert.ok(
    read('docs/agent1/provider-seen-memory-schema-proposal.md').length > 0,
    'la propuesta de esquema tiene que seguir escrita',
  );
});

/**
 * 🔴 RATCHET INVERTIDO, NO BORRADO (AGENT1-PROVIDER-SEEN-MEMORY-3).
 *
 * Antes: «el resolutor sigue devolviendo el no-op», porque encender la memoria antes
 * de aplicar la migración habría hecho que cada corrida escribiera contra una tabla
 * inexistente. La migración está aplicada, así que ese orden ya se cumplió y lo que
 * hay que defender ahora es el otro extremo: que encender no se haya llevado por
 * delante el fail-soft.
 */
test('§ 13 — Producción SÍ se enciende, y sin poder lanzar', () => {
  const code = stripTsComments(read(`${SERVER_DIR}/provider-seen-store.ts`));
  const resolver = code.slice(code.indexOf('export function resolveProviderSeenStore'));

  assert.ok(
    resolver.includes('createSupabaseProviderSeenStore'),
    'el resolutor de Producción devuelve el store persistente',
  );
  // 🔴 Un resolutor que puede lanzar convierte un problema de memoria en una corrida
  // caída. La credencial se resuelve DENTRO de un try y su fallo degrada a un puerto
  // que no persiste, jamás a una excepción.
  assert.ok(resolver.includes('try {'), 'la resolución de credencial va dentro de un try');
  assert.ok(
    resolver.includes('return CLIENT_UNAVAILABLE_PROVIDER_SEEN_STORE;'),
    'sin credencial se degrada a un puerto que no persiste',
  );
  // 🔴 Y el motivo de esa degradación NO puede ser el de «no hay tabla»: la tabla
  // existe. Confundirlos manda a quien depure a buscar una migración ya aplicada.
  assert.ok(
    !resolver.includes('NO_OP_PROVIDER_SEEN_STORE'),
    'el fallback del resolutor no puede reportar «autoridad pendiente»',
  );
  assert.notEqual(
    stripTsComments(read(`${SERVER_DIR}/provider-seen-store.ts`)).indexOf(
      "PROVIDER_SEEN_WRITE_SKIPPED_CLIENT_UNAVAILABLE = 'persistence_client_unavailable'",
    ),
    -1,
    'el motivo de «sin credencial» es distinto del de «sin autoridad»',
  );
});

/**
 * 🔴 RATCHET INVERTIDO, NO BORRADO (AGENT1-PROVIDER-SEEN-MEMORY-3).
 *
 * Antes: la lista de importadores tenía que estar VACÍA. Ahora tiene que ser
 * EXACTAMENTE la del cableado declarado. Sigue siendo la misma guarda —«nadie
 * cablea esto por su cuenta»— con la lista movida de 0 a 1: el puerto es el único
 * que conoce al adaptador, y todo lo demás pasa por `resolveProviderSeenStore()`.
 *
 * 🔴 Que la lista sea EXACTA y no un «al menos» es lo que impide que un tercer
 * módulo se construya su propio store con otra credencial: dos formas de elegir
 * credencial son dos formas de que una ruta lea de un sitio y otra escriba en otro.
 */
test('§ 13 — sólo el puerto importa el store persistente, y nadie más', () => {
  const importers: string[] = [];

  const walk = (dir: string): void => {
    for (const entry of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
        walk(rel);
        continue;
      }
      if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) continue;
      if (rel.endsWith('provider-seen-supabase-store.ts')) continue;
      if (stripTsComments(read(rel)).includes('provider-seen-supabase-store')) importers.push(rel);
    }
  };
  walk('src');

  assert.deepEqual(
    importers,
    ['src/server/prospect-batches/provider-seen/provider-seen-store.ts'],
    'el adaptador persistente se cablea SÓLO desde el puerto',
  );
});

test('§ 13 — el cableado de Producción pasa por el resolutor, no por el adaptador', () => {
  // Los dos puntos de consumo reales: la carga (capa gratuita) y la escritura
  // (ejecutor pagado). Los dos tienen que pedir el store al MISMO resolutor.
  for (const rel of [
    'src/server/prospect-batches/country-source-discovery/prepaid-novelty-gate.server.ts',
    LUSHA_ACTION,
  ]) {
    const code = stripTsComments(read(rel));
    assert.ok(code.includes('resolveProviderSeenStore'), `${rel} resuelve la memoria por el puerto`);
    assert.ok(
      !code.includes('createSupabaseProviderSeenStore'),
      `${rel} no puede construirse su propio store`,
    );
  }
});

// ─── AGENT1-PROVIDER-SEEN-MEMORY-2 ───────────────────────────────────────────

test('§ 4 — la memoria NO puede llamar a un proveedor: recordar nunca vuelve a pagar', () => {
  // 🔴 El peor defecto posible en este subsistema sería que el acto de recordar
  // provocara otra petición. Ni el store persistente ni el puerto pueden alcanzar un
  // cliente de proveedor, ni la red por su cuenta.
  const forbidden = [
    'executeLushaPreview',
    'buildLushaPreviewRequest',
    'apollo-client',
    'lusha-preview',
    'getLushaApiKey',
    'getApolloApiKey',
    'fetch(',
    'axios',
  ];
  for (const rel of PROVIDER_SEEN_SOURCES) {
    const code = stripTsComments(read(rel));
    for (const needle of forbidden) {
      assert.ok(!code.includes(needle), `${rel} alcanza un proveedor (${needle})`);
    }
  }
});

test('§ 4 — el store persistente sólo pide columnas de IDENTIDAD y ventana', () => {
  const code = stripTsComments(read(`${SERVER_DIR}/provider-seen-supabase-store.ts`));

  // Ninguna columna del perfil comprado aparece por ningún lado: recordar «ya vi este
  // id» no es conservar el dato que se pagó, y esa distinción es la que mantiene la
  // memoria fuera del alcance de una cláusula de redistribución.
  for (const forbidden of [
    'company_name', 'employee_count', 'industry', 'sector',
    'phone', 'email', 'address', 'revenue', 'linkedin',
  ]) {
    assert.ok(!code.includes(forbidden), `el store pide un campo del perfil comprado (${forbidden})`);
  }

  // Y no puede borrar: quitar una fila de memoria vuelve a hacernos pagar esa empresa
  // en silencio. La migración tampoco le concede DELETE.
  for (const forbidden of ['.delete(', '.upsert(', 'truncate']) {
    assert.ok(!code.includes(forbidden), `el store hace algo que la migración no le concede (${forbidden})`);
  }
});
