/**
 * Encontrar la empresa en Merco / Great Place to Work aunque el nombre no sea idéntico
 * (Davivienda, 19-10), sin mezclar empresas distintas.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { curatedCoreName, curatedNamesMatch } from '../curated-match';

describe('núcleo del nombre para las listas cargadas', () => {
  it('quita el país, la forma jurídica y los prefijos genéricos', () => {
    assert.equal(curatedCoreName('Davivienda Colombia'), 'DAVIVIENDA');
    assert.equal(curatedCoreName('BANCO DAVIVIENDA S.A.'), 'DAVIVIENDA');
    assert.equal(curatedCoreName('Grupo LALA, S.A.B. de C.V.'), 'LALA');
    assert.equal(curatedCoreName('Itaú Colombia'), 'ITAU');
    assert.equal(curatedCoreName('Nestlé de México'), 'NESTLE');
    assert.equal(curatedCoreName('Novartis México'), 'NOVARTIS');
    assert.equal(curatedCoreName('Grupo Ciisa'), 'CIISA');
  });

  it('coincide la misma empresa escrita distinto (el caso de Prod)', () => {
    assert.ok(curatedNamesMatch('Davivienda Colombia', 'DAVIVIENDA'));
    assert.ok(curatedNamesMatch('Davivienda Colombia', 'BANCO DAVIVIENDA'));
    assert.ok(curatedNamesMatch('Grupo LALA', 'LALA'));
  });

  it('no mezcla empresas que sólo comparten una palabra o un núcleo corto', () => {
    assert.equal(curatedNamesMatch('Grupo Éxito', 'Éxito Viajes'), false);
    assert.equal(curatedNamesMatch('Itaú Colombia', 'Itaú Corpbanca'), false);
    assert.equal(curatedNamesMatch('Banco de Bogotá', 'Bogotá Beer Company'), false);
    // «Grupo Sura» → «SURA» sí; «Grupo AB» → «AB» es demasiado corto para coincidir solo.
    assert.equal(curatedNamesMatch('Grupo AB', 'AB'), false);
    assert.equal(curatedNamesMatch('', ''), false);
  });
});

describe('núcleos que son palabras comunes (revisión 19-10)', () => {
  it('«Banco de Chile» o «Grupo Éxito» no coinciden por «BANCO» o «EXITO» solos', async () => {
    assert.equal(curatedNamesMatch('Banco de Chile', 'BANCO'), false);
    assert.equal(curatedNamesMatch('Grupo Éxito', 'ÉXITO'), false);
    const { mentionsCompany } = await import('../contact-research');
    assert.equal(mentionsCompany('El banco anunció nuevos nombramientos en talento.', 'Banco de Chile'), false);
    assert.equal(mentionsCompany('Tuvo éxito en su gestión de talento.', 'Grupo Éxito'), false);
    assert.ok(mentionsCompany('El Banco de Chile nombró a su gerenta de personas.', 'Banco de Chile'));
    assert.ok(mentionsCompany('Grupo Éxito nombró a su vicepresidenta de talento.', 'Grupo Éxito'));
  });
});
