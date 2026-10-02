/**
 * CR — ETL de empresas con cédula jurídica (SOURCES-CR-CEDULA-BY-NAME-1)
 *
 * Carga en `source_company_snapshots` (source_key='cr_company_registry') las
 * sociedades costarricenses con cédula jurídica y nombre, combinando tres archivos
 * oficiales y gratuitos de datos.go.cr (CC-BY), para que el Agente 1 obtenga la
 * cédula por nombre dentro de la corrida:
 *
 *   --pymes=<xlsx>         MEIC «Lista de Pymes activas — Empresas activas».
 *   --recursos=<xlsx>      Hacienda SICOP «recursos» 2022-2024.
 *   --aclaraciones=<xlsx>  Hacienda SICOP «aclaraciones» 2022-2024.
 * (al menos uno; datos.go.cr exige un User-Agent de navegador para descargar).
 *
 * Uso (DRY-RUN por defecto: lee, cuenta y NO escribe):
 *   npx tsx scripts/source-catalog/run-cr-company-registry-etl.ts --pymes=… --recursos=… --aclaraciones=…
 *
 * Escritura REAL (sólo con autorización explícita de la dueña): añadir --apply.
 *
 * Guardrails: dry-run por defecto; `--apply` escribe SÓLO source_key=
 * 'cr_company_registry'; `assertLargeImportAllowed` antes de escribir; sólo lee
 * archivos locales; nunca personas físicas (sólo cédulas 3…; la columna
 * SOLICITANTE de aclaraciones no se lee). No toca `cr_sicop`.
 */

import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { createClient } from '@supabase/supabase-js';
// CLI-only: Node < 22 no trae WebSocket global y el cliente de Supabase lo necesita.
import { ensureNode20WebSocketShim } from '../peru/ensure-node20-websocket-shim';

import {
  buildCrCompanyRegistryRows,
  CR_COMPANY_REGISTRY_SOURCE_KEY,
  type CrSourceRecords,
} from '../../src/server/source-catalog/connectors/cr-registry/cr-company-registry-rows';
import { RECORD_IDENTITY_ON_CONFLICT } from '../../src/server/source-catalog/record-identity';
import { assertLargeImportAllowed } from '../../src/server/source-catalog/large-import-guardrail';

const UPSERT_CHUNK = 1000;

function value(argv: readonly string[], name: string): string | null {
  const hit = argv.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

/** Primera hoja del XLSX como registros columna → valor. */
function readFirstSheet(path: string): Record<string, unknown>[] {
  const workbook = XLSX.read(readFileSync(path), { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const paths = { pymes: value(argv, 'pymes'), recursos: value(argv, 'recursos'), aclaraciones: value(argv, 'aclaraciones') };
  if (!paths.pymes && !paths.recursos && !paths.aclaraciones) {
    throw new Error('config_invalid: indica al menos --pymes, --recursos o --aclaraciones');
  }
  console.log(`CR COMPANY REGISTRY ETL — ${apply ? 'APPLY' : 'DRY-RUN (no escribe)'}`);

  const records: CrSourceRecords = {
    pymes: paths.pymes ? readFirstSheet(paths.pymes) : [],
    recursos: paths.recursos ? readFirstSheet(paths.recursos) : [],
    aclaraciones: paths.aclaraciones ? readFirstSheet(paths.aclaraciones) : [],
  };
  const year = Number(value(argv, 'year') ?? new Date().getUTCFullYear());
  const rows = buildCrCompanyRegistryRows(records, { sourceYear: year, importedAt: new Date().toISOString() }).filter(
    (row) => row.record_identity_key !== null,
  );

  const byOrigin: Record<string, number> = {};
  for (const row of rows) byOrigin[String(row.raw_data.origin)] = (byOrigin[String(row.raw_data.origin)] ?? 0) + 1;
  const cores = new Map<string, number>();
  for (const row of rows) cores.set(row.normalized_legal_name, (cores.get(row.normalized_legal_name) ?? 0) + 1);
  const unique = rows.filter((row) => cores.get(row.normalized_legal_name) === 1).length;

  console.log(`  Registros leídos: pymes ${records.pymes?.length ?? 0} · recursos ${records.recursos?.length ?? 0} · aclaraciones ${records.aclaraciones?.length ?? 0}`);
  console.log(`  Sociedades (cédula 3…): ${rows.length} — por origen ${JSON.stringify(byOrigin)}`);
  console.log(`  Con nombre único (cédula asignable con seguridad): ${unique} (${((100 * unique) / Math.max(rows.length, 1)).toFixed(1)} %)`);

  if (!apply) {
    console.log('  DRY-RUN: no se escribió nada. Usa --apply (con autorización) para persistir.');
    return;
  }

  assertLargeImportAllowed({
    sourceKey: CR_COMPANY_REGISTRY_SOURCE_KEY,
    countryCode: 'CR',
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
