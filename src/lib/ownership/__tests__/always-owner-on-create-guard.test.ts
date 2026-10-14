// ALWAYS-OWNER-ON-CREATE-1 — Guarda estática: ningún camino crea una empresa
// (`accounts`) o un lote (`prospect_batches`) sin responsable.
//
// Recorre src/ (sin comentarios, sin tests), encuentra cada `.from('accounts')` /
// `.from('prospect_batches')` encadenado a `.insert(` / `.upsert(` y exige que:
//   1. el fichero use el helper compartido (`resolveOwnerForCreate` /
//      `requireOwnerForCreate`), y
//   2. el `owner_id:` más cercano al sitio de escritura salga del helper (o de una
//      variable asignada desde él) — nunca `null`, `?? null` ni `|| null`.
//
// Un camino nuevo que se salte el responsable rompe esta guarda.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const SRC_ROOT = path.resolve(__dirname, '../../..');
const TABLES = ['accounts', 'prospect_batches'] as const;
const HELPER_CALL = /\b(?:resolveOwnerForCreate|requireOwnerForCreate)\s*\(/;
/** Ventana (en líneas) alrededor del sitio donde debe estar el `owner_id:` del payload. */
const WINDOW_BEFORE_LINES = 130;
const WINDOW_AFTER_LINES = 60;

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue;
      out.push(...listSourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry) && !entry.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

interface WriteSite {
  file: string;
  line: number;
  table: string;
  offset: number;
}

export function findCreateSites(file: string, code: string): WriteSite[] {
  const sites: WriteSite[] = [];
  const fromRe = /\.from\(\s*(['"])(accounts|prospect_batches)\1\s*\)/g;
  for (let m = fromRe.exec(code); m; m = fromRe.exec(code)) {
    // Sólo la cadena que sigue: hasta el siguiente `.from(` o 400 caracteres.
    const tail = code.slice(m.index + m[0].length, m.index + m[0].length + 400);
    const nextFrom = tail.search(/\.from\(/);
    const chain = nextFrom >= 0 ? tail.slice(0, nextFrom) : tail;
    const op = /^\s*\.(\w+)\(/.exec(chain);
    if (!op || (op[1] !== 'insert' && op[1] !== 'upsert')) continue;
    sites.push({
      file,
      table: m[2],
      offset: m.index,
      line: code.slice(0, m.index).split('\n').length,
    });
  }
  return sites;
}

function ownerValueIsResolved(code: string, value: string): boolean {
  const v = value.trim();
  if (/^null\b/.test(v) || /(\?\?|\|\|)\s*null\s*$/.test(v)) return false;
  if (HELPER_CALL.test(v)) return true;
  const ident = /^([A-Za-z_$][\w$]*)$/.exec(v);
  if (!ident) return false;
  const assigned = new RegExp(
    `\\b${ident[1]}\\b\\s*(?::[^=]+)?=\\s*(?:await\\s+)?(?:resolveOwnerForCreate|requireOwnerForCreate)\\s*\\(`,
  );
  return assigned.test(code);
}

function nearestOwnerValue(code: string, site: WriteSite): string | null {
  const lines = code.split('\n');
  const from = Math.max(0, site.line - 1 - WINDOW_BEFORE_LINES);
  const to = Math.min(lines.length, site.line - 1 + WINDOW_AFTER_LINES);
  let best: { distance: number; value: string } | null = null;
  for (let i = from; i < to; i += 1) {
    const m = /\bowner_id\s*:\s*(.+?),?\s*$/.exec(lines[i]);
    if (!m) continue;
    // Valores multilínea (`requireOwnerForCreate(\n ...`): basta con la cabecera.
    const distance = Math.abs(i - (site.line - 1));
    if (!best || distance < best.distance) best = { distance, value: m[1] };
  }
  return best?.value ?? null;
}

const files = listSourceFiles(SRC_ROOT);
const sites = files.flatMap((file) => {
  const code = stripComments(readFileSync(file, 'utf8'));
  return findCreateSites(path.relative(SRC_ROOT, file), code).map((s) => ({ ...s, code }));
});

describe('ALWAYS-OWNER-ON-CREATE-1 — guarda estática de responsable al crear', () => {
  it('el detector encuentra los caminos conocidos (si esto falla, el detector se rompió)', () => {
    const found = new Set(sites.map((s) => `${s.file}#${s.table}`));
    for (const known of [
      'modules/accounts/actions.ts#accounts',
      'modules/prospect-batches/actions.ts#accounts',
      'modules/prospect-batches/actions.ts#prospect_batches',
      'server/agents/contact-enrichment-toolkit/hubspot-account-resolution-deps.ts#accounts',
      'server/agents/prospecting-toolkit/candidate-writer.ts#prospect_batches',
      'server/agents/prospecting-toolkit/structured-source-candidate-writer.ts#prospect_batches',
      'server/agents/prospect-generation.ts#prospect_batches',
      'server/prospect-batches/lusha-canonical-batch.ts#prospect_batches',
      'modules/prospect-batches/chat-wizard-execution/wizard-idempotency.ts#prospect_batches',
      'app/api/prospect-batches/create-import-batch/route.ts#prospect_batches',
    ]) {
      assert.ok(found.has(known), `no se detectó el camino conocido ${known}`);
    }
    assert.ok(sites.length >= 12, `se esperaban al menos 12 sitios de creación, hay ${sites.length}`);
  });

  for (const site of sites) {
    it(`${site.file}:${site.line} (${site.table}) nace con responsable`, () => {
      assert.ok(
        HELPER_CALL.test(site.code),
        `${site.file} crea en ${site.table} sin usar resolveOwnerForCreate/requireOwnerForCreate`,
      );
      const value = nearestOwnerValue(site.code, site);
      assert.ok(value, `${site.file}:${site.line} crea en ${site.table} sin owner_id en el payload`);
      assert.ok(
        ownerValueIsResolved(site.code, value),
        `${site.file}:${site.line} — owner_id: ${value} no sale del helper (o puede quedar null)`,
      );
    });
  }

  it('el detector rechaza un payload sin responsable o con `?? null`', () => {
    const bad = "await db.from('accounts').insert({ name, owner_id: input.owner_id ?? null })";
    const [site] = findCreateSites('x.ts', bad);
    assert.ok(site);
    assert.equal(ownerValueIsResolved(bad, nearestOwnerValue(bad, site) ?? ''), false);
    const missing = "await db.from('prospect_batches').upsert({ name })";
    const [site2] = findCreateSites('y.ts', missing);
    assert.ok(site2);
    assert.equal(nearestOwnerValue(missing, site2), null);
  });
});
