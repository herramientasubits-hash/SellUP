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
 *     sin NEXT_PUBLIC, sin console.*, sin bulk, sin Lusha reveal, sin HubSpot).
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

  it('no toca Lusha reveal ni escribe/sincroniza HubSpot desde el detalle', () => {
    // Mostrar el HubSpot Company ID (o el label de fuente `lusha_reveal`) es
    // legítimo; lo prohibido es habilitar/llamar un reveal Lusha o importar/llamar
    // integraciones de HubSpot y sincronizar contactos desde el cliente.
    assert.equal(/isLushaPhoneRevealEnabled|revealCandidatePhoneViaLusha|lushaPhoneReveal/i.test(detailSheetCode), false);
    assert.equal(/from\s+['"]@\/server\/integrations\/hubspot/i.test(detailSheetCode), false);
    assert.equal(/syncHubspot|syncToHubspot|hubspotClient|createHubspot/i.test(detailSheetCode), false);
  });

  it('no expone reveal_phone_number en el cliente (vive solo en el helper 3D.1)', () => {
    assert.equal(/reveal_phone_number/.test(detailSheetCode), false);
  });
});
