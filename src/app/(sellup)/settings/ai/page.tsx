import { redirect } from 'next/navigation';

/**
 * Legacy `/settings/ai` route — kept only for backward compatibility. AI
 * provider configuration now lives inside the primary `/settings/providers`
 * console, via each provider's sidepanel (`?provider=<key>&ptab=configuracion`).
 */
export default function AIConfigLegacyRedirectPage() {
  redirect('/settings/providers');
}