import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  APP_TIME_ZONE,
  EMPTY_DATE_LABEL,
  appDayKey,
  formatAppDate,
  formatAppDateTime,
  formatAppTime,
  formatInAppZone,
  withAppTimeZone,
} from '../format-date';

// 27 de septiembre a las 02:30 UTC = 26 de septiembre a las 21:30 en Bogotá.
// Es el caso que rompía la hidratación: el servidor (UTC) escribía «27» y el
// navegador «26».
const NEAR_MIDNIGHT_UTC = '2026-09-27T02:30:00.000Z';

describe('format-date', () => {
  it('usa la zona de Bogotá aunque el proceso corra en otra zona', () => {
    const formatted = formatAppDate(NEAR_MIDNIGHT_UTC);

    assert.match(formatted, /26/);
    assert.doesNotMatch(formatted, /27/);
  });

  it('da el mismo texto sea cual sea la zona del proceso', () => {
    const previous = process.env.TZ;
    try {
      process.env.TZ = 'UTC';
      const inUtc = formatAppDateTime(NEAR_MIDNIGHT_UTC);
      process.env.TZ = 'Asia/Tokyo';
      const inTokyo = formatAppDateTime(NEAR_MIDNIGHT_UTC);

      assert.equal(inUtc, inTokyo);
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });

  it('devuelve el marcador vacío cuando no hay fecha', () => {
    assert.equal(formatAppDate(null), EMPTY_DATE_LABEL);
    assert.equal(formatAppDate(undefined), EMPTY_DATE_LABEL);
    assert.equal(formatAppDate(''), EMPTY_DATE_LABEL);
  });

  it('devuelve el marcador vacío cuando la fecha no se puede leer', () => {
    assert.equal(formatAppDate('no-es-una-fecha'), EMPTY_DATE_LABEL);
  });

  it('respeta el marcador vacío que pasa quien llama', () => {
    assert.equal(formatAppDate(null, 'Sin fecha'), 'Sin fecha');
    assert.equal(formatInAppZone(null, {}, 'es-CO', 'Nunca'), 'Nunca');
  });

  it('acepta Date, número y cadena para el mismo instante', () => {
    const asDate = new Date(NEAR_MIDNIGHT_UTC);

    assert.equal(formatAppDate(asDate), formatAppDate(NEAR_MIDNIGHT_UTC));
    assert.equal(formatAppDate(asDate.getTime()), formatAppDate(NEAR_MIDNIGHT_UTC));
  });

  it('formatea la hora en la zona de la aplicación', () => {
    const formatted = formatAppTime(NEAR_MIDNIGHT_UTC);

    assert.match(formatted, /9:30/);
  });

  it('deja que las opciones cambien la zona cuando se pide otra a propósito', () => {
    const options = withAppTimeZone({ timeZone: 'UTC', day: 'numeric' });

    assert.equal(options.timeZone, 'UTC');
    assert.equal(formatInAppZone(NEAR_MIDNIGHT_UTC, { timeZone: 'UTC', day: 'numeric' }), '27');
  });

  it('añade la zona de la aplicación cuando las opciones no traen una', () => {
    assert.equal(withAppTimeZone({ day: 'numeric' }).timeZone, APP_TIME_ZONE);
    assert.equal(withAppTimeZone().timeZone, APP_TIME_ZONE);
  });

  it('calcula el día de calendario en la zona de la aplicación', () => {
    assert.equal(appDayKey(NEAR_MIDNIGHT_UTC), '2026-09-26');
    assert.equal(appDayKey(null), null);
    assert.equal(appDayKey('no-es-una-fecha'), null);
  });
});
