'use server';

// ============================================================
// Actions: Estado del sistema y auditoría administrativa
// ============================================================
// Agrega datos de salud de configuración desde los módulos
// existentes (IA, HubSpot, automatizaciones, prospección, acceso)
// y normaliza eventos de audit tables para una vista unificada.
//
// Decisión de arquitectura (Opción A):
//   Se mantienen las tablas de auditoría existentes (access_audit,
//   ai_provider_audit, integration_audit) sin migrar ni duplicar.
//   Este módulo actúa como capa de agregación y normalización.
// ============================================================

import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { hasApolloApiKey } from '@/server/services/apollo-connection';
import { hasLushaApiKey } from '@/server/services/lusha-connection';
import { hasSamuApiKey } from '@/server/services/samu-connection';
import type {
  SystemHealthSummary,
  ConfigurationHealthDetails,
  AIProviderHealth,
  HubSpotHealth,
  SlackHealth,
  ApolloHealth,
  LushaHealth,
  SamuHealth,
  AdminRisk,
  AdminActivityEvent,
} from './types';

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  'https://lrdruowtadwbdulndlph.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function getAdminSupabase() {
  if (!SUPABASE_SERVICE_KEY) {
    throw new Error('enrichment_configuration_unavailable');
  }
  return createAdminClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
}

async function assertAdmin(): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase.rpc('is_admin', { p_auth_user_id: user.id });
  return data ?? false;
}

// ============================================================
// Resumen ejecutivo (tarjetas superiores)
// ============================================================

export async function getSystemHealthSummary(): Promise<SystemHealthSummary> {
  if (!(await assertAdmin())) {
    return {
      configured_components: 0,
      components_with_issues: 0,
      automatic_automations: 0,
      pending_access_requests: 0,
    };
  }

  const admin = getAdminSupabase();

  const [
    aiProvidersResult,
    hubspotIntegResult,
    slackIntegResult,
    automationsResult,
    pendingUsersResult,
    activeConfigResult,
  ] = await Promise.all([
    admin.from('ai_providers').select('id, connection_status'),
    admin
      .from('external_integrations')
      .select('id')
      .eq('integration_key', 'hubspot')
      .single(),
    admin
      .from('external_integrations')
      .select('id')
      .eq('integration_key', 'slack')
      .single(),
    admin
      .from('system_automations')
      .select('execution_mode')
      .eq('is_available', true),
    admin
      .from('internal_users')
      .select('id', { count: 'exact', head: true })
      .eq('access_status', 'pending_approval'),
    admin
      .from('ai_active_config')
      .select('active_provider_id, active_model_id')
      .eq('id', '00000000-0000-0000-0000-000000000001')
      .single(),
  ]);

  // HubSpot connection status
  let hubspotConnStatus = 'not_configured';
  if (hubspotIntegResult.data?.id) {
    const { data: conn } = await admin
      .from('external_integration_connections')
      .select('connection_status, credentials_status')
      .eq('integration_id', hubspotIntegResult.data.id)
      .single();
    hubspotConnStatus = conn?.connection_status ?? 'not_configured';
    if (hubspotConnStatus === 'not_tested' && conn?.credentials_status === 'stored') {
      hubspotConnStatus = 'not_tested';
    }
  }

  // Slack connection status
  let slackConnStatus = 'not_configured';
  if (slackIntegResult.data?.id) {
    const { data: conn } = await admin
      .from('external_integration_connections')
      .select('connection_status, credentials_status')
      .eq('integration_id', slackIntegResult.data.id)
      .single();
    slackConnStatus = conn?.connection_status ?? 'not_configured';
  }

  const aiProviders = aiProvidersResult.data ?? [];
  const hasActiveAIConfig = !!activeConfigResult.data?.active_provider_id;
  const hasConnectedAI =
    aiProviders.some((p) => p.connection_status === 'connected') && hasActiveAIConfig;

  const automations = automationsResult.data ?? [];
  const automaticCount = automations.filter(
    (a) => a.execution_mode === 'automatic'
  ).length;

  // Count configured/issues: AI, HubSpot, Slack, Automations
  let configured = 0;
  let withIssues = 0;

  if (hasConnectedAI) configured++;
  else withIssues++;

  if (hubspotConnStatus === 'connected') configured++;
  else withIssues++;

  if (slackConnStatus === 'connected') configured++;

  if (automations.length > 0) configured++;

  return {
    configured_components: configured,
    components_with_issues: withIssues,
    automatic_automations: automaticCount,
    pending_access_requests: pendingUsersResult.count ?? 0,
  };
}

// ============================================================
// Salud detallada por componente
// ============================================================

export async function getConfigurationHealthDetails(): Promise<ConfigurationHealthDetails> {
  if (!(await assertAdmin())) {
    return {
      ai_providers: [],
      active_ai: null,
      hubspot: {
        credentials_status: 'missing',
        connection_status: 'not_tested',
        last_tested_at: null,
        hub_id: null,
        last_connection_error: null,
      },
      slack: {
        credentials_status: 'missing',
        connection_status: 'not_tested',
        last_tested_at: null,
        team_name: null,
        channel_name: null,
        last_connection_error: null,
      },
      apollo: {
        credentials_status: 'missing',
        connection_status: 'not_connected',
        last_tested_at: null,
        last_connection_error: null,
      },
      lusha: {
        credentials_status: 'missing',
        connection_status: 'not_connected',
        last_tested_at: null,
        last_connection_error: null,
      },
      samu: {
        credentials_status: 'missing',
        connection_status: 'not_tested',
        last_tested_at: null,
        user_count: null,
        last_connection_error: null,
      },
      prospecting: { total: 0, prepared: 0, active_provider: null },
      automations: { total: 0, manual: 0, suggested: 0, automatic: 0 },
    };
  }

  const admin = getAdminSupabase();

  const [
    aiProvidersResult,
    activeConfigResult,
    hubspotIntegResult,
    slackIntegResult,
    apolloProviderResult,
    lushaProviderResult,
    prospectingResult,
    automationsResult,
    samuIntegResult,
  ] = await Promise.all([
    admin
      .from('ai_providers')
      .select('id, key, name, status, connection_status, credentials_status, last_tested_at')
      .order('name'),
    admin
      .from('ai_active_config')
      .select(
        'active_provider_id, active_model_id, updated_at, ai_providers!active_provider_id(name), ai_models!active_model_id(name)'
      )
      .eq('id', '00000000-0000-0000-0000-000000000001')
      .single(),
    admin
      .from('external_integrations')
      .select('id')
      .eq('integration_key', 'hubspot')
      .single(),
    admin
      .from('external_integrations')
      .select('id')
      .eq('integration_key', 'slack')
      .single(),
    admin
      .from('prospecting_providers')
      .select('id')
      .eq('provider_key', 'apollo')
      .single(),
    admin
      .from('prospecting_providers')
      .select('id')
      .eq('provider_key', 'lusha')
      .single(),
    admin.from('prospecting_providers').select('lifecycle_status, provider_key'),
    admin
      .from('system_automations')
      .select('execution_mode')
      .eq('is_available', true),
    admin
      .from('external_integrations')
      .select('id')
      .eq('integration_key', 'samu_ia')
      .single(),
  ]);

  // AI providers
  const activeProviderId = activeConfigResult.data?.active_provider_id ?? null;
  const aiProviders: AIProviderHealth[] = (aiProvidersResult.data ?? []).map((p) => ({
    key: p.key,
    name: p.name,
    has_credential: p.credentials_status === 'configured',
    connection_status: p.connection_status ?? 'not_configured',
    last_tested_at: p.last_tested_at ?? null,
    is_active_provider: p.id === activeProviderId,
  }));

  // Active AI config
  const activeAiData = activeConfigResult.data;
  const active_ai =
    activeAiData?.active_provider_id
      ? {
          provider_name:
            ((activeAiData.ai_providers as unknown as Record<string, string> | null))?.name ?? null,
          model_name:
            ((activeAiData.ai_models as unknown as Record<string, string> | null))?.name ?? null,
          updated_at: activeAiData.updated_at ?? null,
        }
      : null;

  // HubSpot
  let hubspot: HubSpotHealth = {
    credentials_status: 'missing',
    connection_status: 'not_tested',
    last_tested_at: null,
    hub_id: null,
    last_connection_error: null,
  };
  if (hubspotIntegResult.data?.id) {
    const { data: conn } = await admin
      .from('external_integration_connections')
      .select(
        'credentials_status, connection_status, last_tested_at, last_connection_error, metadata'
      )
      .eq('integration_id', hubspotIntegResult.data.id)
      .single();

    if (conn) {
      const meta = conn.metadata as Record<string, unknown> | null;
      hubspot = {
        credentials_status: (conn.credentials_status as 'stored' | 'missing') ?? 'missing',
        connection_status:
          (conn.connection_status as HubSpotHealth['connection_status']) ?? 'not_tested',
        last_tested_at: conn.last_tested_at ?? null,
        hub_id: (meta?.hub_id as number) ?? null,
        last_connection_error: conn.last_connection_error ?? null,
      };
    }
  }

  // Slack
  let slack: SlackHealth = {
    credentials_status: 'missing',
    connection_status: 'not_tested',
    last_tested_at: null,
    team_name: null,
    channel_name: null,
    last_connection_error: null,
  };
  if (slackIntegResult.data?.id) {
    const { data: conn } = await admin
      .from('external_integration_connections')
      .select('credentials_status, connection_status, last_tested_at, last_connection_error, metadata')
      .eq('integration_id', slackIntegResult.data.id)
      .single();

    if (conn) {
      const meta = conn.metadata as Record<string, unknown> | null;
      slack = {
        credentials_status: (conn.credentials_status as 'stored' | 'missing') ?? 'missing',
        connection_status: (conn.connection_status as SlackHealth['connection_status']) ?? 'not_tested',
        last_tested_at: conn.last_tested_at ?? null,
        team_name: (meta?.team_name as string) ?? null,
        channel_name: (meta?.channel_name as string) ?? null,
        last_connection_error: conn.last_connection_error ?? null,
      };
    }
  }

  // Apollo
  let apollo: ApolloHealth = {
    credentials_status: 'missing',
    connection_status: 'not_connected',
    last_tested_at: null,
    last_connection_error: null,
  };
  if (apolloProviderResult.data?.id) {
    const { data: apolloConn } = await admin
      .from('prospecting_provider_connections')
      .select('credentials_status, connection_status, last_tested_at, last_connection_error')
      .eq('provider_id', apolloProviderResult.data.id)
      .single();

    if (apolloConn) {
      const hasKey = await hasApolloApiKey();
      apollo = {
        credentials_status: hasKey ? 'stored' : 'missing',
        connection_status: (apolloConn.connection_status as ApolloHealth['connection_status']) ?? 'not_connected',
        last_tested_at: apolloConn.last_tested_at ?? null,
        last_connection_error: apolloConn.last_connection_error ?? null,
      };
    }
  }

  // Lusha
  let lusha: LushaHealth = {
    credentials_status: 'missing',
    connection_status: 'not_connected',
    last_tested_at: null,
    last_connection_error: null,
  };
  if (lushaProviderResult.data?.id) {
    const { data: lushaConn } = await admin
      .from('prospecting_provider_connections')
      .select('credentials_status, connection_status, last_tested_at, last_connection_error')
      .eq('provider_id', lushaProviderResult.data.id)
      .single();

    if (lushaConn) {
      const hasKey = await hasLushaApiKey();
      lusha = {
        credentials_status: hasKey ? 'stored' : 'missing',
        connection_status: (lushaConn.connection_status as LushaHealth['connection_status']) ?? 'not_connected',
        last_tested_at: lushaConn.last_tested_at ?? null,
        last_connection_error: lushaConn.last_connection_error ?? null,
      };
    }
  }

  // Samu IA
  let samu: SamuHealth = {
    credentials_status: 'missing',
    connection_status: 'not_tested',
    last_tested_at: null,
    user_count: null,
    last_connection_error: null,
  };
  if (samuIntegResult.data?.id) {
    const { data: samuConn } = await admin
      .from('external_integration_connections')
      .select('credentials_status, connection_status, last_tested_at, last_connection_error, metadata')
      .eq('integration_id', samuIntegResult.data.id)
      .single();

    if (samuConn) {
      const hasKey = await hasSamuApiKey();
      const meta = samuConn.metadata as Record<string, unknown> | null;
      samu = {
        credentials_status: hasKey ? 'stored' : 'missing',
        connection_status: (samuConn.connection_status as SamuHealth['connection_status']) ?? 'not_tested',
        last_tested_at: samuConn.last_tested_at ?? null,
        user_count: (meta?.user_count as number) ?? null,
        last_connection_error: samuConn.last_connection_error ?? null,
      };
    }
  }

  // Prospecting
  const prospData = prospectingResult.data ?? [];
  const activeProsp = prospData.find((p) => p.lifecycle_status === 'connected');

  // Automations
  const automations = automationsResult.data ?? [];

  return {
    ai_providers: aiProviders,
    active_ai,
    hubspot,
    slack,
    apollo,
    lusha,
    samu,
    prospecting: {
      total: prospData.length,
      prepared: prospData.filter(
        (p) => p.lifecycle_status === 'prepared' || p.lifecycle_status === 'connected'
      ).length,
      active_provider: activeProsp?.provider_key ?? null,
    },
    automations: {
      total: automations.length,
      manual: automations.filter((a) => a.execution_mode === 'manual').length,
      suggested: automations.filter((a) => a.execution_mode === 'suggested').length,
      automatic: automations.filter((a) => a.execution_mode === 'automatic').length,
    },
  };
}

// ============================================================
// Riesgos y pendientes administrativos (derivados, sin DB)
// ============================================================

export async function deriveAdministrativeRisks(
  health: ConfigurationHealthDetails,
  pendingUsers: number
): Promise<AdminRisk[]> {
  const risks: AdminRisk[] = [];

  // IA — conexión y configuración activa
  const connectedAI = health.ai_providers.filter(
    (p) => p.connection_status === 'connected'
  );
  const errorAI = health.ai_providers.filter((p) => p.connection_status === 'error');

  if (connectedAI.length === 0) {
    risks.push({
      id: 'ai_no_connected',
      severity: 'attention',
      message: 'Ningún proveedor de IA está conectado.',
      action_href: '/settings/ai',
    });
  } else if (!health.active_ai?.provider_name) {
    risks.push({
      id: 'ai_no_active_config',
      severity: 'pending',
      message:
        'Hay proveedor IA conectado pero no se ha seleccionado configuración activa.',
      action_href: '/settings/ai',
    });
  }

  if (errorAI.length > 0) {
    const names = errorAI.map((p) => p.name).join(', ');
    risks.push({
      id: 'ai_connection_error',
      severity: 'attention',
      message: `Error de conexión detectado en: ${names}.`,
      action_href: '/settings/ai',
    });
  }

  // HubSpot
  if (health.hubspot.connection_status === 'error') {
    risks.push({
      id: 'hubspot_error',
      severity: 'attention',
      message: 'La conexión con HubSpot falló. Verifica el token de acceso.',
      action_href: '/settings/integrations/hubspot',
    });
  } else if (
    health.hubspot.credentials_status === 'stored' &&
    health.hubspot.connection_status === 'not_tested'
  ) {
    risks.push({
      id: 'hubspot_not_tested',
      severity: 'pending',
      message:
        'HubSpot tiene credencial guardada pero aún no se ha probado la conexión.',
      action_href: '/settings/integrations/hubspot',
    });
  } else if (health.hubspot.credentials_status === 'missing') {
    risks.push({
      id: 'hubspot_not_configured',
      severity: 'pending',
      message: 'HubSpot no está configurado. Sin integración CRM activa.',
      action_href: '/settings/integrations/hubspot',
    });
  }

  // Apollo.io
  if (health.apollo.connection_status === 'error') {
    risks.push({
      id: 'apollo_error',
      severity: 'attention',
      message: 'La conexión con Apollo.io falló. Verifica la API Key.',
      action_href: '/settings/prospecting',
    });
  } else if (
    health.apollo.credentials_status === 'stored' &&
    health.apollo.connection_status === 'not_tested'
  ) {
    risks.push({
      id: 'apollo_not_tested',
      severity: 'pending',
      message: 'Apollo.io tiene credencial guardada pero aún no se ha probado la conexión.',
      action_href: '/settings/prospecting',
    });
  }

  // Lusha
  if (health.lusha.connection_status === 'error') {
    risks.push({
      id: 'lusha_error',
      severity: 'attention',
      message: 'La conexión con Lusha falló. Verifica la API Key.',
      action_href: '/settings/prospecting',
    });
  } else if (
    health.lusha.credentials_status === 'stored' &&
    health.lusha.connection_status === 'not_tested'
  ) {
    risks.push({
      id: 'lusha_not_tested',
      severity: 'pending',
      message: 'Lusha tiene credencial guardada pero aún no se ha probado la conexión.',
      action_href: '/settings/prospecting',
    });
  }

  // Samu IA
  if (health.samu.connection_status === 'error') {
    risks.push({
      id: 'samu_error',
      severity: 'pending',
      message: 'La conexión con Samu IA falló. Verifica la API Key.',
      action_href: '/settings/integrations/samu',
    });
  } else if (
    health.samu.credentials_status === 'stored' &&
    health.samu.connection_status === 'not_tested'
  ) {
    risks.push({
      id: 'samu_not_tested',
      severity: 'pending',
      message: 'Samu IA tiene credencial guardada pero aún no se ha probado la conexión.',
      action_href: '/settings/integrations/samu',
    });
  }

  // Usuarios pendientes
  if (pendingUsers > 0) {
    risks.push({
      id: 'pending_users',
      severity: 'attention',
      message: `${pendingUsers} solicitud${pendingUsers > 1 ? 'es' : ''} de acceso ${pendingUsers > 1 ? 'esperan' : 'espera'} aprobación.`,
      action_href: '/settings/users',
    });
  }

  // Automatizaciones
  if (health.automations.automatic === 0 && health.automations.total > 0) {
    risks.push({
      id: 'no_automatic_automations',
      severity: 'pending',
      message: 'Ninguna automatización está configurada en modo automático.',
      action_href: '/settings/automations',
    });
  }

  return risks;
}

// ============================================================
// Feed de actividad administrativa unificada
// ============================================================

const ACCESS_AUDIT_LABELS: Record<string, string> = {
  approved: 'Acceso aprobado',
  rejected: 'Acceso rechazado',
  suspended: 'Usuario suspendido',
  reactivated: 'Usuario reactivado',
  role_changed: 'Rol cambiado',
  created: 'Usuario creado',
};

const INTEGRATION_AUDIT_LABELS: Record<string, string> = {
  credential_stored: 'Credencial guardada',
  credential_updated: 'Credencial actualizada',
  connection_tested: 'Prueba de conexión iniciada',
  connection_succeeded: 'Conexión exitosa',
  connection_failed: 'Conexión fallida',
  disconnected: 'Integración desconectada',
  oauth_started: 'OAuth iniciado',
  oauth_connected: 'OAuth completado',
  oauth_failed: 'OAuth fallido',
  channel_created: 'Canal creado',
  test_message_sent: 'Mensaje de prueba enviado',
};

const INTEGRATION_KEY_LABELS: Record<string, string> = {
  hubspot: 'HubSpot',
  slack: 'Slack',
  google_drive: 'Google Drive',
  samu_ia: 'Samu IA',
  apollo: 'Apollo.io',
  lusha: 'Lusha',
};

const AI_AUDIT_LABELS: Record<string, string> = {
  ai_provider_credential_stored: 'Credencial de IA guardada',
  ai_provider_credential_updated: 'Credencial de IA actualizada',
  ai_provider_connection_succeeded: 'Conexión IA exitosa',
  ai_provider_connection_failed: 'Conexión IA fallida',
  ai_provider_disconnected: 'Proveedor IA desconectado',
  ai_active_config_changed: 'Configuración activa IA modificada',
  ai_model_pricing_added: 'Tarifa de modelo IA registrada',
};

/**
 * Devuelve hasta `limit` eventos administrativos recientes unificados
 * desde access_audit, integration_audit y ai_provider_audit,
 * ordenados por created_at DESC.
 *
 * Fuentes:
 *  - access_audit      → gestión de usuarios (aprobaciones, roles, suspensiones)
 *  - integration_audit → HubSpot y otras integraciones externas
 *  - ai_provider_audit → credenciales, conexiones y config activa de IA
 */
export async function getRecentAdminActivity(limit = 30): Promise<AdminActivityEvent[]> {
  if (!(await assertAdmin())) return [];

  const admin = getAdminSupabase();
  const perSource = Math.ceil(limit / 3);

  const [accessResult, integrationResult, aiAuditResult] = await Promise.all([
    admin
      .from('access_audit')
      .select('id, action_type, previous_status, new_status, created_at')
      .order('created_at', { ascending: false })
      .limit(perSource),
    admin
      .from('integration_audit')
      .select('id, event_type, integration_key, created_at')
      .order('created_at', { ascending: false })
      .limit(perSource),
    admin
      .from('ai_provider_audit')
      .select('id, event_type, created_at, provider:provider_id(name, key)')
      .order('created_at', { ascending: false })
      .limit(perSource),
  ]);

  const events: AdminActivityEvent[] = [];

  for (const entry of accessResult.data ?? []) {
    const label = ACCESS_AUDIT_LABELS[entry.action_type] ?? entry.action_type;
    const description =
      entry.previous_status && entry.new_status
        ? `${entry.previous_status} → ${entry.new_status}`
        : null;
    events.push({
      id: `access_${entry.id}`,
      source: 'users',
      event_type: entry.action_type,
      label,
      description,
      created_at: entry.created_at,
    });
  }

  for (const entry of integrationResult.data ?? []) {
    const label = INTEGRATION_AUDIT_LABELS[entry.event_type] ?? entry.event_type;
    const integrationName =
      INTEGRATION_KEY_LABELS[entry.integration_key] ?? entry.integration_key;
    events.push({
      id: `integration_${entry.id}`,
      source: 'integrations',
      event_type: entry.event_type,
      label,
      description: integrationName,
      created_at: entry.created_at,
    });
  }

  for (const entry of aiAuditResult.data ?? []) {
    const label = AI_AUDIT_LABELS[entry.event_type] ?? entry.event_type;
    const providerName =
      (entry.provider as unknown as Record<string, string> | null)?.name ?? null;
    events.push({
      id: `ai_${entry.id}`,
      source: 'ai',
      event_type: entry.event_type,
      label,
      description: providerName,
      created_at: entry.created_at,
    });
  }

  events.sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  return events.slice(0, limit);
}
