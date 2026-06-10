/**
 * Context Assembler — Preview Offline (Hito 16AB.24.2 — actualizado para Hotfix 16AB.24.5)
 *
 * Genera previews de contexto ensamblado para Sofka, Celes y SGM Salud.
 * Guarda resultados en scratch/agent1-context-implementation-preview/.
 * No llama APIs externas. No modifica producción.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { assembleVerificationContext, TOKEN_BUDGET } from '../src/server/benchmark/prospect-benchmark/context';
import type { VerificationCandidateInput } from '../src/server/benchmark/prospect-benchmark/context';

const OUTPUT_DIR = join(process.cwd(), 'scratch/agent1-context-implementation-preview');

mkdirSync(OUTPUT_DIR, { recursive: true });

// ─── Inputs de candidatos (desde fixtures de test, no desde producción) ───────

const sofkaInput: VerificationCandidateInput = {
  candidateId: 'sofka-technologies',
  candidateName: 'Sofka Technologies',
  country: 'Colombia',
  industry: 'Tecnología',
  proposedWebsite: null,
  proposedLinkedin: null,
  discoveryReason: 'Empresa de tecnología B2B conocida en Colombia; actividad clara en software y servicios TI',
  discoveryUrls: [],
  duplicateStatus: 'not_flagged',
  knownRisks: [],
  fieldsToVerify: [
    'official_website',
    'linkedin_company_url',
    'colombia_operation',
    'technology_b2b_subsegment',
    'size_colombia_vs_global',
    'identity_confirmation',
  ],
};

const celesInput: VerificationCandidateInput = {
  candidateId: 'celes',
  candidateName: 'Celes',
  country: 'Colombia',
  industry: 'Tecnología',
  proposedWebsite: null,
  proposedLinkedin: null,
  discoveryReason: 'Aparece en búsquedas de retail tech o tecnología B2B en Colombia',
  discoveryUrls: [],
  duplicateStatus: 'possible_duplicate',
  knownRisks: [
    'Marcada como possible_duplicate en el pool',
    'Antecedentes de evidencia agregadora o débil',
    'Posible confusión con otra entidad de nombre similar',
  ],
  fieldsToVerify: [
    'official_website',
    'linkedin_company_url',
    'duplicate_resolution',
    'evidence_origin',
    'technology_b2b_classification',
    'size_and_scale',
    'identity_confirmation',
  ],
};

const sgmInput: VerificationCandidateInput = {
  candidateId: 'sgm-salud',
  candidateName: 'SGM Salud',
  country: 'Colombia',
  industry: 'Tecnología',
  proposedWebsite: null,
  proposedLinkedin: null,
  discoveryReason: 'Aparece en búsquedas de healthtech B2B o tecnología en Colombia',
  discoveryUrls: [],
  duplicateStatus: 'not_flagged',
  knownRisks: [
    'El nombre incluye Salud — riesgo de ser empresa operativa de salud y no empresa tecnológica',
    'Puede ser empresa de servicios de salud ocupacional que usa tecnología internamente',
    'Actividad principal no confirmada desde el pool',
  ],
  fieldsToVerify: [
    'official_website',
    'linkedin_company_url',
    'primary_business_activity',
    'technology_b2b_classification',
    'colombia_operation',
    'size_and_scale',
    'client_evidence',
  ],
};

// ─── Ensamblado ───────────────────────────────────────────────────────────────

const candidates = [
  { id: 'sofka', input: sofkaInput, file: 'sofka-context-preview.json' },
  { id: 'celes', input: celesInput, file: 'celes-context-preview.json' },
  { id: 'sgm',   input: sgmInput,   file: 'sgm-context-preview.json' },
];

const results: Array<{
  candidateId: string;
  sharedContextHash: string;
  candidateDeltaHash: string;
  estimatedModelSharedTokens: number;
  estimatedCandidateTokens: number;
  estimatedModelTotalTokens: number;
  warnings: string[];
  ok: boolean;
}> = [];

for (const { id, input, file } of candidates) {
  const result = assembleVerificationContext({
    candidate: input,
    country: 'Colombia',
    industry: 'Tecnología',
  });

  if (result.ok) {
    writeFileSync(join(OUTPUT_DIR, file), JSON.stringify(result.context, null, 2), 'utf8');
    results.push({
      candidateId: id,
      sharedContextHash: result.context.sharedContextHash,
      candidateDeltaHash: result.context.candidateDeltaHash,
      estimatedModelSharedTokens: result.context.estimatedModelSharedTokens,
      estimatedCandidateTokens: result.context.estimatedCandidateTokens,
      estimatedModelTotalTokens: result.context.estimatedModelTotalTokens,
      warnings: result.context.warnings,
      ok: true,
    });
    console.log(`✓ ${id}: ${file} — ${result.context.estimatedModelTotalTokens} tokens estimados (modelo)`);
  } else {
    console.error(`✗ ${id}: error — ${result.error.code}: ${result.error.detail}`);
    results.push({ candidateId: id, sharedContextHash: '', candidateDeltaHash: '', estimatedModelSharedTokens: 0, estimatedCandidateTokens: 0, estimatedModelTotalTokens: 0, warnings: [], ok: false });
  }
}

// ─── Hash comparison ──────────────────────────────────────────────────────────

const hashComparison = {
  description: 'Comparación de hashes — sharedContextHash debe ser idéntico entre los tres candidatos',
  sharedHashes: results.map((r) => ({ candidateId: r.candidateId, sharedContextHash: r.sharedContextHash })),
  candidateHashes: results.map((r) => ({ candidateId: r.candidateId, candidateDeltaHash: r.candidateDeltaHash })),
  sharedHashIsIdentical:
    results.length === 3 &&
    results[0].sharedContextHash !== '' &&
    results[0].sharedContextHash === results[1].sharedContextHash &&
    results[1].sharedContextHash === results[2].sharedContextHash,
};

writeFileSync(join(OUTPUT_DIR, 'hash-comparison.json'), JSON.stringify(hashComparison, null, 2), 'utf8');
console.log(`\nShared hash idéntico entre los tres: ${hashComparison.sharedHashIsIdentical}`);

// ─── Token comparison ─────────────────────────────────────────────────────────

const tokenComparison = {
  description: 'Estimación de tokens por candidato (chars/4 calibrado)',
  methodology: 'ceil(chars / 4) — estimación conservadora. Los límites semánticos originales (4500/700/5200) fueron calculados con recuento de palabras; los límites calibrados (sharedHardLimit/candidateHardLimit/totalHardLimit) reflejan chars/4 aplicado al contenido aprobado.',
  budgetLimits: {
    calibrated_chars4: TOKEN_BUDGET,
    semantic_original_word_based: { sharedHardLimit: 4500, candidateHardLimit: 700, totalHardLimit: 5200 },
  },
  candidates: results.map((r) => ({
    candidateId: r.candidateId,
    estimatedModelSharedTokens: r.estimatedModelSharedTokens,
    estimatedCandidateTokens: r.estimatedCandidateTokens,
    estimatedModelTotalTokens: r.estimatedModelTotalTokens,
    sharedWithinBudget: r.estimatedModelSharedTokens <= TOKEN_BUDGET.sharedHardLimit,
    candidateWithinBudget: r.estimatedCandidateTokens <= TOKEN_BUDGET.candidateHardLimit,
    totalWithinBudget: r.estimatedModelTotalTokens <= TOKEN_BUDGET.totalHardLimit,
    warnings: r.warnings,
  })),
  method: 'ceil(chars / 4) — estimación determinística sin API',
};

writeFileSync(join(OUTPUT_DIR, 'token-comparison.json'), JSON.stringify(tokenComparison, null, 2), 'utf8');
console.log('Previews guardados en scratch/agent1-context-implementation-preview/');
