/**
 * 4O-H3-B-R1 — qué cola de revisión renderiza el panel de candidatos.
 *
 * `pending` es el comportamiento histórico (`pending_review`). `duplicates` es la cola nueva:
 * candidatos que la detección movió a `duplicate` y que, hasta ese hito, quedaban inalcanzables
 * porque ninguna consulta de la UI volvía a mirar ese estado.
 *
 * AGENT2A-P0-R2 — por qué el tipo vive en su PROPIO módulo y no en el panel.
 *
 * El panel es un server component: importa `feature-flags.server` y los server actions de
 * lectura. La tabla que consume esta cola es un client component. Colgar el tipo del panel
 * obligaría al cliente a importar (aunque sólo fuera como tipo) un módulo cargado de código de
 * servidor. Un módulo sin runtime —sólo un tipo— lo pueden importar los dos lados sin arrastrar
 * nada.
 */
export type ContactCandidatesQueue = 'pending' | 'duplicates';
