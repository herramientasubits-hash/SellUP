/**
 * Copy + payload guards for the Lusha phone reveal fallback
 * (Agente 2A · LUSHA-PHONE-FALLBACK-SPEND-CAP-FIX).
 *
 * Lusha support confirmed a successful phone reveal charges 5 credits, not 1.
 * These tests pin the operator-facing copy to that number, keep the UI constant
 * in sync with the server-authoritative cap in lusha-phone-fallback-core.ts,
 * and read the detail sheet's source on disk to verify the action payload still
 * carries an explicit, non-downgraded confirmation.
 *
 * Pure: no React render, no network, no DB, no provider call, no credits.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  getLushaPhoneFallbackCopy,
  LUSHA_PHONE_FALLBACK_COST_CONFIRMATION_MESSAGE,
  LUSHA_PHONE_FALLBACK_MAX_CREDITS,
  LUSHA_PHONE_FALLBACK_PHONE_TYPE_WARNING,
} from '../lusha-phone-fallback-copy';
import { LUSHA_PHONE_FALLBACK_DEFAULT_MAX_CREDITS } from '@/modules/contact-enrichment/lusha-phone-fallback-core';

const here = dirname(fileURLToPath(import.meta.url));
const detailSheet = readFileSync(
  join(here, '..', 'contact-candidate-detail-sheet.tsx'),
  'utf8',
);

/** Todo el copy que el operador puede leer en el flujo del fallback. */
const allCopy = Object.values(getLushaPhoneFallbackCopy())
  .filter((value): value is string => typeof value === 'string')
  .join(' ');

describe('LUSHA-PHONE-FALLBACK cap — UI constant matches the server cap', () => {
  it('the UI cap is 5 credits', () => {
    assert.equal(LUSHA_PHONE_FALLBACK_MAX_CREDITS, 5);
  });

  it('the UI cap never drifts from LUSHA_PHONE_FALLBACK_DEFAULT_MAX_CREDITS', () => {
    assert.equal(LUSHA_PHONE_FALLBACK_MAX_CREDITS, LUSHA_PHONE_FALLBACK_DEFAULT_MAX_CREDITS);
  });

  it('getLushaPhoneFallbackCopy() exposes the same cap it renders', () => {
    assert.equal(getLushaPhoneFallbackCopy().maxCredits, LUSHA_PHONE_FALLBACK_MAX_CREDITS);
  });
});

describe('LUSHA-PHONE-FALLBACK copy — 5 credits, no stale 1-credit wording', () => {
  it('the cost confirmation states 5 credits when a phone is found', () => {
    assert.match(LUSHA_PHONE_FALLBACK_COST_CONFIRMATION_MESSAGE, /5 créditos/);
    assert.match(LUSHA_PHONE_FALLBACK_COST_CONFIRMATION_MESSAGE, /si se encuentra teléfono/i);
  });

  it('no operator-facing string claims 1 credit', () => {
    assert.doesNotMatch(allCopy, /\b1 crédito\b/i);
    assert.doesNotMatch(allCopy, /\bun crédito\b/i);
    assert.doesNotMatch(allCopy, /\bun solo crédito\b/i);
  });

  it('the real cost is attributed to billing.creditsCharged', () => {
    assert.match(LUSHA_PHONE_FALLBACK_COST_CONFIRMATION_MESSAGE, /billing\.creditsCharged/);
  });

  it('states that HubSpot is not written automatically', () => {
    assert.match(LUSHA_PHONE_FALLBACK_COST_CONFIRMATION_MESSAGE, /HubSpot/);
    assert.match(LUSHA_PHONE_FALLBACK_COST_CONFIRMATION_MESSAGE, /no se escribirá/i);
  });

  it('states the action is individual, never bulk', () => {
    assert.match(LUSHA_PHONE_FALLBACK_COST_CONFIRMATION_MESSAGE, /individual/i);
    assert.match(LUSHA_PHONE_FALLBACK_COST_CONFIRMATION_MESSAGE, /no masiva/i);
  });

  it('warns that Lusha may return a phone without confirming its type', () => {
    assert.match(LUSHA_PHONE_FALLBACK_PHONE_TYPE_WARNING, /sin confirmar/i);
    assert.match(LUSHA_PHONE_FALLBACK_PHONE_TYPE_WARNING, /tipo desconocido/i);
  });

  it('says "teléfono", never "celular"', () => {
    assert.match(allCopy, /teléfono/i);
    assert.doesNotMatch(allCopy, /celular/i);
  });
});

describe('LUSHA-PHONE-FALLBACK payload — explicit confirmation, single candidate', () => {
  /** Argumento del único call site del server action del fallback. */
  const payload =
    detailSheet.match(
      /revealCandidatePhoneViaLushaFallbackAction\(\{([\s\S]*?)\}\)/,
    )?.[1] ?? '';

  it('the detail sheet calls the fallback action with a payload', () => {
    assert.notEqual(payload, '', 'no se encontró el call site del server action');
  });

  it('sends confirmCost: true', () => {
    assert.match(payload, /confirmCost:\s*true/);
  });

  it('sends the shared cap constant, never a hardcoded number', () => {
    assert.match(payload, /expectedMaxCredits:\s*LUSHA_PHONE_FALLBACK_MAX_CREDITS/);
    assert.doesNotMatch(payload, /expectedMaxCredits:\s*\d/);
  });

  it('sends exactly one candidate id, never an array', () => {
    assert.match(payload, /candidateId:\s*candidate\.id/);
    assert.doesNotMatch(payload, /candidateIds/);
    assert.doesNotMatch(payload, /\[/);
  });

  it('never sends PII (phone, email, LinkedIn, name, company) in the payload', () => {
    for (const forbidden of [/phone_number/, /\bemail\b/, /linkedin/i, /full_name/, /company/i]) {
      assert.doesNotMatch(payload, forbidden);
    }
  });

  it('the sheet never reaches Lusha search, waterfallReveal or HubSpot for this flow', () => {
    assert.doesNotMatch(detailSheet, /waterfallReveal/i);
    assert.doesNotMatch(detailSheet, /searchLusha|lushaSearch/i);
    assert.doesNotMatch(detailSheet, /enrichLushaContactPhonesForFallback/);
  });
});
