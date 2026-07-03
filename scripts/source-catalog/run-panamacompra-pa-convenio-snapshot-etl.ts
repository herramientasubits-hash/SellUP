/**
 * PanamaCompra Panamá — ETL Convenio Marco (Centroamérica.5C)
 *
 * Consulta la API ASMX de PanamaCompra para obtener convenios marco y sus
 * proveedores, normaliza RUCs, construye snapshots y — con confirmación explícita —
 * los escribe en source_company_snapshots.
 *
 * Flags:
 *   --limit-convenios=<N>     Máximo de convenios a consultar (default: 3, max piloto: 5)
 *   --limit-providers=<N>     Máximo de proveedores únicos a enriquecer (default: 20, max piloto: 50)
 *   --dry-run                 Modo seco — no escribe en Supabase (default si no se pasa --apply)
 *   --apply                   Habilita escritura (requiere --confirm-pilot-apply)
 *   --confirm-pilot-apply     Confirmación explícita de apply piloto
 *
 * Guardrails:
 *   - --apply sin --confirm-pilot-apply → error inmediato.
 *   - limit-convenios > 5 o limit-providers > 50 → bloqueado en este hito.
 *   - No toca accounts, prospect_candidates.
 *   - No usa searchOrderList, ListarActosParametros.
 *   - No usa credenciales, Tavily, LLM.
 *   - No hace crawling masivo.
 *   - No marca pa_panamacompra_convenio como connected.
 *   - No usa complete_snapshot.
 *   - Solo escribe en source_company_snapshots.
 *
 * Semántica:
 *   PanamaCompra Convenio Marco NO es fuente legal ni tributaria.
 *   No valida RUC. No reemplaza DGI Panamá. No reemplaza Registro Público.
 *   Cubre solo proveedores de Convenio Marco.
 *
 * Hito: Centroamérica.5C
 */

import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { createClient } from '@supabase/supabase-js';
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
  PANAMACOMPRA_SOURCE_KEY,
} from '../../src/server/source-catalog/connectors/panamacompra-pa/panamacompra-pa-snapshot-builder';
import type { PanamaProviderEntry } from '../../src/server/source-catalog/connectors/panamacompra-pa/panamacompra-pa-snapshot-builder';
import type { PanaNormalizedProvider } from '../../src/server/source-catalog/connectors/panamacompra-pa/panamacompra-pa-normalizer';

// ─── Guardrails piloto ─────────────────────────────────────────────────────────

const PILOT_MAX_CONVENIOS = 5;
const PILOT_MAX_PROVIDERS = 50;

// ─── Args ──────────────────────────────────────────────────────────────────────

type EtlArgs = {
  limitConvenios: number;
  limitProviders: number;
  apply: boolean;
  confirmPilotApply: boolean;
};

export function parseArgs(argv: string[] = process.argv.slice(2)): EtlArgs {
  let limitConvenios = 3;
  let limitProviders = 20;
  let apply = false;
  let confirmPilotApply = false;

  for (const arg of argv) {
    if (arg.startsWith('--limit-convenios=')) {
      limitConvenios = parseInt(arg.split('=')[1] ?? '3', 10);
    } else if (arg.startsWith('--limit-providers=')) {
      limitProviders = parseInt(arg.split('=')[1] ?? '20', 10);
    } else if (arg === '--apply') {
      apply = true;
    } else if (arg === '--dry-run') {
      // dry-run is the default when --apply is absent; explicit flag is a no-op
    } else if (arg === '--confirm-pilot-apply') {
      confirmPilotApply = true;
    }
  }

  return { limitConvenios, limitProviders, apply, confirmPilotApply };
}

// ─── Validación de args ────────────────────────────────────────────────────────

export type ArgsValidation = { ok: true } | { ok: false; reason: string };

export function validateArgs(args: EtlArgs): ArgsValidation {
  if (args.apply && !args.confirmPilotApply) {
    return {
      ok: false,
      reason:
        'ERROR: --apply requiere --confirm-pilot-apply para proteger contra writes accidentales.\n' +
        'Uso correcto:\n' +
        '  npx tsx ... --apply --confirm-pilot-apply\n',
    };
  }

  if (args.limitConvenios > PILOT_MAX_CONVENIOS) {
    return {
      ok: false,
      reason:
        `ERROR: --limit-convenios=${args.limitConvenios} supera el límite piloto de ${PILOT_MAX_CONVENIOS}.\n` +
        'Centroamérica.5C es carga piloto controlada. No se permiten cargas amplias en este hito.\n',
    };
  }

  if (args.limitProviders > PILOT_MAX_PROVIDERS) {
    return {
      ok: false,
      reason:
        `ERROR: --limit-providers=${args.limitProviders} supera el límite piloto de ${PILOT_MAX_PROVIDERS}.\n` +
        'Centroamérica.5C es carga piloto controlada. No se permiten cargas amplias en este hito.\n',
    };
  }

  return { ok: true };
}

// ─── Reporte ───────────────────────────────────────────────────────────────────

export type EtlReport = {
  conveniosLeidos: number;
  proveedoresEncontrados: number;
  proveedoresUnicos: number;
  proveedoresConRuc: number;
  proveedoresSinRuc: number;
  proveedoresEnriquecidos: number;
  snapshotsConstruidos: number;
  conveniosAsociados: number;
  errores: string[];
  writes: number;
};

function printReport(report: EtlReport, isDryRun: boolean): void {
  const mode = isDryRun ? 'DRY-RUN' : 'APPLY PILOTO';
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  PanamaCompra Convenio Marco — ${mode}`);
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
  console.log(`  Writes a source_company_snapshots: ${report.writes}`);
  console.log('───────────────────────────────────────────────────────────');
  if (report.errores.length > 0) {
    console.log('  Errores detalle:');
    for (const e of report.errores.slice(0, 10)) {
      console.log(`    - ${e}`);
    }
  }
  if (isDryRun) {
    console.log('  [DRY-RUN] No se escribió nada en Supabase.');
    console.log('  [DRY-RUN] Pasar --apply --confirm-pilot-apply para escribir.');
  } else {
    console.log(`  [APPLY PILOTO] ${report.writes} filas escritas en source_company_snapshots.`);
    console.log('  [APPLY PILOTO] coverage_status se actualizará con el script de coverage summary.');
  }
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
}

// ─── Upsert a Supabase ────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function upsertSnapshots(admin: any, snapshots: ReturnType<typeof buildPanamaSnapshotRows>): Promise<number> {
  if (snapshots.length === 0) return 0;

  // source_year is required by the unique constraint; use current year for pilot load
  const sourceYear = new Date().getFullYear();

  const rows = snapshots.map((s) => ({
    source_key: s.source_key,
    country_code: s.country_code,
    source_year: sourceYear,
    tax_id: s.tax_id,
    normalized_tax_id: s.normalized_tax_id,
    legal_name: s.legal_name,
    sector: null,
    city: null,
    department: null,
    region: null,
    priority_score: 0,
    signals: { source_url: s.source_url },
    financials: {},
    raw_data: s.raw_data,
    imported_at: new Date().toISOString(),
  }));

  const { error, count } = await admin
    .from('source_company_snapshots')
    .upsert(rows, {
      onConflict: 'source_key,country_code,source_year,normalized_tax_id',
      ignoreDuplicates: false,
      count: 'exact',
    });

  if (error) {
    const msg =
      typeof error === 'object' && error !== null && 'message' in error
        ? (error as { message: string }).message
        : String(error);
    throw new Error(`upsert_source_company_snapshots: ${msg}`);
  }

  return typeof count === 'number' ? count : snapshots.length;
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs();
  const isDryRun = !args.apply;

  // Validación de flags
  const validation = validateArgs(args);
  if (!validation.ok) {
    console.error('');
    console.error(validation.reason);
    process.exit(1);
  }

  console.log(`[PanamaCompra ETL 5C] Modo: ${isDryRun ? 'DRY-RUN' : 'APPLY PILOTO'}`);
  console.log(`[PanamaCompra ETL 5C] limit-convenios=${args.limitConvenios} limit-providers=${args.limitProviders}`);
  console.log('[PanamaCompra ETL 5C] GUARDRAIL: No es fuente legal ni tributaria.');
  console.log('[PanamaCompra ETL 5C] GUARDRAIL: No reemplaza DGI Panamá ni Registro Público.');
  console.log('[PanamaCompra ETL 5C] GUARDRAIL: Cubre solo proveedores de Convenio Marco.');
  console.log('');

  // Supabase solo en apply
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any = null;
  if (!isDryRun) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      console.error('ERROR: Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
      process.exit(1);
    }
    admin = createClient(url, key);
    console.log('[PanamaCompra ETL 5C] APPLY PILOTO confirmado. Guardando en source_company_snapshots únicamente.');
    console.log('[PanamaCompra ETL 5C] No toca accounts, prospect_candidates, source_catalog.');
    console.log('');
  }

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
    printReport(report, isDryRun);
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
    const pid = entry.provider.companyId ?? entry.provider.providerId;
    if (!pid) {
      enrichedEntries.push(entry);
      continue;
    }

    const infoResult = await getProveedorInfo(pid);
    if (!infoResult.ok) {
      report.errores.push(`ObtenerInfoProveedor(${pid}): ${infoResult.error}`);
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

  // ── Construir snapshots ────────────────────────────────────────────────────
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
    console.log(`  source_type:       ${first.raw_data.source_type}`);
    console.log(`  coverage_scope:    ${first.raw_data.coverage_scope}`);
  }

  // ── Apply piloto ──────────────────────────────────────────────────────────
  if (!isDryRun && admin) {
    console.log('');
    console.log(`[APPLY PILOTO] Upserting ${snapshots.length} snapshots en source_company_snapshots...`);
    try {
      report.writes = await upsertSnapshots(admin, snapshots);
      console.log(`[APPLY PILOTO] ✓ ${report.writes} filas escritas.`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[APPLY PILOTO] ERROR en upsert: ${msg}`);
      report.errores.push(`upsert: ${msg}`);
    }

    // Verificar count real en DB
    const { count: dbCount } = await admin
      .from('source_company_snapshots')
      .select('id', { count: 'exact', head: true })
      .eq('source_key', PANAMACOMPRA_SOURCE_KEY);

    console.log(`[APPLY PILOTO] Filas totales en DB para ${PANAMACOMPRA_SOURCE_KEY}: ${dbCount ?? 'N/A'}`);
  }

  printReport(report, isDryRun);

  if (report.errores.length > 0) {
    console.warn(`[PanamaCompra ETL] Completado con ${report.errores.length} error(es).`);
    process.exit(report.writes > 0 ? 0 : 1);
  } else {
    console.log('[PanamaCompra ETL] Completado sin errores.');
  }
}

main().catch((err: unknown) => {
  console.error('[PanamaCompra ETL] Error fatal:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
