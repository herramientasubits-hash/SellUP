import { redirect } from 'next/navigation';
import { EMPRESAS_SEARCHES_ROUTE } from '@/config/navigation';

/**
 * La antigua «Prospección masiva» (dueña 28-10): lo masivo vive ahora en Empresas
 * (la quinta forma de Rumbo y la vista Búsquedas). Esta ruta sólo redirige, para que
 * los enlaces viejos sigan funcionando.
 */
export default function GrowthPage() {
  redirect(EMPRESAS_SEARCHES_ROUTE);
}
