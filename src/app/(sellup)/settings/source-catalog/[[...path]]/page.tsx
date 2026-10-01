import { redirect } from 'next/navigation';

import { legacySourceCatalogRedirect } from '@/config/navigation';

interface PageProps {
  params: Promise<{ path?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * El Catálogo de fuentes dejó de ser una sección de Configuración: es un
 * módulo propio en `/source-catalog`. Esta ruta solo redirige los enlaces
 * antiguos (`/settings/source-catalog`, su detalle de fuente y sus lotes),
 * conservando el resto de la ruta y los parámetros.
 */
export default async function LegacySourceCatalogRedirect({ params, searchParams }: PageProps) {
  const [{ path }, query] = await Promise.all([params, searchParams]);
  redirect(legacySourceCatalogRedirect(path, query));
}
