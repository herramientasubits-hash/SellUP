/**
 * MX CompraNet — ETL del RFC de personas morales (SOURCES-MX-RFC-BY-NAME-1)
 *
 * Carga en `source_company_snapshots` (source_key='mx_compranet_rfc_registry')
 * una fila por RFC de PERSONA MORAL que aparece en los contratos de CompraNet
 * (nunca personas físicas ni extranjeros), con su razón social, el núcleo del
 * nombre y la estratificación del contrato más reciente.
 *
 *   --dir=<carpeta> con los CSV anuales «Contratos_CompraNet<año>.csv» (Latin-1),
 *     de https://upcp-compranet.buengobierno.gob.mx/cnetassets/datos_abiertos_contratos_expedientes/
 *
 * Uso (DRY-RUN por defecto: lee, cuenta y NO escribe):
 *   npx tsx scripts/source-catalog/run-mx-compranet-rfc-etl.ts --dir=…
 *
 * Escritura REAL (sólo con autorización explícita de la dueña):
 *   npx tsx scripts/source-catalog/run-mx-compranet-rfc-etl.ts --dir=… --apply
 *
 * Guardrails: dry-run por defecto; `--apply` escribe SÓLO source_key=
 * 'mx_compranet_rfc_registry'; `assertLargeImportAllowed` antes de escribir; sólo
 * lee archivos locales. Reanudable con --offset.
 */

import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { createReadStream, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
// CLI-only: Node < 22 no trae WebSocket global y el cliente de Supabase lo necesita.
import { ensureNode20WebSocketShim } from '../peru/ensure-node20-websocket-shim';

import {
  buildMxCompranetRfcRows,
  indexCompranetHeader,
  MX_COMPRANET_RFC_SOURCE_KEY,
  type MxCompranetContract,
} from '../../src/server/source-catalog/connectors/compranet-mexico/mx-compranet-rfc-rows';
import { CsvRowParser } from '../../src/server/source-catalog/connectors/rns-argentina/streaming-csv';
import { RECORD_IDENTITY_ON_CONFLICT } from '../../src/server/source-catalog/record-identity';
import { assertLargeImportAllowed } from '../../src/server/source-catalog/large-import-guardrail';

const UPSERT_CHUNK = 1000;
const FILE_PATTERN = /^Contratos_CompraNet(\d{4})\.csv$/;

type Config = { dir: string; apply: boolean; offset: number };

function parseArgs(argv: readonly string[]): Config {
  const value = (name: string): string | null => {
    const hit = argv.find((arg) => arg.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : null;
  };
  const dir = value('dir');
  if (!dir) throw new Error('config_invalid: falta --dir=<carpeta con los CSV de CompraNet>');
  const offset = Number(value('offset') ?? 0);
  if (!Number.isInteger(offset) || offset < 0) throw new Error('config_invalid: --offset debe ser un entero ≥ 0');
  return { dir, apply: argv.includes('--apply'), offset };
}

async function* contractsOf(path: string, year: number): AsyncGenerator<MxCompranetContract> {
  const parser = new CsvRowParser(',');
  let index: ReturnType<typeof indexCompranetHeader> | undefined;
  const emit = function* (rows: string[][]) {
    for (const cells of rows) {
      if (index === undefined) {
        index = indexCompranetHeader(cells);
        if (index === null) throw new Error(`config_invalid: ${path} no tiene las columnas rfc / Proveedor o contratista`);
        continue;
      }
      if (index === null) return;
      yield {
        rfc: cells[index.rfc] ?? null,
        supplier: cells[index.supplier] ?? null,
        stratification: index.stratification >= 0 ? cells[index.stratification] ?? null : null,
        year,
      };
    }
  };
  for await (const chunk of createReadStream(path, { encoding: 'latin1', highWaterMark: 1 << 20 })) {
    yield* emit(parser.push(chunk as string));
  }
  yield* emit(parser.end());
}

async function main(): Promise<void> {
  const config = parseArgs(process.argv.slice(2));
  console.log(`MX COMPRANET RFC ETL — ${config.apply ? 'APPLY' : 'DRY-RUN (no escribe)'}`);

  const files = readdirSync(config.dir).filter((file) => FILE_PATTERN.test(file)).sort();
  if (files.length === 0) throw new Error('config_invalid: no hay CSV de CompraNet en la carpeta');

  const contracts: MxCompranetContract[] = [];
  for (const file of files) {
    const year = Number(FILE_PATTERN.exec(file)![1]);
    let count = 0;
    for await (const contract of contractsOf(join(config.dir, file), year)) {
      contracts.push(contract);
      count++;
    }
    console.log(`  ${file}: ${count} contratos`);
  }

  const rows = buildMxCompranetRfcRows(contracts, { importedAt: new Date().toISOString() }).filter(
    (row) => row.record_identity_key !== null,
  );
  const cores = new Map<string, number>();
  for (const row of rows) cores.set(row.normalized_legal_name, (cores.get(row.normalized_legal_name) ?? 0) + 1);
  const unique = rows.filter((row) => cores.get(row.normalized_legal_name) === 1).length;
  const large = rows.filter((row) => row.raw_data.stratification === 'GRANDE' || row.raw_data.stratification === 'NO MIPYME').length;

  console.log(`  Personas morales con RFC: ${rows.length}`);
  console.log(`  Con nombre único (RFC asignable con seguridad): ${unique} (${((100 * unique) / Math.max(rows.length, 1)).toFixed(1)} %)`);
  console.log(`  Estratificación GRANDE o NO MIPYME: ${large}`);

  if (!config.apply) {
    console.log('  DRY-RUN: no se escribió nada. Usa --apply (con autorización) para persistir.');
    return;
  }

  assertLargeImportAllowed({
    sourceKey: MX_COMPRANET_RFC_SOURCE_KEY,
    countryCode: 'MX',
    estimatedRows: rows.length,
    isDryRun: false,
  });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('supabase_service_role_not_configured');
  ensureNode20WebSocketShim();
  const client = createClient(url, key);

  let upserted = 0;
  for (let i = config.offset; i < rows.length; i += UPSERT_CHUNK) {
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
