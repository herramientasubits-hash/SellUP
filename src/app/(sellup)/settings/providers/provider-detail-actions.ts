'use server';

import { getProviderDetail } from '@/modules/budgets/provider-detail-queries';
import type { ProviderUsageLogRow, ProviderSyncLogRow } from '@/modules/budgets/provider-detail-queries';
import type { BudgetRuleRow, BudgetRuleFormOptions } from '@/modules/budgets/rule-queries';
import {
  getAiProviderConnectionStatus,
  testAiProviderConnectionWithVault,
  updateAiProviderCredential,
  disconnectAiProvider,
} from '@/modules/ai-config/actions';
import {
  getApolloConnection,
  testApolloConnectionAction,
  updateApolloApiKey,
  disconnectApollo,
  getLushaConnection,
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

export type { ProviderUsageLogRow, ProviderSyncLogRow };

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
}

// ── Wrappers IA ───────────────────────────────────────────────────────────────

export async function loadAiProviderConnectionForPanel(
  providerKey: string,
): Promise<AiConnectionPanelState | null> {
  try {
    const status = await getAiProviderConnectionStatus(providerKey);
    return {
      hasCredential: status.has_credential,
      connectionStatus: status.connection_status,
      lastTestedAt: status.last_tested_at,
      lastConnectionError: status.last_connection_error,
      canActivate: status.can_activate,
    };
  } catch {
    return null;
  }
}

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

export async function loadProspectingProviderConnectionForPanel(
  providerKey: string,
): Promise<ProspectingConnectionPanelState> {
  try {
    if (providerKey === 'apollo') {
      const conn = await getApolloConnection();
      if (!conn) {
        return { supported: true, credentialsStatus: 'missing', connectionStatus: 'not_configured', lastTestedAt: null, lastConnectedAt: null, lastConnectionError: null };
      }
      return {
        supported: true,
        credentialsStatus: conn.credentials_status,
        connectionStatus: conn.connection_status,
        lastTestedAt: conn.last_tested_at ?? null,
        lastConnectedAt: conn.last_connected_at ?? null,
        lastConnectionError: conn.last_connection_error ?? null,
      };
    }

    if (providerKey === 'lusha') {
      const conn = await getLushaConnection();
      if (!conn) {
        return { supported: true, credentialsStatus: 'missing', connectionStatus: 'not_configured', lastTestedAt: null, lastConnectedAt: null, lastConnectionError: null };
      }
      return {
        supported: true,
        credentialsStatus: conn.credentials_status,
        connectionStatus: conn.connection_status,
        lastTestedAt: conn.last_tested_at ?? null,
        lastConnectedAt: conn.last_connected_at ?? null,
        lastConnectionError: conn.last_connection_error ?? null,
      };
    }

    if (providerKey === 'tavily') {
      const integration = await getTavilyIntegration();
      if (!integration?.connection) {
        return { supported: true, credentialsStatus: 'missing', connectionStatus: 'not_configured', lastTestedAt: null, lastConnectedAt: null, lastConnectionError: null };
      }
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
    return { supported: false, credentialsStatus: 'missing', connectionStatus: 'not_configured', lastTestedAt: null, lastConnectedAt: null, lastConnectionError: null };
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
