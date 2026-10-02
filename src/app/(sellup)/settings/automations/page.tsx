import { redirect } from 'next/navigation';

/**
 * «Automatizaciones» ya no es una sección de Configuración. La ruta se conserva
 * solo para que un enlace antiguo no dé 404: lleva al resumen.
 */
export default function AutomationsLegacyRedirectPage() {
  redirect('/settings');
}
