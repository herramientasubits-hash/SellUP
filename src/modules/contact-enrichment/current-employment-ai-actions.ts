'use server';

/**
 * «Verificar con IA» — acción del servidor (CONTACT-CURRENT-EMPLOYMENT-AI-1).
 *
 * Un contacto por llamada: la tabla recorre los seleccionados uno a uno y muestra el avance, así
 * ninguna llamada se acerca al tope de tiempo. Usa el modelo y la clave de Configuración → IA, la
 * cuota de Claude en Proveedores y deja el gasto en «Uso de IA» (Agente 2A · verificar cargo).
 * No escribe en HubSpot ni llama a Apollo o Lusha. La conexión vive en current-employment-ai.server.ts
 * (también la usa la comprobación automática al buscar contactos).
 */

import { createClient } from '@/lib/supabase/server';
import { canSeeContactCandidate } from './candidate-scope.server';
import { requireActiveActor } from './current-actor.server';
import { runEmploymentAiForCandidate } from './current-employment-ai.server';
import type { VerifyEmploymentWithAiResult } from './current-employment-ai-runner';

export async function verifyCandidateEmploymentWithAiAction(input: {
  candidateId: string;
}): Promise<VerifyEmploymentWithAiResult> {
  const candidateId = typeof input?.candidateId === 'string' ? input.candidateId.trim() : '';
  const actor = await requireActiveActor();
  const supabase = await createClient();
  // Alcance comercial ANTES de gastar: un candidato ajeno no existe para este usuario.
  if (!candidateId || !(await canSeeContactCandidate(supabase, candidateId))) {
    return { ok: false, status: 'candidate_not_found', rejection: null, check: null };
  }
  return runEmploymentAiForCandidate(candidateId, {
    triggeredBy: actor.internalUserId,
    readClient: supabase,
    trigger: 'manual',
  });
}
