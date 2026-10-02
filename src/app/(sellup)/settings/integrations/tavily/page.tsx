import { redirect } from 'next/navigation';

/**
 * Tavily ya no es una integración comercial: se conecta y se mide en
 * «Proveedores y consumo». La ruta se conserva solo para los enlaces antiguos.
 */
export default function TavilyLegacyRedirectPage() {
  redirect('/settings/providers');
}
