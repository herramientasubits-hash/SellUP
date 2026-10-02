import { redirect } from 'next/navigation';

/**
 * «Prospección y enriquecimiento» se fundió en «Proveedores y consumo»: Apollo,
 * Lusha y Tavily se conectan en el detalle de cada proveedor. La ruta se
 * conserva solo para los enlaces antiguos.
 */
export default function ProspectingLegacyRedirectPage() {
  redirect('/settings/providers');
}
