/**
 * HN OCDS — ETL del RTN de personas jurídicas (SOURCES-HN-RTN-BY-NAME-1)
 *
 * 🔴 REEMPLAZADO por `run-hn-sources-etl.ts` (SOURCES-HN-CLOSE-1): sólo dry-run.
 *
 * Carga en `source_company_snapshots` (source_key='hn_ocds_rtn_registry') una fila
 * por RTN de PERSONA JURÍDICA que aparece como proveedor u oferente en las
 * publicaciones OCDS de Honduras (ONCAE y SEFIN) del registro de Open Contracting
 * (CC BY 4.0). Nunca personas naturales, cédulas ni pasaportes.
 *
 *   --dir=<carpeta> con los «<publicación>_<año>.jsonl.gz» bajados de
 *     https://fastly.data.open-contracting.org/downloads/honduras_oncae/…/<año>.jsonl.gz y
 *     https://fastly.data.open-contracting.org/downloads/honduras_sefin_bulk/…/<año>.jsonl.gz
 *
 * Uso (DRY-RUN por defecto: lee, cuenta y NO escribe):
 *   npx tsx scripts/source-catalog/run-hn-ocds-rtn-etl.ts --dir=…
 *
 * Escritura REAL (sólo con autorización explícita de la dueña):
 *   npx tsx scripts/source-catalog/run-hn-ocds-rtn-etl.ts --dir=… --apply
 *
 * Guardrails: dry-run por defecto; `--apply` escribe SÓLO source_key=
 * 'hn_ocds_rtn_registry'; `assertLargeImportAllowed` antes de escribir.
 */

import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { createReadStream, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import { createClient } from '@supabase/supabase-js';
// CLI-only: Node < 22 no trae WebSocket global y el cliente de Supabase lo necesita.
import { ensureNode20WebSocketShim } from '../peru/ensure-node20-websocket-shim';

import {
  buildHnOcdsRtnRows,
  extractHondurasSuppliers,
  HN_OCDS_RTN_SOURCE_KEY,
  type HnOcdsSupplier,
} from '../../src/server/source-catalog/connectors/hn-contrataciones-abiertas/hn-ocds-rtn-registry-rows';
import { RECORD_IDENTITY_ON_CONFLICT } from '../../src/server/source-catalog/record-identity';
import { assertLargeImportAllowed } from '../../src/server/source-catalog/large-import-guardrail';

const UPSERT_CHUNK = 1000;
const FILE_PATTERN = /^honduras_(oncae|sefin_bulk)_\d{4}\.jsonl\.gz$/;

async function main(): Promise<void> {
  const dirArg = process.argv.find((arg) => arg.startsWith('--dir='));
  if (!dirArg) throw new Error('config_invalid: falta --dir=<carpeta con los .jsonl.gz de Honduras>');
  const dir = dirArg.slice('--dir='.length);
  const apply = process.argv.includes('--apply');
  // SOURCES-HN-CLOSE-1 — reemplazado por run-hn-sources-etl.ts (núcleo por estructura,
  // alias y marca MIPYME). Recargar desde aquí volvería al núcleo viejo.
  if (apply) throw new Error('superseded: usa scripts/source-catalog/run-hn-sources-etl.ts --apply --only=registry');
  console.log('HN OCDS RTN ETL — DRY-RUN (no escribe)');

  const files = readdirSync(dir).filter((file) => FILE_PATTERN.test(file)).sort();
  if (files.length === 0) throw new Error('config_invalid: no hay .jsonl.gz de Honduras en la carpeta');

  const suppliers: HnOcdsSupplier[] = [];
  for (const file of files) {
    const reader = createInterface({ input: createReadStream(join(dir, file)).pipe(createGunzip()), crlfDelay: Infinity });
    let releases = 0;
    for await (const line of reader) {
      if (line.trim().length === 0) continue;
      let release: unknown;
      try {
        release = JSON.parse(line);
      } catch {
        continue;
      }
      releases++;
      suppliers.push(...extractHondurasSuppliers(release));
    }
    console.log(`  ${file}: ${releases} versiones`);
  }

  const rows = buildHnOcdsRtnRows(suppliers, { importedAt: new Date().toISOString() }).filter(
    (row) => row.record_identity_key !== null,
  );
  const cores = new Map<string, number>();
  for (const row of rows) cores.set(row.normalized_legal_name, (cores.get(row.normalized_legal_name) ?? 0) + 1);
  const unique = rows.filter((row) => cores.get(row.normalized_legal_name) === 1).length;

  console.log(`  Personas jurídicas con RTN: ${rows.length}`);
  console.log(`  Con nombre único (RTN asignable con seguridad): ${unique} (${((100 * unique) / Math.max(rows.length, 1)).toFixed(1)} %)`);

  if (!apply) {
    console.log('  DRY-RUN: no se escribió nada. Usa --apply (con autorización) para persistir.');
    return;
  }

  assertLargeImportAllowed({ sourceKey: HN_OCDS_RTN_SOURCE_KEY, countryCode: 'HN', estimatedRows: rows.length, isDryRun: false });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('supabase_service_role_not_configured');
  ensureNode20WebSocketShim();
  const client = createClient(url, key);

  let upserted = 0;
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK);
    const { error } = await client.from('source_company_snapshots').upsert(chunk, { onConflict: RECORD_IDENTITY_ON_CONFLICT });
    if (error) throw new Error(`upsert_failed_at_offset_${i}: ${error.message}`);
    upserted += chunk.length;
  }
  console.log(`  rowsUpserted = ${upserted}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
