import { CONTACT_CANDIDATES_QUEUE_COPY } from '@/components/contact-enrichment/contact-candidates-queue-copy';
import { CONTACTS_ROUTE } from '@/config/navigation';

/**
 * Las vistas del módulo «Contactos». Se llega a ellas desde el menú lateral
 * (Contactos → Contactos / Por revisar); la cola de duplicados
 * (`?tab=duplicates`) conserva su ruta y se llega a ella por enlace. Las rutas
 * son las de siempre; la página ya no lleva pestañas propias.
 */
export type ContactsTabId = 'approved' | 'candidates' | 'duplicates';

/** El nombre del módulo: el del menú y el primer tramo de las migas. */
export const CONTACTOS_MODULE_TITLE = 'Contactos';

/**
 * El título de la página dice la vista en la que estás, con los mismos rótulos
 * que el menú lateral. La cola de duplicados está separada de «Por revisar»
 * (antes «Candidatos por revisar»): son dos colas, dos títulos.
 */
export const CONTACTOS_VIEW_TITLES: Record<ContactsTabId, string> = {
  approved: 'Contactos',
  candidates: 'Por revisar',
  duplicates: 'Duplicados',
};

export const CONTACTOS_TAB_DESCRIPTIONS: Record<ContactsTabId, string> = {
  approved: 'Las personas ya aprobadas de tus empresas: decisores, champions y contactos clave.',
  // Las dos colas de revisión ya tienen su texto, fijado por pruebas: es el
  // mismo que se lee aquí, para que cabecera y cola no digan cosas distintas.
  candidates: CONTACT_CANDIDATES_QUEUE_COPY.pending.description,
  duplicates: CONTACT_CANDIDATES_QUEUE_COPY.duplicates.description,
};

/** Las migas de una vista: «Contactos › Por revisar». La vista raíz no lleva. */
export function contactosViewCrumbs(view: ContactsTabId): (string | { label: string; href: string })[] | null {
  if (view === 'approved') return null;
  return [{ label: CONTACTOS_MODULE_TITLE, href: CONTACTS_ROUTE }, CONTACTOS_VIEW_TITLES[view]];
}
