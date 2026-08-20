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
 * 🔴 RATCHET INVERTIDO, NO BORRADO (AGENT1-PROVIDER-SEEN-MEMORY-2).
 *
 * Hasta este hito la garantía era «no existe ninguna migración de provider-seen»,
 * porque § 13 mandaba PARAR y reportar antes de improvisar un esquema. Ese reporte
 * ya se entregó y la dueña autorizó ESCRIBIRLA. Lo que la prueba defiende cambia de
 * lado, pero la superficie protegida es la misma y sigue siendo la peligrosa: que
 * escribir el esquema no se convierta, por inercia, en aplicarlo o en encenderlo.
 *
 * Ahora se exige exactamente una migración, declarada NO aplicada, y un runtime que
 * sigue sin persistir.
 */
test('§ 13 — la migración está ESCRITA, declarada NO aplicada, y es UNA sola', () => {
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
  // si la aplica. Si el archivo dijera que ya está en Producción, la decisión se
  // habría tomado sola.
  const sql = read(`supabase/migrations/${providerSeen[0]}`);
  assert.ok(
    sql.includes('APPLIED IN PRODUCTION: NO'),
    'la migración tiene que declararse NO aplicada',
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

test('§ 13 — Producción NO se enciende: el resolutor sigue devolviendo el no-op', () => {
  const code = stripTsComments(read(`${SERVER_DIR}/provider-seen-store.ts`));
  const resolver = code.slice(code.indexOf('export function resolveProviderSeenStore'));

  assert.ok(
    resolver.includes('return NO_OP_PROVIDER_SEEN_STORE;'),
    'el resolutor de Producción sigue devolviendo el no-op',
  );
  // 🔴 Encender la memoria ANTES de aplicar la migración haría que cada corrida
  // escribiera contra una tabla que no existe. El orden es: aplicar, luego encender.
  assert.ok(
    !resolver.includes('createSupabaseProviderSeenStore'),
    'el store persistente no puede cablearse desde el resolutor todavía',
  );
});

test('§ 13 — ningún módulo de Producción importa todavía el store persistente', () => {
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

  assert.deepEqual(importers, [], 'el adaptador persistente existe y está probado, pero no cableado');
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
