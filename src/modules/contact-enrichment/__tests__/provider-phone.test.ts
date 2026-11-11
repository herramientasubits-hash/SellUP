import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readProviderPhone } from '../provider-phone';

describe('readProviderPhone — «Teléfono Apollo / Lusha» (164)', () => {
  it('lee número, tipo y fuente', () => {
    assert.deepEqual(
      readProviderPhone({ provider_phone: { number: ' +18095550199 ', type: 'mobile', source: 'apollo_reveal' } }, '+1 809 555 0101'),
      { number: '+18095550199', type: 'mobile', source: 'apollo_reveal' },
    );
  });

  it('sin metadata, sin clave o sin número → null', () => {
    assert.equal(readProviderPhone(null), null);
    assert.equal(readProviderPhone({}), null);
    assert.equal(readProviderPhone({ provider_phone: { number: '   ' } }), null);
    assert.equal(readProviderPhone({ provider_phone: 'x' }), null);
  });

  it('si es el mismo número que ya se muestra en «Teléfono», no se repite', () => {
    assert.equal(readProviderPhone({ provider_phone: { number: '+1 809-555-0101' } }, '+18095550101'), null);
  });
});
