import { redirect } from 'next/navigation';

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Legacy `/prospects` route — kept only for backward compatibility.
 *
 * Prospectos is no longer a standalone module: it lives as an internal tab of
 * Empresas (`/accounts?tab=prospectos`). This route preserves existing deep
 * links (notably the Agente 1 flow passing `?sourceId=`) by forwarding every
 * incoming query param to the unified Empresas route with `tab=prospectos`.
 *
 * Example: `/prospects?sourceId=abc` → `/accounts?tab=prospectos&sourceId=abc`.
 */
export default async function ProspectsLegacyRedirectPage({ searchParams }: PageProps) {
  const params = await searchParams;

  const forwarded = new URLSearchParams();
  forwarded.set('tab', 'prospectos');

  for (const [key, value] of Object.entries(params)) {
    if (key === 'tab') continue; // tab is forced to "prospectos"
    if (Array.isArray(value)) {
      // Preserve repeated params (e.g. ?status=a&status=b)
      for (const entry of value) {
        if (entry) forwarded.append(key, entry);
      }
    } else if (value) {
      forwarded.set(key, value);
    }
  }

  redirect(`/accounts?${forwarded.toString()}`);
}
