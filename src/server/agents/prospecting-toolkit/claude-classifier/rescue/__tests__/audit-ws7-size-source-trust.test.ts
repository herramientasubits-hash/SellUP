/**
 * AUDIT-A1-WS7 (16-10) — Claude ya no descarta por tamaño con una cita no
 * comprobada de una página que puede ser de OTRA empresa.
 *
 * `source_listed` (la URL salió en la búsqueda pero la cita no se encontró) sólo
 * descarta si la fuente es el LinkedIn verificado de esta empresa o su sitio
 * oficial; si no, la fila queda con el aviso `size_warning`.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { isTrustedSizeSource, rangeProvesBelowThreshold } from '../rescue-decision';
import { buildRescueMetadata } from '../rescue-patch';

const trust = {
  verifiedLinkedInUrl: 'https://www.linkedin.com/company/acme-peru',
  officialPageUrl: 'https://www.acme.pe/inicio',
};

describe('isTrustedSizeSource', () => {
  it('LinkedIn verificado de la empresa (con o sin subdominio de país)', () => {
    assert.equal(isTrustedSizeSource('https://pe.linkedin.com/company/acme-peru', trust), true);
    assert.equal(isTrustedSizeSource('https://www.linkedin.com/company/acme-peru/about/', trust), true);
  });

  it('otro LinkedIn, o sin LinkedIn verificado ⇒ no', () => {
    assert.equal(isTrustedSizeSource('https://www.linkedin.com/company/acme-chile', trust), false);
    assert.equal(isTrustedSizeSource('https://www.linkedin.com/company/acme-peru', { ...trust, verifiedLinkedInUrl: null }), false);
  });

  it('sitio oficial sí; directorio o noticia no', () => {
    assert.equal(isTrustedSizeSource('https://acme.pe/nosotros', trust), true);
    assert.equal(isTrustedSizeSource('https://www.directorio.example/acme', trust), false);
    assert.equal(isTrustedSizeSource(null, trust), false);
    assert.equal(isTrustedSizeSource('https://acme.pe/', null), false);
  });
});

describe('rangeProvesBelowThreshold con fuente listada', () => {
  const range = { max: 50, verification: 'source_listed', confidence: 0.9 };
  it('sólo con fuente de la empresa', () => {
    assert.equal(rangeProvesBelowThreshold({ ...range, sourceUrl: 'https://pe.linkedin.com/company/acme-peru' }, 200, trust), true);
    assert.equal(rangeProvesBelowThreshold({ ...range, sourceUrl: 'https://pe.linkedin.com/company/otra' }, 200, trust), false);
    assert.equal(rangeProvesBelowThreshold({ ...range, sourceUrl: 'https://pe.linkedin.com/company/acme-peru' }, 200), false);
  });
  it('la cita comprobada no cambia', () => {
    assert.equal(rangeProvesBelowThreshold({ max: 50, verification: 'quote_verified', confidence: 0.7 }, 200), true);
  });
});

describe('aviso en la metadata del rescate', () => {
  it('admit con tamaño bajo sin confirmar ⇒ size_warning', () => {
    const meta = buildRescueMetadata(
      { kind: 'admit', sectorConfirmed: true, sizeConfirmed: false, linkedinConfirmed: false, sizeBelowMinUnconfirmed: true },
      [],
      '2026-10-16T00:00:00.000Z',
    );
    assert.equal(meta.size_warning, 'claude_size_below_min_unconfirmed');
    const clean = buildRescueMetadata(
      { kind: 'admit', sectorConfirmed: true, sizeConfirmed: false, linkedinConfirmed: false },
      [],
      '2026-10-16T00:00:00.000Z',
    );
    assert.equal('size_warning' in clean, false);
  });
});
