/**
 * Honduras Contrataciones Abiertas — Snapshot ETL
 *
 * Lee el feed anual OCDS desde OCP Data Registry, extrae candidatos con
 * RTN válido y señal jurídica, y escribe snapshots en source_company_snapshots.
 *
 * Dry-run por defecto. Requiere --apply + --confirm-hn-snapshot-write para apply.
 *
 * Uso (dry-run):
 *   node --import tsx scripts/source-catalog/run-hn-contrataciones-snapshot-etl.ts \
 *     --year 2024 --max-lines 1000
 *
 * Uso (apply piloto — 8C.4B+):
 *   node --import tsx scripts/source-catalog/run-hn-contrataciones-snapshot-etl.ts \
 *     --year 2024 --max-lines 1000 \
 *     --apply --confirm-hn-snapshot-write
 *
 * Flags:
 *   --year=<N>                    Año del feed (requerido)
 *   --max-lines=<N>               Máximo de líneas JSONL a leer (default 1000)
 *   --max-bytes=<N>               Máximo de bytes comprimidos (default 8MB)
 *   --apply                       Habilita escritura (requiere confirmación)
 *   --confirm-hn-snapshot-write   Confirmación explícita del apply piloto HN
 *
 * Guardrails de apply (8C.4B.1):
 *   - --apply sin --confirm-hn-snapshot-write → bloqueado (exit 1)
 *   - --apply con --max-lines > 1000 → bloqueado (pilot scope)
 *   - --confirm-hn-snapshot-write sin --apply → dry-run (flag ignorado)
 *   - pilot_scope = true, max_apply_lines = 1000
 *   - Solo escribe en source_company_snapshots y source_coverage_summaries
 *   - No toca accounts, prospect_candidates, source_company_signals
 *   - No llama Tavily, LLM, ni otras fuentes
 *   - No habilita post_approval
 *   - No toca El Salvador, Lusha
 *
 * Semántica de la fuente:
 *   hn_contrataciones_abiertas no es fuente fiscal ni legal.
 *   No valida RTN. No reemplaza SAR HN.
 *   Es señal procurement B2G: empresa proveedora del Estado hondureño.
 *
 * Hito Centroamérica.8C.4B
 */

import { createGunzip } from 'node:zlib';

import { processRelease, buildCandidates } from '../../src/server/source-catalog/connectors/hn-contrataciones-abiertas/hn-ocds-adapter';
import { maskRtn } from '../../src/server/source-catalog/connectors/hn-contrataciones-abiertas/hn-rtn-normalizer';
import { hnAnnualFeedUrl, HN_SOURCE_KEY } from '../../src/server/source-catalog/connectors/hn-contrataciones-abiertas/hn-ocds-types';
import { runHnSnapshotWriter, validateSnapshotRows } from '../../src/server/source-catalog/connectors/hn-contrataciones-abiertas/hn-snapshot-writer';
import type { HnAdapterStats } from '../../src/server/source-catalog/connectors/hn-contrataciones-abiertas/hn-ocds-adapter';
import type { OcdsRelease } from '../../src/server/source-catalog/connectors/hn-contrataciones-abiertas/hn-ocds-types';

// ─── Constantes ────────────────────────────────────────────────────────────────

const DEFAULT_MAX_LINES = 1000;
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 45_000;
const USER_AGENT = 'SellUp/0.1 hn-snapshot-etl-8c4b';
const SAMPLE_SUPPLIERS = 5;

/** Máximo de líneas permitidas en apply piloto (8C.4B.1). */
const PILOT_MAX_APPLY_LINES = 1000;

// ─── CLI args ──────────────────────────────────────────────────────────────────

export type EtlArgs = {
  year: number;
  maxLines: number;
  maxBytes: number;
  apply: boolean;
  confirmHnSnapshotWrite: boolean;
};

export function parseArgs(argv: string[] = process.argv.slice(2)): EtlArgs {
  let year: number | null = null;
  let maxLines = DEFAULT_MAX_LINES;
  let maxBytes = DEFAULT_MAX_BYTES;
  let apply = false;
  let confirmHnSnapshotWrite = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--year' && argv[i + 1]) {
      year = parseInt(argv[++i]!, 10);
    } else if (arg === '--max-lines' && argv[i + 1]) {
      maxLines = parseInt(argv[++i]!, 10);
    } else if (arg === '--max-bytes' && argv[i + 1]) {
      maxBytes = parseInt(argv[++i]!, 10);
    } else if (arg === '--apply') {
      apply = true;
    } else if (arg === '--confirm-hn-snapshot-write') {
      confirmHnSnapshotWrite = true;
    }
  }

  if (!year || isNaN(year) || year < 2015 || year > 2030) {
    console.error('[error] --year requerido y debe ser un año válido (2015–2030)');
    process.exit(1);
  }

  return { year, maxLines, maxBytes, apply, confirmHnSnapshotWrite };
}

// ─── Guardrails apply ──────────────────────────────────────────────────────────

export type ApplyValidation = { ok: true } | { ok: false; reason: string };

export function validateApplyArgs(args: EtlArgs): ApplyValidation {
  if (!args.apply) return { ok: true };

  if (!args.confirmHnSnapshotWrite) {
    return {
      ok: false,
      reason:
        '[guardrail] confirmation_required\n' +
        '  --apply requiere --confirm-hn-snapshot-write.\n' +
        '  Comando correcto:\n' +
        '    node --import tsx scripts/source-catalog/run-hn-contrataciones-snapshot-etl.ts \\\n' +
        '      --year 2024 --max-lines 1000 --apply --confirm-hn-snapshot-write',
    };
  }

  if (args.maxLines > PILOT_MAX_APPLY_LINES) {
    return {
      ok: false,
      reason:
        `[guardrail] pilot_scope_exceeded: --max-lines=${args.maxLines} supera el máximo de apply piloto (${PILOT_MAX_APPLY_LINES}).\n` +
        '  En 8C.4B.1, el apply está limitado a max_apply_lines=1000.\n' +
        '  Para cargas más amplias, esperar el hito 8C.4B.2.',
    };
  }

  return { ok: true };
}

// ─── Streaming JSONL.GZ ────────────────────────────────────────────────────────

async function streamJsonlGzLines(
  url: string,
  maxLines: number,
  maxBytes: number,
): Promise<{ lines: string[]; bytesRead: number; truncated: boolean }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let bytesRead = 0;
  let truncated = false;
  const lines: string[] = [];

  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: controller.signal,
    });

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status} al descargar ${url}`);
    }

    const reader = resp.body?.getReader();
    if (!reader) throw new Error('No readable body en response');

    const gunzip = createGunzip();
    let leftover = '';
    const decompressed: string[] = [];

    await new Promise<void>((resolve, reject) => {
      gunzip.on('data', (chunk: Buffer) => {
        leftover += chunk.toString('utf-8');
        const parts = leftover.split('\n');
        leftover = parts.pop() ?? '';
        for (const part of parts) {
          const trimmed = part.trim();
          if (trimmed) decompressed.push(trimmed);
        }
      });
      gunzip.on('end', resolve);
      gunzip.on('error', (err) => {
        if (truncated) { resolve(); return; }
        reject(err);
      });

      (async () => {
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            bytesRead += value.byteLength;
            gunzip.write(value);
            if (bytesRead >= maxBytes) {
              truncated = true;
              reader.cancel();
              break;
            }
          }
          gunzip.end();
        } catch (err) {
          gunzip.destroy(err instanceof Error ? err : new Error(String(err)));
          reject(err);
        }
      })();
    });

    if (leftover.trim()) decompressed.push(leftover.trim());

    for (const line of decompressed) {
      if (lines.length >= maxLines) { truncated = true; break; }
      lines.push(line);
    }

    return { lines, bytesRead, truncated };
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs();

  // Guardrail: validar flags de apply antes de cualquier operación
  const applyValidation = validateApplyArgs(args);
  if (!applyValidation.ok) {
    console.error('\n' + applyValidation.reason);
    process.exit(1);
  }

  // --confirm-hn-snapshot-write sin --apply: continúa como dry-run
  const dryRun = !args.apply;
  const modeLabel = dryRun
    ? 'DRY-RUN (sin escrituras)'
    : '⚠️  APPLY PILOTO (escribe en Supabase)';

  const url = hnAnnualFeedUrl(args.year);

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(' Honduras Contrataciones Abiertas — Snapshot ETL 8C.4B');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  source_key:         ${HN_SOURCE_KEY}`);
  console.log(`  country_code:       HN`);
  console.log(`  year:               ${args.year}`);
  console.log(`  max_lines:          ${args.maxLines}`);
  console.log(`  max_bytes:          ${(args.maxBytes / 1024 / 1024).toFixed(1)} MB`);
  console.log(`  mode:               ${modeLabel}`);
  console.log(`  pilot_scope:        true`);
  console.log(`  max_apply_lines:    ${PILOT_MAX_APPLY_LINES}`);
  console.log('');
  console.log('  Guardrail: hn_contrataciones_abiertas es señal procurement B2G.');
  console.log('  No es fuente fiscal ni legal. No valida RTN.');
  console.log('  human_review_required=true. post_approval_enabled=false.');
  console.log('═══════════════════════════════════════════════════════════════\n');

  if (!dryRun) {
    console.log('  ⚠️  APPLY PILOTO confirmado.');
    console.log('  Solo escribe en source_company_snapshots y source_coverage_summaries.');
    console.log('  No toca accounts, prospect_candidates, source_company_signals.');
    console.log('  No habilita post_approval. No toca El Salvador ni Lusha.\n');
  }

  // ── 1. Fetch feed ──────────────────────────────────────────────────────────
  console.log(`[1/5] Conectando a OCP Registry…`);
  console.log(`      URL: ${url}`);

  let lines: string[];
  let bytesRead: number;
  let truncated: boolean;

  try {
    ({ lines, bytesRead, truncated } = await streamJsonlGzLines(url, args.maxLines, args.maxBytes));
    console.log(`      ${(bytesRead / 1024).toFixed(1)} KB leídos${truncated ? ' (truncado al límite)' : ''}`);
    console.log(`      ${lines.length} líneas JSONL obtenidas\n`);
  } catch (err) {
    console.error(`\n[error] No se pudo conectar con OCP Registry: ${err instanceof Error ? err.message : String(err)}`);
    console.error(`  URL intentada: ${url}`);
    console.error(`  Verifique conexión a internet o intente con un año diferente.`);
    process.exit(1);
  }

  // ── 2. Procesar releases ───────────────────────────────────────────────────
  console.log('[2/5] Procesando releases OCDS…');
  const acc = new Map();
  const totals: HnAdapterStats = {
    partiesSeen: 0,
    supplierOrTendererSeen: 0,
    hnRtnSeen: 0,
    validRtn: 0,
    invalidRtn: 0,
    legacySchemeIgnored: 0,
  };
  let linesRead = 0;
  let parseErrors = 0;

  for (const line of lines) {
    linesRead++;
    let release: OcdsRelease;
    try {
      release = JSON.parse(line) as OcdsRelease;
    } catch {
      parseErrors++;
      continue;
    }
    const stats = processRelease(release, acc);
    totals.partiesSeen += stats.partiesSeen;
    totals.supplierOrTendererSeen += stats.supplierOrTendererSeen;
    totals.hnRtnSeen += stats.hnRtnSeen;
    totals.validRtn += stats.validRtn;
    totals.invalidRtn += stats.invalidRtn;
    totals.legacySchemeIgnored += stats.legacySchemeIgnored;
  }

  const candidates = buildCandidates(acc);
  const legalEntities = candidates.filter((c) => c.legalEntityHint === 'likely_legal_entity');
  const personRisk = candidates.filter((c) => c.legalEntityHint === 'unknown_or_person_natural_risk');

  console.log(`      ${linesRead} líneas procesadas (${parseErrors} errores de parse)`);
  console.log(`      ${candidates.length} RTN únicos válidos encontrados\n`);

  // ── 3. Snapshot writer ─────────────────────────────────────────────────────
  const stepLabel = dryRun ? 'Preparando snapshots (dry-run)' : 'Escribiendo snapshots (apply piloto)';
  console.log(`[3/5] ${stepLabel}…`);

  let writerResult;
  try {
    writerResult = await runHnSnapshotWriter(candidates, {
      sourceYear: args.year,
      dryRun,
      linesRead,
      uniqueValidRtn: acc.size,
    });
  } catch (err) {
    console.error(`\n[error] Writer falló: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  console.log(`      ${writerResult.rowsPrepared} filas preparadas`);
  console.log(`      ${writerResult.excludedNaturalPersonRisk} excluidos (unknown/person_natural_risk)`);
  console.log(`      ${writerResult.invalidRtn} excluidos (RTN inválido)`);
  if (!dryRun) {
    console.log(`      ${writerResult.rowsWritten} filas escritas en source_company_snapshots`);
    console.log(`      coverage_summary_written: ${String(writerResult.coverageSummaryWritten)}`);
  }
  console.log('');

  // ── 4. Validar invariantes ─────────────────────────────────────────────────
  console.log('[4/5] Validando invariantes…');
  const { mapCandidatesToSnapshot } = await import(
    '../../src/server/source-catalog/connectors/hn-contrataciones-abiertas/hn-snapshot-mapper'
  );
  const mapped = mapCandidatesToSnapshot(candidates, args.year);
  const validation = validateSnapshotRows(mapped.rows);

  for (const [key, val] of Object.entries(validation)) {
    const icon = val ? '✓' : '✗';
    console.log(`      ${icon} ${key}: ${String(val)}`);
  }
  console.log('');

  // ── 5. Resumen ──────────────────────────────────────────────────────────────
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(' Resumen');
  console.log('═══════════════════════════════════════════════════════════════');

  const summary = {
    lines_read: linesRead,
    parties_seen: totals.partiesSeen,
    supplier_or_tenderer_seen: totals.supplierOrTendererSeen,
    hn_rtn_seen: totals.hnRtnSeen,
    valid_rtn_count: totals.validRtn,
    invalid_rtn_count: totals.invalidRtn,
    legacy_scheme_ignored: totals.legacySchemeIgnored,
    unique_valid_rtn: acc.size,
    likely_legal_entity_count: legalEntities.length,
    unknown_or_person_natural_risk_count: personRisk.length,
    snapshot_rows_prepared: writerResult.rowsPrepared,
    snapshot_rows_written: writerResult.rowsWritten,
    coverage_summary_written: writerResult.coverageSummaryWritten,
    pilot_scope: true,
    max_apply_lines: PILOT_MAX_APPLY_LINES,
  };

  for (const [k, v] of Object.entries(summary)) {
    console.log(`  ${k.padEnd(44)}: ${v}`);
  }

  if (truncated) {
    console.log(`\n  ⚠️  truncated: true — límite de líneas/bytes alcanzado`);
    console.log(`     Los conteos anteriores reflejan solo la muestra leída.`);
  }
  if (parseErrors > 0) {
    console.log(`  parse_errors: ${parseErrors}`);
  }

  // ── Muestra proveedores ────────────────────────────────────────────────────
  console.log('\n── Muestra proveedores likely_legal_entity (RTN enmascarado) ──');
  const sample = legalEntities.slice(0, SAMPLE_SUPPLIERS);
  if (sample.length === 0) {
    console.log('  (ningún proveedor likely_legal_entity en esta muestra)');
  } else {
    for (const c of sample) {
      console.log(`  ${maskRtn(c.normalizedRtn)} — ${c.supplierName.slice(0, 50)}`);
    }
  }

  // ── Coverage summary preview (solo en dry-run) ────────────────────────────
  if (dryRun) {
    console.log('\n── coverage_summary_preview (NO escrito) ────────────────────────');
    const coverageSummaryPreview = {
      source_key: HN_SOURCE_KEY,
      country_code: 'HN',
      coverage_kind: 'procurement_signal',
      entity_label: 'RTN proveedores con señal jurídica',
      coverage_status: 'partial_snapshot',
      loaded_rows: writerResult.rowsPrepared,
      audited_total_rows: 0,
      coverage_breakdown: {
        source_type: 'procurement_signal',
        tax_identifier_type: 'RTN',
        source_year: args.year,
        lines_read: linesRead,
        unique_valid_rtn: acc.size,
        likely_legal_entity: legalEntities.length,
        excluded_person_natural_risk: personRisk.length,
        post_approval_enabled: false,
        matching_automatic_enabled: false,
        human_review_required: true,
        pilot_scope: true,
        max_apply_lines: PILOT_MAX_APPLY_LINES,
        note: 'Señal procurement B2G. No valida RTN fiscalmente. No reemplaza fuente tributaria HN.',
      },
    };
    console.log(JSON.stringify(coverageSummaryPreview, null, 2));
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  if (dryRun) {
    console.log(' DRY-RUN completado.');
    console.log(' snapshot_rows_written: 0');
    console.log(' coverage_summary_written: false');
    console.log(' DB remota: NO TOCADA');
    console.log('');
    console.log(' Para apply piloto (primer hito real):');
    console.log('   node --import tsx scripts/source-catalog/run-hn-contrataciones-snapshot-etl.ts \\');
    console.log(`     --year ${args.year} --max-lines 1000 --apply --confirm-hn-snapshot-write`);
  } else {
    console.log(' APPLY PILOTO completado.');
    console.log(` snapshot_rows_written: ${writerResult.rowsWritten}`);
    console.log(` coverage_summary_written: ${String(writerResult.coverageSummaryWritten)}`);
  }
  console.log('═══════════════════════════════════════════════════════════════\n');
}

// Guard: solo ejecutar main cuando este archivo es el entry point directo.
// Cuando se importa para tests (parseArgs/validateApplyArgs), main() no corre.
const callerFile = process.argv[1] ?? '';
if (callerFile.includes('run-hn-contrataciones-snapshot-etl')) {
  main().catch((err) => {
    console.error('[error fatal]', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
