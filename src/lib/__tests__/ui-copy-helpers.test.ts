/**
 * Los textos que ve la persona: dinero, roles y errores, iguales en toda la app.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatUSD } from '../format-money';
import { mensajeDeError } from '../friendly-error';
import { roleLabelFor } from '../../modules/access/role-labels';

describe('formatUSD', () => {
  it('usa el formato es-CO con el prefijo pegado', () => {
    assert.equal(formatUSD(1234.5), 'US$1.234,50');
    assert.equal(formatUSD(0.25), 'US$0,25');
  });

  it('debajo de un centavo muestra 4 decimales en vez de US$0,00', () => {
    assert.equal(formatUSD(0.0042), 'US$0,0042');
  });

  it('sin dato devuelve el texto de reemplazo', () => {
    assert.equal(formatUSD(null), '—');
    assert.equal(formatUSD(undefined, 'No disponible'), 'No disponible');
    assert.equal(formatUSD(Number.NaN), '—');
  });
});

describe('roleLabelFor', () => {
  it('nombra los roles en español, nunca con la clave cruda', () => {
    assert.equal(roleLabelFor('seller_bd'), 'Vendedor / BD');
    assert.equal(roleLabelFor('commercial_manager'), 'Manager comercial');
    assert.equal(roleLabelFor('growth'), 'Growth');
  });

  it('sin rol es «Miembro»', () => {
    assert.equal(roleLabelFor(null), 'Miembro');
  });
});

describe('mensajeDeError', () => {
  it('no muestra el mensaje técnico del error: da la frase de la pantalla', () => {
    const original = console.error;
    console.error = () => {};
    try {
      const texto = mensajeDeError(new Error('PGRST116: JSON object requested, multiple rows'), 'No se pudo importar');
      assert.ok(texto.startsWith('No se pudo importar.'));
      assert.ok(!texto.includes('PGRST116'));
    } finally {
      console.error = original;
    }
  });
});
