/**
 * Agente 2A — el copy del reveal post-aprobación
 * (AGENT2A-POST-APPROVAL-OFFICIAL-CONTACT-PHONE-REVEAL-1).
 *
 * Se prueba palabra por palabra porque es el texto que le PROMETE UN GASTO a un operador. Dos
 * propiedades importan más que el estilo:
 *
 *   * cuando el servidor no dio un tope, el copy NO escribe una cifra. Un suelo inventado menor
 *     que el real hace que el arranque rechace la autorización por techo; uno mayor le promete al
 *     operador un gasto que nadie va a reservar;
 *   * la reutilización se etiqueta como GRATIS y de forma explícita. Un número que la operación ya
 *     pagó no se puede presentar como una compra nueva.
 *
 * Sin red, sin DOM, sin proveedores, 0 créditos.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  OFFICIAL_REVEAL_ERROR_COPY,
  OFFICIAL_REVEAL_IN_FLIGHT_COPY,
  OFFICIAL_REVEAL_NO_PHONE_COPY,
  OFFICIAL_REVEAL_PROJECTED_COPY,
  officialRevealHelperText,
  officialRevealOutcomeText,
  officialRevealUnavailableText,
} from '../post-approval-reveal-copy';
import type { OfficialContactPhoneRevealOfferView } from '@/modules/contact-enrichment/post-approval-reveal-core';

const view = (
  over: Partial<OfficialContactPhoneRevealOfferView> = {},
): OfficialContactPhoneRevealOfferView => ({
  status: 'eligible',
  actionable: true,
  free: false,
  maxCredits: 14,
  requiresIdentitySearch: true,
  lushaEligible: true,
  ...over,
});

describe('el texto que precede al gasto', () => {
  it('el caso Priscilla: nombra las dos patas y el tope 14', () => {
    const text = officialRevealHelperText(view());
    assert.match(text, /Apollo/);
    assert.match(text, /Lusha/);
    assert.match(text, /hasta 14 créditos/);
  });

  it('sin búsqueda de identidad no promete un crédito de búsqueda', () => {
    const text = officialRevealHelperText(
      view({ maxCredits: 13, requiresIdentitySearch: false }),
    );
    assert.match(text, /hasta 13 créditos/);
    assert.equal(/búsqueda de identidad/.test(text), false);
  });

  it('sin pata Lusha sólo nombra Apollo', () => {
    const text = officialRevealHelperText(
      view({ maxCredits: 8, lushaEligible: false, requiresIdentitySearch: false }),
    );
    assert.match(text, /hasta 8 créditos/);
    assert.equal(/Lusha/.test(text), false);
  });

  it('sin tope del servidor NO se escribe ninguna cifra', () => {
    const text = officialRevealHelperText(view({ maxCredits: null }));
    assert.equal(/\d/.test(text), false, 'ni un dígito: el número lo confirma el servidor');
    assert.match(text, /se confirma en el servidor/);
  });

  it('la reutilización se etiqueta SIN COSTO y de forma explícita', () => {
    const text = officialRevealHelperText(
      view({ status: 'reuse_from_candidate', free: true, maxCredits: 0 }),
    );
    assert.match(text, /Sin costo/);
    assert.match(text, /ya fue obtenido y pagado/);
    assert.equal(/crédito/.test(text), false, 'no se menciona un gasto que no existe');
  });
});

describe('por qué NO se ofrece nada', () => {
  it('un contacto que ya tiene teléfono recibe una explicación y una salida', () => {
    const text = officialRevealUnavailableText('phone_already_present');
    assert.ok(text);
    assert.match(text, /ya tiene un teléfono/);
  });

  for (const status of [
    'missing_source_candidate',
    'contact_archived',
    'contact_unavailable',
    'eligible',
    'reuse_from_candidate',
  ] as const) {
    it(`${status} no pinta ningún aviso`, () => {
      // Anunciar «no se puede revelar» en cada contacto del sistema sería ruido, y en el caso sin
      // candidato fuente además sería contarle al operador algo que no puede accionar.
      assert.equal(officialRevealUnavailableText(status), null);
    });
  }
});

describe('el desenlace de un clic', () => {
  it('el teléfono llegó a la ficha: se dice así', () => {
    assert.equal(
      officialRevealOutcomeText({
        ok: true,
        gate: 'delegated',
        revealStatus: 'revealed_from_cache',
        phoneProjected: true,
      }),
      OFFICIAL_REVEAL_PROJECTED_COPY,
    );
  });

  it('`requested` NO se presenta como revelado', () => {
    const text = officialRevealOutcomeText({
      ok: true,
      gate: 'delegated',
      revealStatus: 'requested',
      phoneProjected: false,
    });
    assert.equal(text, OFFICIAL_REVEAL_IN_FLIGHT_COPY);
    assert.equal(/revelado|guardado/.test(text), false);
  });

  it('el proveedor cerró sin número: es un resultado, no un error', () => {
    assert.equal(
      officialRevealOutcomeText({
        ok: false,
        gate: 'delegated',
        revealStatus: 'no_phone_found',
        phoneProjected: false,
      }),
      OFFICIAL_REVEAL_NO_PHONE_COPY,
    );
  });

  it('cualquier otro fallo usa un texto genérico y sin datos de la persona', () => {
    const text = officialRevealOutcomeText({
      ok: false,
      gate: 'delegated',
      revealStatus: 'insufficient_credits',
      phoneProjected: false,
    });
    assert.equal(text, OFFICIAL_REVEAL_ERROR_COPY);
  });

  it('ningún texto del módulo contiene un número de teléfono', () => {
    for (const text of [
      OFFICIAL_REVEAL_PROJECTED_COPY,
      OFFICIAL_REVEAL_IN_FLIGHT_COPY,
      OFFICIAL_REVEAL_NO_PHONE_COPY,
      OFFICIAL_REVEAL_ERROR_COPY,
    ]) {
      assert.equal(/\+?\d{6,}/.test(text), false);
    }
  });
});
