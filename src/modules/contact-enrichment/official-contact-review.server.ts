// Agente 2A — «Revisión» de un contacto APROBADO: qué puede hacer el navegador sobre su candidato
// de origen (AGENT2A-CONTACT-APPROVED-REVIEW, Bryan 19-11).
//
// Las acciones de la ficha del candidato («Revelar LinkedIn / correo», «Revelar teléfono» con
// identificación) sólo completaban candidatos en `pending_review`. En la revisión de un contacto
// aprobado el candidato está `approved`: el permiso para tratarlo como revisable lo decide AQUÍ el
// servidor —candidato aprobado, vínculo durable con su contacto, contacto vivo y visible para
// quien actúa—, nunca un parámetro que mande el navegador.

import { createClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { canSeeOfficialContact } from './candidate-scope.server';
import { resolveOfficialContactSourceCandidateId } from './post-approval-reveal-core';
import type { IdentityCompletionRunOptions } from './candidate-identity-completion-runner.server';

export interface ApprovedReviewRunAllowance {
  contactId: string;
  options: IdentityCompletionRunOptions;
}

/** `null` ⇒ no es la revisión de un contacto aprobado: las reglas de siempre. Nunca lanza. */
export async function resolveApprovedReviewAllowance(candidateId: string): Promise<ApprovedReviewRunAllowance | null> {
  try {
    const id = candidateId.trim();
    if (!id) return null;
    const admin = createSupabaseAdminClient();
    const { data: candidate } = await admin
      .from('contact_enrichment_candidates')
      .select('status, matched_contacts_id')
      .eq('id', id)
      .maybeSingle();
    const row = candidate as { status?: unknown; matched_contacts_id?: unknown } | null;
    const contactId = typeof row?.matched_contacts_id === 'string' ? row.matched_contacts_id : null;
    if (row?.status !== 'approved' || !contactId) return null;
    const { data: contact } = await admin.from('contacts').select('metadata, archived_at').eq('id', contactId).maybeSingle();
    const c = contact as { metadata?: unknown; archived_at?: unknown } | null;
    if (!c || (typeof c.archived_at === 'string' && c.archived_at)) return null;
    const durable = resolveOfficialContactSourceCandidateId(c.metadata);
    if (durable.kind !== 'resolved' || durable.candidateId !== id) return null;
    if (!(await canSeeOfficialContact(await createClient(), contactId))) return null;
    return { contactId, options: { allowApproved: true, allowAnySource: true, surface: 'official_contact' } };
  } catch {
    return null;
  }
}
