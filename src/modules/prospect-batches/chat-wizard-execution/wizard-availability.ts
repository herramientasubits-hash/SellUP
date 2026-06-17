/**
 * wizard-availability.ts — Tavily availability check for wizard execution.
 *
 * Verifies server-side Tavily configuration without making a real search or
 * consuming any API credits. Server-only — never import from client components.
 */

import { hasTavilyApiKey } from '@/server/services/tavily-connection';

export type WizardTavilyAvailabilityChecker = () => Promise<boolean>;

/**
 * Returns true if Tavily is configured for use by the wizard.
 * Checks TAVILY_API_KEY env var (local dev fallback) then Supabase Vault (production).
 * Never makes a real Tavily search. Returns false on any configuration error.
 */
export async function isTavilyConfiguredForWizard(): Promise<boolean> {
  if (process.env.TAVILY_API_KEY) return true;
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return false;
  try {
    return await hasTavilyApiKey();
  } catch {
    return false;
  }
}
