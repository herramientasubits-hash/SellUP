// Agente 2A — Abrir la ficha de un candidato de «Por revisar» desde otro lugar (el chat de la
// búsqueda puntual). AGENT2A-LINKEDIN-EMAIL-REVIEW-INLINE. Puro (sin React ni Next).
//
// Por qué un enlace y no la ficha dentro del chat: la regla de «un solo panel abierto» cierra
// el panel del agente al abrir una ficha de detalle, y el panel desmonta su contenido al
// cerrarse. «Por revisar» ya monta la ficha con los permisos de teléfono resueltos en el
// servidor, así que el chat lleva allí con `?candidate=<id>` y la tabla la abre.
//
// Si la tabla ya está montada (el chat se abrió encima de «Por revisar»), cambiar la URL no la
// vuelve a montar: el chat avisa además con un evento de ventana.

export const CANDIDATE_REVIEW_PARAM = 'candidate';

/** Evento de ventana: «abre la ficha de este candidato» (`detail: { candidateId }`). */
export const CANDIDATE_REVIEW_OPEN_EVENT = 'sellup:contact-candidate:open';

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isCandidateReviewId(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value.trim());
}

/** `/contacts?tab=candidates&candidate=<id>` a partir de la ruta de «Por revisar». */
export function candidateReviewHref(baseHref: string, candidateId: string): string {
  const separator = baseHref.includes('?') ? '&' : '?';
  return `${baseHref}${separator}${CANDIDATE_REVIEW_PARAM}=${encodeURIComponent(candidateId)}`;
}

/** El id del candidato a abrir, si la query lo trae y tiene forma de id. */
export function readCandidateReviewParam(search: string): string | null {
  const value = new URLSearchParams(search).get(CANDIDATE_REVIEW_PARAM);
  return isCandidateReviewId(value) ? value.trim() : null;
}

/** La misma URL sin `candidate` (para que recargar o cerrar no vuelva a abrir la ficha). */
export function stripCandidateReviewParam(href: string): string {
  const url = new URL(href, 'http://local');
  url.searchParams.delete(CANDIDATE_REVIEW_PARAM);
  const query = url.searchParams.toString();
  return `${url.pathname}${query ? `?${query}` : ''}${url.hash}`;
}
