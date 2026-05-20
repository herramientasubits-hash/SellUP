'use server';

import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import {
  storeApolloApiKey,
  removeApolloApiKey,
  hasApolloApiKey,
  testApolloHealth,
} from '@/server/services/apollo-connection';
import {
  storeLushaApiKey,
  removeLushaApiKey,
  hasLushaApiKey,
  testLushaHealth,
} from '@/server/services/lusha-connection';
import type {
  ProspectingProvider,
  ProspectingStats,
  ProspectingProviderConnection,
} from './types';

// ============================================================
// Cliente admin (service role) — solo lectura de catálogo
// ============================================================
const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  'https://lrdruowtadwbdulndlph.supabase.co';
const supabaseServiceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxyZHJ1b3d0YWR3YmR1bG5kbHBoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODgzODY2NCwiZXhwIjoyMDk0NDE0NjY0fQ.0fnp65rmdJxklJvVkaWuA3J9dtBpf0Jg2zB2kSyyg0E';

function getAdminSupabase() {
  return createAdminClient(supabaseUrl, supabaseServiceKey);
}

// ============================================================
// Lectura del catálogo de proveedores
// ============================================================

/**
 * Devuelve todos los proveedores de prospección/enriquecimiento.
 * Ordenados por lifecycle_status desc para mostrar 'prepared' antes que 'planned'.
 *
 * Extensión futura: cuando se implemente conexión real, agregar JOIN con
 * prospecting_provider_connections para mostrar estado operativo.
 */
export async function getAllProspectingProviders(): Promise<ProspectingProvider[]> {
  const admin = getAdminSupabase();

  const { data, error } = await admin
    .from('prospecting_providers')
    .select('*')
    .order('lifecycle_status', { ascending: false }) // 'prepared' antes que 'planned'
    .order('name');

  if (error || !data) return [];

  return data as ProspectingProvider[];
}

/**
 * Devuelve estadísticas agregadas del catálogo de proveedores.
 *
 * Extensión futura: `active_provider` se populará cuando se implemente la
 * selección de proveedor activo en la tabla de configuración global.
 */
export async function getProspectingStats(): Promise<ProspectingStats> {
  const providers = await getAllProspectingProviders();

  const total = providers.length;
  const prepared = providers.filter(
    (p) => p.lifecycle_status === 'prepared' || p.lifecycle_status === 'connected'
  ).length;

  // Extensión futura: consultar tabla de config global para active_provider_key
  const activeProvider = providers.find((p) => p.lifecycle_status === 'connected');

  return {
    total,
    prepared,
    active_provider: activeProvider?.provider_key ?? null,
  };
}

/**
 * Retorna la configuración del proveedor activo, o null si no hay ninguno.
 * Usado por automatizaciones y batch jobs para saber qué API invocar.
 */
export async function getActiveProspectingProvider(): Promise<ProspectingProvider | null> {
  const admin = getAdminSupabase();

  const { data } = await admin
    .from('prospecting_providers')
    .select('*')
    .eq('lifecycle_status', 'connected')
    .eq('is_available_for_selection', true)
    .single();

  return (data as ProspectingProvider) ?? null;
}

// ============================================================
// Helpers privados — Apollo
// ============================================================

async function getAdminActorId(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<{ id: string | null; error?: string }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { id: null, error: 'No autenticado' };

  const { data: internalUser } = await supabase
    .from('internal_users')
    .select('id, role_id')
    .eq('auth_user_id', user.id)
    .eq('access_status', 'active')
    .single();

  if (!internalUser) return { id: null, error: 'Usuario no encontrado o inactivo' };

  const { data: role } = await supabase
    .from('roles')
    .select('key')
    .eq('id', internalUser.role_id)
    .single();

  if (role?.key !== 'admin') return { id: null, error: 'No autorizado' };

  return { id: internalUser.id };
}

async function logApolloAuditEvent(
  eventType: string,
  actorId: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  const admin = getAdminSupabase();
  await admin.from('integration_audit').insert({
    integration_key: 'apollo',
    event_type: eventType,
    actor_user_id: actorId,
    metadata: metadata ?? null,
  });
}

async function getApolloProviderId(): Promise<string | null> {
  const admin = getAdminSupabase();
  const { data } = await admin
    .from('prospecting_providers')
    .select('id')
    .eq('provider_key', 'apollo')
    .single();
  return data?.id ?? null;
}

// ============================================================
// Apollo: Leer estado de conexión
// ============================================================

export async function getApolloConnection(): Promise<ProspectingProviderConnection | null> {
  const admin = getAdminSupabase();

  const providerId = await getApolloProviderId();
  if (!providerId) return null;

  const { data } = await admin
    .from('prospecting_provider_connections')
    .select('*')
    .eq('provider_id', providerId)
    .single();

  if (!data) return null;

  // Verificar si la credencial realmente existe en Vault
  const hasKey = await hasApolloApiKey();
  return {
    ...(data as ProspectingProviderConnection),
    credentials_status: hasKey ? 'stored' : 'missing',
  };
}

// ============================================================
// Apollo: Conectar (guardar API Key por primera vez)
// ============================================================

export async function connectApollo(apiKey: string): Promise<{
  success: boolean;
  error?: string;
  message?: string;
}> {
  if (!apiKey || apiKey.trim().length < 10) {
    return { success: false, error: 'La API Key es inválida o demasiado corta.' };
  }

  const supabase = await createClient();
  const { id: actorId, error: authError } = await getAdminActorId(supabase);
  if (!actorId) return { success: false, error: authError };

  const storeResult = await storeApolloApiKey(apiKey.trim());
  if (!storeResult.success) return { success: false, error: storeResult.message };

  const providerId = await getApolloProviderId();
  if (!providerId) {
    return { success: false, error: 'Proveedor Apollo no encontrado en el catálogo.' };
  }

  const admin = getAdminSupabase();
  const now = new Date().toISOString();

  const { data: existing } = await admin
    .from('prospecting_provider_connections')
    .select('id')
    .eq('provider_id', providerId)
    .single();

  if (existing) {
    await admin
      .from('prospecting_provider_connections')
      .update({
        vault_secret_id: storeResult.vaultSecretId ?? null,
        credentials_status: 'stored',
        connection_status: 'not_tested',
        last_connection_error: null,
        configured_by: actorId,
        updated_at: now,
      })
      .eq('id', existing.id);
  } else {
    await admin.from('prospecting_provider_connections').insert({
      provider_id: providerId,
      vault_secret_id: storeResult.vaultSecretId ?? null,
      credentials_status: 'stored',
      connection_status: 'not_tested',
      configured_by: actorId,
    });
  }

  await logApolloAuditEvent('credential_stored', actorId);

  return {
    success: true,
    message: 'API Key guardada correctamente. Prueba la conexión para verificarla.',
  };
}

// ============================================================
// Apollo: Actualizar API Key existente
// ============================================================

export async function updateApolloApiKey(newApiKey: string): Promise<{
  success: boolean;
  error?: string;
  message?: string;
}> {
  if (!newApiKey || newApiKey.trim().length < 10) {
    return { success: false, error: 'La API Key es inválida o demasiado corta.' };
  }

  const supabase = await createClient();
  const { id: actorId, error: authError } = await getAdminActorId(supabase);
  if (!actorId) return { success: false, error: authError };

  const storeResult = await storeApolloApiKey(newApiKey.trim());
  if (!storeResult.success) return { success: false, error: storeResult.message };

  const providerId = await getApolloProviderId();
  if (!providerId) {
    return { success: false, error: 'Proveedor Apollo no encontrado en el catálogo.' };
  }

  const admin = getAdminSupabase();

  await admin
    .from('prospecting_provider_connections')
    .update({
      vault_secret_id: storeResult.vaultSecretId ?? null,
      credentials_status: 'stored',
      connection_status: 'not_tested',
      last_tested_at: null,
      last_connection_error: null,
      configured_by: actorId,
      updated_at: new Date().toISOString(),
    })
    .eq('provider_id', providerId);

  await logApolloAuditEvent('credential_updated', actorId);

  return {
    success: true,
    message: 'API Key actualizada. Prueba la conexión para verificar la nueva key.',
  };
}

// ============================================================
// Apollo: Probar conexión
// ============================================================

export async function testApolloConnectionAction(): Promise<{
  success: boolean;
  error?: string;
  message?: string;
}> {
  const supabase = await createClient();
  const { id: actorId, error: authError } = await getAdminActorId(supabase);
  if (!actorId) return { success: false, error: authError };

  const providerId = await getApolloProviderId();
  if (!providerId) {
    return { success: false, error: 'Proveedor Apollo no encontrado en el catálogo.' };
  }

  await logApolloAuditEvent('connection_tested', actorId);

  const result = await testApolloHealth();
  const now = new Date().toISOString();
  const admin = getAdminSupabase();

  if (result.success) {
    await admin
      .from('prospecting_provider_connections')
      .update({
        connection_status: 'connected',
        last_tested_at: now,
        last_connected_at: now,
        last_connection_error: null,
        updated_at: now,
      })
      .eq('provider_id', providerId);

    // Actualizar lifecycle del catálogo de proveedores
    await admin
      .from('prospecting_providers')
      .update({
        lifecycle_status: 'connected',
        is_available_for_selection: true,
        updated_at: now,
      })
      .eq('provider_key', 'apollo');

    await logApolloAuditEvent('connection_succeeded', actorId);
  } else {
    const sanitizedError = result.message
      ? result.message.slice(0, 500)
      : 'Error desconocido';

    await admin
      .from('prospecting_provider_connections')
      .update({
        connection_status: 'error',
        last_tested_at: now,
        last_connection_error: sanitizedError,
        updated_at: now,
      })
      .eq('provider_id', providerId);

    // Regresar lifecycle a 'prepared' si falla
    await admin
      .from('prospecting_providers')
      .update({
        lifecycle_status: 'prepared',
        is_available_for_selection: false,
        updated_at: now,
      })
      .eq('provider_key', 'apollo');

    await logApolloAuditEvent('connection_failed', actorId, {
      error_code: result.error,
    });
  }

  return {
    success: result.success,
    error: result.error,
    message: result.message,
  };
}

// ============================================================
// Helpers privados — Lusha
// ============================================================

async function getLushaProviderId(): Promise<string | null> {
  const admin = getAdminSupabase();
  const { data } = await admin
    .from('prospecting_providers')
    .select('id')
    .eq('provider_key', 'lusha')
    .single();
  return data?.id ?? null;
}

async function logLushaAuditEvent(
  eventType: string,
  actorId: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  const admin = getAdminSupabase();
  await admin.from('integration_audit').insert({
    integration_key: 'lusha',
    event_type: eventType,
    actor_user_id: actorId,
    metadata: metadata ?? null,
  });
}

// ============================================================
// Lusha: Leer estado de conexión
// ============================================================

export async function getLushaConnection(): Promise<ProspectingProviderConnection | null> {
  const admin = getAdminSupabase();

  const providerId = await getLushaProviderId();
  if (!providerId) return null;

  const { data } = await admin
    .from('prospecting_provider_connections')
    .select('*')
    .eq('provider_id', providerId)
    .single();

  if (!data) return null;

  const hasKey = await hasLushaApiKey();
  return {
    ...(data as ProspectingProviderConnection),
    credentials_status: hasKey ? 'stored' : 'missing',
  };
}

// ============================================================
// Lusha: Conectar (guardar API Key por primera vez)
// ============================================================

export async function connectLusha(apiKey: string): Promise<{
  success: boolean;
  error?: string;
  message?: string;
}> {
  if (!apiKey || apiKey.trim().length < 10) {
    return { success: false, error: 'La API Key es inválida o demasiado corta.' };
  }

  const supabase = await createClient();
  const { id: actorId, error: authError } = await getAdminActorId(supabase);
  if (!actorId) return { success: false, error: authError };

  const storeResult = await storeLushaApiKey(apiKey.trim());
  if (!storeResult.success) return { success: false, error: storeResult.message };

  const providerId = await getLushaProviderId();
  if (!providerId) {
    return { success: false, error: 'Proveedor Lusha no encontrado en el catálogo.' };
  }

  const admin = getAdminSupabase();
  const now = new Date().toISOString();

  const { data: existing } = await admin
    .from('prospecting_provider_connections')
    .select('id')
    .eq('provider_id', providerId)
    .single();

  if (existing) {
    await admin
      .from('prospecting_provider_connections')
      .update({
        vault_secret_id: storeResult.vaultSecretId ?? null,
        credentials_status: 'stored',
        connection_status: 'not_tested',
        last_connection_error: null,
        configured_by: actorId,
        updated_at: now,
      })
      .eq('id', existing.id);
  } else {
    await admin.from('prospecting_provider_connections').insert({
      provider_id: providerId,
      vault_secret_id: storeResult.vaultSecretId ?? null,
      credentials_status: 'stored',
      connection_status: 'not_tested',
      configured_by: actorId,
    });
  }

  await logLushaAuditEvent('credential_stored', actorId);

  return {
    success: true,
    message: 'API Key guardada correctamente. Prueba la conexión para verificarla.',
  };
}

// ============================================================
// Lusha: Actualizar API Key existente
// ============================================================

export async function updateLushaApiKey(newApiKey: string): Promise<{
  success: boolean;
  error?: string;
  message?: string;
}> {
  if (!newApiKey || newApiKey.trim().length < 10) {
    return { success: false, error: 'La API Key es inválida o demasiado corta.' };
  }

  const supabase = await createClient();
  const { id: actorId, error: authError } = await getAdminActorId(supabase);
  if (!actorId) return { success: false, error: authError };

  const storeResult = await storeLushaApiKey(newApiKey.trim());
  if (!storeResult.success) return { success: false, error: storeResult.message };

  const providerId = await getLushaProviderId();
  if (!providerId) {
    return { success: false, error: 'Proveedor Lusha no encontrado en el catálogo.' };
  }

  const admin = getAdminSupabase();

  await admin
    .from('prospecting_provider_connections')
    .update({
      vault_secret_id: storeResult.vaultSecretId ?? null,
      credentials_status: 'stored',
      connection_status: 'not_tested',
      last_tested_at: null,
      last_connection_error: null,
      configured_by: actorId,
      updated_at: new Date().toISOString(),
    })
    .eq('provider_id', providerId);

  await logLushaAuditEvent('credential_updated', actorId);

  return {
    success: true,
    message: 'API Key actualizada. Prueba la conexión para verificar la nueva key.',
  };
}

// ============================================================
// Lusha: Probar conexión
// ============================================================

export async function testLushaConnectionAction(): Promise<{
  success: boolean;
  error?: string;
  message?: string;
}> {
  const supabase = await createClient();
  const { id: actorId, error: authError } = await getAdminActorId(supabase);
  if (!actorId) return { success: false, error: authError };

  const providerId = await getLushaProviderId();
  if (!providerId) {
    return { success: false, error: 'Proveedor Lusha no encontrado en el catálogo.' };
  }

  await logLushaAuditEvent('connection_tested', actorId);

  const result = await testLushaHealth();
  const now = new Date().toISOString();
  const admin = getAdminSupabase();

  if (result.success) {
    await admin
      .from('prospecting_provider_connections')
      .update({
        connection_status: 'connected',
        last_tested_at: now,
        last_connected_at: now,
        last_connection_error: null,
        updated_at: now,
      })
      .eq('provider_id', providerId);

    await admin
      .from('prospecting_providers')
      .update({
        lifecycle_status: 'connected',
        is_available_for_selection: true,
        updated_at: now,
      })
      .eq('provider_key', 'lusha');

    await logLushaAuditEvent('connection_succeeded', actorId);
  } else {
    const sanitizedError = result.message
      ? result.message.slice(0, 500)
      : 'Error desconocido';

    await admin
      .from('prospecting_provider_connections')
      .update({
        connection_status: 'error',
        last_tested_at: now,
        last_connection_error: sanitizedError,
        updated_at: now,
      })
      .eq('provider_id', providerId);

    await admin
      .from('prospecting_providers')
      .update({
        lifecycle_status: 'prepared',
        is_available_for_selection: false,
        updated_at: now,
      })
      .eq('provider_key', 'lusha');

    await logLushaAuditEvent('connection_failed', actorId, {
      error_code: result.error,
    });
  }

  return {
    success: result.success,
    error: result.error,
    message: result.message,
  };
}

// ============================================================
// Lusha: Desconectar
// ============================================================

export async function disconnectLusha(): Promise<{
  success: boolean;
  error?: string;
  message?: string;
}> {
  const supabase = await createClient();
  const { id: actorId, error: authError } = await getAdminActorId(supabase);
  if (!actorId) return { success: false, error: authError };

  await removeLushaApiKey();

  const providerId = await getLushaProviderId();
  if (providerId) {
    const admin = getAdminSupabase();
    const now = new Date().toISOString();

    await admin
      .from('prospecting_provider_connections')
      .update({
        credentials_status: 'missing',
        connection_status: 'disconnected',
        vault_secret_id: null,
        last_connection_error: null,
        updated_at: now,
      })
      .eq('provider_id', providerId);

    await admin
      .from('prospecting_providers')
      .update({
        lifecycle_status: 'prepared',
        is_available_for_selection: false,
        updated_at: now,
      })
      .eq('provider_key', 'lusha');
  }

  await logLushaAuditEvent('disconnected', actorId);

  return {
    success: true,
    message: 'Lusha desconectado correctamente.',
  };
}

// ============================================================
// Apollo: Desconectar
// ============================================================

export async function disconnectApollo(): Promise<{
  success: boolean;
  error?: string;
  message?: string;
}> {
  const supabase = await createClient();
  const { id: actorId, error: authError } = await getAdminActorId(supabase);
  if (!actorId) return { success: false, error: authError };

  await removeApolloApiKey();

  const providerId = await getApolloProviderId();
  if (providerId) {
    const admin = getAdminSupabase();
    const now = new Date().toISOString();

    await admin
      .from('prospecting_provider_connections')
      .update({
        credentials_status: 'missing',
        connection_status: 'disconnected',
        vault_secret_id: null,
        last_connection_error: null,
        updated_at: now,
      })
      .eq('provider_id', providerId);

    // Regresar lifecycle del catálogo
    await admin
      .from('prospecting_providers')
      .update({
        lifecycle_status: 'prepared',
        is_available_for_selection: false,
        updated_at: now,
      })
      .eq('provider_key', 'apollo');
  }

  await logApolloAuditEvent('disconnected', actorId);

  return {
    success: true,
    message: 'Apollo.io desconectado correctamente.',
  };
}
