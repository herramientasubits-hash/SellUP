/**
 * Context Assembler — Context Loader (Hito 16AB.24.2)
 *
 * Carga perfiles compactos versionados desde profiles/.
 * No accede a scratch/ ni a documentos fuente completos.
 * No llama APIs externas.
 */

import type { ContextRule, ExecutionLayer, RulePriority } from './types';
import { SUPPORTED_COUNTRIES, SUPPORTED_INDUSTRIES } from './context-config';

// ─── Importaciones estáticas de perfiles compactos ───────────────────────────

import sharedContextRaw from './profiles/shared-context.json';
import evidencePolicyRaw from './profiles/evidence-and-quality-policy.json';
import verificationSchemaRaw from './profiles/verification-output-schema.json';
import colombiaRaw from './profiles/countries/colombia.json';
import technologyRaw from './profiles/industries/technology.json';

// ─── Mapas de perfiles ────────────────────────────────────────────────────────

const COUNTRY_PROFILES: Record<string, unknown> = {
  colombia: colombiaRaw,
};

const INDUSTRY_PROFILES: Record<string, unknown> = {
  technology: technologyRaw,
};

// ─── Resolución de perfiles ───────────────────────────────────────────────────

export function resolveCountryKey(country: string): string | null {
  return SUPPORTED_COUNTRIES[country] ?? null;
}

export function resolveIndustryKey(industry: string): string | null {
  return SUPPORTED_INDUSTRIES[industry] ?? null;
}

export function loadCountryProfile(countryKey: string): unknown | null {
  return COUNTRY_PROFILES[countryKey] ?? null;
}

export function loadIndustryProfile(industryKey: string): unknown | null {
  return INDUSTRY_PROFILES[industryKey] ?? null;
}

export function loadSharedContext(): typeof sharedContextRaw {
  return sharedContextRaw;
}

export function loadEvidencePolicy(): typeof evidencePolicyRaw {
  return evidencePolicyRaw;
}

export function loadVerificationSchema(): typeof verificationSchemaRaw {
  return verificationSchemaRaw;
}

// ─── Extracción de reglas trazables ──────────────────────────────────────────

type RawRule = {
  rule_id?: string;
  ruleId?: string;
  source_document?: string;
  sourceDocument?: string;
  source_section?: string;
  sourceSection?: string;
  rule_summary?: string;
  ruleSummary?: string;
  execution_layer?: string;
  executionLayer?: string;
  priority?: string;
};

function isRawRule(v: unknown): v is RawRule {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return typeof r['rule_id'] === 'string' || typeof r['ruleId'] === 'string';
}

function normalizeRule(raw: RawRule): ContextRule | null {
  const ruleId = raw.rule_id ?? raw.ruleId ?? '';
  const sourceDocument = raw.source_document ?? raw.sourceDocument ?? '';
  const sourceSection = raw.source_section ?? raw.sourceSection ?? '';
  const ruleSummary = raw.rule_summary ?? raw.ruleSummary ?? '';
  const executionLayer = (raw.execution_layer ?? raw.executionLayer ?? 'model') as ExecutionLayer;
  const priority = (raw.priority ?? 'normal') as RulePriority;

  if (!ruleId || !sourceDocument || !sourceSection) return null;

  return { ruleId, sourceDocument, sourceSection, ruleSummary, executionLayer, priority };
}

function extractRulesFromValue(value: unknown, collected: ContextRule[]): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      if (isRawRule(item)) {
        const rule = normalizeRule(item);
        if (rule) collected.push(rule);
      } else {
        extractRulesFromValue(item, collected);
      }
    }
  } else if (value && typeof value === 'object') {
    if (isRawRule(value)) {
      const rule = normalizeRule(value as RawRule);
      if (rule) collected.push(rule);
    }
    for (const child of Object.values(value as Record<string, unknown>)) {
      extractRulesFromValue(child, collected);
    }
  }
}

export function extractRulesFromProfile(profile: unknown): ContextRule[] {
  const collected: ContextRule[] = [];
  extractRulesFromValue(profile, collected);
  return collected;
}

export function extractAllSharedRules(): ContextRule[] {
  const rules: ContextRule[] = [];
  extractRulesFromValue(sharedContextRaw, rules);
  extractRulesFromValue(evidencePolicyRaw, rules);
  extractRulesFromValue(verificationSchemaRaw, rules);
  return rules;
}
