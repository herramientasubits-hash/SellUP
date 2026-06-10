/**
 * Context Assembler — Types (Hotfix 16AB.24.5)
 *
 * Contratos para el ensamblado de contexto de verificación del Agente 1.
 * No llama APIs externas. No ejecuta el benchmark real.
 */

// ─── Capas de ejecución y prioridades ────────────────────────────────────────

export type ExecutionLayer = 'model' | 'code' | 'combined';

export type RulePriority = 'blocking' | 'high' | 'medium' | 'normal';

// ─── Regla trazable (single source) ──────────────────────────────────────────

export type ContextRule = {
  ruleId: string;
  sourceDocument: string;
  sourceSection: string;
  ruleSummary: string;
  executionLayer: ExecutionLayer;
  priority: RulePriority;
};

// ─── Regla compacta (multi-source consolidada) ───────────────────────────────

export type CompactContextRule = {
  ruleId: string;
  ruleSummary: string;
  executionLayer: ExecutionLayer;
  priority: RulePriority;
  sourceRefs: Array<{
    sourceDocument: string;
    sourceSection: string;
  }>;
  mergedRuleIds?: string[];
};

// ─── Contexto de país compacto (para modelo) ─────────────────────────────────

export type CompactCountryContext = {
  country: string;
  country_code: string;
  key_sources: string[];
  tech_hubs: string[];
};

// ─── Contexto de industria compacto (para modelo) ────────────────────────────

export type CompactIndustryContext = {
  industry: string;
  definition: string;
  included_subsegments: string[];
  excluded_subsegments: string[];
  misclassification_risks: string[];
  ubits_fit_signals: string[];
  fit_language_rule: string;
};

// ─── Política de evidencia compacta (para modelo) ────────────────────────────

export type CompactEvidencePolicy = {
  validation_states: Record<string, string>;
  confidence_levels: Record<string, string>;
  forbidden_combinations: string[];
  evidence_origin: { allowed: string[]; not_allowed: string[] };
  minimum_evidence: Record<string, string>;
  size_ranges: string[];
};

// ─── Schema de output compacto (para modelo) ─────────────────────────────────

export type CompactOutputSchema = {
  fields: Record<string, string>;
  key_constraints: string[];
};

// ─── Bloque de contexto para el modelo ───────────────────────────────────────

export type ModelContextBlock = {
  objective: string;
  semanticRules: CompactContextRule[];
  codeLayerInstruction: string;
  countryContext: CompactCountryContext;
  industryContext: CompactIndustryContext;
  evidencePolicy: CompactEvidencePolicy;
  outputSchema: CompactOutputSchema;
};

// ─── Contexto de política interno (no enviado al modelo) ─────────────────────

export type InternalPolicyContext = {
  codeLayerRules: ContextRule[];
  fullCountrySources: unknown;
  fullEligibilityGates: unknown;
  fullStateMatrix: unknown;
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

  modelContext: ModelContextBlock;
  internalPolicyContext: InternalPolicyContext;
  traceability: ContextRule[];
  candidateDelta: CandidateDelta;

  appliedRuleIds: string[];

  sharedContextHash: string;
  candidateDeltaHash: string;
  assembledContextHash: string;

  estimatedModelSharedTokens: number;
  estimatedCandidateTokens: number;
  estimatedModelTotalTokens: number;
  estimatedFullInternalContextTokens: number;

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

// ─── Estados de verificación ─────────────────────────────────────────────────

export type VerificationStatus =
  | 'verified'
  | 'supported'
  | 'estimated'
  | 'conflicting'
  | 'not_found';

// ─── Alcance del tamaño ───────────────────────────────────────────────────────

export type SizeScope = 'colombia' | 'legal_entity' | 'global_group' | 'unknown';

// ─── Estado de auditoría / elegibilidad ──────────────────────────────────────

export type AuditStatus =
  | 'eligible_auditable'
  | 'eligible_partially_auditable'
  | 'requires_review'
  | 'rejected';

// ─── Confianza ────────────────────────────────────────────────────────────────

export type Confidence = 'Alta' | 'Media' | 'Baja';

// ─── Razón social estructurada ────────────────────────────────────────────────

export type LegalNameRecord = {
  value: string | null;
  status: VerificationStatus;
  evidence_urls: string[];
};

// ─── Contrato compacto de verificación (output del modelo) ───────────────────

export type CompactVerificationRecord = {
  candidate_name: string;
  identity: {
    status: VerificationStatus;
    commercial_name: string;
    legal_name: LegalNameRecord;
    official_website: string | null;
    linkedin_company_url: string | null;
    evidence_urls: string[];
  };
  colombia_operation: {
    status: VerificationStatus;
    primary_city: string | null;
    other_cities: string[];
    evidence_urls: string[];
  };
  technology_b2b_fit: {
    status: VerificationStatus;
    subsegment: string | null;
    reason: string;
    evidence_urls: string[];
  };
  size: {
    value: string | null;
    status: VerificationStatus;
    scope: SizeScope | null;
    evidence_urls: string[];
  };
  company_facts: {
    incorporation_date: string | null;
    incorporation_year: number | null;
    evidence_urls: string[];
  };
  ubits_fit: {
    signals: string[];
    status: 'present' | 'not_found';
  };
  conflicts: string[];
  missing_information: string[];
  audit_status: AuditStatus;
  confidence: Confidence;
  eligibility: AuditStatus;
  primary_evidence_url: string | null;
  notes: string;
};

// ─── Fila de 12 columnas (contrato oficial de salida) ─────────────────────────

export type TwelveColumnRow = {
  empresa: string;
  pais: string;
  sector: string;
  sitio_web: string;
  linkedin: string;
  ciudad: string;
  tamano_estimado: string;
  descripcion: string;
  url_evidencia_principal: string;
  fuente_evidencia: string;
  confianza: string;
  notas: string;
};

// ─── Issue de validación de output ───────────────────────────────────────────

export type VerificationOutputValidationIssue = {
  path: string;
  code: string;
  severity: 'warning' | 'blocking';
  message: string;
};

/** @deprecated Use VerificationOutputValidationIssue */
export type VerificationOutputIssue = VerificationOutputValidationIssue;

// ─── Resultado de validación de output ───────────────────────────────────────

export type VerificationOutputValidationResult = {
  valid: boolean;
  sanitizedOutput: CompactVerificationRecord | null;
  issues: VerificationOutputValidationIssue[];
  blockingIssues: VerificationOutputValidationIssue[];
  warnings: VerificationOutputValidationIssue[];
};
