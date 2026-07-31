/**
 * Static safety guards — PHONE-3D.6B (elegibilidad del reveal alineada al server)
 *
 * PHONE-3D.6B corrige que el botón "Revelar teléfono" no aparecía para
 * candidatos Lusha con identidad suficiente. Este test lee el código fuente en
 * disco y verifica el CONTRATO de la elegibilidad de la UI, sin red/DB/proveedores:
 *
 *   - La elegibilidad usa una señal de identidad (source_contact_id / email /
 *     linkedin_url), espejo de `buildApolloPhoneRevealMatchParams`.
 *   - La elegibilidad NO exige `account_id` (el server revalida la cuenta).
 *   - La elegibilidad NO exige que la fuente sea Apollo (ni Lusha): el reveal se
 *     ofrece por identidad, no por proveedor de origen.
 *   - Se mantienen los gates de crédito (flag), rol y re-reveal.
 *   - No se debilitan las invariantes de privacidad del cliente (sin process.env,
 *     sin NEXT_PUBLIC, sin console.*, sin bulk, sin HubSpot).
 *
 * LUSHA-PHONE-FALLBACK-1 (posterior): el detalle SÍ ahora ofrece, tras
 * `no_phone_found` de Apollo, un fallback manual admin-only que llama al
 * server action dedicado `revealCandidatePhoneViaLushaFallbackAction` (nunca
 * `isLushaPhoneRevealEnabled` ni un reveal Lusha ad-hoc fuera de ese wrapper).
 * El test de "no toca Lusha reveal" de más abajo se actualizó para permitir
 * ESE wrapper específico, no cualquier acceso a Lusha.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const componentsDir = join(here, '..');

function readComponent(relative: string): string {
  return readFileSync(join(componentsDir, relative), 'utf8');
}

/** Elimina comentarios para vigilar CÓDIGO, no prosa. Conserva `https://`. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const detailSheet = readComponent('contact-candidate-detail-sheet.tsx');
const detailSheetCode = stripComments(detailSheet);

/** Bloque asignado a `const canOfferPhoneReveal = ...;` (sin comentarios). */
function eligibilityBlock(source: string): string {
  const match = source.match(/const\s+canOfferPhoneReveal\s*=([\s\S]*?);/);
  return match ? match[1] : '';
}

/** Bloque del helper de identidad `const hasSufficientPhoneRevealIdentity = ...;`. */
function identityBlock(source: string): string {
  const match = source.match(/const\s+hasSufficientPhoneRevealIdentity\s*=([\s\S]*?);/);
  return match ? match[1] : '';
}

describe('PHONE-3D.6B — elegibilidad por identidad, no por proveedor', () => {
  const eligibility = eligibilityBlock(detailSheetCode);
  const identity = identityBlock(detailSheetCode);

  it('define y usa una señal de identidad suficiente en la elegibilidad', () => {
    assert.notEqual(identity, '', 'falta el helper hasSufficientPhoneRevealIdentity');
    assert.ok(eligibility.includes('hasSufficientPhoneRevealIdentity'));
  });

  it('la señal de identidad mira source_contact_id, email y linkedin_url', () => {
    assert.ok(/source_contact_id/.test(identity));
    assert.ok(/email/.test(identity));
    assert.ok(/linkedin_url/.test(identity));
  });

  it('la elegibilidad NO exige account_id (el server revalida la cuenta)', () => {
    assert.equal(/account_id/.test(eligibility), false, 'la elegibilidad no debe depender de account_id');
  });

  it('la elegibilidad NO exige que la fuente sea Apollo ni Lusha', () => {
    assert.equal(/source\s*===\s*['"]apollo['"]/.test(eligibility), false);
    assert.equal(/source\s*===\s*['"]lusha['"]/.test(eligibility), false);
    assert.equal(/\.source\b/.test(eligibility), false, 'la elegibilidad no debe leer candidate.source');
  });

  it('mantiene los gates de crédito (flag), rol y re-reveal', () => {
    assert.ok(/phoneRevealEnabled\s*===\s*true/.test(eligibility));
    assert.ok(/phoneRevealAuthorized\s*===\s*true/.test(eligibility));
    assert.ok(/!phoneAlreadyRevealed/.test(eligibility));
    assert.ok(/!phoneRevealExhausted/.test(eligibility));
  });
});

describe('PHONE-3D.6B — invariantes de privacidad/seguridad no debilitadas', () => {
  it('no lee el flag desde el cliente: sin process.env ni NEXT_PUBLIC_*', () => {
    assert.equal(/process\.env/.test(detailSheetCode), false);
    assert.equal(/NEXT_PUBLIC_[A-Z_]*PHONE_REVEAL/.test(detailSheetCode), false);
  });

  it('no imprime nada por consola', () => {
    assert.equal(/console\.(log|info|debug|warn|error)\s*\(/.test(detailSheetCode), false);
  });

  it('no introduce bulk reveal (acción individual por candidato)', () => {
    assert.equal(/candidateIds|bulkReveal|revealMany|revealAll/i.test(detailSheetCode), false);
  });

  it('never touches the old hard-off Lusha phone flag, and only calls Lusha through the dedicated fallback action', () => {
    // isLushaPhoneRevealEnabled() is the hardcoded `false` ban on the
    // email-only V3 client — must never be referenced from the client.
    assert.equal(/isLushaPhoneRevealEnabled/.test(detailSheetCode), false);
    // LUSHA-PHONE-FALLBACK-1: the ONLY sanctioned Lusha call surface from this
    // component is the dedicated action wrapper, by its exact name. Any OTHER
    // "reveal via Lusha"-shaped identifier (ad-hoc, differently named) is
    // still banned — this asserts the wrapper is used, and nothing else.
    const lushaRevealMentions = detailSheetCode.match(/revealCandidatePhoneViaLusha\w*/g) ?? [];
    for (const mention of lushaRevealMentions) {
      assert.equal(
        mention,
        'revealCandidatePhoneViaLushaFallbackAction',
        `unexpected Lusha reveal call surface: ${mention}`,
      );
    }
    assert.ok(lushaRevealMentions.length > 0, 'expected the dedicated action wrapper to be referenced');
  });

  it('does not write/sync HubSpot from the detail sheet', () => {
    // Showing the HubSpot Company ID (or the `lusha_reveal` source label) is
    // legitimate; forbidden is importing/calling HubSpot integrations or
    // syncing contacts from the client.
    assert.equal(/from\s+['"]@\/server\/integrations\/hubspot/i.test(detailSheetCode), false);
    assert.equal(/syncHubspot|syncToHubspot|hubspotClient|createHubspot/i.test(detailSheetCode), false);
  });

  it('no expone reveal_phone_number en el cliente (vive solo en el helper 3D.1)', () => {
    assert.equal(/reveal_phone_number/.test(detailSheetCode), false);
  });
});
