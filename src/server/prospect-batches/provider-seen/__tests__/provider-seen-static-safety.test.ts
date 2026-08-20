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

test('§ 13 — este PR no aplica ni escribe migraciones', () => {
  const migrations = readdirSync(path.join(ROOT, 'supabase/migrations')).filter((f) =>
    f.endsWith('.sql'),
  );
  // La propuesta vive en un documento, no en un fichero ejecutable: § 13 pide
  // STOP y reportar antes de improvisar el esquema.
  for (const file of migrations) {
    assert.ok(
      !file.toLowerCase().includes('provider_seen'),
      `no debe existir una migración de provider-seen todavía: ${file}`,
    );
  }
  assert.ok(
    read('docs/agent1/provider-seen-memory-schema-proposal.md').length > 0,
    'la propuesta de esquema tiene que estar escrita',
  );
});
