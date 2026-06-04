/**
 * Unified AI credential resolution — single source of truth.
 *
 * Used by: Settings connection test, Settings badge display, enrichment, debug route.
 *
 * Vault naming convention (new): sellup_ai_{canonical_key}
 * Vault naming convention (legacy): ai_provider_{key}_api_key
 * Env var fallback: only in non-production environments.
 *
 * resolveAIProviderCredential  → safe, never returns the key.
 * getAIProviderCredentialValue → server-side only, returns decrypted key. NEVER log/return to frontend.
 */

import { hasVaultSecretByRawName, getVaultSecretByRawName } from './ai-connection';

export type CanonicalProvider = 'anthropic' | 'google' | 'openai';

export interface CredentialResolution {
  available: boolean;
  provider_key_normalized: CanonicalProvider;
  secret_name?: string;
  source: 'vault' | 'env_dev' | 'missing';
  checked_aliases: string[];
  error?: string;
}

const PROVIDER_VAULT_ALIASES: Record<CanonicalProvider, string[]> = {
  google: [
    'sellup_ai_google',
    'sellup_ai_gemini',
    'ai_provider_google_api_key',
    'ai_provider_gemini_api_key',
  ],
  anthropic: [
    'sellup_ai_anthropic',
    'sellup_ai_claude',
    'ai_provider_anthropic_api_key',
    'ai_provider_claude_api_key',
  ],
  openai: [
    'sellup_ai_openai',
    'ai_provider_openai_api_key',
  ],
};

const PROVIDER_ENV_FALLBACK: Record<CanonicalProvider, string[]> = {
  google: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  anthropic: ['ANTHROPIC_API_KEY'],
  openai: ['OPENAI_API_KEY'],
};

export function normalizeToCanonicalProvider(key: string): CanonicalProvider | null {
  const k = (key || '').toLowerCase().trim();
  if (k === 'google' || k === 'gemini' || k.includes('gemini') || k.includes('google')) return 'google';
  if (k === 'anthropic' || k === 'claude' || k.includes('claude') || k.includes('anthropic')) return 'anthropic';
  if (k === 'openai' || k.includes('openai') || k.includes('gpt')) return 'openai';
  return null;
}

/**
 * Checks whether a credential is available for the given provider.
 * Tries all known Vault aliases in order, then env var fallback in non-production.
 * Safe: never returns or logs the actual API key.
 */
export async function resolveAIProviderCredential(
  providerKeyOrAlias: string
): Promise<CredentialResolution> {
  const canonical = normalizeToCanonicalProvider(providerKeyOrAlias);
  if (!canonical) {
    return {
      available: false,
      provider_key_normalized: 'openai',
      source: 'missing',
      checked_aliases: [],
      error: `Unknown provider key: ${providerKeyOrAlias}`,
    };
  }

  const aliases = PROVIDER_VAULT_ALIASES[canonical];
  const checked: string[] = [];

  for (const alias of aliases) {
    checked.push(alias);
    const found = await hasVaultSecretByRawName(alias);
    if (found) {
      return {
        available: true,
        provider_key_normalized: canonical,
        secret_name: alias,
        source: 'vault',
        checked_aliases: checked,
      };
    }
  }

  if (process.env.NODE_ENV !== 'production') {
    for (const envVar of PROVIDER_ENV_FALLBACK[canonical]) {
      if (process.env[envVar]) {
        return {
          available: true,
          provider_key_normalized: canonical,
          secret_name: envVar,
          source: 'env_dev',
          checked_aliases: checked,
        };
      }
    }
  }

  return {
    available: false,
    provider_key_normalized: canonical,
    source: 'missing',
    checked_aliases: checked,
  };
}

/**
 * Retrieves the decrypted API key for a provider.
 * Server-side only. NEVER return to frontend. NEVER log the value.
 */
export async function getAIProviderCredentialValue(
  providerKeyOrAlias: string
): Promise<{ success: boolean; apiKey?: string; error?: string; resolved_alias?: string }> {
  const canonical = normalizeToCanonicalProvider(providerKeyOrAlias);
  if (!canonical) {
    return { success: false, error: `Unknown provider: ${providerKeyOrAlias}` };
  }

  for (const alias of PROVIDER_VAULT_ALIASES[canonical]) {
    const result = await getVaultSecretByRawName(alias);
    if (result.success && result.apiKey) {
      return { success: true, apiKey: result.apiKey, resolved_alias: alias };
    }
  }

  if (process.env.NODE_ENV !== 'production') {
    for (const envVar of PROVIDER_ENV_FALLBACK[canonical]) {
      const val = process.env[envVar];
      if (val) {
        return { success: true, apiKey: val, resolved_alias: envVar };
      }
    }
  }

  return { success: false, error: 'CREDENTIAL_NOT_FOUND' };
}
