'use server';

import { getProviderDetail } from '@/modules/budgets/provider-detail-queries';
import type { ProviderUsageLogRow, ProviderSyncLogRow } from '@/modules/budgets/provider-detail-queries';
import type { BudgetRuleRow, BudgetRuleFormOptions } from '@/modules/budgets/rule-queries';
import {
  getProviderStats,
  getRecentProviderLogs,
  getDistinctFilterOptions,
} from '@/modules/ai-usage/queries';
import type { UsageFilters, FilterOptions } from '@/modules/ai-usage/queries';
import type { ProviderUsageLog } from '@/modules/usage-tracking/types';
import {
  testAiProviderConnectionWithVault,
  updateAiProviderCredential,
  disconnectAiProvider,
} from '@/modules/ai-config/actions';
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

export interface SidepanelDetailData {
  usageLogs: ProviderUsageLogRow[];
  syncLogs: ProviderSyncLogRow[];
  providerRules: BudgetRuleRow[];
  formOptions: BudgetRuleFormOptions;
}

export async function loadProviderDetailForPanel(providerKey: string): Promise<SidepanelDetailData | null> {
  try {
    const detail = await getProviderDetail(providerKey);
    if (!detail) return null;
    return {
      usageLogs: detail.recentUsageLogs,
      syncLogs: detail.recentSyncLogs,
      providerRules: detail.allRulesForProvider,
      formOptions: detail.formOptions,
    };
  } catch {
    return null;
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

// ── Consumption workspace ─────────────────────────────────────────────────────

export interface ProviderConsumptionSnapshot {
  totalCredits: number | null;
  totalCostUsd: number;
  recentLogs: ProviderUsageLog[];
  filterOptions: FilterOptions | null;
}

export type { UsageFilters, FilterOptions };

export async function loadProviderConsumptionForWorkspace(
  providerKey: string,
  filters: UsageFilters,
): Promise<ProviderConsumptionSnapshot | null> {
  try {
    const providerFilters: UsageFilters = { ...filters, provider: providerKey };
    const [statsResult, logsResult, optionsResult] = await Promise.all([
      getProviderStats(providerFilters),
      getRecentProviderLogs(25, providerFilters),
      getDistinctFilterOptions(),
    ]);

    if (statsResult === null) return null;

    const stat = (statsResult ?? []).find((s) => s.provider_key === providerKey);

    return {
      totalCredits: stat?.total_credits_used ?? null,
      totalCostUsd: stat?.total_estimated_cost_usd ?? 0,
      recentLogs: logsResult ?? [],
      filterOptions: optionsResult,
    };
  } catch {
    return null;
  }
}
