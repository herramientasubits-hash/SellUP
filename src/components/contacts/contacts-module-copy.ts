import type { ContactsTabId } from '@/components/navigation/contacts-module-tabs-nav';
import { CONTACT_CANDIDATES_QUEUE_COPY } from '@/components/contact-enrichment/contact-candidates-queue-copy';

/**
 * La voz del módulo «Contactos»: el mismo título en el menú, en la miga y en
 * la página sea cual sea la pestaña. Lo que cambia con la pestaña es la
 * descripción, que dice qué hay en esa vista.
 *
 * Vive aparte para que la página, sus paneles de servidor y el estado de carga
 * lean el mismo texto.
 */
export const CONTACTOS_MODULE_TITLE = 'Contactos';

export const CONTACTOS_TAB_DESCRIPTIONS: Record<ContactsTabId, string> = {
  approved: 'Las personas ya aprobadas de tus empresas: decisores, champions y contactos clave.',
  // Las dos colas de revisión ya tienen su texto, fijado por pruebas: es el
  // mismo que se lee aquí, para que cabecera y cola no digan cosas distintas.
  candidates: CONTACT_CANDIDATES_QUEUE_COPY.pending.description,
  duplicates: CONTACT_CANDIDATES_QUEUE_COPY.duplicates.description,
};
