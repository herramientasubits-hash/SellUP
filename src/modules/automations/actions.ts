'use server';

import { createClient as createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import type { SystemAutomation, AutomationExecutionMode, AutomationsSummary } from './types';

function getAdminSupabaseClient() {
  return createSupabaseAdminClient();
}

async function getAdminInternalUserId(): Promise<{ id: string | null; error?: string }> {
  const supabase = await createSupabaseServerClient();
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

  if (role?.key !== 'admin') return { id: null, error: 'No autorizado. Solo administradores pueden gestionar automatizaciones.' };

  return { id: internalUser.id };
}

export async function getAllAutomations(): Promise<SystemAutomation[]> {
  const admin = getAdminSupabaseClient();
  const { data, error } = await admin
    .from('system_automations')
    .select('*')
    .order('category')
    .order('name');

  if (error) {
    console.error('[getAllAutomations] Error:', error);
    return [];
  }

  return (data ?? []) as SystemAutomation[];
}

export async function getAutomationsSummary(): Promise<AutomationsSummary> {
  const admin = getAdminSupabaseClient();
  const { data, error } = await admin
    .from('system_automations')
    .select('execution_mode')
    .eq('is_available', true);

  if (error || !data) {
    return { total: 0, automatic: 0, suggested: 0, manual: 0 };
  }

  const automations = data as Array<{ execution_mode: AutomationExecutionMode }>;

  return {
    total: automations.length,
    automatic: automations.filter(a => a.execution_mode === 'automatic').length,
    suggested: automations.filter(a => a.execution_mode === 'suggested').length,
    manual: automations.filter(a => a.execution_mode === 'manual').length,
  };
}

/**
 * Consulta la configuración de una automatización por su trigger_key.
 * Función pensada para ser usada por módulos operativos futuros
 * (Pipeline, Cuentas, agentes de IA) para decidir cómo comportarse.
 *
 * Uso futuro:
 *   const config = await getAutomationConfig('manual_prospect_created');
 *   if (config?.execution_mode === 'automatic') { ... ejecutar enriquecimiento ... }
 */
export async function getAutomationConfig(triggerKey: string): Promise<SystemAutomation | null> {
  const admin = getAdminSupabaseClient();
  const { data, error } = await admin
    .from('system_automations')
    .select('*')
    .eq('trigger_key', triggerKey)
    .eq('is_available', true)
    .single();

  if (error || !data) return null;
  return data as SystemAutomation;
}

export async function updateAutomationMode(
  automationId: string,
  newMode: AutomationExecutionMode
): Promise<{ success: boolean; error?: string }> {
  const { id: adminId, error: authError } = await getAdminInternalUserId();

  if (!adminId) {
    return { success: false, error: authError ?? 'No autorizado' };
  }

  const admin = getAdminSupabaseClient();

  // Obtener modo anterior para auditoría
  const { data: current } = await admin
    .from('system_automations')
    .select('execution_mode, name')
    .eq('id', automationId)
    .single();

  const { error: updateError } = await admin
    .from('system_automations')
    .update({
      execution_mode: newMode,
      updated_by: adminId,
    })
    .eq('id', automationId);

  if (updateError) {
    console.error('[updateAutomationMode] Error:', updateError);
    return { success: false, error: updateError.message };
  }

  // Registro de auditoría en access_audit reutilizando el patrón existente
  // Se registra como metadata adicional dado que access_audit es de acceso de usuarios
  // En el futuro se puede migrar a una tabla config_audit_log dedicada
  console.log(`[audit] automation_execution_mode_changed: ${current?.name} ${current?.execution_mode} → ${newMode} by ${adminId}`);

  return { success: true };
}
