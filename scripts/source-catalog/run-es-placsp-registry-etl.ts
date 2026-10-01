/**
 * ES PLACSP — ETL de sociedades adjudicatarias (SOURCES-ES-NIF-BY-NAME-1)
 *
 * Carga en `source_company_snapshots` (source_key='es_placsp_registry') las
 * sociedades que ganaron contratos públicos en España, con filas MÍNIMAS (NIF,
 * razón social, núcleo del nombre), para que el Agente 1 obtenga el NIF por nombre
 * dentro de la corrida.
 *
 *   --dir=<carpeta>  una o varias carpetas (separadas por coma) con los .atom de la
 *                    sindicación «licitacionesPerfilesContratanteCompleto3» de la
 *                    PLACSP descomprimidos (mensuales o anuales; públicos y
 *                    gratuitos). Si una sociedad aparece con varios nombres, se
 *                    queda el PRIMERO leído.
 *
 * Uso (DRY-RUN por defecto: lee, cuenta y NO escribe):
 *   npx tsx scripts/source-catalog/run-es-placsp-registry-etl.ts --dir=…
 *
 * Escritura REAL (sólo con autorización explícita de la dueña, y DESPUÉS de aplicar
 * la migración 141, que permite el tipo 'NIF'):
 *   npx tsx scripts/source-catalog/run-es-placsp-registry-etl.ts --dir=… --apply
 *
 * Guardrails: dry-run por defecto; `--apply` escribe SÓLO source_key=
 * 'es_placsp_registry'; `assertLargeImportAllowed` antes de escribir; sólo lee
 * archivos locales; nunca personas físicas (sólo NIF de sociedad con control válido).
 */

import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
// CLI-only: Node < 22 no trae WebSocket global y el cliente de Supabase lo necesita.
import { ensureNode20WebSocketShim } from '../peru/ensure-node20-websocket-shim';

import {
  buildEsPlacspRegistryRow,
  ES_PLACSP_REGISTRY_SOURCE_KEY,
  extractPlacspWinners,
  type EsPlacspRegistryRow,
} from '../../src/server/source-catalog/connectors/placsp-spain/es-placsp-registry-rows';
import { RECORD_IDENTITY_ON_CONFLICT } from '../../src/server/source-catalog/record-identity';
import { assertLargeImportAllowed } from '../../src/server/source-catalog/large-import-guardrail';

const UPSERT_CHUNK = 1000;

type Config = { dirs: string[]; apply: boolean; year: number };

function parseArgs(argv: readonly string[]): Config {
  const value = (name: string): string | null => {
    const hit = argv.find((arg) => arg.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : null;
  };
  const dir = value('dir');
  if (!dir) throw new Error('config_invalid: falta --dir=<carpeta[,carpeta…]>');
  const year = Number(value('year') ?? new Date().getUTCFullYear());
  if (!Number.isInteger(year)) throw new Error('config_invalid: --year debe ser entero');
  return { dirs: dir.split(',').filter((d) => d.length > 0), apply: argv.includes('--apply'), year };
}

async function main(): Promise<void> {
  const config = parseArgs(process.argv.slice(2));
  console.log(`ES PLACSP REGISTRY ETL — ${config.apply ? 'APPLY' : 'DRY-RUN (no escribe)'}`);

  const importedAt = new Date().toISOString();
  const byNif = new Map<string, EsPlacspRegistryRow>();
  let files = 0;
  let awards = 0;
  for (const dir of config.dirs) {
    for (const file of readdirSync(dir).filter((name) => name.endsWith('.atom')).sort()) {
      files++;
      for (const winner of extractPlacspWinners(readFileSync(join(dir, file), 'utf8'))) {
        awards++;
        if (byNif.has(winner.nif)) continue;
        const row = buildEsPlacspRegistryRow(winner, { sourceYear: config.year, importedAt });
        if (row !== null && row.record_identity_key !== null) byNif.set(winner.nif, row);
      }
    }
  }

  const rows = [...byNif.values()].sort((a, b) => a.normalized_tax_id.localeCompare(b.normalized_tax_id));
  const cores = new Map<string, number>();
  for (const row of rows) cores.set(row.normalized_legal_name, (cores.get(row.normalized_legal_name) ?? 0) + 1);
  const unique = rows.filter((row) => cores.get(row.normalized_legal_name) === 1).length;

  console.log(`  Archivos .atom leídos: ${files}`);
  console.log(`  Adjudicaciones a sociedades con NIF válido: ${awards}`);
  console.log(`  Sociedades distintas: ${rows.length}`);
  console.log(`  Con nombre único (NIF asignable con seguridad): ${unique} (${((100 * unique) / Math.max(rows.length, 1)).toFixed(1)} %)`);

  if (!config.apply) {
    console.log('  DRY-RUN: no se escribió nada. Usa --apply (con autorización) para persistir.');
    return;
  }

  assertLargeImportAllowed({
    sourceKey: ES_PLACSP_REGISTRY_SOURCE_KEY,
    countryCode: 'ES',
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
