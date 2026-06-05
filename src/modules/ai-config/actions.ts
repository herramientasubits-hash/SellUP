/* eslint-disable @typescript-eslint/no-explicit-any */
'use server';

import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient, type SupabaseClient } from '@supabase/supabase-js';
import { redirect } from 'next/navigation';
import {
  testGeminiWithKey,
  testOpenAIConnection,
  testClaudeConnection,
  listAnthropicModels,
  testAnthropicModelExecution,
  storeAiProviderCredential,
  removeAiProviderCredential,
  type ConnectionTestResult,
  type AnthropicExecutionTestResult,
} from '@/server/services/ai-connection';
import {
  resolveAIProviderCredential,
  getAIProviderCredentialValue,
} from '@/server/services/ai-credentials';
import type { 
  AIProvider, 
  AIModel, 
  AIModelPricing, 
  AIActiveConfig,
  AIProvidersWithModels,
  AICongifSummary
} from './types';

async function getAdminUserId(supabase: any): Promise<{ id: string | null; error?: string }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { id: null, error: 'No autenticado' };

  const { data: internalUser, error } = await supabase
    .from('internal_users')
    .select('id, role_id')
    .eq('auth_user_id', user.id)
    .eq('access_status', 'active')
    .single();

  if (error || !internalUser) return { id: null, error: 'Usuario no encontrado o inactivo' };

  const { data: role } = await supabase
    .from('roles')
    .select('key')
    .eq('id', internalUser.role_id)
    .single();

  if (role?.key !== 'admin') return { id: null, error: 'No autorizado' };

  return { id: internalUser.id };
}

export async function isCurrentUserAdmin(): Promise<boolean> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  const { data } = await supabase.rpc('is_admin', { p_auth_user_id: user.id });
  return data ?? false;
}

export async function getAllAIProviders(): Promise<AIProvider[]> {
  const adminSupabase = getAdminSupabaseClient();

  const { data: providers, error } = await (adminSupabase as any)
    .from('ai_providers')
    .select('*')
    .order('name');

  if (error) {
    console.error('Error fetching AI providers:', error);
    return [];
  }

  const { data: counts } = await (adminSupabase as any)
    .from('ai_models')
    .select('provider_id');

  const countMap = new Map<string, number>();
  (counts ?? []).forEach((m: any) => {
    countMap.set(m.provider_id, (countMap.get(m.provider_id) ?? 0) + 1);
  });

  // Verify vault credentials for providers that claim to be 'connected'.
  // If the credential no longer exists, repair the DB and return the corrected state.
  // This prevents a stale 'connected' badge from appearing when Vault has no secret.
  const verifiedProviders = await Promise.all(
    (providers ?? []).map(async (p: any) => {
      const claimsConnected =
        p.connection_status === 'connected' || p.credentials_status === 'configured';
      if (!claimsConnected) return p;

      const resolution = await resolveAIProviderCredential(p.key);
      if (!resolution.available) {
        // Repair stale DB state — the credential is gone from Vault.
        await (adminSupabase as any)
          .from('ai_providers')
          .update({
            credentials_status: 'missing',
            connection_status: 'not_configured',
            updated_at: new Date().toISOString(),
          })
          .eq('id', p.id);
        return { ...p, credentials_status: 'missing', connection_status: 'not_configured' };
      }
      return p;
    })
  );

  return verifiedProviders.map((p: any) => ({
    ...p,
    model_count: countMap.get(p.id) ?? 0,
  })) as AIProvider[];
}

export async function getAIModelsByProvider(providerId: string): Promise<AIModel[]> {
  const supabase = await createClient();
  
  const [modelsResult, pricingResult] = await Promise.all([
    supabase
      .from('ai_models')
      .select('*')
      .eq('provider_id', providerId)
      .order('name'),
    supabase
      .from('ai_model_pricing')
      .select('*')
      .eq('is_current', true)
  ]);

  if (modelsResult.error) {
    console.error('Error fetching AI models:', modelsResult.error);
    return [];
  }

  const pricingMap = new Map<string, AIModelPricing>();
  (pricingResult.data ?? []).forEach(p => pricingMap.set(p.model_id, p));

  return (modelsResult.data ?? []).map(m => ({
    ...m,
    current_pricing: pricingMap.get(m.id) || null
  })) as AIModel[];
}

export async function getAllAIModels(): Promise<AIModel[]> {
  const supabase = await createClient();
  
  const [modelsResult, pricingResult] = await Promise.all([
    supabase
      .from('ai_models')
      .select('*, ai_providers(name)')
      .order('name'),
    supabase
      .from('ai_model_pricing')
      .select('*')
      .eq('is_current', true)
  ]);

  if (modelsResult.error) {
    console.error('Error fetching AI models:', modelsResult.error);
    return [];
  }

  const pricingMap = new Map<string, AIModelPricing>();
  (pricingResult.data ?? []).forEach(p => pricingMap.set(p.model_id, p));

  return (modelsResult.data ?? []).map(m => ({
    ...m,
    provider_name: (m.ai_providers as Record<string, string> | null)?.name ?? null,
    current_pricing: pricingMap.get(m.id) || null
  })) as AIModel[];
}

function getAdminSupabaseClient(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://lrdruowtadwbdulndlph.supabase.co';
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseServiceKey) {
    throw new Error('enrichment_configuration_unavailable');
  }
  return createAdminClient(supabaseUrl, supabaseServiceKey);
}

export async function getAIActiveConfig(): Promise<AIActiveConfig | null> {
  const admin = getAdminSupabaseClient();
  const configId = '00000000-0000-0000-0000-000000000001';

  const { data, error } = await admin
    .from('ai_active_config')
    .select(`
      active_provider_id,
      active_model_id,
      updated_at,
      ai_providers!active_provider_id(name, key),
      ai_models!active_model_id(name, key)
    `)
    .eq('id', configId)
    .single();

  if (error || !data) return null;

  return {
    active_provider_id: data.active_provider_id,
    active_model_id: data.active_model_id,
    provider_name: (data.ai_providers as any)?.name ?? null,
    model_name: (data.ai_models as any)?.name ?? null,
    provider_key: (data.ai_providers as any)?.key ?? null,
    model_key: (data.ai_models as any)?.key ?? null,
    updated_at: data.updated_at
  };
}

export async function getAIConfigSummary(): Promise<AICongifSummary> {
  const admin = getAdminSupabaseClient();
  const configId = '00000000-0000-0000-0000-000000000001';

  const [configResult, modelsResult, pricingResult] = await Promise.all([
    admin
      .from('ai_active_config')
      .select(`
        active_provider_id,
        active_model_id,
        ai_providers!active_provider_id(name),
        ai_models!active_model_id(name)
      `)
      .eq('id', configId)
      .single(),
    admin.from('ai_models').select('id, is_executable'),
    admin
      .from('ai_model_pricing')
      .select('created_at')
      .eq('is_current', true)
      .order('created_at', { ascending: false })
      .limit(1)
  ]);

  const config = configResult.data;
  const activeCount = (modelsResult.data ?? []).filter((m: any) => m.is_executable === true).length;
  const totalCount = modelsResult.data?.length ?? 0;
  const lastPricing = pricingResult.data?.[0]?.created_at ?? null;

  return {
    activeProvider: (config?.ai_providers as any)?.name ?? null,
    activeModel: (config?.ai_models as any)?.name ?? null,
    totalModels: totalCount,
    activeModels: activeCount,
    lastPricingUpdate: lastPricing
  };
}

export async function getCurrentPricing(modelId: string): Promise<AIModelPricing | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('ai_model_pricing')
    .select('*')
    .eq('model_id', modelId)
    .eq('is_current', true)
    .single();

  if (error) return null;
  return data as AIModelPricing;
}

export async function updateAIProviderStatus(
  providerId: string,
  newStatus: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return { success: false, error: 'No autenticado' };

  const { data: adminUser } = await supabase
    .from('internal_users')
    .select('id')
    .eq('auth_user_id', user.id)
    .eq('access_status', 'active')
    .single();

  if (!adminUser) return { success: false, error: 'No autorizado' };

  const { error: updateError } = await supabase
    .from('ai_providers')
    .update({ status: newStatus, updated_at: new Date().toISOString() })
    .eq('id', providerId);

  if (updateError) {
    return { success: false, error: updateError.message };
  }

  return { success: true };
}

export async function updateAIModelStatus(
  modelId: string,
  newStatus: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return { success: false, error: 'No autenticado' };

  const { data: adminUser } = await supabase
    .from('internal_users')
    .select('id')
    .eq('auth_user_id', user.id)
    .eq('access_status', 'active')
    .single();

  if (!adminUser) return { success: false, error: 'No autorizado' };

  const { error: updateError } = await supabase
    .from('ai_models')
    .update({ status: newStatus, updated_at: new Date().toISOString() })
    .eq('id', modelId);

  if (updateError) {
    return { success: false, error: updateError.message };
  }

  return { success: true };
}

export async function setActiveConfig(
  providerId: string,
  modelId: string
): Promise<{ success: boolean; error?: string; debugLogs?: string[] }> {
  const logs: string[] = [];
  const log = (msg: string) => { logs.push(msg); console.log(msg); };

  log('[setActiveConfig] providerId: ' + providerId + ' modelId: ' + modelId);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  log('[setActiveConfig] user: ' + (user?.id ?? 'NONE'));

  if (!user) return { success: false, error: 'No autenticado', debugLogs: logs };

  const { data: adminUser, error: adminErr } = await supabase
    .from('internal_users')
    .select('id')
    .eq('auth_user_id', user.id)
    .eq('access_status', 'active')
    .single();
  log('[setActiveConfig] adminUser: ' + (adminUser?.id ?? 'NONE') + ' err: ' + (adminErr?.message ?? 'none'));

  if (!adminUser) return { success: false, error: 'No autorizado', debugLogs: logs };

  const configId = '00000000-0000-0000-0000-000000000001';

  const adminSupabase = getAdminSupabaseClient();

  const { data: upsertData, error: upsertError } = await (adminSupabase as any)
    .from('ai_active_config')
    .upsert({
      id: configId,
      active_provider_id: providerId,
      active_model_id: modelId,
      updated_by: adminUser.id,
      updated_at: new Date().toISOString()
    }, { onConflict: 'id' })
    .select();

  log('[setActiveConfig] upsert data: ' + JSON.stringify(upsertData) + ' error: ' + (upsertError?.message ?? 'NONE'));

  if (upsertError) {
    return { success: false, error: upsertError.message, debugLogs: logs };
  }

  // Auditoría: configuración activa cambiada — solo IDs, nunca secretos
  await supabase.rpc('log_ai_provider_audit', {
    p_event_type: 'ai_active_config_changed',
    p_provider_id: providerId,
    p_details: { model_id: modelId },
  });

  return { success: true, debugLogs: logs };
}

export async function addModelPricing(
  modelId: string,
  inputCost: number,
  outputCost: number,
  currency: string = 'USD'
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return { success: false, error: 'No autenticado' };

  const { data: adminUser } = await supabase
    .from('internal_users')
    .select('id')
    .eq('auth_user_id', user.id)
    .eq('access_status', 'active')
    .single();

  if (!adminUser) return { success: false, error: 'No autorizado' };

  await supabase
    .from('ai_model_pricing')
    .update({ is_current: false })
    .eq('model_id', modelId)
    .eq('is_current', true);

  const { error: insertError } = await supabase
    .from('ai_model_pricing')
    .insert({
      model_id: modelId,
      input_cost_per_million_tokens: inputCost,
      output_cost_per_million_tokens: outputCost,
      currency: currency,
      is_current: true,
      created_by: adminUser.id
    });

  if (insertError) {
    return { success: false, error: insertError.message };
  }

  // Auditoría: tarifa de modelo registrada — solo model_id, sin costos sensibles
  await supabase.rpc('log_ai_provider_audit', {
    p_event_type: 'ai_model_pricing_added',
    p_provider_id: null,
    p_details: { model_id: modelId },
  });

  return { success: true };
}

export async function getProviderConnectionStatus(providerKey: string): Promise<{
  credentials_status: string;
  connection_status: string;
  last_tested_at: string | null;
  last_connection_error: string | null;
}> {
  const resolution = await resolveAIProviderCredential(providerKey);
  const hasKey = resolution.available;
  const credentialsStatus = hasKey ? 'configured' : 'missing';

  const supabase = await createClient();
  const { data } = await supabase
    .from('ai_providers')
    .select('credentials_status, connection_status, last_tested_at, last_connection_error')
    .eq('key', providerKey)
    .single();

  return {
    credentials_status: data?.credentials_status ?? credentialsStatus,
    connection_status: data?.connection_status ?? (hasKey ? 'not_tested' : 'not_configured'),
    last_tested_at: data?.last_tested_at ?? null,
    last_connection_error: data?.last_connection_error ?? null
  };
}

export async function testAIProviderConnection(
  providerKey: string
): Promise<{ success: boolean; error?: string; message?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: 'No autenticado' };
  }

  const { data: adminUser } = await supabase
    .from('internal_users')
    .select('id')
    .eq('auth_user_id', user.id)
    .eq('access_status', 'active')
    .single();

  if (!adminUser) {
    return { success: false, error: 'No autorizado' };
  }

  const { data: provider } = await supabase
    .from('ai_providers')
    .select('id, name')
    .eq('key', providerKey)
    .single();

  if (!provider) {
    return { success: false, error: 'Proveedor no encontrado' };
  }

  // Delegate to the vault-based test — single source of truth for credential resolution.
  return testAiProviderConnectionWithVault(providerKey);
}

export async function connectAiProvider(
  providerKey: string,
  apiKey: string
): Promise<{ success: boolean; error?: string; message?: string; debugLogs?: string[] }> {
  console.log('[connectAiProvider] Iniciando...', { providerKey, apiKeyLength: apiKey?.length });
  
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  console.log('[connectAiProvider] User:', user?.id);
  
  const debugLogs: string[] = [];
  debugLogs.push(`User ID: ${user?.id || 'NONE'}`);

  if (!user) {
    debugLogs.push('ERROR: No hay usuario');
    console.log('[connectAiProvider] ERROR: No hay usuario');
    return { success: false, error: 'No autenticado', debugLogs };
  }

  const { data: adminUser, error: adminError } = await supabase
    .from('internal_users')
    .select('id, role_id')
    .eq('auth_user_id', user.id)
    .eq('access_status', 'active')
    .single();

  // Verificar si el rol es admin
  if (adminUser) {
    const { data: role } = await supabase
      .from('roles')
      .select('key')
      .eq('id', adminUser.role_id)
      .single();
    
    if (role?.key !== 'admin') {
      debugLogs.push('ERROR: Usuario no es admin');
      console.log('[connectAiProvider] ERROR: No es admin');
      return { success: false, error: 'No autorizado. Solo administradores pueden conectar proveedores.', debugLogs };
    }
  }
  
  debugLogs.push(`Admin lookup: ${adminUser ? 'Found' : 'Not found'}, Error: ${adminError?.message}`);
  console.log('[connectAiProvider] AdminUser:', adminUser, 'Error:', adminError);

  if (!adminUser) {
    debugLogs.push('ERROR: No es admin');
    console.log('[connectAiProvider] ERROR: No es admin');
    return { success: false, error: 'No autorizado. Solo administradores pueden conectar proveedores.', debugLogs };
  }

  const { data: provider } = await supabase
    .from('ai_providers')
    .select('id, name, key')
    .eq('key', providerKey)
    .single();

  debugLogs.push(`Provider: ${provider ? provider.name : 'NOT FOUND'}`);
  console.log('[connectAiProvider] Provider:', provider);

  if (!provider) {
    return { success: false, error: 'Proveedor no encontrado', debugLogs };
  }

  const validKeys = ['google', 'gemini', 'openai', 'anthropic', 'claude'];
  if (!validKeys.includes(providerKey)) {
    return { success: false, error: 'Proveedor no válido', debugLogs };
  }

  debugLogs.push('Guardando credencial...');
  console.log('[connectAiProvider] Guardando credencial...');
  const storeResult = await storeAiProviderCredential(providerKey, apiKey);
  debugLogs.push(`Store result: ${JSON.stringify(storeResult)}`);
  console.log('[connectAiProvider] storeResult:', storeResult);
  
  if (!storeResult.success) {
    return { ...storeResult, debugLogs };
  }

  // Usar admin client para actualizar el proveedor
  const adminSupabase = getAdminSupabaseClient();

  debugLogs.push('Activando proveedor...');
  const { data: updateResult, error: updateError } = await (adminSupabase as any)
    .from('ai_providers')
    .update({
      status: 'active',
      updated_at: new Date().toISOString()
    })
    .eq('id', provider.id)
    .select();
    
  debugLogs.push(`Update: ${updateError ? updateError.message : 'OK'}`);

  debugLogs.push('COMPLETADO');
  console.log('[connectAiProvider] COMPLETADO');

  // Auditoría: credencial almacenada — metadata segura, nunca el secreto
  await supabase.rpc('log_ai_provider_audit', {
    p_event_type: 'ai_provider_credential_stored',
    p_provider_id: provider.id,
    p_details: { provider_key: providerKey },
  });

  return {
    success: true,
    message: 'Proveedor conectado correctamente. Ahora puedes probar la conexión.',
    debugLogs
  };
}

export async function updateAiProviderCredential(
  providerKey: string,
  newApiKey: string
): Promise<{ success: boolean; error?: string; message?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: 'No autenticado' };
  }

  const { data: adminUser } = await supabase
    .from('internal_users')
    .select('id, role_id')
    .eq('auth_user_id', user.id)
    .eq('access_status', 'active')
    .single();

  if (!adminUser) {
    return { success: false, error: 'No autorizado' };
  }

  const { data: role } = await supabase
    .from('roles')
    .select('key')
    .eq('id', adminUser.role_id)
    .single();

  if (role?.key !== 'admin') {
    return { success: false, error: 'No autorizado' };
  }

  const { data: provider } = await supabase
    .from('ai_providers')
    .select('id')
    .eq('key', providerKey)
    .single();

  if (!provider) {
    return { success: false, error: 'Proveedor no encontrado' };
  }

  const storeResult = await storeAiProviderCredential(providerKey, newApiKey);
  if (!storeResult.success) {
    return storeResult;
  }

  await supabase
    .from('ai_providers')
    .update({
      credentials_status: 'configured',
      connection_status: 'not_tested',
      updated_at: new Date().toISOString()
    })
    .eq('id', provider.id);

  // Auditoría: credencial actualizada — metadata segura, nunca el secreto
  await supabase.rpc('log_ai_provider_audit', {
    p_event_type: 'ai_provider_credential_updated',
    p_provider_id: provider.id,
    p_details: { provider_key: providerKey },
  });

  return {
    success: true,
    message: 'Credencial actualizada correctamente. Debes probar la conexión.'
  };
}

export async function disconnectAiProvider(
  providerKey: string
): Promise<{ success: boolean; error?: string; message?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: 'No autenticado' };
  }

  const { data: adminUser } = await supabase
    .from('internal_users')
    .select('id, role_id')
    .eq('auth_user_id', user.id)
    .eq('access_status', 'active')
    .single();

  if (!adminUser) {
    return { success: false, error: 'No autorizado' };
  }

  const { data: role } = await supabase
    .from('roles')
    .select('key')
    .eq('id', adminUser.role_id)
    .single();

  if (role?.key !== 'admin') {
    return { success: false, error: 'No autorizado' };
  }

  const { data: provider } = await supabase
    .from('ai_providers')
    .select('id')
    .eq('key', providerKey)
    .single();

  if (!provider) {
    return { success: false, error: 'Proveedor no encontrado' };
  }

  await removeAiProviderCredential(providerKey);

  const adminSupabase = getAdminSupabaseClient();

  await (adminSupabase as any)
    .from('ai_providers')
    .update({
      status: 'inactive',
      credentials_status: 'missing',
      connection_status: 'not_configured',
      last_tested_at: null,
      last_connection_error: null,
      updated_at: new Date().toISOString()
    })
    .eq('id', provider.id);

  const { data: activeConfig } = await (adminSupabase as any)
    .from('ai_active_config')
    .select('id')
    .eq('active_provider_id', provider.id)
    .single();

  if (activeConfig) {
    await (adminSupabase as any)
      .from('ai_active_config')
      .update({
        active_provider_id: null,
        active_model_id: null,
        updated_at: new Date().toISOString()
      })
      .eq('id', activeConfig.id);
  }

  // Auditoría: proveedor desconectado — metadata segura, nunca el secreto
  await supabase.rpc('log_ai_provider_audit', {
    p_event_type: 'ai_provider_disconnected',
    p_provider_id: provider.id,
    p_details: { provider_key: providerKey },
  });

  return {
    success: true,
    message: 'Proveedor desconectado correctamente'
  };
}

export async function testAiProviderConnectionWithVault(
  providerKey: string
): Promise<{ success: boolean; error?: string; message?: string; debugLogs?: string[] }> {
  const logs: string[] = [];
  const log = (msg: string) => { logs.push(msg); console.log(msg); };

  log('[testVault] INICIO providerKey: ' + providerKey);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  log('[testVault] user: ' + (user?.id ?? 'NONE'));

  if (!user) {
    return { success: false, error: 'No autenticado', debugLogs: logs };
  }

  const { data: adminUser, error: adminError } = await supabase
    .from('internal_users')
    .select('id, role_id')
    .eq('auth_user_id', user.id)
    .eq('access_status', 'active')
    .single();
  log('[testVault] adminUser: ' + (adminUser?.id ?? 'NONE') + ' error: ' + (adminError?.message ?? 'none'));

  if (!adminUser) {
    return { success: false, error: 'No autorizado', debugLogs: logs };
  }

  const { data: role, error: roleError } = await supabase
    .from('roles')
    .select('key')
    .eq('id', adminUser.role_id)
    .single();
  log('[testVault] role: ' + (role?.key ?? 'NONE') + ' error: ' + (roleError?.message ?? 'none'));

  if (role?.key !== 'admin') {
    return { success: false, error: 'No autorizado', debugLogs: logs };
  }

  const { data: provider, error: providerError } = await supabase
    .from('ai_providers')
    .select('id, name, key')
    .eq('key', providerKey)
    .single();
  log('[testVault] provider: ' + provider?.id + ' ' + provider?.name + ' error: ' + (providerError?.message ?? 'none'));

  if (!provider) {
    return { success: false, error: 'Proveedor no encontrado', debugLogs: logs };
  }

  // Resolver credencial usando el helper unificado — mismo código que usa el enrichment.
  const resolution = await resolveAIProviderCredential(providerKey);
  log('[testVault] resolution: available=' + resolution.available + ' source=' + resolution.source + ' secret_name=' + (resolution.secret_name ?? 'none'));
  log('[testVault] checked_aliases: ' + resolution.checked_aliases.join(', '));

  if (!resolution.available) {
    // Reparar estado stale en DB: si la credencial ya no existe en Vault,
    // el badge debe dejar de mostrar "Conectado".
    const adminRepair = getAdminSupabaseClient();
    await (adminRepair as any)
      .from('ai_providers')
      .update({
        credentials_status: 'missing',
        connection_status: 'not_configured',
        updated_at: new Date().toISOString(),
      })
      .eq('id', provider.id);
    log('[testVault] DB reparado a not_configured (credencial ausente en Vault)');

    const checkedMsg = resolution.checked_aliases.join(', ') || '(ningún alias)';
    return {
      success: false,
      error: 'NO_CREDENTIAL',
      message: `No hay credencial guardada para ${provider.name}. Aliases revisados: ${checkedMsg}. Agrega la API key en Configuración > Proveedores de IA.`,
      debugLogs: logs,
    };
  }

  const credentialResult = await getAIProviderCredentialValue(providerKey);
  log('[testVault] credentialResult.success: ' + credentialResult.success + ' hasKey: ' + !!credentialResult.apiKey);

  if (!credentialResult.success || !credentialResult.apiKey) {
    return { success: false, error: 'CREDENTIAL_ERROR', message: 'No se pudo recuperar la credencial desde Vault', debugLogs: logs };
  }

  let testResult: ConnectionTestResult;

  if (providerKey === 'google' || providerKey === 'gemini') {
    log('[testVault] Probando Gemini...');
    testResult = await testGeminiWithKey(credentialResult.apiKey);
  } else if (providerKey === 'openai') {
    log('[testVault] Probando OpenAI...');
    testResult = await testOpenAIConnection(credentialResult.apiKey);
  } else if (providerKey === 'anthropic' || providerKey === 'claude') {
    log('[testVault] Probando Anthropic (2 niveles: key + ejecución real)...');
    // Pass active model key so Level 2 tests the actually-configured model
    const activeConfig = await getAIActiveConfig();
    const isAnthropicActive =
      activeConfig?.provider_key === 'anthropic' || activeConfig?.provider_key === 'claude';
    const activeModelId = isAnthropicActive ? (activeConfig?.model_key ?? undefined) : undefined;
    log('[testVault] active model for Claude test: ' + (activeModelId ?? 'none — will auto-detect'));
    testResult = await testClaudeConnection(credentialResult.apiKey, activeModelId);
  } else {
    return {
      success: false,
      error: 'NOT_IMPLEMENTED',
      message: `Prueba de conexión para ${provider.name} no implementada todavía`,
      debugLogs: logs
    };
  }

  log('[testVault] testResult: ' + JSON.stringify(testResult));

  const connectionStatus = testResult.success ? 'connected' : 'error';
  const errorMessage = testResult.success ? null : (testResult.message ?? testResult.error ?? null);
  log('[testVault] connectionStatus: ' + connectionStatus + ' provider.id: ' + provider.id);

  const adminSupabase = getAdminSupabaseClient();

  const { data: updateData, error: updateError } = await (adminSupabase as any)
    .from('ai_providers')
    .update({
      credentials_status: 'configured',
      connection_status: connectionStatus,
      last_tested_at: new Date().toISOString(),
      last_tested_by: adminUser.id,
      last_connection_error: errorMessage,
      updated_at: new Date().toISOString()
    })
    .eq('id', provider.id)
    .select();

  log('[testVault] UPDATE data: ' + JSON.stringify(updateData) + ' error: ' + (updateError?.message ?? 'NONE'));

  // Auditoría: resultado de prueba de conexión — sin secretos, solo estado y error_code
  await supabase.rpc('log_ai_provider_audit', {
    p_event_type: testResult.success
      ? 'ai_provider_connection_succeeded'
      : 'ai_provider_connection_failed',
    p_provider_id: provider.id,
    p_details: {
      provider_key: providerKey,
      ...(testResult.success ? {} : { error_code: testResult.error ?? null }),
    },
  });

  return {
    success: testResult.success,
    error: testResult.error,
    message: testResult.message,
    debugLogs: logs
  };
}

export interface SyncAnthropicModelsResult {
  success: boolean;
  error?: string;
  api_models_found: number;
  models_checked: Array<{
    key: string;
    name: string;
    is_available: boolean;
    is_executable: boolean;
    error_message: string | null;
    latency_ms?: number;
  }>;
  models_marked_unavailable: string[];
  models_added: string[];
}

/**
 * Syncs Anthropic model availability and executability against the live API.
 * 1. Reads API key from Vault.
 * 2. Lists models from GET /v1/models.
 * 3. Tests real execution via POST /v1/messages for each model in DB.
 * 4. Updates is_available, is_executable, last_checked_at, error_message in DB.
 * NEVER logs or returns the API key.
 */
export async function syncAnthropicModels(): Promise<SyncAnthropicModelsResult> {
  const admin = getAdminSupabaseClient();

  // Auth gate: admin only
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'No autenticado', api_models_found: 0, models_checked: [], models_marked_unavailable: [], models_added: [] };

  const { data: adminUser } = await supabase.from('internal_users').select('id, role_id').eq('auth_user_id', user.id).eq('access_status', 'active').single();
  if (!adminUser) return { success: false, error: 'No autorizado', api_models_found: 0, models_checked: [], models_marked_unavailable: [], models_added: [] };

  const { data: role } = await supabase.from('roles').select('key').eq('id', adminUser.role_id).single();
  if (role?.key !== 'admin') return { success: false, error: 'No autorizado', api_models_found: 0, models_checked: [], models_marked_unavailable: [], models_added: [] };

  // Get Anthropic API key from Vault via unified helper
  const credResult = await getAIProviderCredentialValue('anthropic');
  if (!credResult.success || !credResult.apiKey) {
    return { success: false, error: 'No hay credencial de Anthropic en Vault. Conecta el proveedor primero.', api_models_found: 0, models_checked: [], models_marked_unavailable: [], models_added: [] };
  }

  // Level 1: list models from Anthropic API
  const listResult = await listAnthropicModels(credResult.apiKey);
  if (!listResult.ok) {
    return { success: false, error: `Error al listar modelos de Anthropic: ${listResult.error}`, api_models_found: 0, models_checked: [], models_marked_unavailable: [], models_added: [] };
  }

  const apiModelIds = new Set((listResult.models ?? []).map((m) => m.id));
  const apiModelsFound = apiModelIds.size;

  // Get Anthropic provider from DB
  const { data: provider } = await admin.from('ai_providers').select('id').eq('key', 'anthropic').single();
  if (!provider) {
    return { success: false, error: 'Proveedor Anthropic no encontrado en DB', api_models_found: apiModelsFound, models_checked: [], models_marked_unavailable: [], models_added: [] };
  }

  // Get existing models in DB for Anthropic
  const { data: dbModels } = await admin
    .from('ai_models')
    .select('id, key, name')
    .eq('provider_id', provider.id);

  const dbModelMap = new Map<string, { id: string; name: string }>(
    (dbModels ?? []).map((m: { id: string; key: string; name: string }) => [m.key, { id: m.id, name: m.name }])
  );

  const modelsChecked: SyncAnthropicModelsResult['models_checked'] = [];
  const modelsMarkedUnavailable: string[] = [];
  const modelsAdded: string[] = [];
  const now = new Date().toISOString();

  // Level 2: test execution and update DB for each known model
  for (const [key, dbModel] of dbModelMap.entries()) {
    const isAvailable = apiModelIds.has(key);

    if (!isAvailable) {
      modelsMarkedUnavailable.push(key);
      await admin.from('ai_models').update({
        status: 'inactive',
        is_available: false,
        is_executable: false,
        deprecation_status: 'unavailable_or_deprecated',
        last_checked_at: now,
        error_message: 'Model not available for current Anthropic API key',
        updated_at: now,
      }).eq('id', dbModel.id);

      modelsChecked.push({ key, name: dbModel.name, is_available: false, is_executable: false, error_message: 'Model not available for current Anthropic API key' });
      continue;
    }

    // Model is in list — test actual execution
    const execResult: AnthropicExecutionTestResult = await testAnthropicModelExecution({
      apiKey: credResult.apiKey,
      modelId: key,
    });

    const isExecutable = execResult.ok;
    const errMsg = execResult.ok ? null : (execResult.error_message ?? execResult.error_code ?? 'Execution failed');

    await admin.from('ai_models').update({
      status: isExecutable ? 'active' : 'inactive',
      is_available: true,
      is_executable: isExecutable,
      deprecation_status: isExecutable ? 'available' : 'unavailable_or_deprecated',
      last_checked_at: now,
      error_message: errMsg,
      updated_at: now,
    }).eq('id', dbModel.id);

    modelsChecked.push({
      key,
      name: dbModel.name,
      is_available: true,
      is_executable: isExecutable,
      error_message: errMsg,
      latency_ms: execResult.latency_ms,
    });
  }

  // Add new models from API list that aren't in DB yet
  for (const apiModel of listResult.models ?? []) {
    if (dbModelMap.has(apiModel.id)) continue;
    // Only add claude-* models to avoid noise
    if (!apiModel.id.startsWith('claude-')) continue;

    const displayName = apiModel.display_name ?? apiModel.id;
    const execResult: AnthropicExecutionTestResult = await testAnthropicModelExecution({
      apiKey: credResult.apiKey,
      modelId: apiModel.id,
    });
    const isExecutable = execResult.ok;
    const errMsg = execResult.ok ? null : (execResult.error_message ?? execResult.error_code ?? 'Execution failed');

    await admin.from('ai_models').insert({
      provider_id: provider.id,
      key: apiModel.id,
      name: displayName,
      description: `Modelo Anthropic descubierto en sincronización (${now})`,
      status: isExecutable ? 'active' : 'inactive',
      is_selectable: true,
      is_available: true,
      is_executable: isExecutable,
      deprecation_status: isExecutable ? 'available' : 'unavailable_or_deprecated',
      last_checked_at: now,
      error_message: errMsg,
    });

    modelsAdded.push(apiModel.id);
    modelsChecked.push({
      key: apiModel.id,
      name: displayName,
      is_available: true,
      is_executable: isExecutable,
      error_message: errMsg,
      latency_ms: execResult.latency_ms,
    });
  }

  // Audit log — safe: no secrets, just metadata
  await supabase.rpc('log_ai_provider_audit', {
    p_event_type: 'ai_anthropic_models_synced',
    p_provider_id: provider.id,
    p_details: {
      api_models_found: apiModelsFound,
      models_checked: modelsChecked.length,
      executable_count: modelsChecked.filter((m) => m.is_executable).length,
    },
  });

  return {
    success: true,
    api_models_found: apiModelsFound,
    models_checked: modelsChecked,
    models_marked_unavailable: modelsMarkedUnavailable,
    models_added: modelsAdded,
  };
}

export async function getAiProviderConnectionStatus(
  providerKey: string
): Promise<{
  has_credential: boolean;
  connection_status: string;
  last_tested_at: string | null;
  last_connection_error: string | null;
  can_activate: boolean;
}> {
  const resolution = await resolveAIProviderCredential(providerKey);
  const hasCredential = resolution.available;

  const supabase = await createClient();
  const { data: provider } = await supabase
    .from('ai_providers')
    .select('connection_status, last_tested_at, last_connection_error')
    .eq('key', providerKey)
    .single();

  const connectionStatus = provider?.connection_status ?? 'not_configured';
  const canActivate = hasCredential && connectionStatus === 'connected';

  return {
    has_credential: hasCredential,
    connection_status: connectionStatus,
    last_tested_at: provider?.last_tested_at ?? null,
    last_connection_error: provider?.last_connection_error ?? null,
    can_activate: canActivate
  };
}