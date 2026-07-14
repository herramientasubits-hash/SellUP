/**
 * SICOP Costa Rica — ETL Piloto de Snapshots
 *
 * Descarga un dataset XLSX de SICOP desde datos.go.cr, parsea proveedores,
 * normaliza cédulas jurídicas y construye snapshots en source_company_snapshots.
 *
 * Dry-run por defecto. Requiere --apply para escribir en Supabase.
 *
 * Uso:
 *   npx tsx scripts/source-catalog/run-sicop-cr-snapshot-etl.ts \
 *     --dataset=recursos --limit-rows=500 --max-providers=100
 *
 *   npx tsx scripts/source-catalog/run-sicop-cr-snapshot-etl.ts \
 *     --dataset=recursos --limit-rows=500 --max-providers=100 --apply
 *
 * Flags:
 *   --dataset=<key>         Dataset SICOP a procesar (default: recursos)
 *                           Valores: recursos, aclaraciones, ofertas_2024, ofertas_2023, ofertas_2022
 *   --limit-rows=<N>        Máximo de filas a procesar del XLSX (default: 500)
 *                           Usar 0 para procesar todas las filas del archivo.
 *   --max-providers=<N>     Máximo de proveedores únicos a construir (default: 100)
 *                           Usar 0 para todos los proveedores únicos.
 *   --apply                 Ejecuta upsert real en Supabase (default: dry-run)
 *   --confirm-large-apply   Habilita apply masivo sin límite de filas/proveedores.
 *                           Requerido si --limit-rows > 2000 o --max-providers > 500.
 *                           Solo para cargas operativas amplias controladas (ej: Centroamérica.4E).
 *   --local-file=<path>     Usar XLSX local en lugar de descargar (testing offline)
 *
 * Guardrails de apply:
 *   - limit-rows > 2000 sin --confirm-large-apply → bloqueado
 *   - max-providers > 500 sin --confirm-large-apply → bloqueado
 *   - source_key != cr_sicop → siempre bloqueado
 *   - No toca accounts, prospect_candidates
 *   - No toca source_coverage_summaries en este hito
 *   - No llama Tavily, LLM, ni otras fuentes
 *
 * Semántica de la fuente:
 *   SICOP no es fuente legal ni tributaria.
 *   No valida cédula jurídica.
 *   No reemplaza Hacienda CR.
 *   Es señal procurement B2G: empresa proveedora del Estado costarricense.
 */

import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import * as fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';

import {
  listSicopResources,
  downloadSicopResource,
  SICOP_KNOWN_DATASETS,
} from '../../src/server/source-catalog/connectors/sicop-cr/sicop-cr-client';
import {
  parseSicopRows,
  deduplicateProviders,
} from '../../src/server/source-catalog/connectors/sicop-cr/sicop-cr-normalizer';
import {
  buildSicopSnapshotRows,
  SICOP_SOURCE_KEY,
  SICOP_COUNTRY_CODE,
} from '../../src/server/source-catalog/connectors/sicop-cr/sicop-cr-snapshot-builder';
import {
  OLD_TAX_GRAIN_ON_CONFLICT,
  validateRecordIdentityKey,
} from '../../src/server/source-catalog/record-identity';

// ─── Args ──────────────────────────────────────────────────────────────────────

type EtlArgs = {
  dataset: string;
  limitRows: number;
  maxProviders: number;
  apply: boolean;
  confirmLargeApply: boolean;
  localFile: string | null;
};

function parseArgs(): EtlArgs {
  const argv = process.argv.slice(2);
  let dataset = 'recursos';
  let limitRows = 500;
  let maxProviders = 100;
  let apply = false;
  let confirmLargeApply = false;
  let localFile: string | null = null;

  for (const arg of argv) {
    if (arg.startsWith('--dataset=')) dataset = arg.slice('--dataset='.length);
    else if (arg.startsWith('--limit-rows=')) limitRows = parseInt(arg.slice('--limit-rows='.length), 10);
    else if (arg.startsWith('--max-providers=')) maxProviders = parseInt(arg.slice('--max-providers='.length), 10);
    else if (arg === '--apply') apply = true;
    else if (arg === '--confirm-large-apply') confirmLargeApply = true;
    else if (arg.startsWith('--local-file=')) localFile = arg.slice('--local-file='.length);
  }

  // 0 = sin límite (procesa todo el archivo)
  if (limitRows === 0) limitRows = Number.MAX_SAFE_INTEGER;
  if (maxProviders === 0) maxProviders = Number.MAX_SAFE_INTEGER;

  return { dataset, limitRows, maxProviders, apply, confirmLargeApply, localFile };
}

// ─── Guardrails de apply ───────────────────────────────────────────────────────

function assertApplyGuardrails(args: EtlArgs): void {
  if (args.limitRows > 2_000 && !args.confirmLargeApply) {
    console.error(`[guardrail] BLOQUEADO: --limit-rows=${args.limitRows} supera el máximo permitido de 2000 para apply.`);
    console.error(`            Para carga operativa amplia, añade --confirm-large-apply (Centroamérica.4E).`);
    process.exit(1);
  }
  if (args.maxProviders > 500 && !args.confirmLargeApply) {
    console.error(`[guardrail] BLOQUEADO: --max-providers=${args.maxProviders} supera el máximo permitido de 500 para apply.`);
    console.error(`            Para carga operativa amplia, añade --confirm-large-apply (Centroamérica.4E).`);
    process.exit(1);
  }
  if (args.confirmLargeApply) {
    console.log('[guardrail] ⚠️  --confirm-large-apply activo: carga operativa amplia habilitada.');
    console.log('            Solo escribe en source_company_snapshots con source_key=cr_sicop.');
    console.log('            No toca accounts, prospect_candidates, source_coverage_summaries.');
    console.log('            No llama Tavily, LLM, Hacienda CR, ni otras fuentes.\n');
  }
  // Invariante: solo escribimos cr_sicop — siempre obligatorio
  if (SICOP_SOURCE_KEY !== 'cr_sicop') {
    console.error(`[guardrail] BLOQUEADO: SICOP_SOURCE_KEY inesperado: ${SICOP_SOURCE_KEY}`);
    process.exit(1);
  }
}

// ─── Supabase ──────────────────────────────────────────────────────────────────

function buildSupabaseClient() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) {
    throw new Error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env');
  }
  return createClient(url, key);
}

// ─── XLSX parsing ──────────────────────────────────────────────────────────────

function parseXlsxBuffer(buffer: Buffer): Record<string, unknown>[] {
  // dense:true + raw:true evita conversiones de celda costosas en archivos grandes (>10 MB).
  const wb = XLSX.read(buffer, { type: 'buffer', dense: true, raw: true, cellDates: false });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error('XLSX sin hojas');
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error(`Hoja '${sheetName}' no encontrada`);
  return XLSX.utils.sheet_to_json(ws, { defval: null, raw: true });
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs();

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(' SICOP Costa Rica — ETL Piloto Snapshots');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  source_key:    ${SICOP_SOURCE_KEY}`);
  console.log(`  country_code:  ${SICOP_COUNTRY_CODE}`);
  console.log(`  dataset:       ${args.dataset}`);
  console.log(`  limit-rows:    ${args.limitRows}`);
  console.log(`  max-providers: ${args.maxProviders}`);
  console.log(`  mode:          ${args.apply ? '⚠️  APPLY (escribe en Supabase)' : '✓  DRY-RUN (sin escrituras)'}`);
  console.log('');
  console.log('  Guardrail: SICOP no es fuente legal ni tributaria.');
  console.log('  No valida cédula jurídica. No reemplaza Hacienda CR.');
  console.log('  Señal procurement B2G únicamente.');
  console.log('═══════════════════════════════════════════════════════════\n');

  if (args.apply) assertApplyGuardrails(args);

  // Validar dataset key
  if (!(args.dataset in SICOP_KNOWN_DATASETS)) {
    console.error(`[error] dataset desconocido: '${args.dataset}'`);
    console.error(`  Valores válidos: ${Object.keys(SICOP_KNOWN_DATASETS).join(', ')}`);
    process.exit(1);
  }

  // ── 1. Obtener buffer XLSX ──────────────────────────────────────────────────
  let xlsxBuffer: Buffer;

  if (args.localFile) {
    console.log(`[1/6] Cargando XLSX local: ${args.localFile}`);
    if (!fs.existsSync(args.localFile)) {
      console.error(`[error] Archivo local no encontrado: ${args.localFile}`);
      process.exit(1);
    }
    xlsxBuffer = fs.readFileSync(args.localFile);
    console.log(`      ${(xlsxBuffer.length / 1024).toFixed(1)} KB cargados.`);
  } else {
    console.log(`[1/6] Buscando recursos SICOP para dataset '${args.dataset}' en datos.go.cr...`);
    const resourcesResult = await listSicopResources(args.dataset as keyof typeof SICOP_KNOWN_DATASETS);

    if (!resourcesResult.ok) {
      console.error(`[error] No se pudo obtener recursos CKAN: ${resourcesResult.error}`);
      console.error('       Puedes usar --local-file=<path> para trabajar con un XLSX descargado manualmente.');
      process.exit(1);
    }

    if (resourcesResult.resources.length === 0) {
      console.error(`[error] No se encontraron recursos XLSX/XLS/CSV para '${args.dataset}'.`);
      console.error('       El dataset puede estar temporalmente no disponible en datos.go.cr.');
      console.error('       Usa --local-file=<path> si tienes el XLSX descargado.');
      process.exit(1);
    }

    const resource = resourcesResult.resources[0];
    console.log(`      Recurso seleccionado: ${resource.name} (${resource.format})`);
    console.log(`      URL: ${resource.url}`);
    console.log(`[2/6] Descargando XLSX...`);

    const dlResult = await downloadSicopResource(resource.url);
    if (!dlResult.ok) {
      console.error(`[error] Descarga fallida: ${dlResult.error}`);
      process.exit(1);
    }
    xlsxBuffer = dlResult.buffer;
    console.log(`      ${(xlsxBuffer.length / 1024 / 1024).toFixed(2)} MB descargados.`);
  }

  // ── 2. Parsear XLSX ────────────────────────────────────────────────────────
  console.log('[3/6] Parseando XLSX...');
  let rawRows: Record<string, unknown>[];
  try {
    rawRows = parseXlsxBuffer(xlsxBuffer);
  } catch (err) {
    console.error(`[error] No se pudo parsear XLSX: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
  console.log(`      ${rawRows.length} filas encontradas en el XLSX.`);

  // ── 3. Normalizar proveedores ──────────────────────────────────────────────
  console.log('[4/6] Normalizando proveedores...');
  const parseResult = parseSicopRows(rawRows as Parameters<typeof parseSicopRows>[0], args.dataset, args.limitRows);

  console.log(`\n  Resumen de parsing:`);
  console.log(`    Filas procesadas:              ${parseResult.totalRows}`);
  console.log(`    Registros con proveedor válido: ${parseResult.providers.length}`);
  console.log(`    Skipped sin identificador:      ${parseResult.skippedNoIdentifier}`);
  console.log(`    Skipped identificador inválido: ${parseResult.skippedInvalidIdentifier}`);
  console.log(`    Skipped no-empresa (no inicia 3): ${parseResult.skippedNonCompany}`);
  console.log(`    Skipped sin nombre:             ${parseResult.skippedNoName}`);
  console.log(`    Skipped fila vacía:             ${parseResult.skippedEmptyRow}`);
  if (parseResult.warnings.length > 0) {
    for (const w of parseResult.warnings) console.log(`    ⚠️  ${w}`);
  }

  // ── 4. Deduplicar ──────────────────────────────────────────────────────────
  const providers = deduplicateProviders(parseResult.providers, args.maxProviders);
  console.log(`\n    Proveedores únicos (cédula):    ${providers.length}`);
  if (providers.length < parseResult.providers.length) {
    const dup = parseResult.providers.length - providers.length;
    console.log(`    Registros duplicados agrupados: ${dup}`);
  }
  if (providers.length >= args.maxProviders) {
    console.log(`    ⚠️  Límite --max-providers=${args.maxProviders} alcanzado. Hay más proveedores en el dataset.`);
  }

  // ── 5. Construir snapshots ─────────────────────────────────────────────────
  console.log('[5/6] Construyendo snapshots...');
  const importedAt = new Date().toISOString();
  const rows = buildSicopSnapshotRows(providers, importedAt);
  console.log(`      ${rows.length} snapshots construidos.`);

  const recordIdentityResolved = rows.filter((r) => r.record_identity_key !== null).length;
  const recordIdentityUnavailable = rows.length - recordIdentityResolved;
  console.log(`      record_identity_shadow.resolved_count:    ${recordIdentityResolved}`);
  console.log(`      record_identity_shadow.unavailable_count: ${recordIdentityUnavailable}`);

  // Verificar invariante: solo cr_sicop
  const wrongKey = rows.find((r) => r.source_key !== 'cr_sicop' || r.country_code !== 'CR');
  if (wrongKey) {
    console.error(`[guardrail] BLOQUEADO: fila con source_key='${wrongKey.source_key}' o country_code='${wrongKey.country_code}' inesperado.`);
    process.exit(1);
  }

  // ── 6. Dry-run o apply ────────────────────────────────────────────────────
  console.log('\n[6/6] Resultado final:');

  if (!args.apply) {
    console.log('\n  ✓ DRY-RUN completado — no se escribió nada en Supabase.\n');
    console.log('  Muestra de snapshots (primeros 3):');
    for (const row of rows.slice(0, 3)) {
      console.log(`    cedula=${row.tax_id} | nombre="${row.legal_name}" | año=${row.source_year} | registros=${row.raw_data.total_records_year}`);
    }
    console.log('\n  Para escribir, añade --apply (dentro de los límites permitidos).');
    console.log('  ⚠️  Recuerda: SICOP no es fuente legal. human_review_required=true en todos los snapshots.\n');
    return;
  }

  // Apply
  console.log(`\n  ⚠️  APPLY: escribiendo ${rows.length} filas en source_company_snapshots...`);
  const sb = buildSupabaseClient();

  const BATCH_SIZE = 50;
  let totalUpserted = 0;
  const errors: string[] = [];
  let boundaryAllowedCount = 0;
  let boundaryBlockedCount = 0;
  const boundaryBlockedReasons: Record<string, number> = {};

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);

    // APP-B P2B — partición: solo filas con record_identity_key válido llegan al upsert.
    const allowedRows: typeof batch = [];
    for (const row of batch) {
      const validation = validateRecordIdentityKey(row.record_identity_key);
      if (validation.valid) {
        allowedRows.push(row);
        boundaryAllowedCount += 1;
      } else {
        boundaryBlockedCount += 1;
        boundaryBlockedReasons[validation.reason] = (boundaryBlockedReasons[validation.reason] ?? 0) + 1;
      }
    }

    if (allowedRows.length === 0) continue;

    const { error } = await sb
      .from('source_company_snapshots')
      .upsert(allowedRows, {
        onConflict: OLD_TAX_GRAIN_ON_CONFLICT,
        ignoreDuplicates: false,
      });
    if (error) {
      errors.push(`Batch offset ${i}: ${error.message}`);
    } else {
      totalUpserted += allowedRows.length;
    }
  }

  console.log('\n  Resultado de upsert:');
  console.log(`    Filas upserted: ${totalUpserted}`);
  console.log(`    record_identity_boundary.allowedCount: ${boundaryAllowedCount}`);
  console.log(`    record_identity_boundary.blockedCount: ${boundaryBlockedCount}`);
  if (boundaryBlockedCount > 0) {
    console.log(`    record_identity_boundary.blockedReasons: ${JSON.stringify(boundaryBlockedReasons)}`);
  }
  if (errors.length > 0) {
    console.error(`    Errores (${errors.length}):`);
    for (const e of errors) console.error(`      ${e}`);
  } else {
    console.log('    Sin errores.');
  }

  console.log('\n  Confirmaciones de guardrail:');
  console.log(`    ✓ source_key=cr_sicop en todos los snapshots`);
  console.log(`    ✓ country_code=CR en todos los snapshots`);
  console.log(`    ✓ source_coverage_summaries no tocado`);
  console.log(`    ✓ accounts no tocado`);
  console.log(`    ✓ prospect_candidates no tocado`);
  console.log(`    ✓ No llamadas a Tavily, LLM ni otras fuentes`);
  console.log(`    ✓ human_review_required=true en raw_data de todos los snapshots\n`);
}

main().catch((err) => {
  console.error('[error fatal]', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
