/**
 * Copy de las DOS colas de revisión de candidatos
 * (AGENT2A-P0-R2 — cross-flow runtime incident).
 *
 * Defecto observado en QA (2026-08-13): con la pill «Duplicados» seleccionada y
 * la consulta correcta ya ejecutándose (`status=eq.duplicate`), la tabla seguía
 * titulándose «Candidatos por revisar» y su estado vacío seguía diciendo «No hay
 * candidatos por revisar.».
 *
 * La causa: `ContactCandidatesPanel` sí distingue la cola —tarjeta, pill activa y
 * lectura— pero el título, la descripción y el estado vacío vivían HARDCODEADOS
 * dentro de `ContactCandidatesDataTableClient`, que no recibía la cola. El panel
 * sabía en qué cola estaba; la tabla no. Por eso la pantalla se contradecía a sí
 * misma: pill «Duplicados» sobre una tabla que se anunciaba como la otra cola.
 *
 * Centralizar el copy aquí es lo que impide que vuelva a divergir: hay UNA fuente
 * por cola, y añadir una cola nueva obliga a declarar su copy (el `Record` es
 * total sobre `ContactCandidatesQueue`).
 */

import type { ContactCandidatesQueue } from './contact-candidates-panel-queue';

export interface ContactCandidatesQueueCopy {
  /** Título de la tabla. Debe coincidir con la pill activa. */
  title: string;
  /** Descripción bajo el título: qué es esta cola y por qué está aquí. */
  description: string;
  /** Titular del estado vacío. */
  emptyTitle: string;
  /** Cuerpo del estado vacío. */
  emptyBody: string;
  /**
   * Si el estado vacío ofrece el CTA de «Enriquecer contactos».
   *
   * En «Por revisar» sí: lanzar el agente es justo la acción que llena esa cola.
   * En «Duplicados» NO: un duplicado no se produce buscando más contactos, y
   * ofrecerlo ahí invita a gastar para resolver algo que no se resuelve así.
   */
  showEnrichmentCta: boolean;
}

export const CONTACT_CANDIDATES_QUEUE_COPY: Record<
  ContactCandidatesQueue,
  ContactCandidatesQueueCopy
> = {
  pending: {
    title: 'Candidatos por revisar',
    description:
      'Perfiles encontrados por el Agente de contactos que pasaron el filtro de relevancia y esperan revisión humana.',
    emptyTitle: 'No hay candidatos por revisar.',
    emptyBody:
      'Cuando el Agente de contactos encuentre perfiles relevantes, aparecerán aquí.',
    showEnrichmentCta: true,
  },
  duplicates: {
    title: 'Duplicados',
    description:
      'Candidatos que coinciden con un contacto que ya existe en SellUp y esperan una decisión humana: fusionarlos con el contacto existente o descartarlos.',
    emptyTitle: 'No hay candidatos duplicados.',
    emptyBody:
      'Cuando la detección marque un candidato como duplicado de un contacto existente, aparecerá aquí.',
    showEnrichmentCta: false,
  },
};
