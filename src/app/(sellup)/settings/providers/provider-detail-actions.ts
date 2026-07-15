'use server';

import { getProviderDetail, getFilteredProviderUsageLogs } from '@/modules/budgets/provider-detail-queries';
import type { ProviderUsageLogRow, ProviderSyncLogRow } from '@/modules/budgets/provider-detail-queries';
import { getDistinctFilterOptions, type UsageFilters, type FilterOptions } from '@/modules/ai-usage/queries';
import type { BudgetRuleRow, BudgetRuleFormOptions } from '@/modules/budgets/rule-queries';
import {
  testAiProviderConnectionWithVault,
  updateAiProviderCredential,
  disconnectAiProvider,
  syncAnthropicModels,
  updateAIProviderStatus,
  updateAIModelStatus,
  addModelPricing,
  setActiveConfig,
} from '@/modules/ai-config/actions';
import {
  getAiProviderDetail,
  isIaProviderKey,
  type AiProviderDetailResult,
} from '@/modules/ai-config/provider-ai-detail-queries';
import {
  testApolloConnectionAction,
  updateApolloApiKey,
  disconnectApollo,
  testLushaConnectionAction,
  updateLushaApiKey,
  disconnectLusha,
} from '@/modules/prospecting-config/actions';
import {
  getTavilyIntegration,
  testTavilyConnectionAction,
  updateTavilyApiKey,
  disconnectTavily,
} from '@/modules/integrations/actions';
import { getProviderEffectivenessReadModel } from '@/modules/provider-effectiveness/actions';
import type { ProviderEffectivenessProviderSummary } from '@/modules/provider-effectiveness/types';
import { isEffectivenessSupportedProvider } from './contact-enrichment-effectiveness-ui';

export interface SidepanelDetailData {
  usageLogs: ProviderUsageLogRow[];
  syncLogs: ProviderSyncLogRow[];
  providerRules: BudgetRuleRow[];
  formOptions: BudgetRuleFormOptions;
  /** Null when the provider is outside the read model's supported cohort, or when the read failed. */
  contactEnrichmentEffectiveness: ProviderEffectivenessProviderSummary | null;
  /** Null when the provider is not an IA provider (anthropic/openai/gemini), or when the read failed. */
  aiProviderDetail: AiProviderDetailResult | null;
}

async function loadContactEnrichmentEffectivenessForPanel(
  providerKey: string,
): Promise<ProviderEffectivenessProviderSummary | null> {
  if (!isEffectivenessSupportedProvider(providerKey)) return null;
  try {
    const model = await getProviderEffectivenessReadModel({ provider: providerKey });
    return model.providers[0] ?? null;
  } catch {
    return null;
  }
}

async function loadAiProviderDetailForPanel(providerKey: string): Promise<AiProviderDetailResult | null> {
  if (!isIaProviderKey(providerKey)) return null;
  try {
    return await getAiProviderDetail(providerKey);
  } catch {
    return null;
  }
}

export async function loadProviderDetailForPanel(providerKey: string): Promise<SidepanelDetailData | null> {
  try {
    const detail = await getProviderDetail(providerKey);
    if (!detail) return null;
    const [contactEnrichmentEffectiveness, aiProviderDetail] = await Promise.all([
      loadContactEnrichmentEffectivenessForPanel(providerKey),
      loadAiProviderDetailForPanel(providerKey),
    ]);
    return {
      usageLogs: detail.recentUsageLogs,
      syncLogs: detail.recentSyncLogs,
      providerRules: detail.allRulesForProvider,
      formOptions: detail.formOptions,
      contactEnrichmentEffectiveness,
      aiProviderDetail,
    };
  } catch {
    return null;
  }
}

// ── Logs tab filter parity (Q3F-HOTFIX-4A) ────────────────────────────────────

export interface ProviderLogsFilterResult {
  ok: boolean;
  logs: ProviderUsageLogRow[];
  filterOptions: FilterOptions | null;
}

export async function loadFilteredProviderUsageLogsForPanel(
  providerKey: string,
  filters: UsageFilters,
): Promise<ProviderLogsFilterResult> {
  try {
    const [logs, filterOptions] = await Promise.all([
      getFilteredProviderUsageLogs(providerKey, filters, 20),
      getDistinctFilterOptions(),
    ]);
    return { ok: true, logs, filterOptions };
  } catch {
    return { ok: false, logs: [], filterOptions: null };
  }
}

// ── Tipos de panel ────────────────────────────────────────────────────────────

export interface AiConnectionPanelState {
  hasCredential: boolean;
  connectionStatus: string;
  lastTestedAt: string | null;
  lastConnectionError: string | null;
  canActivate: boolean;
}

export interface ActionResult {
  ok: boolean;
  message?: string;
  error?: string;
}

export interface ProspectingConnectionPanelState {
  supported: boolean;
  credentialsStatus: string;
  connectionStatus: string;
  lastTestedAt: string | null;
  lastConnectedAt: string | null;
  lastConnectionError: string | null;
  loadErrorMsg?: string;
}

// ── Wrappers IA ───────────────────────────────────────────────────────────────

export async function testAiProviderConnectionForPanel(
  providerKey: string,
): Promise<ActionResult> {
  try {
    const result = await testAiProviderConnectionWithVault(providerKey);
    return { ok: result.success, message: result.message, error: result.error };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Error desconocido' };
  }
}

export async function updateAiProviderCredentialForPanel(
  providerKey: string,
  apiKey: string,
): Promise<ActionResult> {
  try {
    const result = await updateAiProviderCredential(providerKey, apiKey);
    return { ok: result.success, message: result.message, error: result.error };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Error desconocido' };
  }
}

export async function disconnectAiProviderForPanel(
  providerKey: string,
): Promise<ActionResult> {
  try {
    const result = await disconnectAiProvider(providerKey);
    return { ok: result.success, message: result.message, error: result.error };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Error desconocido' };
  }
}

/** Thin panel wrapper around the existing syncAnthropicModels() server action — no new backend logic. */
export async function syncAnthropicModelsForPanel(): Promise<ActionResult> {
  try {
    const result = await syncAnthropicModels();
    const message = result.success
      ? `Modelos verificados: ${result.models_checked.length} · nuevos: ${result.models_added.length} · no disponibles: ${result.models_marked_unavailable.length}`
      : undefined;
    return { ok: result.success, message, error: result.error };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Error desconocido' };
  }
}

/** Thin panel wrapper around the existing updateAIProviderStatus() server action — no new backend logic. */
export async function updateAiProviderStatusForPanel(
  providerId: string,
  newStatus: 'active' | 'inactive',
): Promise<ActionResult> {
  try {
    const result = await updateAIProviderStatus(providerId, newStatus);
    return { ok: result.success, error: result.error };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Error desconocido' };
  }
}

/** Thin panel wrapper around the existing updateAIModelStatus() server action — no new backend logic. */
export async function updateAiModelStatusForPanel(
  modelId: string,
  newStatus: 'active' | 'inactive',
): Promise<ActionResult> {
  try {
    const result = await updateAIModelStatus(modelId, newStatus);
    return { ok: result.success, error: result.error };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Error desconocido' };
  }
}

/** Thin panel wrapper around the existing addModelPricing() server action — no new backend logic. */
export async function addAiModelPricingForPanel(
  modelId: string,
  inputCost: number,
  outputCost: number,
  currency: string = 'USD',
): Promise<ActionResult> {
  try {
    const result = await addModelPricing(modelId, inputCost, outputCost, currency);
    return { ok: result.success, error: result.error };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Error desconocido' };
  }
}

/**
 * Thin panel wrapper around the existing setActiveConfig() server action — no new backend logic.
 * This changes the GLOBAL active IA provider/model used by future AI executions across SellUp,
 * not just a setting local to this provider's panel. Callers must present copy that makes this
 * global effect explicit (see "Usar como modelo base global" in the sidepanel).
 */
export async function setAiActiveConfigForPanel(
  providerId: string,
  modelId: string,
): Promise<ActionResult> {
  try {
    const result = await setActiveConfig(providerId, modelId);
    return { ok: result.success, error: result.error };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Error desconocido' };
  }
}

// ── Wrappers Prospección ──────────────────────────────────────────────────────

const _NOT_CONFIGURED: ProspectingConnectionPanelState = {
  supported: true,
  credentialsStatus: 'missing',
  connectionStatus: 'not_configured',
  lastTestedAt: null,
  lastConnectedAt: null,
  lastConnectionError: null,
};

// Apollo and Lusha connection state is loaded server-side in providers/page.tsx
// via getApolloConnection() / getLushaConnection() and passed as props.
// This function is used only for Tavily (and future providers without a server prop).
export async function loadProspectingProviderConnectionForPanel(
  providerKey: string,
): Promise<ProspectingConnectionPanelState> {
  try {
    if (providerKey === 'tavily') {
      const integration = await getTavilyIntegration();
      if (!integration?.connection) return _NOT_CONFIGURED;
      return {
        supported: true,
        credentialsStatus: integration.connection.credentials_status ?? 'missing',
        connectionStatus: integration.connection.connection_status ?? 'not_configured',
        lastTestedAt: integration.connection.last_tested_at ?? null,
        lastConnectedAt: null,
        lastConnectionError: integration.connection.last_connection_error ?? null,
      };
    }

    return { supported: false, credentialsStatus: 'missing', connectionStatus: 'not_configured', lastTestedAt: null, lastConnectedAt: null, lastConnectionError: null };
  } catch {
    return {
      supported: true,
      credentialsStatus: 'missing',
      connectionStatus: 'not_configured',
      lastTestedAt: null,
      lastConnectedAt: null,
      lastConnectionError: null,
      loadErrorMsg: 'No fue posible cargar el estado de conexión.',
    };
  }
}

export async function testProspectingProviderConnectionForPanel(
  providerKey: string,
): Promise<ActionResult> {
  try {
    if (providerKey === 'apollo') {
      const r = await testApolloConnectionAction();
      return { ok: r.success, message: r.message, error: r.error };
    }
    if (providerKey === 'lusha') {
      const r = await testLushaConnectionAction();
      return { ok: r.success, message: r.message, error: r.error };
    }
    if (providerKey === 'tavily') {
      const r = await testTavilyConnectionAction();
      return { ok: r.success, message: r.message, error: r.error };
    }
    return { ok: false, error: 'Proveedor no soportado aún. Configuración progresiva.' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Error desconocido' };
  }
}

export async function updateProspectingProviderCredentialForPanel(
  providerKey: string,
  apiKey: string,
): Promise<ActionResult> {
  try {
    if (providerKey === 'apollo') {
      const r = await updateApolloApiKey(apiKey);
      return { ok: r.success, message: r.message, error: r.error };
    }
    if (providerKey === 'lusha') {
      const r = await updateLushaApiKey(apiKey);
      return { ok: r.success, message: r.message, error: r.error };
    }
    if (providerKey === 'tavily') {
      const r = await updateTavilyApiKey(apiKey);
      return { ok: r.success, message: r.message, error: r.error };
    }
    return { ok: false, error: 'Proveedor no soportado aún. Configuración progresiva.' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Error desconocido' };
  }
}

export async function disconnectProspectingProviderForPanel(
  providerKey: string,
): Promise<ActionResult> {
  try {
    if (providerKey === 'apollo') {
      const r = await disconnectApollo();
      return { ok: r.success, message: r.message, error: r.error };
    }
    if (providerKey === 'lusha') {
      const r = await disconnectLusha();
      return { ok: r.success, message: r.message, error: r.error };
    }
    if (providerKey === 'tavily') {
      const r = await disconnectTavily();
      return { ok: r.success, message: r.message, error: r.error };
    }
    return { ok: false, error: 'Proveedor no soportado aún. Configuración progresiva.' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Error desconocido' };
  }
}
