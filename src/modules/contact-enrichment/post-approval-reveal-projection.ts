// Agente 2A — La PROYECCIÓN transaccional candidato → contacto oficial
// (AGENT2A-POST-APPROVAL-OFFICIAL-CONTACT-PHONE-REVEAL-1)
//
// Server-only. Hace EXACTAMENTE UNA llamada a `project_approved_candidate_phones_onto_contact`
// (migración 128), que dentro de UNA sola transacción de PostgreSQL bloquea el candidato,
// revalida que sigue `approved` y que sigue apuntando a ESTE contacto, vuelve a comprobar la
// supresión POR PERSONA bajo ese lock, bloquea el contacto, promueve la colección viva con toda
// su procedencia, elige principal sólo si el contacto no tenía y proyecta el escalar heredado
// sólo si estaba en NULL y el principal es nuevo.
//
// Este archivo no contiene ni un `.insert()`, ni un `.update()`, ni un `.delete()`. Esa es la
// razón por la que existe: partida en escrituras sueltas por PostgREST, la proyección deja —si
// falla a mitad— un contacto con parte de los números, sin procedencia para el resto y con un
// escalar que no corresponde a su principal. Y sin el lock del candidato, dos reconciliaciones
// concurrentes (un clic y un refresco automático) compiten por elegir el principal.
//
// ── SIN FALLBACK SECUENCIAL, SIN REINTENTO CIEGO ───────────────
// Si la RPC falla, este módulo LANZA y no intenta nada más. La función es idempotente por
// construcción —`ON CONFLICT DO NOTHING` sobre las dos claves únicas, más el namespace
// `v1:promoted:` de la clave de evento—, así que una reconciliación posterior converge; lo que no
// se hace es adivinar aquí si hubo COMMIT.
//
// ── NI PROVEEDORES NI CRÉDITOS NI HUBSPOT ──────────────────────
// No llama a Apollo, ni a Lusha, ni a ningún CRM externo. No reserva ni consume un crédito y no escribe
// usage log, reserva ni corrida: proyectar no gasta nada, porque cada número que promueve ya fue
// observado y ya fue pagado por el reveal que lo persistió.
//
// ── PRIVACIDAD ─────────────────────────────────────────────────
// No imprime nada. El sobre lleva conteos, banderas, ids opacos y una `dedupe_key` (SHA-256 por
// diseño de la 114): ningún número, ningún nombre, ningún email. El mensaje del driver NO se
// propaga: PostgreSQL cita valores de la query en sus errores y uno de ellos puede ser un
// teléfono.

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import {
  PROJECT_APPROVED_CANDIDATE_PHONES_FN,
  buildProjectApprovedCandidatePhonesParams,
  parseProjectApprovedCandidatePhonesEnvelope,
  type ProjectApprovedCandidatePhonesOutcome,
  type ProjectApprovedCandidatePhonesRequest,
} from './post-approval-reveal-core';

/**
 * Proyecta la colección oficial del candidato APROBADO sobre el contacto que su propia
 * aprobación creó, en UNA transacción.
 *
 * Devuelve lo que quedó realmente escrito (conteos de la base, no del plan). LANZA si la
 * transacción no llegó a completarse: el llamador lo trata como proyección fallida y NO reporta
 * que el contacto ya tiene el teléfono.
 */
export async function projectApprovedCandidatePhonesOntoContact(
  request: ProjectApprovedCandidatePhonesRequest,
): Promise<ProjectApprovedCandidatePhonesOutcome> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc(
    PROJECT_APPROVED_CANDIDATE_PHONES_FN,
    buildProjectApprovedCandidatePhonesParams(request),
  );
  if (error) {
    // Un error REPORTADO por el servidor significa que la transacción se deshizo: no hay estado
    // a medias que limpiar. El mensaje del driver se DESCARTA a propósito (puede citar un
    // teléfono); el código de la operación es lo único que viaja.
    throw new Error('official contact phone projection failed');
  }
  return parseProjectApprovedCandidatePhonesEnvelope(data);
}
