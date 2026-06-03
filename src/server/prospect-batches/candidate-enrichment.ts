import { SupabaseClient } from '@supabase/supabase-js';
import { getAiProviderCredential } from '../services/ai-connection';
import { getAIActiveConfig } from '@/modules/ai-config/actions';
import type { AIActiveConfig } from '@/modules/ai-config/types';
import { evaluateCandidateEnrichmentNeed } from './candidate-enrichment-eligibility';
import {
  createAgentRun,
  updateAgentRun,
  createAgentRunStep,
  finishAgentRunStep,
  logProviderUsage,
} from '@/modules/usage-tracking/logging';
import { estimateLLMCost } from '../agents/prospecting-toolkit/llm-evaluator';

export interface EnrichProspectCandidateInput {
  candidateId: string;
  userId: string;
  supabase: SupabaseClient;
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildEnrichmentPrompt(candidate: any, eligibility: any): string {
  return `Eres un analista de datos B2B y Sales Ops Architect experto. Tu objetivo es enriquecer los datos comerciales de un candidato (empresa) utilizando ÚNICAMENTE la información interna provista.

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
  "requires_human_review": true
}`;
}

export async function enrichProspectCandidate({
  candidateId,
  userId,
  supabase,
}: EnrichProspectCandidateInput): Promise<EnrichProspectCandidateResult> {
  const startedAt = Date.now();

  try {
    // 1. Cargar candidato
    const { data: candidate, error: loadErr } = await supabase
      .from('prospect_candidates')
      .select('*')
      .eq('id', candidateId)
      .single();

    if (loadErr || !candidate) {
      return { success: false, error: `Candidato no encontrado: ${loadErr?.message ?? 'sin datos'}` };
    }

    // 2. Evaluar elegibilidad
    const eligibility = evaluateCandidateEnrichmentNeed(candidate);

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

    // 3. Obtener configuración activa de IA
    const activeConfig = await getAIActiveConfig();
    if (!activeConfig || !activeConfig.active_provider_id || !activeConfig.active_model_id) {
      return {
        success: false,
        error: 'No hay proveedor de IA configurado para enriquecimiento.',
      };
    }

    const canonicalProvider = resolveCanonicalProvider(activeConfig);
    const resolvedModelId = resolveProviderModelId(activeConfig, canonicalProvider);

    if (!resolvedModelId) {
      const errMsg = 'El modelo configurado no tiene un ID técnico válido para Anthropic.';
      const failedMetadata = {
        status: 'failed',
        failed_at: new Date().toISOString(),
        provider: canonicalProvider,
        display_name: activeConfig.model_name ?? '',
        provider_model_id: '',
        error_code: 'provider_model_not_found',
        error_message: errMsg,
        raw_error_safe: { message: errMsg },
        eligibility: {
          completeness_score: eligibility.completeness_score,
          reasons: eligibility.reasons,
          missing_fields: eligibility.missing_fields,
        }
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
        errorCode: 'provider_model_not_found',
        errorDetails: failedMetadata
      };
    }

    // 4. Obtener API key desde Vault
    const creds = await getAiProviderCredential(canonicalProvider);
    if (!creds.success || !creds.apiKey) {
      return {
        success: false,
        error: 'No hay proveedor de IA configurado para enriquecimiento.',
      };
    }

    // 5. Iniciar agent run de observabilidad si se desea registrar
    let agentRunId: string | undefined;
    let stepId: string | undefined;

    try {
      const run = await createAgentRun({
        agent_key: 'candidate_enrichment',
        agent_name: 'Enriquecimiento manual de candidato',
        triggered_by: userId,
        input_params: { candidateId },
      });
      if (run) {
        agentRunId = run.id;
        const step = await createAgentRunStep({
          agent_run_id: run.id,
          step_key: 'enrichment_llm_call',
          step_name: 'Llamada al LLM para enriquecimiento',
          provider_key: canonicalProvider,
        });
        if (step) {
          stepId = step.id;
        }
      }
    } catch (logErr) {
      console.warn('[enrichProspectCandidate] Error writing to agent execution tables (non-blocking):', logErr);
    }

    // 6. Construir prompt y llamar al LLM
    const prompt = buildEnrichmentPrompt(candidate, eligibility);

    let text: string;
    let inputTokens = 0;
    let outputTokens = 0;

    try {
      const response = await callAiProviderAPI(
        canonicalProvider,
        resolvedModelId,
        creds.apiKey,
        prompt
      );
      text = response.text;
      inputTokens = response.inputTokens;
      outputTokens = response.outputTokens;
    } catch (apiErr) {
      const isLlmError = apiErr instanceof AILlmCallError;
      const status = isLlmError ? apiErr.status : 500;
      const rawError = isLlmError ? apiErr.rawError : String(apiErr);
      const errMsg = apiErr instanceof Error ? apiErr.message : String(apiErr);
      
      let errorCode = 'api_error';
      let errorMsg = errMsg;
      
      if (status === 404 || rawError.includes('not_found_error') || rawError.includes('model_not_found') || rawError.includes('model: ') || rawError.includes('models/')) {
        errorCode = 'provider_model_not_found';
        errorMsg = `Modelo no encontrado en ${canonicalProvider === 'anthropic' ? 'Anthropic' : canonicalProvider === 'google' ? 'Google Gemini' : 'OpenAI'}`;
      }

      let rawErrorSafe: Record<string, unknown> = { message: errMsg };
      try {
        if (isLlmError) {
          rawErrorSafe = JSON.parse(rawError);
        }
      } catch {}

      const failedMetadata = {
        status: 'failed',
        failed_at: new Date().toISOString(),
        provider: canonicalProvider,
        display_name: activeConfig.model_name ?? '',
        provider_model_id: resolvedModelId,
        error_code: errorCode,
        error_message: errorMsg,
        raw_error_safe: rawErrorSafe,
        eligibility: {
          completeness_score: eligibility.completeness_score,
          reasons: eligibility.reasons,
          missing_fields: eligibility.missing_fields,
        }
      };

      if (agentRunId && stepId) {
        await finishAgentRunStep(stepId, {
          status: 'error',
          error_message: errMsg,
        });
        await updateAgentRun(agentRunId, {
          status: 'failed',
          error_message: errMsg,
          finished_at: new Date().toISOString(),
        });
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
        error: isLlmError 
          ? `Error al llamar al proveedor de IA: ${canonicalProvider.toUpperCase()} error ${status}: ${rawError}`
          : `Error al llamar al proveedor de IA: ${errMsg}`,
        errorCode,
        errorDetails: failedMetadata
      };
    }

    // 7. Parsear la respuesta del LLM
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let parsedJson: any;
    try {
      const cleanedText = text
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '')
        .trim();
      
      const jsonStart = cleanedText.indexOf('{');
      const jsonEnd = cleanedText.lastIndexOf('}');
      if (jsonStart === -1 || jsonEnd === -1) {
        throw new Error('No se encontró un objeto JSON en la respuesta');
      }
      
      parsedJson = JSON.parse(cleanedText.slice(jsonStart, jsonEnd + 1));
    } catch (parseErr) {
      const errMsg = `Fallo al parsear respuesta JSON de la IA: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`;
      const failedMetadata = {
        status: 'failed',
        failed_at: new Date().toISOString(),
        provider: canonicalProvider,
        display_name: activeConfig.model_name ?? '',
        provider_model_id: resolvedModelId,
        error_code: 'parse_error',
        error_message: errMsg,
        raw_error_safe: { message: parseErr instanceof Error ? parseErr.message : String(parseErr), raw_response: text.slice(0, 1000) },
        eligibility: {
          completeness_score: eligibility.completeness_score,
          reasons: eligibility.reasons,
          missing_fields: eligibility.missing_fields,
        }
      };

      if (agentRunId && stepId) {
        await finishAgentRunStep(stepId, {
          status: 'error',
          error_message: errMsg,
        });
        await updateAgentRun(agentRunId, {
          status: 'failed',
          error_message: errMsg,
          finished_at: new Date().toISOString(),
        });
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
        error: errMsg,
        errorCode: 'parse_error',
        errorDetails: failedMetadata
      };
    }

    // 8. Calcular costos estimados
    let estimatedCostUsd = 0;
    try {
      const { data: pricing } = await supabase
        .from('provider_pricing_config')
        .select('provider_key, operation_key, unit, unit_cost_usd')
        .eq('provider_key', canonicalProvider)
        .eq('is_active', true);

      if (pricing && pricing.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const inputRule = pricing.find((p: any) => p.operation_key === 'input_token');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const outputRule = pricing.find((p: any) => p.operation_key === 'output_token');

        if (inputRule) {
          const costPerToken = inputRule.unit === 'per_1k_tokens' ? inputRule.unit_cost_usd / 1000 : inputRule.unit_cost_usd;
          estimatedCostUsd += inputTokens * costPerToken;
        }
        if (outputRule) {
          const costPerToken = outputRule.unit === 'per_1k_tokens' ? outputRule.unit_cost_usd / 1000 : outputRule.unit_cost_usd;
          estimatedCostUsd += outputTokens * costPerToken;
        }
      } else {
        // Fallback calculations using local helper
        estimatedCostUsd = estimateLLMCost(inputTokens, outputTokens, resolvedModelId);
      }
    } catch (priceErr) {
      console.warn('[enrichProspectCandidate] Error calculating dynamic pricing, using fallbacks:', priceErr);
      estimatedCostUsd = estimateLLMCost(inputTokens, outputTokens, resolvedModelId);
    }

    // 9. Registrar logs de ejecución en Supabase
    if (agentRunId && stepId) {
      try {
        const duration = Date.now() - startedAt;
        await logProviderUsage({
          agent_run_id: agentRunId,
          agent_run_step_id: stepId,
          provider_key: canonicalProvider,
          operation_key: 'enrich_candidate',
          model: resolvedModelId,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
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
        console.warn('[enrichProspectCandidate] Non-blocking logging failure:', logErr);
      }
    }

    // 10. Guardar en metadata.enrichment
    const inputSources = ['candidate_import'];
    if (candidate.metadata?.validation) inputSources.push('validation_metadata');
    if (candidate.matched_hubspot_company_id) inputSources.push('hubspot_match');
    if (candidate.website) inputSources.push('website');

    const enrichmentBlock = {
      status: 'completed',
      enriched_at: new Date().toISOString(),
      enriched_by: userId,
      provider: canonicalProvider,
      model: resolvedModelId,
      display_name: activeConfig.model_name ?? '',
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
    };

    const existingMeta = candidate.metadata || {};
    const updatedMeta = {
      ...existingMeta,
      enrichment: enrichmentBlock,
    };

    const { error: saveErr } = await supabase
      .from('prospect_candidates')
      .update({
        metadata: updatedMeta,
        fit_score: parsedJson.sellup_fit?.fit_score || null,
        commercial_fit_status: parsedJson.sellup_fit?.fit_level || null,
      })
      .eq('id', candidateId);

    if (saveErr) {
      throw new Error(`No se pudo persistir el enriquecimiento en el candidato: ${saveErr.message}`);
    }

    return {
      success: true,
      data: enrichmentBlock,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('[enrichProspectCandidate] Unexpected error:', err);
    return {
      success: false,
      error: `Error inesperado durante el enriquecimiento: ${errMsg}`,
    };
  }
}
