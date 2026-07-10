import { redirect } from 'next/navigation';

interface Props {
  params: Promise<{ providerKey: string }>;
}

/**
 * Legacy `/settings/providers/[providerKey]` route — kept only for backward
 * compatibility. The provider detail workspace now lives in the primary
 * `/settings/providers` console as an addressable sidepanel
 * (`?provider=<providerKey>`).
 *
 * Example: `/settings/providers/apollo` → `/settings/providers?provider=apollo`.
 */
export default async function ProviderDetailLegacyRedirectPage({ params }: Props) {
  const { providerKey } = await params;

  const forwarded = new URLSearchParams();
  forwarded.set('provider', providerKey);

  redirect(`/settings/providers?${forwarded.toString()}`);
}
