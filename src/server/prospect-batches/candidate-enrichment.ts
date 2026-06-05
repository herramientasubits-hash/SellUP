import { SupabaseClient, createClient } from '@supabase/supabase-js';
import {
  resolveAIProviderCredential,
  getAIProviderCredentialValue,
} from '../services/ai-credentials';
import { getAIActiveConfig } from '@/modules/ai-config/actions';
import type { AIActiveConfig } from '@/modules/ai-config/types';
import { evaluateCandidateEnrichmentNeed } from './candidate-enrichment-eligibility';
import type { EnrichmentEligibilityResult } from './candidate-enrichment-eligibility';
import {
  createAgentRun,
  updateAgentRun,
  createAgentRunStep,
  finishAgentRunStep,
  logProviderUsage,
} from '@/modules/usage-tracking/logging';
import { estimateLLMCost } from '../agents/prospecting-toolkit/llm-evaluator';

/**
 * Normaliza aliases de proveedor de IA a una clave canónica.
 * Soporta: google, gemini, Google Gemini → "google"
 *          anthropic, claude → "anthropic"
 *          openai → "openai"
 */
export function normalizeAIProviderKey(value: string): string {
  const v = (value || '').toLowerCase().trim();
  if (v === 'google' || v === 'gemini' || v.includes('gemini') || v.includes('google')) return 'google';
  if (v === 'anthropic' || v === 'claude' || v.includes('claude') || v.includes('anthropic')) return 'anthropic';
  if (v === 'openai' || v.includes('openai') || v.includes('gpt')) return 'openai';
  return v;
}

/**
 * Aliases canónicos de Vault para Google/Gemini.
 * Usados para construir la respuesta de diagnóstico de hasGeminiCredential.
 */
const GEMINI_VAULT_ALIASES: Array<{ alias: string; vault_key: string }> = [
  { alias: 'google',        vault_key: 'sellup_ai_google' },
  { alias: 'gemini',        vault_key: 'sellup_ai_gemini' },
  { alias: 'google_legacy', vault_key: 'ai_provider_google_api_key' },
  { alias: 'gemini_legacy', vault_key: 'ai_provider_gemini_api_key' },
];

/**
 * Verifica credencial Google/Gemini usando el helper unificado.
 * Devuelve diagnóstico seguro con aliases revisados (sin exponer keys).
 */
export async function hasGeminiCredential(): Promise<{
  available: boolean;
  resolved_provider_key: string | null;
  checked_aliases: Array<{ alias: string; vault_key: string; found: boolean }>;
}> {
  const resolution = await resolveAIProviderCredential('google');

  // Construir el array de checks con el formato esperado por buildAIExecutionCandidates
  const checks: Array<{ alias: string; vault_key: string; found: boolean }> = [];
  for (const entry of GEMINI_VAULT_ALIASES) {
    const wasChecked = resolution.checked_aliases.includes(entry.vault_key);
    const isFound = entry.vault_key === resolution.secret_name;
    if (wasChecked || isFound) {
      checks.push({ ...entry, found: isFound });
    }
    if (isFound) break; // La búsqueda se detuvo aquí
  }

  // Si se resolvió desde env var, agregar ese alias al diagnóstico
  if (resolution.source === 'env_dev' && resolution.secret_name) {
    checks.push({ alias: 'env_var', vault_key: resolution.secret_name, found: true });
  }

  return {
    available: resolution.available,
    resolved_provider_key: resolution.secret_name ?? null,
    checked_aliases: checks,
  };
}

/**
 * Verifica disponibilidad de credencial usando el helper unificado.
 */
async function hasAiProviderCredentialWithAlias(providerKey: string): Promise<boolean> {
  const resolution = await resolveAIProviderCredential(normalizeAIProviderKey(providerKey));
  return resolution.available;
}

/**
 * Recupera credencial desde Vault usando el helper unificado.
 * Prueba todos los aliases conocidos (nuevo + legacy + env dev).
 */
async function getAiProviderCredentialWithAlias(
  providerKey: string
): Promise<{ success: boolean; apiKey?: string; error?: string; resolved_alias?: string }> {
  return getAIProviderCredentialValue(normalizeAIProviderKey(providerKey));
}

/**
 * Allowed values for the prospect_candidates.commercial_fit_status column.
 * Defined by the CHECK constraint prospect_candidates_commercial_fit_status_check.
 */
type CommercialFitStatus =
  | 'likely_fit'
  | 'needs_manual_review'
  | 'likely_not_fit'
  | 'risky_fit'
  | 'blocked'
  | 'duplicate'
  | 'customer_blocked'
  | 'recyclable_prospect';

const ALLOWED_COMMERCIAL_FIT_STATUSES: ReadonlySet<string> = new Set<CommercialFitStatus>([
  'likely_fit',
  'needs_manual_review',
  'likely_not_fit',
  'risky_fit',
  'blocked',
  'duplicate',
  'customer_blocked',
  'recyclable_prospect',
]);

/**
 * Maps LLM output values to allowed DB values for commercial_fit_status.
 * Returns null for null/undefined inputs.
 * Falls back to 'needs_manual_review' for unrecognized values.
 */
export function normalizeCommercialFitStatus(value: string | null | undefined): CommercialFitStatus | null {
  if (value === null || value === undefined) return null;

  const v = value.toLowerCase().trim();

  // Already a valid DB value
  if (ALLOWED_COMMERCIAL_FIT_STATUSES.has(v)) return v as CommercialFitStatus;

  // LLM fit_level aliases → DB values
  if (v === 'high' || v === 'alto' || v === 'good_fit' || v === 'qualified' || v === 'excellent') {
    return 'likely_fit';
  }
  if (
    v === 'medium' || v === 'medio' || v === 'partial_fit' ||
    v === 'needs_review' || v === 'moderate' || v === 'average'
  ) {
    return 'needs_manual_review';
  }
  if (v === 'low' || v === 'bajo' || v === 'poor_fit' || v === 'not_fit' || v === 'no_fit' || v === 'poor') {
    return 'likely_not_fit';
  }

  // Unknown value — safe fallback
  return 'needs_manual_review';
}

export interface EnrichProspectCandidateInput {
  candidateId: string;
  userId: string;
  supabase: SupabaseClient;
  executionType?: 'manual_re_enrichment' | 'automatic_post_import_enrichment';
}

export interface EnrichProspectCandidateResult {
  success: boolean;
  skipped?: boolean;
  reason?: string;
  error?: string;
  data?: unknown;
  errorCode?: string;
  errorDetails?: unknown;
}

export class AILlmCallError extends Error {
  constructor(
    public readonly provider: string,
    public readonly status: number,
    public readonly rawError: string,
    message: string
  ) {
    super(message);
    this.name = 'AILlmCallError';
  }
}

function resolveCanonicalProvider(config: AIActiveConfig): string {
  const provKey = (config.provider_key || '').toLowerCase();
  if (provKey === 'anthropic' || provKey === 'claude') return 'anthropic';
  if (provKey === 'google' || provKey === 'gemini') return 'google';
  if (provKey === 'openai') return 'openai';

  const provName = (config.provider_name || '').toLowerCase();
  if (provName.includes('claude') || provName.includes('anthropic')) return 'anthropic';
  if (provName.includes('gemini') || provName.includes('google')) return 'google';
  if (provName.includes('openai')) return 'openai';

  return config.provider_key || config.active_provider_id || '';
}

function resolveProviderModelId(config: AIActiveConfig, canonicalProvider: string): string {
  const rawModelKey = config.model_key || (config as unknown as Record<string, string>).provider_model_id || '';
  const cleanKey = rawModelKey.trim();

  const isTechnical = cleanKey && !cleanKey.includes(' ') && (
    cleanKey.startsWith('claude-') ||
    cleanKey.startsWith('gpt-') ||
    cleanKey.startsWith('gemini-') ||
    cleanKey.startsWith('o4-')
  );

  if (isTechnical) {
    return cleanKey;
  }

  const displayName = (config.model_name || '').trim();

  if (canonicalProvider === 'anthropic') {
    switch (displayName) {
      case 'Claude 3.5 Haiku':
        return 'claude-3-5-haiku-20241022';
      case 'Claude 3.5 Sonnet':
        return 'claude-3-5-sonnet-20241022';
      case 'Claude 3 Haiku':
        return 'claude-3-haiku-20240307';
      case 'Claude 3 Sonnet':
        return 'claude-3-sonnet-20240229';
      case 'Claude 3 Opus':
        return 'claude-3-opus-20240229';
      default:
        if (displayName.toLowerCase().includes('haiku') && displayName.includes('3.5')) {
          return 'claude-3-5-haiku-20241022';
        }
        if (displayName.toLowerCase().includes('sonnet') && displayName.includes('3.5')) {
          return 'claude-3-5-sonnet-20241022';
        }
        if (displayName.toLowerCase().includes('opus')) {
          return 'claude-3-opus-20240229';
        }
    }
  } else if (canonicalProvider === 'google') {
    switch (displayName) {
      case 'Gemini 3.1 Pro':
        return 'gemini-3.1-pro';
      case 'Gemini 3.1 Flash':
        return 'gemini-3.1-flash';
      case 'Gemini 3.0 Pro':
        return 'gemini-3.0-pro';
      case 'Gemini 3.0 Flash':
        return 'gemini-3.0-flash';
      case 'Gemini 2.5 Pro':
        return 'gemini-2.5-pro';
      case 'Gemini 2.5 Flash':
        return 'gemini-2.5-flash';
      case 'Gemini 2.0 Pro':
        return 'gemini-2.0-pro';
      case 'Gemini 2.0 Flash':
        return 'gemini-2.0-flash';
      case 'Gemini 1.5 Pro':
        return 'gemini-1.5-pro';
      case 'Gemini 1.5 Flash 8B':
        return 'gemini-1.5-flash-8b';
      default:
        if (displayName.toLowerCase().startsWith('gemini-')) {
          return displayName.toLowerCase();
        }
    }
  } else if (canonicalProvider === 'openai') {
    switch (displayName) {
      case 'o4-mini':
        return 'o4-mini';
      case 'GPT-4.1':
        return 'gpt-4.1';
      case 'GPT-4.1 Mini':
        return 'gpt-4.1-mini';
      case 'GPT-4o':
        return 'gpt-4o';
      case 'GPT-4o Mini':
        return 'gpt-4o-mini';
      default:
        if (displayName.toLowerCase().startsWith('gpt-')) {
          return displayName.toLowerCase();
        }
    }
  }

  if (cleanKey) return cleanKey;
  return '';
}

/**
 * Llama a la API correspondiente según el proveedor configurado de forma segura.
 */
async function callAiProviderAPI(
  provider: string,
  model: string,
  apiKey: string,
  prompt: string
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const timeoutMs = 30000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    if (provider === 'anthropic') {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model,
          max_tokens: 4000,
          messages: [{ role: 'user', content: prompt }],
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        let parsedJson: { error?: { message?: string } } | null = null;
        try {
          parsedJson = JSON.parse(body);
        } catch {}
        
        let detailMessage = `Anthropic error ${response.status}: ${body.slice(0, 300)}`;
        if (parsedJson?.error?.message) {
          detailMessage = parsedJson.error.message;
        }
        throw new AILlmCallError('anthropic', response.status, body, detailMessage);
      }

      const data = await response.json();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const textContent = data.content.find((c: any) => c.type === 'text');
      if (!textContent) throw new Error('Anthropic: no text content returned');

      return {
        text: textContent.text,
        inputTokens: data.usage?.input_tokens ?? 0,
        outputTokens: data.usage?.output_tokens ?? 0,
      };
    } else if (provider === 'google') {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contents: [
              {
                parts: [{ text: prompt }],
              },
            ],
            generationConfig: {
              responseMimeType: 'application/json',
            },
          }),
          signal: controller.signal,
        }
      );

      clearTimeout(timeoutId);

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        let parsedJson: { error?: { message?: string } } | null = null;
        try {
          parsedJson = JSON.parse(body);
        } catch {}
        
        let detailMessage = `Gemini error ${response.status}: ${body.slice(0, 300)}`;
        if (parsedJson?.error?.message) {
          detailMessage = parsedJson.error.message;
        }
        throw new AILlmCallError('google', response.status, body, detailMessage);
      }

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error('Gemini: no text content returned');

      return {
        text,
        inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
      };
    } else if (provider === 'openai') {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          response_format: { type: 'json_object' },
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        let parsedJson: { error?: { message?: string } } | null = null;
        try {
          parsedJson = JSON.parse(body);
        } catch {}
        
        let detailMessage = `OpenAI error ${response.status}: ${body.slice(0, 300)}`;
        if (parsedJson?.error?.message) {
          detailMessage = parsedJson.error.message;
        }
        throw new AILlmCallError('openai', response.status, body, detailMessage);
      }

      const data = await response.json();
      const text = data.choices?.[0]?.message?.content;
      if (!text) throw new Error('OpenAI: no text content returned');

      return {
        text,
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
      };
    } else {
      throw new Error(`Proveedor de IA no soportado: ${provider}`);
    }
  } finally {
    clearTimeout(timeoutId);
  }
}

interface PromptCandidateData {
  name?: string | null;
  legal_name?: string | null;
  website?: string | null;
  domain?: string | null;
  country?: string | null;
  country_code?: string | null;
  city?: string | null;
  region?: string | null;
  industry?: string | null;
  company_size?: string | null;
  source_primary?: string | null;
  review_notes?: string | null;
  confidence_score?: number | null;
  metadata?: {
    import?: {
      linkedin_url?: string | null;
      source_url?: string | null;
      source_evidence?: string | null;
      confidence?: string | null;
    };
    validation?: {
      normalized_keys?: {
        normalized_linkedin_url?: string | null;
      };
      sellup_duplicate_check?: Record<string, unknown>;
      hubspot_duplicate_check?: Record<string, unknown>;
    };
    ai_evaluation?: {
      description?: string | null;
    };
    enrichment?: Record<string, unknown>;
  };
}

function buildEnrichmentPrompt(
  candidate: PromptCandidateData,
  eligibility: EnrichmentEligibilityResult,
  mode: 'full' | 'incremental_missing_fields' = 'full'
): string {
  const isIncremental = mode === 'incremental_missing_fields';

  // Identify which fields are present vs missing
  const presentFields: string[] = [];
  const missingFields: string[] = [];

  const fieldMapping = {
    website: candidate.website || candidate.domain,
    linkedin_url: candidate.metadata?.import?.linkedin_url || candidate.metadata?.validation?.normalized_keys?.normalized_linkedin_url,
    description: candidate.metadata?.ai_evaluation?.description || candidate.review_notes,
    city: candidate.city || candidate.region,
    company_size: candidate.company_size,
    industry: candidate.industry,
    source_evidence: candidate.metadata?.import?.source_evidence || candidate.metadata?.import?.source_url || candidate.source_primary,
    confidence: candidate.metadata?.import?.confidence || candidate.confidence_score,
  };

  for (const [key, value] of Object.entries(fieldMapping)) {
    if (value) {
      presentFields.push(key);
    } else {
      missingFields.push(key);
    }
  }

  const modeInstructions = isIncremental
    ? `MODO DE OPERACIÓN: INCREMENTAL (incremental_missing_fields)
Tus instrucciones de enriquecimiento son incrementales:
1. Los siguientes campos ya están presentes y son correctos. NO debes buscar información para cambiarlos ni modificarlos:
${presentFields.map(f => `- ${f}: ${fieldMapping[f as keyof typeof fieldMapping]}`).join('\n')}

2. Los siguientes campos están FALTANTES o INCOMPLETOS. Tu tarea principal es investigar y completar únicamente estos campos:
${missingFields.map(f => `- ${f}`).join('\n')}

3. Si en tu investigación encuentras un valor que contradice o entra en conflicto con un campo que ya tiene valor:
   - CONSERVA el valor original en el campo correspondiente del JSON de respuesta (no lo sobrescribas).
   - Registra el conflicto en la sección "enrichment_audit.conflicts" detallando el campo, el valor encontrado y la evidencia.

4. Debes completar la clave "enrichment_audit" en la raíz del JSON con el siguiente formato:
  "enrichment_audit": {
    "attempted_fields": ${JSON.stringify(missingFields)},
    "completed_fields": ["Lista de campos que lograste completar con éxito"],
    "no_result_fields": ["Lista de campos que intentaste completar pero no encontraste evidencia confiable"],
    "conflicts": [
      {
        "field": "Nombre del campo en conflicto",
        "existing_value": "Valor existente proporcionado",
        "found_value": "Nuevo valor contradictorio encontrado",
        "evidence": "Evidencia/fuente del conflicto"
      }
    ]
  }`
    : `MODO DE OPERACIÓN: COMPLETO (full_enrichment)
Completa toda la información y realiza la evaluación completa de la empresa.`;

  return `Eres un analista de datos B2B y Sales Ops Architect experto. Tu objetivo es enriquecer los datos comerciales de un candidato (empresa) utilizando la información proporcionada.

${modeInstructions}

INFORMACIÓN DEL CANDIDATO DISPONIBLE EN EL SISTEMA:
- Nombre: ${candidate.name || 'No disponible'}
- Razón Social: ${candidate.legal_name || 'No disponible'}
- Sitio Web: ${candidate.website || 'No disponible'}
- Dominio: ${candidate.domain || 'No disponible'}
- LinkedIn: ${candidate.metadata?.import?.linkedin_url || candidate.metadata?.validation?.normalized_keys?.normalized_linkedin_url || 'No disponible'}
- País: ${candidate.country || candidate.country_code || 'No disponible'}
- Ciudad: ${candidate.city || 'No disponible'}
- Sector/Industria: ${candidate.industry || 'No disponible'}
- Tamaño (empleados): ${candidate.company_size || 'No disponible'}
- Descripción inicial: ${candidate.metadata?.ai_evaluation?.description || candidate.review_notes || 'No disponible'}
- Fuente principal: ${candidate.source_primary || 'No disponible'}
- Evidencia origen: ${candidate.metadata?.import?.source_evidence || candidate.metadata?.import?.source_url || 'No disponible'}

METADATA DE VALIDACIÓN Y DUPLICIDAD:
- SellUp Duplicate Check: ${JSON.stringify(candidate.metadata?.validation?.sellup_duplicate_check || {}, null, 2)}
- HubSpot Duplicate Check: ${JSON.stringify(candidate.metadata?.validation?.hubspot_duplicate_check || {}, null, 2)}
- Faltantes detectados: ${JSON.stringify(eligibility.missing_fields, null, 2)}
- Razones de elegibilidad: ${JSON.stringify(eligibility.reasons, null, 2)}

INSTRUCCIONES CRÍTICAS:
1. Evalúa el encaje comercial con UBITS (proveedor líder de capacitación/formación corporativa en Latinoamérica).
2. Proporciona una puntuación de encaje (fit_score) de 0 a 100 y un nivel (high, medium, low).
3. No utilices conocimiento externo sobre la empresa que no esté directamente soportado por los datos proporcionados. Si falta información para responder una sección, indícala explícitamente en "missing_data" o "risks_or_uncertainties" y deja el campo correspondiente como null u omitido.
4. Queda terminantemente PROHIBIDO inventar identificadores fiscales (NIT, RUT, RFC), revenue/ingresos, nombres de contactos o número exacto de empleados.
5. Si detectas que el nombre de la empresa corresponde a un rebrand o hay una adquisición mencionada en las notas/evidencia, decláralo bajo "risks_or_uncertainties".
6. Responde estrictamente con un objeto JSON válido que cumpla con la estructura requerida. No incluyas explicaciones en texto plano antes o después del JSON.

ESTRUCTURA DE RESPUESTA JSON REQUERIDA:
{
  "summary": "Resumen ejecutivo en una frase del perfil comercial",
  "website": "Sitio web corporativo oficial de la empresa (solo si lo investigaste o completaste)",
  "linkedin_url": "URL del LinkedIn corporativo de la empresa (solo si lo investigaste o completaste)",
  "city": "Ciudad de la empresa (solo si la investigaste o completaste)",
  "region": "Región o estado de la empresa (solo si la investigaste o completaste)",
  "industry": "Sector o industria principal (solo si lo investigaste o completaste)",
  "company_size": "Tamaño estimado en empleados (solo si lo investigaste o completaste, ej. '51-200 empleados')",
  "tax_identifier": "NIT, RFC o RUT de la empresa sin puntos ni guiones (solo si lo investigaste o completaste y encontraste evidencia confiable)",
  "tax_identifier_type": "Tipo de ID fiscal ('NIT' | 'RFC' | 'RUT' | 'RUC' | 'CUIT' | 'CNPJ' | 'RNC' | 'RTN' | 'cedula_juridica' | 'other')",
  "company_profile": {
    "business_description": "Explicación detallada de qué hace la empresa según los datos",
    "business_model": "B2B | B2C | B2B2C | Híbrido | Desconocido",
    "target_customers": "Descripción de clientes objetivo",
    "products_or_services": ["Lista de productos o servicios principales identificados"],
    "industries_served": ["Sectores a los que vende la empresa"],
    "geographic_presence": ["Países/ciudades donde opera según la evidencia"],
    "estimated_size": "Pequeña | Mediana | Grande | Corporativa | Desconocido",
    "technology_signals": ["Tecnologías, software o señales técnicas mencionadas"]
  },
  "sellup_fit": {
    "fit_score": 0-100,
    "fit_level": "high" | "medium" | "low",
    "why_fit": "Explicación detallada de la puntuación de encaje con la propuesta de formación de UBITS",
    "possible_needs": ["Posibles necesidades de capacitación (ej: liderazgo, ventas, tecnología)"],
    "recommended_next_step": "Siguiente paso comercial recomendado para el equipo de ventas"
  },
  "commercial_angles": ["Ángulos o ganchos de prospección comercial sugeridos"],
  "risks_or_uncertainties": ["Riesgos de identidad, posible duplicado, rebrand o falta de claridad en los datos"],
  "missing_data": ["Campos de información críticos que faltan y deben ser investigados por un humano"],
  "confidence": "high" | "medium" | "low",
  "requires_human_review": true${isIncremental ? `,
  "enrichment_audit": {
    "attempted_fields": ["lista de campos intentados"],
    "completed_fields": ["lista de campos completados"],
    "no_result_fields": ["lista de campos sin resultado"],
    "conflicts": []
  }` : ''}
}
`;
}

export interface AIExecutionCandidate {
  provider_key: string;
  provider_display_name: string;
  model_key: string;
  model_display_name: string;
  credential_available: boolean;
  priority: number;
}

function getAdminSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://lrdruowtadwbdulndlph.supabase.co';
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxyZHJ1b3d0YWR3YmR1bG5kbHBoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODgzODY2NCwiZXhwIjoyMDk0NDE0NjY0fQ.0fnp65rmdJxklJvVkaWuA3J9dtBpf0Jg2zB2kSyyg0E';
  return createClient(supabaseUrl, supabaseServiceKey);
}

/**
 * Determina si un error de proveedor permite continuar con el siguiente candidato.
 *
 * Política:
 * - Errores de modelo no encontrado → siempre recuperable (probar siguiente modelo).
 * - Errores HTTP de proveedor (401, 402, 429, 500, 503, red) → recuperable,
 *   para que el fallback a otro PROVEEDOR siempre ocurra.
 * - Solo errores de parseo de respuesta sin relación con el proveedor podrían
 *   no ser recuperables, pero en la práctica también se permite continuar.
 *
 * IMPORTANTE: Esta función siendo liberal (devolver true) es segura porque
 * el loop tiene un maxAttempts limitado y siempre termina.
 */
function isRecoverableError(status: number, message: string, rawError: string): boolean {
  const errMsg = (message || '').toLowerCase();
  const rawErr = (rawError || '').toLowerCase();

  // ── Errores de modelo no encontrado ──────────────────────────────────────
  if (status === 404) return true;
  if (errMsg.includes('not_found') || rawErr.includes('not_found')) return true;
  if (errMsg.includes('not found') || rawErr.includes('not found')) return true;
  if (errMsg.includes('invalid_model') || rawErr.includes('invalid_model')) return true;
  if (errMsg.includes('invalid model') || rawErr.includes('invalid model')) return true;
  if (errMsg.includes('model_not_available') || rawErr.includes('model_not_available')) return true;
  if (errMsg.includes('model not available') || rawErr.includes('model not available')) return true;
  if (errMsg.includes('model_not_found') || rawErr.includes('model_not_found')) return true;
  if (errMsg.includes('model not found') || rawErr.includes('model not found')) return true;
  if (errMsg.includes('model_error') || rawErr.includes('model_error')) return true;
  if (status === 400 && (errMsg.includes('model') || rawErr.includes('model'))) return true;

  // ── Errores de autenticación/créditos/rate-limit ─────────────────────────
  // Son recuperables porque el SIGUIENTE proveedor puede tener credenciales válidas.
  if (status === 401) return true; // Unauthorized — credencial inválida, probar otro proveedor
  if (status === 402) return true; // Payment Required — créditos agotados, probar otro proveedor
  if (status === 403) return true; // Forbidden — permisos, probar otro proveedor
  if (status === 429) return true; // Too Many Requests — rate limit, probar otro proveedor

  // ── Errores de infraestructura del proveedor ──────────────────────────────
  if (status === 500) return true; // Internal Server Error del proveedor
  if (status === 502) return true; // Bad Gateway
  if (status === 503) return true; // Service Unavailable
  if (status === 504) return true; // Gateway Timeout

  // ── Errores de red/timeout ────────────────────────────────────────────────
  if (errMsg.includes('aborted') || rawErr.includes('aborted')) return true;
  if (errMsg.includes('timeout') || rawErr.includes('timeout')) return true;
  if (errMsg.includes('network') || rawErr.includes('network')) return true;
  if (errMsg.includes('fetch failed') || rawErr.includes('fetch failed')) return true;

  // ── Errores de parseo de respuesta ────────────────────────────────────────
  // También recuperables: quizás otro proveedor devuelve JSON válido.
  if (errMsg.includes('json') || rawErr.includes('json')) return true;
  if (errMsg.includes('parse') || rawErr.includes('parse')) return true;

  // Por defecto, intentar el siguiente candidato en lugar de detenerse.
  // Esto garantiza que Gemini siempre se intente si está configurado.
  return true;
}

export interface AIExecutionDebugInfo {
  active_config_summary: {
    provider_key: string;
    model_key: string;
  } | null;
  active_config_used: {
    provider_id: string | null;
    provider_key: string | null;
    provider_name: string | null;
    model_id: string | null;
    model_name: string | null;
    model_key: string;
    is_executable: boolean | null;
    slot1_included: boolean;
    slot1_skip_reason: string | null;
    source: 'getAIActiveConfig';
  } | null;
  vault_checks: Array<{ alias: string; vault_key: string; found: boolean }>;
  gemini_credential: {
    available: boolean;
    resolved_provider_key: string | null;
  };
  db_models_count: number;
  gemini_models_in_db: Array<{ key: string; name: string }>;
  candidates_before_dedup: Array<{ provider_key: string; model_key: string; priority: number }>;
  candidates_final: Array<{ provider_key: string; model_key: string; priority: number }>;
  skipped_gemini_reason: string | null;
}

export async function buildAIExecutionCandidates(
  supabase: SupabaseClient,
  activeConfig: AIActiveConfig | null,
  debugOut?: { info: AIExecutionDebugInfo }
): Promise<AIExecutionCandidate[]> {
  const candidates: AIExecutionCandidate[] = [];

  let activeProviderKey = '';
  let activeModelKey = '';
  if (activeConfig) {
    activeProviderKey = normalizeAIProviderKey(resolveCanonicalProvider(activeConfig));
    activeModelKey = resolveProviderModelId(activeConfig, activeProviderKey);
  }

  const admin = getAdminSupabase();
  const { data: dbModels, error } = await admin
    .from('ai_models')
    .select(`
      key,
      name,
      is_executable,
      last_checked_at,
      ai_providers!provider_id (
        key,
        name,
        credentials_status
      )
    `)
    .eq('is_selectable', true);

  if (error) {
    console.error('[buildAIExecutionCandidates] Error fetching DB models:', error);
  }

  // ── Verificar credenciales con todos los aliases conocidos ────────────────
  // Para Google se prueban: google (sellup_ai_google) y gemini (sellup_ai_gemini)
  const providersToCheck = ['anthropic', 'google', 'openai'];
  const credentialsMap: Record<string, boolean> = {};
  for (const p of providersToCheck) {
    credentialsMap[p] = await hasAiProviderCredentialWithAlias(p);
  }

  // Verificación Gemini detallada con diagnóstico seguro
  const geminiCheck = await hasGeminiCredential();
  // Sincronizar resultado detallado con el mapa de credenciales
  if (geminiCheck.available) {
    credentialsMap['google'] = true;
  }

  const isDev = process.env.NODE_ENV !== 'production';

  if (isDev) {
    console.log('[buildAIExecutionCandidates] credentialsMap:', credentialsMap);
    console.log('[buildAIExecutionCandidates] activeProviderKey:', activeProviderKey, 'activeModelKey:', activeModelKey);
    console.log('[buildAIExecutionCandidates] geminiCheck:', {
      available: geminiCheck.available,
      resolved_provider_key: geminiCheck.resolved_provider_key,
      checked_aliases: geminiCheck.checked_aliases,
    });
  } else {
    // En producción: solo loguear resultado (sin aliases, sin keys)
    console.log('[buildAIExecutionCandidates] active:', activeProviderKey, activeModelKey,
      '| google_cred:', geminiCheck.available,
      '| anthropic_cred:', credentialsMap['anthropic']);
  }

  const getProviderDisplayName = (pKey: string) => {
    if (pKey === 'anthropic') return 'Claude';
    if (pKey === 'google') return 'Google Gemini';
    if (pKey === 'openai') return 'OpenAI';
    return pKey;
  };

  // ── SLOT 1: Configuración activa ──────────────────────────────────────────
  // The admin-configured model is always included in SLOT 1 regardless of
  // is_executable in DB. is_executable is advisory for automatic fallback
  // discovery; it does not override an explicit admin selection.
  // If the model truly cannot execute, the API call will fail and fall through
  // to SLOT 2/3+ — the error will appear clearly in the attempts history.
  let slot1ActiveIsExecutable: boolean | null = null;
  let slot1SkipReason: string | null = null;

  if (activeProviderKey && activeModelKey) {
    const isCredAvailable = credentialsMap[activeProviderKey] ?? false;
    if (isCredAvailable) {
      const activeModelDbRow = (dbModels ?? []).find((m) => {
        const rawProvider = m.ai_providers as unknown;
        const providerData = (Array.isArray(rawProvider) ? rawProvider[0] : rawProvider) as { key: string } | null;
        const pKey = normalizeAIProviderKey(providerData?.key || '');
        return pKey === activeProviderKey && m.key === activeModelKey;
      });
      slot1ActiveIsExecutable = activeModelDbRow
        ? (activeModelDbRow as unknown as { is_executable: boolean | null }).is_executable ?? null
        : null;

      if (slot1ActiveIsExecutable === false) {
        console.warn(
          `[buildAIExecutionCandidates] Active model ${activeProviderKey}/${activeModelKey} is is_executable=false in DB — ` +
          `including in SLOT 1 anyway (admin-configured). Run "Actualizar modelos disponibles" to re-verify.`
        );
      }

      candidates.push({
        provider_key: activeProviderKey,
        provider_display_name: activeConfig?.provider_name || getProviderDisplayName(activeProviderKey),
        model_key: activeModelKey,
        model_display_name: activeConfig?.model_name || activeModelKey,
        credential_available: true,
        priority: 1,
      });
    } else {
      slot1SkipReason = `No credential available for provider ${activeProviderKey}`;
      console.warn(`[buildAIExecutionCandidates] SLOT 1 skipped — ${slot1SkipReason}`);
    }
  } else {
    slot1SkipReason = `No active config (provider=${activeProviderKey || 'empty'}, model=${activeModelKey || 'empty'})`;
    console.warn(`[buildAIExecutionCandidates] SLOT 1 skipped — ${slot1SkipReason}`);
  }

  // ── SLOT 2: Gemini como fallback preferente ───────────────────────────────
  // Si el proveedor activo NO es Google y Gemini tiene credencial, se agrega
  // como segundo intento ANTES de agotar todos los modelos del proveedor activo.
  //
  // Modelos hardcoded seguros: no exponen secretos, solo IDs técnicos públicos.
  const geminiPriorityModels = [
    { key: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' },
    { key: 'gemini-1.5-flash-8b', name: 'Gemini 1.5 Flash 8B' },
    { key: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro' },
  ];

  let skippedGeminiReason: string | null = null;

  if (activeProviderKey !== 'google') {
    if (geminiCheck.available) {
      for (const gm of geminiPriorityModels) {
        candidates.push({
          provider_key: 'google',
          provider_display_name: 'Google Gemini',
          model_key: gm.key,
          model_display_name: gm.name,
          credential_available: true,
          priority: 2,
        });
      }
    } else {
      // Gemini no tiene credencial — registrar razón para skipped markers
      skippedGeminiReason = `No Gemini credential found in Vault. Checked aliases: ${geminiCheck.checked_aliases.map((c) => c.vault_key).join(', ')}`;
      console.warn('[buildAIExecutionCandidates] Gemini skipped —', skippedGeminiReason);
    }
  }

  // ── SLOTS 3+: Modelos adicionales desde la DB ─────────────────────────────
  const dbGeminiModels: Array<{ key: string; name: string }> = [];

  if (dbModels && dbModels.length > 0) {
    for (const m of dbModels) {
      const rawProvider = m.ai_providers as unknown;
      const providerData = (Array.isArray(rawProvider) ? rawProvider[0] : rawProvider) as { key: string; name: string } | null;
      const pKey = normalizeAIProviderKey(providerData?.key || '');
      if (!pKey) continue;

      if (pKey === 'google') {
        dbGeminiModels.push({ key: m.key, name: m.name });
      }

      // Skip models explicitly verified as non-executable — avoids wasting attempts
      const isExecutable = (m as unknown as { is_executable: boolean | null }).is_executable;
      if (isExecutable === false) {
        console.log(`[buildAIExecutionCandidates] Skipping ${pKey}/${m.key} — marked is_executable=false in DB`);
        continue;
      }

      const isCredAvailable = credentialsMap[pKey] ?? false;
      if (!isCredAvailable) continue;

      const mKey = m.key;
      const mName = m.name;

      // Ya incluido en slot 1 (config activa)
      if (pKey === activeProviderKey && mKey === activeModelKey) continue;

      let priority: number;
      if (pKey === 'google') {
        // Gemini desde DB: prioridad 3 (después del SLOT 2 hardcoded)
        priority = 3;
      } else if (pKey === activeProviderKey) {
        // Otros modelos del proveedor activo van DESPUÉS de Gemini
        priority = 4;
      } else if (pKey === 'openai') {
        priority = 5;
      } else {
        priority = 6;
      }

      candidates.push({
        provider_key: pKey,
        provider_display_name: providerData?.name || getProviderDisplayName(pKey),
        model_key: mKey,
        model_display_name: mName,
        credential_available: true,
        priority,
      });
    }
  }

  // ── Diagnóstico antes de dedup (para debugOut) ────────────────────────────
  const candidatesBeforeDedup = candidates.map((c) => ({
    provider_key: c.provider_key,
    model_key: c.model_key,
    priority: c.priority,
  }));

  // ── Deduplicar preservando primera aparición (menor priority) ─────────────
  candidates.sort((a, b) => a.priority - b.priority);

  const seen = new Set<string>();
  const uniqueCandidates: AIExecutionCandidate[] = [];

  for (const c of candidates) {
    const uniqueKey = `${c.provider_key}:${c.model_key}`;
    if (!seen.has(uniqueKey)) {
      seen.add(uniqueKey);
      uniqueCandidates.push(c);
    }
  }

  // ── Ordenar dentro de mismo priority por modelo preferente ────────────────
  const preferredModelOrder = [
    'gemini-2.0-flash',
    'gemini-1.5-flash-8b',
    'gemini-1.5-pro',
    'gemini-2.0-pro',
    'gemini-3.0-flash',
    'gemini-3.1-flash',
    'gpt-4o-mini',
    'gpt-4o',
    'claude-3-5-haiku-20241022',
    'claude-3-5-sonnet-20241022',
    'claude-sonnet-4-20250514',
  ];

  uniqueCandidates.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    const idxA = preferredModelOrder.indexOf(a.model_key);
    const idxB = preferredModelOrder.indexOf(b.model_key);
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    return a.model_key.localeCompare(b.model_key);
  });

  const finalOrder = uniqueCandidates.map((c) => `[${c.priority}] ${c.provider_key}/${c.model_key}`);
  console.log('[buildAIExecutionCandidates] Final order:', finalOrder);

  // ── Poblar debugOut si se proporcionó ─────────────────────────────────────
  if (debugOut) {
    debugOut.info = {
      active_config_summary: activeProviderKey
        ? { provider_key: activeProviderKey, model_key: activeModelKey }
        : null,
      active_config_used: activeConfig
        ? {
            provider_id: activeConfig.active_provider_id ?? null,
            provider_key: activeConfig.provider_key ?? null,
            provider_name: activeConfig.provider_name ?? null,
            model_id: activeConfig.active_model_id ?? null,
            model_name: activeConfig.model_name ?? null,
            model_key: activeModelKey,
            is_executable: slot1ActiveIsExecutable,
            slot1_included: !slot1SkipReason && !!activeProviderKey && !!activeModelKey,
            slot1_skip_reason: slot1SkipReason,
            source: 'getAIActiveConfig',
          }
        : null,
      vault_checks: geminiCheck.checked_aliases,
      gemini_credential: {
        available: geminiCheck.available,
        resolved_provider_key: geminiCheck.resolved_provider_key,
      },
      db_models_count: dbModels?.length ?? 0,
      gemini_models_in_db: dbGeminiModels,
      candidates_before_dedup: candidatesBeforeDedup,
      candidates_final: uniqueCandidates.map((c) => ({
        provider_key: c.provider_key,
        model_key: c.model_key,
        priority: c.priority,
      })),
      skipped_gemini_reason: skippedGeminiReason,
    };
  }

  return uniqueCandidates;
}

export async function enrichProspectCandidate({
  candidateId,
  userId,
  supabase,
  executionType = 'manual_re_enrichment',
}: EnrichProspectCandidateInput): Promise<EnrichProspectCandidateResult> {
  const localExtractDomain = (url: string | null | undefined): string | null => {
    if (!url) return null;
    try {
      const normalized = url.startsWith('http') ? url : `https://${url}`;
      const { hostname } = new URL(normalized);
      return hostname.replace(/^www\./, '').toLowerCase();
    } catch {
      return null;
    }
  };

  let initialEnrichmentBlock: Record<string, unknown> | null = null;
  let eligibility: EnrichmentEligibilityResult | null = null;
  let activeConfigUsed: AIExecutionDebugInfo['active_config_used'] = null;
  const attempts: Array<{
    provider: string;
    provider_display_name: string;
    model: string;
    model_display_name: string;
    status: 'failed' | 'completed' | 'skipped';
    error_code?: string;
    error_message?: string;
  }> = [];
  let agentRunId: string | undefined;

  try {
    const { data: candidate, error: loadErr } = await supabase
      .from('prospect_candidates')
      .select('*')
      .eq('id', candidateId)
      .single();

    if (loadErr || !candidate) {
      return { success: false, error: `Candidato no encontrado: ${loadErr?.message ?? 'sin datos'}` };
    }

    eligibility = evaluateCandidateEnrichmentNeed(candidate);

    if (eligibility.blocking_reason) {
      return {
        success: false,
        skipped: true,
        reason: 'candidate_already_processed',
        error: eligibility.blocking_reason,
      };
    }

    if (!eligibility.needs_enrichment) {
      return {
        success: false,
        skipped: true,
        reason: 'candidate_has_sufficient_data',
        error: 'El candidato ya cuenta con suficiente información para su revisión.',
      };
    }

    const existingMeta = candidate.metadata || {};
    const currentStatus = existingMeta.enrichment?.status;
    const currentStartedAt = existingMeta.enrichment?.started_at;
    
    // Si ya se está enriqueciendo y el inicio fue hace menos de 5 minutos, omitimos para evitar llamadas duplicadas (lock prevent)
    if (currentStatus === 'enriching' && currentStartedAt) {
      const startedTime = new Date(currentStartedAt).getTime();
      const elapsedMs = Date.now() - startedTime;
      if (elapsedMs < 5 * 60 * 1000) {
        return {
          success: false,
          skipped: true,
          reason: 'already_enriching',
          error: 'El candidato ya se está enriqueciendo actualmente.'
        };
      }
    }

    // Establecer el bloqueo de enriquecimiento antes de iniciar
    initialEnrichmentBlock = {
      ...(existingMeta.enrichment || {}),
      status: 'enriching',
      started_at: new Date().toISOString(),
      execution_type: executionType,
    };

    const { error: lockErr } = await supabase
      .from('prospect_candidates')
      .update({
        metadata: {
          ...existingMeta,
          enrichment: initialEnrichmentBlock
        }
      })
      .eq('id', candidateId);

    if (lockErr) {
      return { success: false, error: `No se pudo establecer el bloqueo de enriquecimiento: ${lockErr.message}` };
    }

    candidate.metadata = {
      ...existingMeta,
      enrichment: initialEnrichmentBlock
    };

    const activeConfig = await getAIActiveConfig();

    // debugOut captura diagnóstico seguro sin exponer API keys
    const debugOut: { info?: AIExecutionDebugInfo } = {};
    const executionCandidates = await buildAIExecutionCandidates(supabase, activeConfig, debugOut as { info: AIExecutionDebugInfo });

    // Log active_config_used seguro (sin API keys)
    activeConfigUsed = debugOut.info?.active_config_used ?? null;
    console.log('[enrichProspectCandidate] active_config_used:', JSON.stringify(activeConfigUsed ?? 'null'));

    if (process.env.NODE_ENV !== 'production') {
      console.log('[enrichProspectCandidate] AI Fallback Debug:', JSON.stringify(debugOut.info ?? {}, null, 2));
    }

    if (executionCandidates.length === 0) {
      const errMsg = 'No fue posible ejecutar el enriquecimiento con los proveedores de IA configurados. Revisa Configuración > Proveedores de IA.';
      const failedMetadata = {
        status: 'failed',
        failed_at: new Date().toISOString(),
        error_code: 'no_ai_providers_configured',
        error_message: errMsg,
        eligibility: {
          completeness_score: eligibility.completeness_score,
          reasons: eligibility.reasons,
          missing_fields: eligibility.missing_fields,
        },
        attempts: [],
        active_config_used: activeConfigUsed,
      };

      await supabase
        .from('prospect_candidates')
        .update({
          metadata: {
            ...(candidate.metadata || {}),
            enrichment: failedMetadata
          }
        })
        .eq('id', candidateId);

      return {
        success: false,
        error: errMsg,
        errorCode: 'no_ai_providers_configured',
        errorDetails: failedMetadata
      };
    }

    try {
      const run = await createAgentRun({
        agent_key: 'candidate_enrichment',
        agent_name: executionType === 'automatic_post_import_enrichment'
          ? 'Enriquecimiento incremental automático post-importación'
          : 'Enriquecimiento manual de candidato',
        triggered_by: userId,
        input_params: { candidateId, executionType },
      });
      if (run) {
        agentRunId = run.id;
      }
    } catch (logErr) {
      console.warn('[enrichProspectCandidate] Error creating agent run:', logErr);
    }

    const mode = executionType === 'automatic_post_import_enrichment' ? 'incremental_missing_fields' : 'full';
    const prompt = buildEnrichmentPrompt(candidate, eligibility, mode);

    let successfulResult: {
      text: string;
      inputTokens: number;
      outputTokens: number;
      candidate: AIExecutionCandidate;
    } | null = null;

    // maxAttempts cubre todos los candidatos disponibles.
    // Con Gemini en posición 2, siempre se intenta si tiene credencial.
    const maxAttempts = Math.min(8, executionCandidates.length);

    // Si Gemini no tiene credencial, registrar un marker de skipped antes de los intentos
    if (debugOut.info?.skipped_gemini_reason) {
      attempts.push({
        provider: 'google',
        provider_display_name: 'Google Gemini',
        model: 'gemini-2.0-flash',
        model_display_name: 'Gemini 2.0 Flash',
        status: 'skipped',
        error_code: 'credential_not_found',
        error_message: debugOut.info.skipped_gemini_reason,
      });
    }

    for (let i = 0; i < maxAttempts; i++) {
      const execCand = executionCandidates[i];
      let stepId: string | undefined;

      try {
        if (agentRunId) {
          const step = await createAgentRunStep({
            agent_run_id: agentRunId,
            step_key: `enrichment_attempt_${i}`,
            step_name: `Intento ${i + 1}: ${execCand.provider_display_name} (${execCand.model_display_name})`,
            provider_key: execCand.provider_key,
          });
          if (step) {
            stepId = step.id;
          }
        }
      } catch (logErr) {
        console.warn('[enrichProspectCandidate] Error creating step:', logErr);
      }

      // Usar alias-aware credential fetch para google/gemini
      const creds = await getAiProviderCredentialWithAlias(execCand.provider_key);
      if (!creds.success || !creds.apiKey) {
        const errMsg = `Credenciales no encontradas para el proveedor ${execCand.provider_display_name}`;
        attempts.push({
          provider: execCand.provider_key,
          provider_display_name: execCand.provider_display_name,
          model: execCand.model_key,
          model_display_name: execCand.model_display_name,
          status: 'skipped',
          error_code: 'credential_not_found',
          error_message: errMsg,
        });

        if (agentRunId && stepId) {
          try {
            await finishAgentRunStep(stepId, {
              status: 'error',
              error_message: errMsg,
            });
          } catch {}
        }
        continue;
      }

      try {
        const callStart = Date.now();
        const response = await callAiProviderAPI(
          execCand.provider_key,
          execCand.model_key,
          creds.apiKey,
          prompt
        );
        const duration = Date.now() - callStart;

        const cleanedText = response.text
          .trim()
          .replace(/^```(?:json)?\s*/i, '')
          .replace(/\s*```$/, '')
          .trim();
        
        const jsonStart = cleanedText.indexOf('{');
        const jsonEnd = cleanedText.lastIndexOf('}');
        if (jsonStart === -1 || jsonEnd === -1) {
          throw new Error('No se encontró un objeto JSON en la respuesta del LLM');
        }
        
        JSON.parse(cleanedText.slice(jsonStart, jsonEnd + 1));

        successfulResult = {
          text: response.text,
          inputTokens: response.inputTokens,
          outputTokens: response.outputTokens,
          candidate: execCand
        };

        attempts.push({
          provider: execCand.provider_key,
          provider_display_name: execCand.provider_display_name,
          model: execCand.model_key,
          model_display_name: execCand.model_display_name,
          status: 'completed',
        });

        let estimatedCostUsd = 0;
        try {
          const { data: pricing } = await supabase
            .from('provider_pricing_config')
            .select('provider_key, operation_key, unit, unit_cost_usd')
            .eq('provider_key', execCand.provider_key)
            .eq('is_active', true);

          if (pricing && pricing.length > 0) {
            const inputRule = pricing.find((p: { operation_key: string }) => p.operation_key === 'input_token');
            const outputRule = pricing.find((p: { operation_key: string }) => p.operation_key === 'output_token');

            if (inputRule) {
              const costPerToken = inputRule.unit === 'per_1k_tokens' ? inputRule.unit_cost_usd / 1000 : inputRule.unit_cost_usd;
              estimatedCostUsd += response.inputTokens * costPerToken;
            }
            if (outputRule) {
              const costPerToken = outputRule.unit === 'per_1k_tokens' ? outputRule.unit_cost_usd / 1000 : outputRule.unit_cost_usd;
              estimatedCostUsd += response.outputTokens * costPerToken;
            }
          } else {
            estimatedCostUsd = estimateLLMCost(response.inputTokens, response.outputTokens, execCand.model_key);
          }
        } catch (priceErr) {
          console.warn('[enrichProspectCandidate] Error calculating pricing:', priceErr);
          estimatedCostUsd = estimateLLMCost(response.inputTokens, response.outputTokens, execCand.model_key);
        }

        if (agentRunId && stepId) {
          try {
            await logProviderUsage({
              agent_run_id: agentRunId,
              agent_run_step_id: stepId,
              provider_key: execCand.provider_key,
              operation_key: 'enrich_candidate',
              model: execCand.model_key,
              input_tokens: response.inputTokens,
              output_tokens: response.outputTokens,
              estimated_cost_usd: estimatedCostUsd,
              status: 'success',
              duration_ms: duration,
              triggered_by: userId,
              metadata: { candidateId },
            });

            await finishAgentRunStep(stepId, {
              status: 'success',
              estimated_cost_usd: estimatedCostUsd,
              duration_ms: duration,
            });

            await updateAgentRun(agentRunId, {
              status: 'completed',
              estimated_cost_usd: estimatedCostUsd,
              finished_at: new Date().toISOString(),
            });
          } catch (logErr) {
            console.warn('[enrichProspectCandidate] Logging success err:', logErr);
          }
        }

        break;
      } catch (apiErr) {
        const isLlmError = apiErr instanceof AILlmCallError;
        const status = isLlmError ? apiErr.status : 500;
        const rawError = isLlmError ? apiErr.rawError : String(apiErr);
        const errMsg = apiErr instanceof Error ? apiErr.message : String(apiErr);

        let errorCode = 'api_error';
        if (status === 404 || rawError.includes('not_found_error') || rawError.includes('model_not_found') || rawError.includes('model: ') || rawError.includes('models/')) {
          errorCode = 'provider_model_not_found';
        } else if (errMsg.includes('JSON')) {
          errorCode = 'parse_error';
        }

        attempts.push({
          provider: execCand.provider_key,
          provider_display_name: execCand.provider_display_name,
          model: execCand.model_key,
          model_display_name: execCand.model_display_name,
          status: 'failed',
          error_code: errorCode,
          error_message: errMsg,
        });

        if (agentRunId && stepId) {
          try {
            await finishAgentRunStep(stepId, {
              status: 'error',
              error_message: errMsg,
            });
          } catch {}
        }

        if (!isRecoverableError(status, errMsg, rawError)) {
          console.warn(`[enrichProspectCandidate] Error fatal no recuperable (${errorCode}): ${errMsg}. Deteniendo fallbacks.`);
          break;
        }
      }
    }

    if (successfulResult) {
      const { text, inputTokens, outputTokens, candidate: execCand } = successfulResult;
      
      const cleanedText = text
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '')
        .trim();
      
      const jsonStart = cleanedText.indexOf('{');
      const jsonEnd = cleanedText.lastIndexOf('}');
      const parsedJson = JSON.parse(cleanedText.slice(jsonStart, jsonEnd + 1));

      let estimatedCostUsd = 0;
      try {
        estimatedCostUsd = estimateLLMCost(inputTokens, outputTokens, execCand.model_key);
      } catch {}

      const inputSources = ['candidate_import'];
      if (candidate.metadata?.validation) inputSources.push('validation_metadata');
      if (candidate.matched_hubspot_company_id) inputSources.push('hubspot_match');
      if (candidate.website) inputSources.push('website');

      // Normalize commercial_fit_status: map LLM fit_level to allowed DB values
      const rawFitLevel: string | null = parsedJson.sellup_fit?.fit_level ?? null;
      const normalizedCommercialFitStatus = normalizeCommercialFitStatus(rawFitLevel);
      const persistenceWarnings: string[] = [];
      if (rawFitLevel !== null && normalizedCommercialFitStatus !== rawFitLevel) {
        persistenceWarnings.push(
          `commercial_fit_status normalized from "${rawFitLevel}" to "${normalizedCommercialFitStatus ?? 'null'}"`
        );
      }

      const enrichmentBlock = {
        status: 'completed',
        enriched_at: new Date().toISOString(),
        enriched_by: userId,
        provider: execCand.provider_key,
        model: execCand.model_key,
        display_name: execCand.model_display_name,
        fallback_used: execCand.priority > 1,
        primary_provider_failed: attempts.length > 1,
        input_sources: inputSources,
        eligibility: {
          completeness_score: eligibility.completeness_score,
          reasons: eligibility.reasons,
          missing_fields: eligibility.missing_fields,
        },
        summary: parsedJson.summary || '',
        company_profile: parsedJson.company_profile || {},
        sellup_fit: parsedJson.sellup_fit || {},
        commercial_angles: parsedJson.commercial_angles || [],
        risks_or_uncertainties: parsedJson.risks_or_uncertainties || [],
        missing_data: parsedJson.missing_data || [],
        confidence: parsedJson.confidence || 'medium',
        requires_human_review: parsedJson.requires_human_review !== false,
        usage: {
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          estimated_cost: estimatedCostUsd,
        },
        attempts: attempts,
        active_config_used: activeConfigUsed,
        execution_type: executionType,
        enrichment_audit: parsedJson.enrichment_audit || {
          attempted_fields: eligibility.missing_fields,
          completed_fields: [],
          no_result_fields: [],
          conflicts: [],
        },
        suggested_tax_identifier: parsedJson.tax_identifier || null,
        suggested_tax_identifier_type: parsedJson.tax_identifier_type || null,
        linkedin_url: parsedJson.linkedin_url || null,
        ...(persistenceWarnings.length > 0 ? { persistence_warnings: persistenceWarnings } : {}),
      };

      const existingMeta = candidate.metadata || {};
      const updatedMeta = {
        ...existingMeta,
        enrichment: enrichmentBlock,
      };

      // Si linkedin_url se completó, lo guardamos en metadata.import.linkedin_url para consistencia
      if (parsedJson.linkedin_url) {
        const existingImport = existingMeta.import || {};
        if (!existingImport.linkedin_url) {
          updatedMeta.import = {
            ...existingImport,
            linkedin_url: parsedJson.linkedin_url,
          };
        }
      }

      // Preparar payload de actualización con campos físicos sólo si están vacíos
      const candidateUpdates: Record<string, unknown> = {
        metadata: updatedMeta,
        fit_score: parsedJson.sellup_fit?.fit_score ?? null,
        commercial_fit_status: normalizedCommercialFitStatus,
      };

      const setIfEmpty = (dbVal: unknown, llmVal: unknown) => {
        if (dbVal === null || dbVal === undefined || String(dbVal).trim() === '') {
          if (llmVal !== null && llmVal !== undefined && String(llmVal).trim() !== '') {
            return llmVal;
          }
        }
        return undefined;
      };

      const fieldsToUpdate = [
        { dbKey: 'website', llmKey: 'website' },
        { dbKey: 'domain', llmKey: 'domain' },
        { dbKey: 'city', llmKey: 'city' },
        { dbKey: 'region', llmKey: 'region' },
        { dbKey: 'industry', llmKey: 'industry' },
        { dbKey: 'company_size', llmKey: 'company_size' },
      ];

      for (const { dbKey, llmKey } of fieldsToUpdate) {
        const val = setIfEmpty(candidate[dbKey], parsedJson[llmKey]);
        if (val !== undefined) {
          candidateUpdates[dbKey] = val;
        }
      }

      // Caso especial: si el dominio está vacío pero se encontró sitio web, lo extraemos y guardamos
      if (!candidate.domain && candidateUpdates.website) {
        const extracted = localExtractDomain(candidateUpdates.website as string);
        if (extracted) {
          candidateUpdates.domain = extracted;
        }
      }

      const { error: saveErr } = await supabase
        .from('prospect_candidates')
        .update(candidateUpdates)
        .eq('id', candidateId);

      if (saveErr) {
        throw new Error(`No se pudo persistir el enriquecimiento en el candidato: ${saveErr.message}`);
      }

      return {
        success: true,
        data: enrichmentBlock,
      };
    } else {
      const finalMsg = 'No fue posible ejecutar el enriquecimiento con los proveedores de IA configurados. Revisa Configuración > Proveedores de IA.';
      const lastAttempt = attempts[attempts.length - 1];
      const finalErrorCode = lastAttempt?.error_code || 'all_ai_providers_failed';

      const failedMetadata = {
        status: 'failed',
        failed_at: new Date().toISOString(),
        error_code: 'all_ai_providers_failed',
        error_message: finalMsg,
        eligibility: {
          completeness_score: eligibility.completeness_score,
          reasons: eligibility.reasons,
          missing_fields: eligibility.missing_fields,
        },
        attempts: attempts,
        active_config_used: activeConfigUsed,
        execution_type: executionType,
      };

      if (agentRunId) {
        try {
          await updateAgentRun(agentRunId, {
            status: 'failed',
            error_message: finalMsg,
            finished_at: new Date().toISOString(),
          });
        } catch {}
      }

      await supabase
        .from('prospect_candidates')
        .update({
          metadata: {
            ...(candidate.metadata || {}),
            enrichment: failedMetadata
          }
        })
        .eq('id', candidateId);

      return {
        success: false,
        error: finalMsg,
        errorCode: finalErrorCode,
        errorDetails: failedMetadata
      };
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('[enrichProspectCandidate] Unexpected error:', err);

    // En caso de error inesperado, liberar el bloqueo de enriquecimiento si se había establecido
    try {
      const failedMetadata = {
        status: 'failed',
        failed_at: new Date().toISOString(),
        error_code: 'unexpected_error',
        error_message: errMsg,
        eligibility: eligibility ? {
          completeness_score: eligibility.completeness_score,
          reasons: eligibility.reasons,
          missing_fields: eligibility.missing_fields,
        } : null,
        attempts: attempts,
        active_config_used: activeConfigUsed,
        execution_type: executionType,
      };

      await supabase
        .from('prospect_candidates')
        .update({
          metadata: {
            ...(initialEnrichmentBlock ? initialEnrichmentBlock : {}),
            enrichment: failedMetadata
          }
        })
        .eq('id', candidateId);
    } catch (dbReleaseErr) {
      console.error('[enrichProspectCandidate] Error releasing block on unexpected error:', dbReleaseErr);
    }

    return {
      success: false,
      error: `Error inesperado durante el enriquecimiento: ${errMsg}`,
    };
  }
}
