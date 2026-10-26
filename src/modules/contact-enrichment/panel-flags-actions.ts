'use server';

// Agente 2A — Banderas que el panel del agente necesita en el navegador.
//
// Las banderas viven sólo en el servidor (`feature-flags.server.ts`) y el panel se monta desde
// varias pantallas cliente. En vez de pasar la bandera por cada una, el panel la pide al abrirse.
// Sólo devuelve booleanos: no expone variables ni datos.

import { isContactEnrichmentLinkedInSearchEnabled } from '@/lib/feature-flags.server';

export interface ContactEnrichmentPanelFlags {
  /** Muestra el botón «Buscar contacto por LinkedIn». */
  linkedinSearchEnabled: boolean;
}

export async function getContactEnrichmentPanelFlagsAction(): Promise<ContactEnrichmentPanelFlags> {
  return { linkedinSearchEnabled: isContactEnrichmentLinkedInSearchEnabled() };
}
