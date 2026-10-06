/**
 * Ecuador name→RUC wiring (SOURCES-EC-RUC-BY-NAME-1 · SOURCES-EC-CLOSE-1).
 *
 * The shared factory builds the Ecuador CHAIN (SCVS registry → acronyms → SRI →
 * trade name → July snapshot). Static guards + one real execution of the shared
 * factory with a fake read-only client. Zero real I/O.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const strip = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const read = (rel: string) => strip(readFileSync(join(process.cwd(), rel), 'utf8'));

describe('cableado y guardas estáticas', () => {
  it('el factory compartido construye la cadena de Ecuador junto a CO y DO', () => {
    const wiring = read('src/server/prospect-batches/official-source-resolvers.ts');
    assert.match(wiring, /createColombiaOfficialSourceResolver\(/);
    assert.match(wiring, /createDominicanOfficialSourceResolver\(/);
    assert.match(wiring, /buildEcuadorOfficialSourceResolver\(snapshotClient\)/);
    // El resolvedor viejo daba una palabra suelta («MOVISTAR S.A.», inactiva) como RUC seguro.
    assert.doesNotMatch(wiring, /createEcuadorOfficialSourceResolver/);
  });

  it('la cadena lee las cinco fuentes en orden, con empleados, y sólo lee', () => {
    const chain = read('src/server/prospect-batches/ecuador-official-source-chain.ts');
    const order = [
      'EC_SCVS_REGISTRY_SOURCE_KEY, normalizeEcCompanyCore',
      'EC_SCVS_ALIAS_REGISTRY_SOURCE_KEY, normalizeEcCompanyCore',
      'EC_SRI_REGISTRY_SOURCE_KEY, normalizeEcEntityCore',
      'EC_SRI_TRADE_NAME_REGISTRY_SOURCE_KEY, normalizeEcEntityCore, true',
      'EC_SCVS_LEGACY_SOURCE_KEY, normalizeEcCompanyCore',
    ].map((needle) => chain.indexOf(needle));
    assert.ok(order.every((at) => at > 0), String(order));
    assert.deepEqual([...order].sort((a, b) => a - b), order);
    assert.match(chain, /withWorkforce: true/);
    assert.match(chain, /singleWordIsSignalOnly: true/);
    assert.match(chain, /largeCompanyStrongMinWorkers: EC_LARGE_COMPANY_STRONG_MIN_WORKERS/);
    assert.doesNotMatch(chain, /\.(insert|update|delete|upsert|rpc)\s*\(/);
    assert.doesNotMatch(chain, /createClient\s*\(|createSupabaseAdminClient\s*\(|process\.env|\bfetch\s*\(/);
  });
});
