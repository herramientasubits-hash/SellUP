/**
 * Prospect Generation Benchmark — Output Generator (Hito 16AB.23)
 *
 * Genera archivos de salida ciegos (result-A.tsv, result-B.tsv, etc.)
 * y los archivos técnicos (metrics.json, provider-map.json).
 *
 * REGLA: Los archivos result-*.tsv NO revelan el proveedor.
 *        provider-map.json guarda la correspondencia y NO entra a git.
 */

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { BenchmarkCandidate, BenchmarkMetrics, BenchmarkReport, ProviderRunResult } from './types';

const LETTERS = ['A', 'B', 'C', 'D'];

// ─── TSV headers (contrato oficial de salida) ─────────────────────────────────

const TSV_HEADERS = [
  'Empresa',
  'País',
  'Sector',
  'Sitio web',
  'LinkedIn',
  'Ciudad',
  'Tamaño estimado',
  'Descripción',
  'URL evidencia principal',
  'Fuente / evidencia',
  'Confianza',
  'Notas',
];

function candidateToTsvRow(c: BenchmarkCandidate): string {
  const fields = [
    c.name ?? '',
    c.country ?? '',
    c.sector ?? '',
    c.website ?? '',
    c.linkedin ?? '',
    c.city ?? '',
    c.estimated_size ?? '',
    (c.description ?? '').replace(/\t/g, ' ').replace(/\n/g, ' '),
    c.evidence_url ?? '',
    (c.evidence_source ?? '').replace(/\t/g, ' '),
    c.confidence ?? '',
    (c.notes ?? '').replace(/\t/g, ' ').replace(/\n/g, ' '),
  ];
  return fields.join('\t');
}

function buildTsv(candidates: BenchmarkCandidate[]): string {
  const rows = [TSV_HEADERS.join('\t')];
  for (const c of candidates) {
    rows.push(candidateToTsvRow(c));
  }
  return rows.join('\n');
}

// ─── Metrics markdown table ───────────────────────────────────────────────────

function buildMetricsTable(metrics: BenchmarkMetrics[]): string {
  const rows: string[] = [
    '| Resultado | Score | Empresas válidas | Evidencia fuerte | Duplicados | Duración | Costo |',
    '|-----------|-------|------------------|-----------------|------------|----------|-------|',
  ];

  const sorted = [...metrics].filter((m) => m.status !== 'skipped_not_configured');

  // Assign blind labels to match the TSV files
  for (let i = 0; i < sorted.length; i++) {
    const m = sorted[i];
    const label = LETTERS[i] ?? String(i + 1);
    const duration = m.duration_ms < 1000
      ? `${m.duration_ms}ms`
      : `${(m.duration_ms / 1000).toFixed(1)}s`;
    const cost = m.estimated_cost_usd !== null
      ? `$${m.estimated_cost_usd.toFixed(4)}`
      : 'N/A';
    rows.push(
      `| ${label} | ${m.score}/100 | ${m.companies_with_website}/${m.companies_returned} | ${m.pct_strong_evidence}% | ${m.duplicate_internal + m.duplicate_sellup} | ${duration} | ${cost} |`
    );
  }

  return rows.join('\n');
}

// ─── Main output writer ───────────────────────────────────────────────────────

export function ensureOutputDir(baseDir: string, runId: string, _isResume = false): string {
  const dir = join(baseDir, 'scratch', 'prospect-benchmark', `run-${runId}`);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function writeBlindOutputs(
  results: ProviderRunResult[],
  metrics: BenchmarkMetrics[],
  outputDir: string
): void {
  const completed = results.filter((r) => r.status !== 'skipped_not_configured');
  const providerMap: Record<string, string> = {};

  // Write result-A.tsv, result-B.tsv, etc. (blind — no provider info)
  for (let i = 0; i < completed.length; i++) {
    const letter = LETTERS[i] ?? String(i + 1);
    const r = completed[i];
    const tsv = buildTsv(r.candidates);
    writeFileSync(join(outputDir, `result-${letter}.tsv`), tsv, 'utf-8');
    providerMap[`result-${letter}`] = r.provider;
  }

  // Write metrics.json (includes all providers, blind labels for completed)
  const metricsOut = {
    run_id: outputDir.split('/').pop() ?? '',
    blind_labels: providerMap,
    metrics: metrics.map((m) => {
      const completedIdx = completed.findIndex((r) => r.provider === m.provider);
      return {
        ...m,
        blind_label: completedIdx >= 0 ? (LETTERS[completedIdx] ?? null) : null,
      };
    }),
    metrics_table: buildMetricsTable(metrics),
  };
  writeFileSync(
    join(outputDir, 'metrics.json'),
    JSON.stringify(metricsOut, null, 2),
    'utf-8'
  );

  // Write provider-map.json (maps result-X to provider — separate file)
  writeFileSync(
    join(outputDir, 'provider-map.json'),
    JSON.stringify(providerMap, null, 2),
    'utf-8'
  );

  // Write full technical report
  const report: BenchmarkReport = {
    run_id: outputDir.split('/').pop() ?? '',
    canonical_request: completed[0]?.request ?? ({} as BenchmarkReport['canonical_request']),
    providers_attempted: results.map((r) => r.provider),
    providers_completed: completed.map((r) => r.provider),
    providers_skipped: results.filter((r) => r.status === 'skipped_not_configured').map((r) => r.provider),
    results: completed,
    metrics,
    output_dir: outputDir,
    generated_at: new Date().toISOString(),
  };
  writeFileSync(
    join(outputDir, 'report.json'),
    JSON.stringify(report, null, 2),
    'utf-8'
  );
}

export function printSummary(
  results: ProviderRunResult[],
  metrics: BenchmarkMetrics[],
  outputDir: string
): void {
  const completed = results.filter((r) => r.status !== 'skipped_not_configured');
  const skipped = results.filter((r) => r.status === 'skipped_not_configured');

  console.log('\n' + '═'.repeat(70));
  console.log('  BENCHMARK COMPLETADO');
  console.log('═'.repeat(70));
  console.log(`\n  Directorio de resultados: ${outputDir}\n`);

  if (skipped.length > 0) {
    console.log('  Proveedores omitidos (no configurados):');
    for (const r of skipped) {
      console.log(`    - ${r.provider}: ${r.skip_reason ?? 'no configurado'}`);
    }
    console.log('');
  }

  console.log('  Resultados ciegos (sin revelar proveedor):');
  for (let i = 0; i < completed.length; i++) {
    const letter = LETTERS[i] ?? String(i + 1);
    const m = metrics.find((x) => x.provider === completed[i]?.provider);
    if (m) {
      const cost = m.estimated_cost_usd !== null ? ` | Costo: $${m.estimated_cost_usd.toFixed(4)}` : '';
      const dur = `${(m.duration_ms / 1000).toFixed(1)}s`;
      console.log(
        `    [${letter}] Score: ${m.score}/100 | Válidas: ${m.companies_with_website}/${m.companies_returned} | Evidencia: ${m.pct_strong_evidence}% | Duración: ${dur}${cost}`
      );
    }
  }

  console.log('\n' + buildMetricsTable(metrics.filter((m) => m.status !== 'skipped_not_configured')));

  console.log('\n  Archivos generados:');
  for (let i = 0; i < completed.length; i++) {
    console.log(`    result-${LETTERS[i] ?? i + 1}.tsv — tabla TSV lista para revisión`);
  }
  console.log('    metrics.json   — métricas técnicas por proveedor');
  console.log('    provider-map.json — mapeo ciego → proveedor (NO compartir antes de revisión)');
  console.log('    report.json    — reporte técnico completo\n');

  console.log('  SIGUIENTE PASO: Revisión humana ciega de result-A, result-B, ...');
  console.log('  Evalúa los resultados SIN ver provider-map.json primero.');
  console.log('  Solo después de puntuar abrir provider-map.json para revelar el ganador.');
  console.log('');
}
