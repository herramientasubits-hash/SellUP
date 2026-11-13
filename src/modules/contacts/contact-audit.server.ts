// ============================================================
// Registro de auditoría de contactos (servidor).
//
// Vive fuera de `./actions.ts` ('use server') a propósito: allí era una acción
// exportada que cualquiera podía invocar desde el cliente con un `actorUserId`
// libre y escribir auditoría a nombre de otra persona. Aquí sólo la llaman otras
// acciones del servidor, con el id del usuario que ya resolvieron ellas.
// Sin 'use server': no es una acción.
// ============================================================

import { createClient } from '@/lib/supabase/server';
import type { ContactAuditAction } from './types';

export async function logContactAudit({
  contactId,
  accountId,
  actorUserId,
  actionType,
  details,
}: {
  contactId: string;
  accountId: string;
  actorUserId: string | null;
  actionType: ContactAuditAction;
  details: Record<string, unknown>;
}): Promise<void> {
  const supabase = await createClient();
  await supabase.from('contact_audit').insert({
    contact_id: contactId,
    account_id: accountId,
    actor_user_id: actorUserId,
    action_type: actionType,
    details,
  });
}
