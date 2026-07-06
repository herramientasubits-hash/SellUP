'use server';

import { createClient as createAdminClient } from '@supabase/supabase-js';
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
import { hasApolloApiKey } from '@/server/services/apollo-connection';
import { hasLushaApiKey } from '@/server/services/lusha-connection';

const _supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://lrdruowtadwbdulndlph.supabase.co';
const _supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function getAdminSupabase() {
  if (!_supabaseServiceKey) {
    throw new Error('enrichment_configuration_unavailable');
  }
  return createAdminClient(_supabaseUrl, _supabaseServiceKey);
}

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
  loadErrorMsg?: string;
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

const _NOT_CONFIGURED: ProspectingConnectionPanelState = {
  supported: true,
  credentialsStatus: 'missing',
  connectionStatus: 'not_configured',
  lastTestedAt: null,
  lastConnectedAt: null,
  lastConnectionError: null,
};

async function _loadApolloConnectionDirect(): Promise<ProspectingConnectionPanelState> {
  const admin = getAdminSupabase();
  const { data: prov } = await admin
    .from('prospecting_providers')
    .select('id')
    .eq('provider_key', 'apollo')
    .maybeSingle();
  if (!prov?.id) return _NOT_CONFIGURED;

  const { data: conn } = await admin
    .from('prospecting_provider_connections')
    .select('*')
    .eq('provider_id', prov.id)
    .maybeSingle();
  if (!conn) return _NOT_CONFIGURED;

  const hasKey = await hasApolloApiKey();
  return {
    supported: true,
    credentialsStatus: hasKey ? 'stored' : 'missing',
    connectionStatus: (conn as { connection_status: string }).connection_status,
    lastTestedAt: (conn as { last_tested_at?: string | null }).last_tested_at ?? null,
    lastConnectedAt: (conn as { last_connected_at?: string | null }).last_connected_at ?? null,
    lastConnectionError: (conn as { last_connection_error?: string | null }).last_connection_error ?? null,
  };
}

async function _loadLushaConnectionDirect(): Promise<ProspectingConnectionPanelState> {
  const admin = getAdminSupabase();
  const { data: prov } = await admin
    .from('prospecting_providers')
    .select('id')
    .eq('provider_key', 'lusha')
    .maybeSingle();
  if (!prov?.id) return _NOT_CONFIGURED;

  const { data: conn } = await admin
    .from('prospecting_provider_connections')
    .select('*')
    .eq('provider_id', prov.id)
    .maybeSingle();
  if (!conn) return _NOT_CONFIGURED;

  const hasKey = await hasLushaApiKey();
  return {
    supported: true,
    credentialsStatus: hasKey ? 'stored' : 'missing',
    connectionStatus: (conn as { connection_status: string }).connection_status,
    lastTestedAt: (conn as { last_tested_at?: string | null }).last_tested_at ?? null,
    lastConnectedAt: (conn as { last_connected_at?: string | null }).last_connected_at ?? null,
    lastConnectionError: (conn as { last_connection_error?: string | null }).last_connection_error ?? null,
  };
}

export async function loadProspectingProviderConnectionForPanel(
  providerKey: string,
): Promise<ProspectingConnectionPanelState> {
  const knownProviders = ['apollo', 'lusha', 'tavily'];
  const isKnown = knownProviders.includes(providerKey);

  try {
    if (providerKey === 'apollo') {
      return await _loadApolloConnectionDirect();
    }

    if (providerKey === 'lusha') {
      return await _loadLushaConnectionDirect();
    }

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
    if (isKnown) {
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
