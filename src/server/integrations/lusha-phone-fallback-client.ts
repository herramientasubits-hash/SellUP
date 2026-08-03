/**
 * lusha-phone-fallback-client.ts — Phone-scoped Lusha enrich client for the
 * Lusha phone reveal fallback (Agente 2A · LUSHA-PHONE-FALLBACK-1S scaffold →
 * LUSHA-PHONE-FALLBACK-1 live).
 *
 * Wired to exactly one live caller: lusha-phone-fallback-core.ts, via the
 * admin-only server action in lusha-phone-fallback-actions.ts. No other route,
 * server action or UI component imports or invokes this function.
 *
 * Deliberately kept SEPARATE from enrichLushaContactsV3 in lusha-client.ts,
 * which stays hard-restricted to `reveal: ['emails']` and is neither imported
 * nor modified here — that guardrail is untouched.
 *
 * Callers MUST pass `allowPhoneReveal: true` explicitly; any other value
 * short-circuits before any fetch.
 *
 * Never logs or returns the raw API key. Never logs or returns the full Lusha
 * contact id — error messages carry only a masked prefix/suffix.
 *
 * LUSHA-PHONE-FALLBACK-1: unlike lusha-phone-fallback-response.ts (which stays
 * a pure, PII-free STATUS classifier only — see that module's doc), this
 * client DOES extract the actual phone number/type and the reported
 * billing.creditsCharged from the raw body, because the live caller needs
 * those values to persist the reveal and log its real cost. This client never
 * logs them itself (no console.* call in this file touches the phone or the
 * body) — the caller is responsible for keeping them out of logs/usage-log
 * metadata (see lusha-phone-fallback-core.ts).
 */

import {
  mapLushaPhoneRevealResponseToInternalStatus,
  type LushaPhoneFallbackStatusMapping,
} from './lusha-phone-fallback-response';
import type { PhoneType } from '@/server/agents/contact-enrichment-toolkit/phone-classification';

const LUSHA_PHONE_FALLBACK_BASE_URL = 'https://api.lusha.com';

export interface LushaPhoneFallbackClientInput {
  apiKey: string;
  timeoutMs: number;
  contactId: string;
  /** Must be exactly `true`. Any other value short-circuits before the fetch. */
  allowPhoneReveal: true;
}

export type LushaPhoneFallbackClientResult =
  | ({
      ok: true;
      httpStatus: number;
      /** First revealed phone number, or null when none was returned. */
      phoneNumber: string | null;
      /** Best-effort normalization of Lusha's raw phone.type; 'unknown' if absent/unrecognized. */
      phoneType: PhoneType;
      /** Lusha's raw phone.type string, kept for traceability. null if absent. */
      phoneRawType: string | null;
      /** billing.creditsCharged as reported by Lusha; null when not reported. */
      creditsCharged: number | null;
    } & LushaPhoneFallbackStatusMapping)
  | { ok: false; errorMessage: string };

/** Masks a Lusha contact id for safe inclusion in an error message. */
function maskContactId(contactId: string): string {
  if (contactId.length <= 6) return '***';
  return `${contactId.slice(0, 4)}…${contactId.slice(-2)}`;
}

interface RawLushaPhoneFallbackBody {
  results?: Array<{ phones?: Array<{ number?: unknown; type?: unknown }> }>;
  billing?: { creditsCharged?: unknown };
}

/**
 * Best-effort mapping from Lusha's raw phone.type string to SellUp's internal
 * PhoneType vocabulary. Lusha's type vocabulary is not documented/guaranteed,
 * so this stays conservative: only the clearly mobile/landline tokens map to
 * something more specific than 'other'; anything unrecognized (but present)
 * maps to 'other', and absence maps to 'unknown'. Mirrors the UI copy warning
 * that Lusha does not confirm phone type (lusha-phone-fallback-copy.ts).
 */
function mapLushaPhoneTypeToPhoneType(raw: string | null): PhoneType {
  if (!raw) return 'unknown';
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'mobile' || normalized === 'cell' || normalized === 'cellphone') {
    return 'mobile';
  }
  if (
    normalized === 'landline' ||
    normalized === 'work' ||
    normalized === 'office' ||
    normalized === 'direct'
  ) {
    return 'work';
  }
  return 'other';
}

/** Extracts the first phone number/raw type from a parsed Lusha response body. */
function extractFirstPhone(body: unknown): { number: string | null; rawType: string | null } {
  if (body === null || typeof body !== 'object') return { number: null, rawType: null };
  const raw = body as RawLushaPhoneFallbackBody;
  const firstResult = Array.isArray(raw.results) ? raw.results[0] : undefined;
  const firstPhone =
    firstResult && Array.isArray(firstResult.phones) ? firstResult.phones[0] : undefined;
  const number =
    firstPhone && typeof firstPhone.number === 'string' && firstPhone.number.trim()
      ? firstPhone.number.trim()
      : null;
  const rawType =
    firstPhone && typeof firstPhone.type === 'string' && firstPhone.type.trim()
      ? firstPhone.type.trim()
      : null;
  return { number, rawType };
}

/** Extracts billing.creditsCharged from a parsed Lusha response body, never assuming 0. */
function extractCreditsCharged(body: unknown): number | null {
  if (body === null || typeof body !== 'object') return null;
  const raw = body as RawLushaPhoneFallbackBody;
  const value = raw.billing?.creditsCharged;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

export async function enrichLushaContactPhonesForFallback(
  input: LushaPhoneFallbackClientInput,
): Promise<LushaPhoneFallbackClientResult> {
  if (input.allowPhoneReveal !== true) {
    return { ok: false, errorMessage: 'allowPhoneReveal must be explicitly true' };
  }
  if (!input.contactId) {
    return { ok: false, errorMessage: 'contactId is required' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);

  try {
    const response = await fetch(`${LUSHA_PHONE_FALLBACK_BASE_URL}/v3/contacts/enrich`, {
      method: 'POST',
      headers: {
        api_key: input.apiKey.trim(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ids: [input.contactId], reveal: ['phones'] }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    const rawBody = await response.json().catch(() => null);
    const mapping = mapLushaPhoneRevealResponseToInternalStatus(response.status, rawBody);
    const { number, rawType } = extractFirstPhone(rawBody);

    return {
      ok: true,
      httpStatus: response.status,
      phoneNumber: number,
      phoneType: mapLushaPhoneTypeToPhoneType(rawType),
      phoneRawType: rawType,
      creditsCharged: extractCreditsCharged(rawBody),
      ...mapping,
    };
  } catch (err: unknown) {
    clearTimeout(timer);
    const isTimeout = err instanceof Error && err.name === 'AbortError';
    return {
      ok: false,
      errorMessage: isTimeout
        ? `timeout contacting Lusha for contact ${maskContactId(input.contactId)}`
        : `network error contacting Lusha for contact ${maskContactId(input.contactId)}`,
    };
  }
}
