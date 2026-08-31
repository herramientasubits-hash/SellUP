/**
 * BR PROD STORAGE RIGHT-SIZING — byte anatomy of the CURRENT persisted row, from REAL Receita data.
 *
 * Reads a bounded, deterministic sample of the local 2026-07 dataset, builds rows with the REAL
 * snapshot builder, and reports where the bytes actually are. No database. No network. No writes.
 */
import {
  resolveCutERealDataset,
  extractCutERealSample,
  buildCutERealSnapshots,
  CUT_E_DEFAULT_BOUNDS,
} from '../../../src/server/source-catalog/connectors/br-receita-cnpj/__tests__/support/br-receita-cut-e-real-sample';

const TARGET = Number(process.env.BR_SAMPLE_ROWS ?? '20000');
const MB_PER_PART = Number(process.env.BR_MB_PER_PART ?? '24');

const resolved = await resolveCutERealDataset();
if (resolved.skip !== false) {
  console.error(`dataset unavailable: ${resolved.skip}`);
  process.exit(2);
}

const sample = await extractCutERealSample(resolved.layout, {
  ...CUT_E_DEFAULT_BOUNDS,
  maxBytesPerEstablishmentPart: MB_PER_PART * 1024 * 1024,
  maxAcceptedEstablishments: TARGET,
  maxBytesPerCompanyWindow: 96 * 1024 * 1024,
  maxKeyBands: 48,
});

const built = buildCutERealSnapshots(sample);
const rows = built.snapshots;
console.log(JSON.stringify({ meters: sample.meters, summary: built.summary }, null, 2));

const utf8 = (s: string) => Buffer.byteLength(s, 'utf8');
type Acc = { n: number; bytes: number; nulls: number; max: number };
const mk = (): Acc => ({ n: 0, bytes: 0, nulls: 0, max: 0 });
const fieldBytes = new Map<string, Acc>();
const note = (k: string, v: unknown) => {
  let a = fieldBytes.get(k);
  if (!a) { a = mk(); fieldBytes.set(k, a); }
  a.n += 1;
  if (v === null || v === undefined) { a.nulls += 1; return; }
  const b = Array.isArray(v) ? utf8(JSON.stringify(v)) : utf8(String(v));
  a.bytes += b;
  if (b > a.max) a.max = b;
};

let rawJsonBytes = 0;
let legalNameBytes = 0;
let cnaeSecCount = 0;

for (const r of rows) {
  rawJsonBytes += utf8(JSON.stringify(r.raw_data));
  legalNameBytes += utf8(r.legal_name ?? '');
  for (const [k, v] of Object.entries(r.raw_data)) note(k, v);
  cnaeSecCount += r.raw_data.cnae_secondary_codes.length;
}

const n = rows.length;
const per = (x: number) => +(x / n).toFixed(2);

console.log('\n=== SAMPLE ===');
console.log(`rows built: ${n}`);
console.log(`avg raw_data JSON text bytes/row: ${per(rawJsonBytes)}`);
console.log(`avg legal_name bytes/row:          ${per(legalNameBytes)}`);
console.log(`avg cnae_secondary_codes/row:      ${per(cnaeSecCount)}`);

console.log('\n=== raw_data FIELD ANATOMY (payload bytes only, key names excluded) ===');
const sorted = [...fieldBytes.entries()].sort((a, b) => b[1].bytes - a[1].bytes);
for (const [k, a] of sorted) {
  console.log(
    `${k.padEnd(28)} avgB=${String(per(a.bytes)).padStart(8)}  nullRate=${((a.nulls / a.n) * 100).toFixed(1).padStart(5)}%  maxB=${String(a.max).padStart(6)}  keyNameB=${utf8(k) + 3}`,
  );
}

const keyOverhead = [...fieldBytes.keys()].reduce((s, k) => s + utf8(k) + 4, 0);
console.log(`\njson key-name + punctuation overhead per row: ~${keyOverhead} B`);
