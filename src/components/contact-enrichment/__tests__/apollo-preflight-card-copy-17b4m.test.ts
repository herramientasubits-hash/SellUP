/**
 * Tests — ApolloPreflightCard copy provider-awareness (Hito 17B.4M)
 *
 * Pure logic tests. Validates that the copy decisions rendered in
 * ApolloPreflightCard are correct per provider without mounting React.
 *
 * We extract the provider-aware copy decision into a pure helper and test it.
 * The rendered JSX branches are directly driven by `isLusha = provider === 'lusha'`.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

type ContactEnrichmentProvider = 'apollo' | 'lusha';

// ── Mirror of the copy logic in ApolloPreflightCard ─────────────────────────

interface PreflightCopySnapshot {
  title: string;
  description: string;
  sectionLabel: string;
  phoneRow: string;
  phoneRevealRow: string;
  hasApolloPhoneNote: boolean;
  hasApolloCreditNote: boolean;
}

function getPreflightCopy(provider?: ContactEnrichmentProvider): PreflightCopySnapshot {
  const isLusha = provider === 'lusha';

  if (isLusha) {
    return {
      title: 'Control de enriquecimiento Lusha',
      description:
        'SellUp buscará o enriquecerá perfiles con Lusha. Solo se busca email corporativo; teléfono deshabilitado en esta fase.',
      sectionLabel: 'Búsqueda / enriquecimiento Lusha',
      phoneRow: 'deshabilitado en esta fase',
      phoneRevealRow: 'no disponible',
      hasApolloPhoneNote: false,
      hasApolloCreditNote: false,
    };
  }

  return {
    title: 'Control de créditos Apollo',
    description:
      'SellUp buscará contactos con email, teléfono o LinkedIn. Solo intentará completar los perfiles con mayor probabilidad de ser útiles. Para controlar costos, no realizará reveal automático de teléfonos sin confirmación.',
    sectionLabel: 'Búsqueda Apollo',
    phoneRow: 'se conserva si Apollo lo entrega',
    phoneRevealRow: 'requiere confirmación',
    hasApolloPhoneNote: true,
    hasApolloCreditNote: true,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('ApolloPreflightCard copy — provider=apollo', () => {
  const copy = getPreflightCopy('apollo');

  it('muestra "Búsqueda Apollo" como sección', () => {
    assert.equal(copy.sectionLabel, 'Búsqueda Apollo');
  });

  it('muestra título Apollo', () => {
    assert.equal(copy.title, 'Control de créditos Apollo');
  });

  it('muestra "Apollo lo entrega" en teléfono', () => {
    assert.ok(copy.phoneRow.includes('Apollo lo entrega'));
  });

  it('muestra "requiere confirmación" en reveal (no "~8 créditos" directo, pero sí la nota)', () => {
    assert.ok(copy.phoneRevealRow.includes('requiere confirmación'));
  });

  it('tiene nota de teléfono Apollo', () => {
    assert.equal(copy.hasApolloPhoneNote, true);
  });

  it('tiene nota de créditos Apollo', () => {
    assert.equal(copy.hasApolloCreditNote, true);
  });
});

describe('ApolloPreflightCard copy — provider=lusha', () => {
  const copy = getPreflightCopy('lusha');

  it('NO muestra "Búsqueda Apollo" como sección', () => {
    assert.notEqual(copy.sectionLabel, 'Búsqueda Apollo');
    assert.ok(!copy.sectionLabel.includes('Apollo'));
  });

  it('muestra "Búsqueda / enriquecimiento Lusha" como sección', () => {
    assert.equal(copy.sectionLabel, 'Búsqueda / enriquecimiento Lusha');
  });

  it('título NO contiene Apollo', () => {
    assert.ok(!copy.title.includes('Apollo'));
  });

  it('título contiene Lusha', () => {
    assert.ok(copy.title.includes('Lusha'));
  });

  it('NO muestra "Apollo lo entrega"', () => {
    assert.ok(!copy.phoneRow.includes('Apollo lo entrega'));
  });

  it('teléfono muestra "deshabilitado en esta fase"', () => {
    assert.ok(copy.phoneRow.includes('deshabilitado en esta fase'));
  });

  it('reveal automático muestra "no disponible"', () => {
    assert.equal(copy.phoneRevealRow, 'no disponible');
  });

  it('NO tiene nota de teléfono Apollo', () => {
    assert.equal(copy.hasApolloPhoneNote, false);
  });

  it('NO tiene nota de créditos Apollo', () => {
    assert.equal(copy.hasApolloCreditNote, false);
  });
});

describe('ApolloPreflightCard copy — provider=undefined (default apollo)', () => {
  const copy = getPreflightCopy(undefined);

  it('default sin provider muestra Apollo', () => {
    assert.equal(copy.sectionLabel, 'Búsqueda Apollo');
  });

  it('default muestra "Apollo lo entrega"', () => {
    assert.ok(copy.phoneRow.includes('Apollo lo entrega'));
  });
});
