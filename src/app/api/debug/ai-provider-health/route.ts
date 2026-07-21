/**
 * GET /api/debug/ai-provider-health?provider=anthropic
 *
 * Safe diagnostic endpoint. Returns provider health status without exposing API keys.
 * Available only in development (NODE_ENV !== 'production').
 *
 * Acceso: admin-only (is_admin RPC + sesión autenticada), en paridad con
 * /api/debug/agent1-apollo-config. No devuelve valores de credenciales, solo
 * presencia. No llama providers externos. No escribe en la base de datos.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { hasAiProviderCredential } from '@/server/services/ai-connection';

function getAdmin() {
  return createSupabaseAdminClient();
}

export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 403 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  const { data: isAdmin } = await supabase.rpc('is_admin', {
    p_auth_user_id: user.id,
  });

  if (!isAdmin) {
    return NextResponse.json({ error: 'Acceso restringido a administradores' }, { status: 403 });
  }

  const providerParam = request.nextUrl.searchParams.get('provider') ?? 'anthropic';
  const admin = getAdmin();

  // Provider info from DB
  const { data: provider } = await admin
    .from('ai_providers')
    .select('id, name, key, status, credentials_status, connection_status, last_tested_at, last_connection_error')
    .eq('key', providerParam)
    .single();

  if (!provider) {
    return NextResponse.json({ error: `Provider "${providerParam}" not found in DB` }, { status: 404 });
  }

  // Credential check (no key value exposed)
  const credentialFound = await hasAiProviderCredential(providerParam);

  // Models for this provider
  const { data: allModels } = await admin
    .from('ai_models')
    .select('key, name, status, is_selectable, is_available, is_executable, deprecation_status, last_checked_at, error_message')
    .eq('provider_id', provider.id)
    .order('name');

  const models = allModels ?? [];
  const availableModels = models.filter((m) => m.is_available === true);
  const executableModels = models.filter((m) => m.is_executable === true);
  const nonExecutableModels = models.filter((m) => m.is_executable === false);
  const uncheckedModels = models.filter((m) => m.is_executable === null);

  // Active config
  const { data: activeConfig } = await admin
    .from('ai_active_config')
    .select(`
      active_model_id,
      ai_providers!active_provider_id(key, name),
      ai_models!active_model_id(key, name, is_executable)
    `)
    .eq('id', '00000000-0000-0000-0000-000000000001')
    .single();

  const activeProviderRaw = activeConfig?.ai_providers as unknown;
  const activeProviderKey = (activeProviderRaw && !Array.isArray(activeProviderRaw))
    ? (activeProviderRaw as { key: string }).key
    : null;
  const activeModelRaw = activeConfig?.ai_models as unknown;
  const activeModelInfo = (activeModelRaw && !Array.isArray(activeModelRaw))
    ? (activeModelRaw as { key: string; name: string; is_executable: boolean | null })
    : null;

  return NextResponse.json({
    diagnosis_timestamp: new Date().toISOString(),
    provider: {
      key: provider.key,
      name: provider.name,
      status: provider.status,
      credentials_status: provider.credentials_status,
      connection_status: provider.connection_status,
      last_tested_at: provider.last_tested_at,
      last_connection_error: provider.last_connection_error,
    },
    credential_found: credentialFound,
    active_model:
      activeProviderKey === providerParam && activeModelInfo
        ? {
            key: activeModelInfo.key,
            name: activeModelInfo.name,
            is_executable: activeModelInfo.is_executable,
          }
        : null,
    models_summary: {
      total: models.length,
      available_count: availableModels.length,
      executable_count: executableModels.length,
      non_executable_count: nonExecutableModels.length,
      unchecked_count: uncheckedModels.length,
    },
    executable_models: executableModels.map((m) => ({
      key: m.key,
      name: m.name,
      last_checked_at: m.last_checked_at,
    })),
    non_executable_models: nonExecutableModels.map((m) => ({
      key: m.key,
      name: m.name,
      deprecation_status: m.deprecation_status,
      last_checked_at: m.last_checked_at,
      error: m.error_message,
    })),
    unchecked_models: uncheckedModels.map((m) => ({
      key: m.key,
      name: m.name,
    })),
    recommendations: [
      ...(executableModels.length === 0
        ? [`No hay modelos ejecutables para ${provider.name}. Usa "Actualizar modelos disponibles" en Configuración > Proveedores de IA.`]
        : []),
      ...(activeModelInfo?.is_executable === false
        ? [`El modelo activo (${activeModelInfo.key}) no es ejecutable. Selecciona uno de: ${executableModels.map((m) => m.key).join(', ') || 'ninguno disponible'}`]
        : []),
      ...(credentialFound === false
        ? [`No hay credencial almacenada para ${provider.name}. Conecta el proveedor primero.`]
        : []),
    ],
  });
}
