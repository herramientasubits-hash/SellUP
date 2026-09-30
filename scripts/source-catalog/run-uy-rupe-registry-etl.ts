/**
 * UY RUPE — ETL del registro de empresas (SOURCES-UY-RUT-BY-NAME-1)
 *
 * Carga en `source_company_snapshots` (source_key='uy_rupe_registry') las
 * EMPRESAS uruguayas ACTIVAS del RUPE (Registro Único de Proveedores del Estado,
 * datos abiertos de ARCE), con filas MÍNIMAS (RUT, razón social, núcleo del nombre,
 * departamento), para que el Agente 1 obtenga el RUT por nombre dentro de la corrida.
 *
 *   --csv=<archivo>  el CSV mensual del RUPE (público, ~13 MB, catalogodatos.gub.uy,
 *                    conjunto «arce-registro-unico-de-proveedores-del-estado-rupe-<año>»).
 *
 * Uso (DRY-RUN por defecto: lee, cuenta y NO escribe):
 *   npx tsx scripts/source-catalog/run-uy-rupe-registry-etl.ts --csv=…
 *
 * Escritura REAL (sólo con autorización explícita de la dueña):
 *   npx tsx scripts/source-catalog/run-uy-rupe-registry-etl.ts --csv=… --apply
 *
 * Guardrails:
 *   - Dry-run por defecto; `--apply` escribe SÓLO source_key='uy_rupe_registry'.
 *   - `assertLargeImportAllowed` antes de cualquier escritura.
 *   - Nunca guarda personas físicas ni domicilios.
 *   - No toca accounts, prospect_candidates ni otras fuentes. Sólo lee un archivo local.
 */

import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { createClient } from '@supabase/supabase-js';
// CLI-only: Node < 22 no trae WebSocket global y el cliente de Supabase lo necesita.
import { ensureNode20WebSocketShim } from '../peru/ensure-node20-websocket-shim';

import {
  buildUyRupeRegistryRow,
  UY_RUPE_REGISTRY_SOURCE_KEY,
  type UyRupeRegistryRow,
} from '../../src/server/source-catalog/connectors/rupe-uruguay/uy-rupe-registry-row';
import { readCsvFile } from '../../src/server/source-catalog/connectors/rns-argentina/streaming-csv';
import { RECORD_IDENTITY_ON_CONFLICT } from '../../src/server/source-catalog/record-identity';
import { assertLargeImportAllowed } from '../../src/server/source-catalog/large-import-guardrail';

const UPSERT_CHUNK = 1000;

type Config = { csv: string; apply: boolean; year: number };

function parseArgs(argv: readonly string[]): Config {
  const value = (name: string): string | null => {
    const hit = argv.find((arg) => arg.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : null;
  };
  const csv = value('csv');
  if (!csv) throw new Error('config_invalid: falta --csv=<archivo del RUPE>');
  const year = Number(value('year') ?? new Date().getUTCFullYear());
  if (!Number.isInteger(year)) throw new Error('config_invalid: --year debe ser entero');
  return { csv, apply: argv.includes('--apply'), year };
}

async function main(): Promise<void> {
  const config = parseArgs(process.argv.slice(2));
  console.log(`UY RUPE REGISTRY ETL — ${config.apply ? 'APPLY' : 'DRY-RUN (no escribe)'}`);

  const importedAt = new Date().toISOString();
  const byRut = new Map<string, UyRupeRegistryRow>();
  let recordsRead = 0;
  for await (const record of readCsvFile(config.csv, { delimiter: ';' })) {
    recordsRead++;
    const row = buildUyRupeRegistryRow(record, { sourceYear: config.year, importedAt });
    if (row !== null && row.record_identity_key !== null && !byRut.has(row.normalized_tax_id)) {
      byRut.set(row.normalized_tax_id, row);
    }
  }

  const rows = [...byRut.values()].sort((a, b) => a.normalized_tax_id.localeCompare(b.normalized_tax_id));
  const cores = new Map<string, number>();
  for (const row of rows) cores.set(row.normalized_legal_name, (cores.get(row.normalized_legal_name) ?? 0) + 1);
  const unique = rows.filter((row) => cores.get(row.normalized_legal_name) === 1).length;

  console.log(`  Registros leídos: ${recordsRead}`);
  console.log(`  Empresas uruguayas activas (con forma societaria): ${rows.length}`);
  console.log(`  Con nombre único (RUT asignable con seguridad): ${unique} (${((100 * unique) / Math.max(rows.length, 1)).toFixed(1)} %)`);

  if (!config.apply) {
    console.log('  DRY-RUN: no se escribió nada. Usa --apply (con autorización) para persistir.');
    return;
  }

  assertLargeImportAllowed({
    sourceKey: UY_RUPE_REGISTRY_SOURCE_KEY,
    countryCode: 'UY',
    estimatedRows: rows.length,
    isDryRun: false,
  });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('supabase_service_role_not_configured');
  ensureNode20WebSocketShim();
  const client = createClient(url, key);

  let upserted = 0;
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK);
    const { error } = await client
      .from('source_company_snapshots')
      .upsert(chunk, { onConflict: RECORD_IDENTITY_ON_CONFLICT });
    if (error) throw new Error(`upsert_failed_at_offset_${i}: ${error.message}`);
    upserted += chunk.length;
  }
  console.log(`  rowsUpserted = ${upserted}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
