'use server';

// HUBSPOT-ENRICHMENT-REQUEST-1 — Acción «Enriquecer empresa de HubSpot» del Agente 1.
//
// Quien la pide debe tener sesión activa y poder VER la empresa: la lectura va con su sesión,
// así la RLS por alcance comercial (migración 166) decide. Los pasos corren con el cliente de
// servicio, igual que el resto del completado de empresas.

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { runHubSpotEnrichmentRequest } from './hubspot-enrichment-request.server';
import type { EnrichmentRequestSummary } from './hubspot-enrichment-request';

export type RequestHubSpotEnrichmentResult =
  | { success: true; accountId: string; accountName: string; summary: EnrichmentRequestSummary }
  | { success: false; error: string };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function requestHubSpotCompanyEnrichment(accountId: string): Promise<RequestHubSpotEnrichmentResult> {
  if (typeof accountId !== 'string' || !UUID_PATTERN.test(accountId)) {
    return { success: false, error: 'No encontré esa empresa en SellUp.' };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Tu sesión no está activa. Vuelve a entrar.' };
  const { data: requester } = await supabase
    .from('internal_users')
    .select('id')
    .eq('auth_user_id', user.id)
    .eq('access_status', 'active')
    .maybeSingle();
  if (!requester) return { success: false, error: 'Tu sesión no está activa. Vuelve a entrar.' };

  const { data: visible, error: visibleError } = await supabase
    .from('accounts')
    .select('id')
    .eq('id', accountId)
    .is('archived_at', null)
    .maybeSingle();
  if (visibleError || !visible) {
    return { success: false, error: 'No encontré esa empresa entre las que puedes ver.' };
  }

  try {
    const result = await runHubSpotEnrichmentRequest(createSupabaseAdminClient(), {
      accountId,
      requesterId: requester.id as string,
    });
    if (!result.ok) return { success: false, error: result.message };
    revalidatePath('/accounts');
    revalidatePath(`/accounts/${accountId}`);
    return { success: true, accountId: result.accountId, accountName: result.accountName, summary: result.summary };
  } catch (err) {
    console.error('[requestHubSpotCompanyEnrichment] failed', {
      accountId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { success: false, error: 'No pude enriquecer la empresa. Intenta de nuevo en unos minutos.' };
  }
}
