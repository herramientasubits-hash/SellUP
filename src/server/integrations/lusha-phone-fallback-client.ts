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
 *
 * AGENT2A-PHONE-REVEAL-4O-D: the body carries `results[0].phones[]`, an ARRAY,
 * and this client used to reduce it to `phones[0]`. It no longer does. Every
 * usable phone in that array now travels in `phones`, and the scalar triple
 * (`phoneNumber` / `phoneType` / `phoneRawType`) is the one the TYPE RANKING
 * elects — not the one the provider happened to serialize first. The reading and
 * the election both live in the pure lusha-phone-fallback-phones.ts, so they can
 * be tested without a fetch. The reported cost is unchanged and stays PER
 * RESPONSE: `billing.creditsCharged` is never divided among the numbers and
 * never multiplied by how many arrived.
 */

import {
  mapLushaPhoneRevealResponseToInternalStatus,
  type LushaPhoneFallbackStatusMapping,
} from './lusha-phone-fallback-response';
import {
  extractAllLushaPhones,
  selectPrimaryLushaPhone,
  type LushaRevealedPhone,
} from './lusha-phone-fallback-phones';
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
      /**
       * EVERY usable phone the response carried, in the order Lusha sent them
       * (AGENT2A-PHONE-REVEAL-4O-D). Empty when none was returned. Entries with
       * no usable `number` never appear. This is the field that stopped the
       * silent loss of the extra numbers.
       */
      phones: readonly LushaRevealedPhone[];
      /**
       * The elected phone number, or null when none was returned.
       *
       * "Elected" by the TYPE RANKING, not by array position: a mobile in slot 1
       * beats a work line in slot 0. Before 4O-D this was literally `phones[0]`.
       */
      phoneNumber: string | null;
      /** Best-effort normalization of Lusha's raw phone.type; 'unknown' if absent, 'other' if unrecognized. */
      phoneType: PhoneType;
      /** Lusha's raw phone.type string, kept for traceability. null if absent. */
      phoneRawType: string | null;
      /**
       * billing.creditsCharged as reported by Lusha; null when not reported.
       *
       * PER RESPONSE, never per number: three phones in one response cost what
       * the field says, not three times that.
       */
      creditsCharged: number | null;
    } & LushaPhoneFallbackStatusMapping)
  | { ok: false; errorMessage: string };

/** Masks a Lusha contact id for safe inclusion in an error message. */
function maskContactId(contactId: string): string {
  if (contactId.length <= 6) return '***';
  return `${contactId.slice(0, 4)}…${contactId.slice(-2)}`;
}

interface RawLushaPhoneFallbackBody {
  billing?: { creditsCharged?: unknown };
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
    // EVERY phone, then the elected one. Two steps on purpose: the collection is
    // what stops the loss, and the scalar is what the pre-4O-D contract still
    // publishes for the callers that only need one number.
    const phones = extractAllLushaPhones(rawBody);
    const primary = selectPrimaryLushaPhone(phones);

    return {
      ok: true,
      httpStatus: response.status,
      phones,
      phoneNumber: primary?.number ?? null,
      phoneType: primary?.phoneType ?? 'unknown',
      phoneRawType: primary?.rawType ?? null,
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
