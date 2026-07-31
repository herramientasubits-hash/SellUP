/**
 * lusha-phone-fallback-client.ts — Phone-scoped Lusha enrich client for the
 * FUTURE Lusha phone reveal fallback (Agente 2A · LUSHA-PHONE-FALLBACK-1S).
 *
 * NOT wired to any live caller in this milestone: no route, server action or
 * UI component in the repo imports or invokes this function. It exists so a
 * future, explicitly authorized implementation reuses an already-reviewed
 * request/response shape instead of improvising one under time pressure.
 *
 * Deliberately kept SEPARATE from enrichLushaContactsV3 in lusha-client.ts,
 * which stays hard-restricted to `reveal: ['emails']` and is neither imported
 * nor modified here — that guardrail is untouched.
 *
 * Callers MUST pass `allowPhoneReveal: true` explicitly; any other value
 * short-circuits before any fetch. This is a structural reminder, not a
 * security boundary on its own — the real boundary is that this milestone
 * wires no caller at all.
 *
 * Never logs or returns the raw API key. Never logs or returns the full Lusha
 * contact id — error messages carry only a masked prefix/suffix. Never
 * extracts or returns a raw phone number (see lusha-phone-fallback-response.ts).
 */

import {
  mapLushaPhoneRevealResponseToInternalStatus,
  type LushaPhoneFallbackStatusMapping,
} from './lusha-phone-fallback-response';

const LUSHA_PHONE_FALLBACK_BASE_URL = 'https://api.lusha.com';

export interface LushaPhoneFallbackClientInput {
  apiKey: string;
  timeoutMs: number;
  contactId: string;
  /** Must be exactly `true`. Any other value short-circuits before the fetch. */
  allowPhoneReveal: true;
}

export type LushaPhoneFallbackClientResult =
  | ({ ok: true; httpStatus: number; phoneType: 'unknown' } & LushaPhoneFallbackStatusMapping)
  | { ok: false; errorMessage: string };

/** Masks a Lusha contact id for safe inclusion in an error message. */
function maskContactId(contactId: string): string {
  if (contactId.length <= 6) return '***';
  return `${contactId.slice(0, 4)}…${contactId.slice(-2)}`;
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

    return {
      ok: true,
      httpStatus: response.status,
      phoneType: 'unknown',
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
