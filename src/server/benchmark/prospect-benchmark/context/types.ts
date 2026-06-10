/**
 * Context Assembler — Types (Hito 16AB.24.2)
 *
 * Contratos para el ensamblado de contexto de verificación del Agente 1.
 * No llama APIs externas. No ejecuta el benchmark real.
 */

// ─── Capas de ejecución y prioridades ────────────────────────────────────────

export type ExecutionLayer = 'model' | 'code' | 'combined';

export type RulePriority = 'blocking' | 'high' | 'medium' | 'normal';

// ─── Regla trazable ───────────────────────────────────────────────────────────

export type ContextRule = {
  ruleId: string;
  sourceDocument: string;
  sourceSection: string;
  ruleSummary: string;
  executionLayer: ExecutionLayer;
  priority: RulePriority;
};

// ─── Entrada del candidato ────────────────────────────────────────────────────

export type VerificationCandidateInput = {
  candidateId?: string;
  candidateName: string;
  country: string;
  industry: string;
  proposedWebsite?: string | null;
  proposedLinkedin?: string | null;
  discoveryReason?: string | null;
  discoveryUrls?: string[];
  duplicateStatus?: string | null;
  knownRisks?: string[];
  fieldsToVerify?: string[];
};

// ─── Delta dinámico por candidato ─────────────────────────────────────────────

export type CandidateDelta = {
  candidateName: string;
  proposedWebsite: string | null;
  proposedLinkedin: string | null;
  linkedinWarning: string | null;
  discoveryReason: string | null;
  discoveryUrls: string[];
  duplicateStatus: string | null;
  knownRisks: string[];
  fieldsToVerify: string[];
  candidateSpecificQuestions: string[];
};

// ─── Contexto ensamblado ──────────────────────────────────────────────────────

export type AssembledVerificationContext = {
  contextVersion: string;
  mode: 'validation';
  countryProfile: string;
  industryProfile: string;

  sharedContext: unknown;
  candidateDelta: CandidateDelta;

  appliedRuleIds: string[];
  traceability: ContextRule[];

  sharedContextHash: string;
  candidateDeltaHash: string;
  assembledContextHash: string;

  estimatedSharedTokens: number;
  estimatedCandidateTokens: number;
  estimatedTotalTokens: number;

  cacheable: boolean;
  warnings: string[];
};

// ─── Opciones de ensamblado ───────────────────────────────────────────────────

export type AssembleOptions = {
  candidate: VerificationCandidateInput;
  country: string;
  industry: string;
  mode?: 'validation';
};

// ─── Error de presupuesto de tokens ──────────────────────────────────────────

export type ContextBudgetError = {
  code: 'context_budget_exceeded';
  estimatedTokens: number;
  limitTokens: number;
  detail: string;
};

// ─── Resultado del ensamblado ─────────────────────────────────────────────────

export type AssembleResult =
  | { ok: true; context: AssembledVerificationContext }
  | { ok: false; error: ContextBudgetError | { code: string; detail: string } };
