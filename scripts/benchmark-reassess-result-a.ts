/**
 * Benchmark Reassessment — Resultado A (Hito 16AB.23.1)
 *
 * Re-evalúa el Resultado A de la primera ejecución usando el nuevo verificador
 * de identidad y scoring con caps. Sin consumir APIs externas.
 *
 * Genera:
 *   scratch/prospect-benchmark/reassessment-A.json
 *   scratch/prospect-benchmark/reassessment-A.tsv
 *
 * No modifica el resultado original.
 * No revela el proveedor del Resultado A.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { runCandidateValidationPipeline } from '@/server/benchmark/prospect-benchmark/candidate-validator';
import { computeDiversification, computeHardenedScore } from '@/server/benchmark/prospect-benchmark/scoring';
import type { BenchmarkCandidate, VerifiedBenchmarkCandidate } from '@/server/benchmark/prospect-benchmark/types';

const SCRATCH_DIR = join(process.cwd(), 'scratch', 'prospect-benchmark');
const OUTPUT_DIR = SCRATCH_DIR;

// ─── Find latest Result A ─────────────────────────────────────────────────────

function findLatestResultA(): { tsvPath: string; runId: string } | null {
  if (!existsSync(SCRATCH_DIR)) return null;

  const runs = readdirSync(SCRATCH_DIR)
    .filter((d) => d.startsWith('run-'))
    .sort()
    .reverse();

  for (const run of runs) {
    const tsvPath = join(SCRATCH_DIR, run, 'result-A.tsv');
    if (existsSync(tsvPath)) {
      return { tsvPath, runId: run };
    }
  }
  return null;
}

// ─── Parse TSV ────────────────────────────────────────────────────────────────

function parseTsv(tsvContent: string): BenchmarkCandidate[] {
  const lines = tsvContent.trim().split('\n');
  if (lines.length < 2) return [];

  const headers = lines[0].split('\t');
  const candidates: BenchmarkCandidate[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split('\t');
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] ?? '';
    });

    candidates.push({
      name: row['Empresa'] || 'Desconocida',
      country: row['País'] || 'Colombia',
      sector: row['Sector'] || 'Tecnología',
      website: row['Sitio web'] || null,
      linkedin: row['LinkedIn'] || null,
      city: row['Ciudad'] || null,
      estimated_size: row['Tamaño estimado'] || null,
      description: row['Descripción'] || null,
      evidence_url: row['URL evidencia principal'] || null,
      evidence_source: row['Fuente / evidencia'] || null,
      confidence: (row['Confianza'] as BenchmarkCandidate['confidence']) || 'Media',
      notes: row['Notas'] || null,
    });
  }

  return candidates.map((c) => ({
    ...c,
    website: c.website || null,
    linkedin: c.linkedin || null,
    city: c.city || null,
    estimated_size: c.estimated_size || null,
    description: c.description || null,
    evidence_url: c.evidence_url || null,
    evidence_source: c.evidence_source || null,
    notes: c.notes || null,
  }));
}

// ─── Build TSV output ─────────────────────────────────────────────────────────

const TSV_HEADERS = [
  'Empresa', 'País', 'Sector', 'Sitio web', 'LinkedIn',
  'Ciudad', 'Tamaño estimado', 'Descripción',
  'URL evidencia principal', 'Fuente / evidencia', 'Confianza', 'Notas',
  'Estado verificación', 'Tipo entidad', 'Resolución identidad',
];

function buildReassessmentTsv(
  verified: VerifiedBenchmarkCandidate[],
  rejected: Array<{ rejection_code: string; rejection_reason: string; original_name: string; original_url: string | null }>,
): string {
  const rows = [TSV_HEADERS.join('\t')];

  for (const v of verified) {
    const resolutionNote = v.identity_resolution
      ? `Resuelto desde: "${v.identity_resolution.original_title}" → ${v.identity_resolution.resolved_company_name}`
      : '';
    rows.push([
      v.name,
      v.country,
      v.sector,
      v.official_website_url ?? v.website ?? '',
      v.linkedin ?? '',
      v.city ?? '',
      v.estimated_size ?? '',
      (v.description ?? '').replace(/\t/g, ' ').replace(/\n/g, ' '),
      v.evidence_url ?? '',
      (v.evidence_source ?? '').replace(/\t/g, ' '),
      v.confidence,
      (v.notes ?? '').replace(/\t/g, ' '),
      v.is_verified_company ? 'VERIFICADA' : 'PENDIENTE',
      v.entity_type,
      resolutionNote,
    ].join('\t'));
  }

  for (const r of rejected) {
    rows.push([
      r.original_name,
      '', '', r.original_url ?? '', '', '', '', '',
      '', '', '', '',
      `RECHAZADA: ${r.rejection_code}`,
      '',
      r.rejection_reason,
    ].join('\t'));
  }

  return rows.join('\n');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n════════════════════════════════════════════════════════════════');
  console.log('  REEVALUACIÓN — Resultado A (Hito 16AB.23.1)');
  console.log('════════════════════════════════════════════════════════════════\n');

  const found = findLatestResultA();
  if (!found) {
    console.error('  ERROR: No se encontró ningún result-A.tsv en scratch/prospect-benchmark/');
    process.exit(1);
  }

  console.log(`  Fuente: ${found.tsvPath}\n`);

  const tsvContent = readFileSync(found.tsvPath, 'utf-8');
  const originalCandidates = parseTsv(tsvContent);

  console.log(`  Candidatos originales: ${originalCandidates.length}`);
  console.log('  Aplicando verificador de identidad y entidad...\n');

  // Run the validation pipeline
  const phaseResult = runCandidateValidationPipeline(originalCandidates);

  const { verified_candidates, rejected_candidates, final_candidates } = phaseResult;

  // Compute hardened score
  const div = computeDiversification(verified_candidates.length > 0 ? verified_candidates : final_candidates);
  const scoreResult = computeHardenedScore(
    verified_candidates,
    rejected_candidates,
    originalCandidates.length,
    0, // no duplicate data available offline
    div,
  );

  // ─── Summary ───────────────────────────────────────────────────────────────

  console.log('  ─── Candidatos rechazados ───────────────────────────────────');
  for (const r of rejected_candidates) {
    console.log(`  [RECHAZADO] ${r.rejection_code}: "${r.original_name}"`);
    console.log(`              Razón: ${r.rejection_reason}`);
  }

  console.log('\n  ─── Candidatos verificados ──────────────────────────────────');
  for (const v of verified_candidates) {
    const resolved = v.identity_resolution
      ? ` ← resuelto de "${v.identity_resolution.original_title}"`
      : '';
    console.log(`  [VERIFICADA] ${v.name}${resolved}`);
    console.log(`               Sitio oficial: ${v.official_website_url ?? '(no verificado)'}`);
    console.log(`               Empresa confirmada: ${v.is_verified_company ? 'SÍ' : 'PENDIENTE'}`);
  }

  console.log('\n  ─── Score ───────────────────────────────────────────────────');
  console.log(`  Score original (16AB.23):     82/100`);
  console.log(`  Score sin caps (16AB.23.1):   ${scoreResult.score_before_caps}/100`);
  console.log(`  Score con caps (16AB.23.1):   ${scoreResult.score_after_caps}/100`);
  console.log('\n  Desglose:');
  const b = scoreResult.breakdown;
  console.log(`    Veracidad e identidad:     ${b.veracidad_identidad}/25`);
  console.log(`    Ajuste país-sector:        ${b.ajuste_pais_sector}/20`);
  console.log(`    Calidad de evidencia:      ${b.calidad_evidencia}/20`);
  console.log(`    Completitud:               ${b.completitud}/15`);
  console.log(`    Novedad:                   ${b.novedad_sin_duplicados}/10`);
  console.log(`    Diversificación:           ${b.diversificacion}/10`);

  if (scoreResult.caps_applied.length > 0) {
    console.log('\n  Caps aplicados:');
    for (const cap of scoreResult.caps_applied) {
      console.log(`    [CAP] ${cap.cap_name}: máximo ${cap.cap_value} — ${cap.reason}`);
    }
  }

  // ─── Tabla resumen ────────────────────────────────────────────────────────

  console.log('\n  ─── Tabla de reevaluación ───────────────────────────────────');
  const metrics = [
    ['Empresas reportadas originalmente', '10', '10'],
    ['Empresas verificadas', '10 (no verificado)', String(verified_candidates.filter((v) => v.is_verified_company).length)],
    ['Identidades inválidas', '0 (no verificado)', String(rejected_candidates.length)],
    ['Score', '82', `${scoreResult.score_after_caps}`],
    ['Score antes de caps', '—', String(scoreResult.score_before_caps)],
    ['Cap aplicado', 'No', scoreResult.caps_applied.length > 0 ? scoreResult.caps_applied[0].cap_name : 'Ninguno'],
  ];

  console.log('\n  | Métrica                          | Antes  | Después |');
  console.log('  | -------------------------------- | ------ | ------- |');
  for (const [label, before, after] of metrics) {
    console.log(`  | ${label.padEnd(32)} | ${String(before).padEnd(6)} | ${String(after).padEnd(7)} |`);
  }

  // ─── Guardar resultados ───────────────────────────────────────────────────

  const reassessmentJson = {
    source_run: found.runId,
    reassessment_version: '16AB.23.1',
    original_candidate_count: originalCandidates.length,
    original_score: 82,
    verified_company_count: verified_candidates.filter((v) => v.is_verified_company).length,
    total_verified: verified_candidates.length,
    total_rejected: rejected_candidates.length,
    score_before_caps: scoreResult.score_before_caps,
    score_after_caps: scoreResult.score_after_caps,
    score_breakdown: scoreResult.breakdown,
    caps_applied: scoreResult.caps_applied,
    human_review_status: 'pending',
    automatically_verified_companies: verified_candidates.filter((v) => v.is_verified_company).length,
    rejected_candidates: rejected_candidates.map((r) => ({
      rejection_code: r.rejection_code,
      rejection_reason: r.rejection_reason,
      original_name: r.original_name,
      original_url: r.original_url,
      entity_type: r.entity_type,
    })),
    verified_candidates: verified_candidates.map((v) => ({
      name: v.name,
      entity_type: v.entity_type,
      official_website_url: v.official_website_url,
      discovery_url: v.discovery_url,
      identity_resolution: v.identity_resolution,
      is_verified_company: v.is_verified_company,
      linkedin_status: v.linkedin_status,
    })),
  };

  const jsonPath = join(OUTPUT_DIR, 'reassessment-A.json');
  const tsvPath = join(OUTPUT_DIR, 'reassessment-A.tsv');

  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  writeFileSync(jsonPath, JSON.stringify(reassessmentJson, null, 2), 'utf-8');
  writeFileSync(
    tsvPath,
    buildReassessmentTsv(verified_candidates, rejected_candidates),
    'utf-8',
  );

  console.log(`\n  Archivos generados:`);
  console.log(`    ${jsonPath}`);
  console.log(`    ${tsvPath}`);
  console.log('\n  human_review_status: pending');
  console.log('  (El score automático no declara companies_valid: 10 sin verificación confirmada)');
  console.log('');
}

main().catch((err) => {
  console.error('Error en reevaluación:', err);
  process.exit(1);
});
