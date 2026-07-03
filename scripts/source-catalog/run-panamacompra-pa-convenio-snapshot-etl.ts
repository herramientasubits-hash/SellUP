/**
 * PanamaCompra Panamá — ETL Dry-run Convenio Marco
 *
 * Consulta la API ASMX de PanamaCompra para obtener convenios marco y sus
 * proveedores, normaliza RUCs, construye snapshots en memoria.
 *
 * DRY-RUN por defecto. El flag --apply está BLOQUEADO en este hito (5B).
 *
 * Uso:
 *   npx tsx scripts/source-catalog/run-panamacompra-pa-convenio-snapshot-etl.ts \
 *     --limit-convenios=3 --limit-providers=20 --dry-run
 *
 * Flags:
 *   --limit-convenios=<N>   Máximo de convenios a consultar (default: 3)
 *   --limit-providers=<N>   Máximo de proveedores únicos a enriquecer (default: 20)
 *   --dry-run               Modo seco (default: true — no escribe en Supabase)
 *   --apply                 BLOQUEADO: Apply is intentionally disabled in Centroamérica.5B.
 *                           Use future hito 5C.
 *
 * Guardrails:
 *   - No escribe en Supabase.
 *   - No toca source_company_snapshots, source_coverage_summaries.
 *   - No toca accounts, prospect_candidates.
 *   - No usa searchOrderList, ListarActosParametros.
 *   - No usa credenciales, Tavily, LLM.
 *   - No hace crawling masivo (límites bajos por defecto).
 *
 * Semántica:
 *   PanamaCompra Convenio Marco NO es fuente legal ni tributaria.
 *   No valida RUC. No reemplaza DGI Panamá. No reemplaza Registro Público.
 *
 * Hito: Centroamérica.5B
 */

import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import {
  listConvenios,
  listProveedoresByConvenio,
  getProveedorInfo,
} from '../../src/server/source-catalog/connectors/panamacompra-pa/panamacompra-pa-client';
import {
  normalizeProveedorListing,
  normalizeProveedorInfo,
} from '../../src/server/source-catalog/connectors/panamacompra-pa/panamacompra-pa-normalizer';
import {
  deduplicateProviderEntries,
  buildPanamaSnapshotRows,
  deduplicationKey,
  PANAMACOMPRA_SOURCE_KEY,
} from '../../src/server/source-catalog/connectors/panamacompra-pa/panamacompra-pa-snapshot-builder';
import type { PanamaProviderEntry } from '../../src/server/source-catalog/connectors/panamacompra-pa/panamacompra-pa-snapshot-builder';
import type { PanaNormalizedProvider } from '../../src/server/source-catalog/connectors/panamacompra-pa/panamacompra-pa-normalizer';

// ─── Args ──────────────────────────────────────────────────────────────────────

type EtlArgs = {
  limitConvenios: number;
  limitProviders: number;
  dryRun: boolean;
  applyBlocked: boolean;
};

function parseArgs(): EtlArgs {
  const argv = process.argv.slice(2);
  let limitConvenios = 3;
  let limitProviders = 20;
  let dryRun = true;
  let applyBlocked = false;

  for (const arg of argv) {
    if (arg.startsWith('--limit-convenios=')) {
      limitConvenios = parseInt(arg.split('=')[1] ?? '3', 10);
    } else if (arg.startsWith('--limit-providers=')) {
      limitProviders = parseInt(arg.split('=')[1] ?? '20', 10);
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--apply') {
      // --apply bloqueado en este hito
      applyBlocked = true;
    }
  }

  return { limitConvenios, limitProviders, dryRun, applyBlocked };
}

// ─── Reporte ───────────────────────────────────────────────────────────────────

type EtlReport = {
  conveniosLeidos: number;
  proveedoresEncontrados: number;
  proveedoresUnicos: number;
  proveedoresConRuc: number;
  proveedoresSinRuc: number;
  proveedoresEnriquecidos: number;
  snapshotsConstruidos: number;
  conveniosAsociados: number;
  errores: string[];
  writes: 0;
};

function printReport(report: EtlReport, dryRun: boolean): void {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  PanamaCompra Convenio Marco — ${dryRun ? 'DRY-RUN' : 'APPLY'}`);
  console.log(`  source_key: ${PANAMACOMPRA_SOURCE_KEY}`);
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Convenios leídos:          ${report.conveniosLeidos}`);
  console.log(`  Proveedores encontrados:   ${report.proveedoresEncontrados}`);
  console.log(`  Proveedores únicos:        ${report.proveedoresUnicos}`);
  console.log(`  Proveedores con RUC:       ${report.proveedoresConRuc}`);
  console.log(`  Proveedores sin RUC:       ${report.proveedoresSinRuc}`);
  console.log(`  Proveedores enriquecidos:  ${report.proveedoresEnriquecidos}`);
  console.log(`  Snapshots construidos:     ${report.snapshotsConstruidos}`);
  console.log(`  Convenios asociados:       ${report.conveniosAsociados}`);
  console.log(`  Errores:                   ${report.errores.length}`);
  console.log(`  Writes a Supabase:         ${report.writes}`);
  console.log('───────────────────────────────────────────────────────────');
  if (report.errores.length > 0) {
    console.log('  Errores detalle:');
    for (const e of report.errores.slice(0, 10)) {
      console.log(`    - ${e}`);
    }
  }
  if (dryRun) {
    console.log('  [DRY-RUN] No se escribió nada en Supabase.');
    console.log('  [DRY-RUN] --apply bloqueado en Centroamérica.5B.');
  }
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs();

  // Caso 21: --apply bloqueado explícitamente
  if (args.applyBlocked) {
    console.error('');
    console.error('ERROR: Apply is intentionally disabled in Centroamérica.5B. Use future hito 5C.');
    console.error('');
    process.exit(1);
  }

  console.log(`[PanamaCompra ETL] Iniciando dry-run — limit-convenios=${args.limitConvenios} limit-providers=${args.limitProviders}`);
  console.log('[PanamaCompra ETL] GUARDRAIL: No es fuente legal ni tributaria. No reemplaza DGI ni Registro Público.');
  console.log('');

  const report: EtlReport = {
    conveniosLeidos: 0,
    proveedoresEncontrados: 0,
    proveedoresUnicos: 0,
    proveedoresConRuc: 0,
    proveedoresSinRuc: 0,
    proveedoresEnriquecidos: 0,
    snapshotsConstruidos: 0,
    conveniosAsociados: 0,
    errores: [],
    writes: 0,
  };

  // ── Paso 1: Listar convenios ───────────────────────────────────────────────
  console.log('[1/4] Listando convenios marco...');
  const conveniosResult = await listConvenios();
  if (!conveniosResult.ok) {
    console.error(`[PanamaCompra ETL] Error al listar convenios: ${conveniosResult.error}`);
    report.errores.push(`listaConvenio: ${conveniosResult.error}`);
    printReport(report, args.dryRun);
    process.exit(1);
  }

  const convenios = conveniosResult.convenios.slice(0, args.limitConvenios);
  report.conveniosLeidos = convenios.length;
  console.log(`  → ${conveniosResult.convenios.length} convenios disponibles, procesando ${convenios.length}`);

  // ── Paso 2: Listar proveedores por convenio ────────────────────────────────
  console.log('[2/4] Listando proveedores por convenio...');
  const rawEntries: PanamaProviderEntry[] = [];

  for (const convenio of convenios) {
    const idConvenio = convenio.IdConvenio;
    const nombreConvenio = String(convenio.Nombre ?? convenio.NombreConvenio ?? idConvenio);

    const provResult = await listProveedoresByConvenio(idConvenio);
    if (!provResult.ok) {
      report.errores.push(`listaProveedor(${idConvenio}): ${provResult.error}`);
      console.warn(`  ⚠ Convenio ${idConvenio}: ${provResult.error}`);
      continue;
    }

    console.log(`  Convenio ${idConvenio} (${nombreConvenio.slice(0, 40)}): ${provResult.proveedores.length} proveedores`);
    report.proveedoresEncontrados += provResult.proveedores.length;

    for (const prov of provResult.proveedores) {
      const normalized = normalizeProveedorListing(prov);
      if (!normalized.ok) continue;

      rawEntries.push({
        provider: normalized.provider,
        conveniosParticipados: [{ id: idConvenio, nombre: nombreConvenio }],
      });
    }
  }

  // ── Paso 3: Deduplicar ────────────────────────────────────────────────────
  console.log('[3/4] Deduplicando proveedores...');
  const dedupedEntries = deduplicateProviderEntries(rawEntries);
  report.proveedoresUnicos = dedupedEntries.length;
  console.log(`  → ${rawEntries.length} registros → ${dedupedEntries.length} proveedores únicos`);

  // ── Paso 4: Enriquecer con ObtenerInfoProveedor ───────────────────────────
  console.log('[4/4] Enriqueciendo proveedores con ObtenerInfoProveedor...');
  const enrichedEntries: PanamaProviderEntry[] = [];
  const toEnrich = dedupedEntries.slice(0, args.limitProviders);

  for (const entry of toEnrich) {
    // ObtenerInfoProveedor espera IdEmpresa como proveedorId
    const pid = entry.provider.companyId ?? entry.provider.providerId;
    if (!pid) {
      // Sin ID de proveedor — conservar datos del listado tal cual
      enrichedEntries.push(entry);
      continue;
    }

    const infoResult = await getProveedorInfo(pid);
    if (!infoResult.ok) {
      report.errores.push(`ObtenerInfoProveedor(${pid}): ${infoResult.error}`);
      // Conservar datos del listado si el detalle falla
      enrichedEntries.push(entry);
      continue;
    }

    const normalized = normalizeProveedorInfo(infoResult.info);
    if (!normalized.ok) {
      enrichedEntries.push(entry);
      continue;
    }

    report.proveedoresEnriquecidos++;
    enrichedEntries.push({
      provider: normalized.provider as PanaNormalizedProvider,
      conveniosParticipados: entry.conveniosParticipados,
    });
  }

  // ── Resumen de RUC ────────────────────────────────────────────────────────
  for (const entry of enrichedEntries) {
    if (entry.provider.rucStatus === 'present') report.proveedoresConRuc++;
    else report.proveedoresSinRuc++;
    report.conveniosAsociados += entry.conveniosParticipados.length;
  }

  // ── Construir snapshots en memoria ────────────────────────────────────────
  const snapshots = buildPanamaSnapshotRows(enrichedEntries);
  report.snapshotsConstruidos = snapshots.length;

  // Preview del primer snapshot
  if (snapshots.length > 0) {
    const first = snapshots[0]!;
    console.log('');
    console.log('  [Preview primer snapshot]');
    console.log(`  source_key:        ${first.source_key}`);
    console.log(`  country_code:      ${first.country_code}`);
    console.log(`  legal_name:        ${first.legal_name ?? '(sin nombre)'}`);
    console.log(`  tax_id:            ${first.tax_id ?? '(sin RUC)'}`);
    console.log(`  normalized_tax_id: ${first.normalized_tax_id ?? '(sin RUC)'}`);
    console.log(`  status:            ${first.status}`);
    console.log(`  convenios:         ${first.raw_data.convenios.length}`);
    console.log(`  human_review:      ${first.raw_data.human_review_required}`);
    console.log(`  source_type:       ${first.raw_data.source_type}`);
    console.log(`  coverage_scope:    ${first.raw_data.coverage_scope}`);
  }

  // ── DRY-RUN: no escribir ──────────────────────────────────────────────────
  // report.writes permanece en 0 siempre en este hito

  printReport(report, args.dryRun);

  if (report.errores.length > 0) {
    console.warn(`[PanamaCompra ETL] Completado con ${report.errores.length} error(es).`);
  } else {
    console.log('[PanamaCompra ETL] Completado sin errores.');
  }
}

main().catch((err: unknown) => {
  console.error('[PanamaCompra ETL] Error fatal:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
