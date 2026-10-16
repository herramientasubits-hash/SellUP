/**
 * SOURCES-CO-CLOSE-1 — el directorio de entidades públicas (CHIP + SIGEP II) se
 * arma con una fila por NIT, la web de la propia entidad y sus servidores.
 * Filas con la forma real de datos.gov.co (5c7g-ptic, h8rs-jxum).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCoPublicEntityRows,
  buildCoPublicEntityRowsWithReport,
  classifyNaturaleza,
  fixMojibake,
  nitCheckDigit,
  normalizeEntityNit,
  sigepEntityName,
  type ChipEntityRow,
  type SigepEntityRow,
} from '../co-public-entity-rows';
import { workforceFromRawData } from '@/server/prospect-batches/snapshot-name-query';

const chip = (overrides: Partial<ChipEntityRow>): ChipEntityRow => ({
  a_o: '2026',
  periodo: 'ENERO-MARZO',
  nit: '800099095:7',
  razon_social: 'Ipiales',
  ciudad: 'IPIALES',
  departamento: 'DEPARTAMENTO DE NARIÑO',
  e_mail: 'contabilidad@ipiales-narino.gov.co',
  p_gina_web: { url: 'http://www.ipiales-narino.gov.co/' },
  ...overrides,
});

const sigep = (overrides: Partial<SigepEntityRow>): SigepEntityRow => ({
  nit: '800099095',
  nombre_de_la_entidad: 'ALCALDIA DE IPIALES',
  naturaleza_jur_dica: 'ALCALDÃ\u008dA',
  orden: 'TERRITORIAL',
  a_o: '2026',
  mes: '6',
  genero_hombre: '80',
  genero_mujer: '70',
  genero_no_binario: '0',
  ...overrides,
});

describe('piezas', () => {
  it('arregla el texto del SIGEP leído como Latin-1', () => {
    assert.equal(fixMojibake('ALCALDÃ\u008dA'), 'ALCALDÍA');
    assert.equal(fixMojibake('GOBERNACIÃ“N'), 'GOBERNACIÓN');
    assert.equal(fixMojibake('MINISTERIO'), 'MINISTERIO');
  });

  it('nombre del SIGEP sin el número de orden pegado al final', () => {
    assert.equal(sigepEntityName('DIRECCION GENERAL DE LA POLICIA NACIONAL 1'), 'DIRECCION GENERAL DE LA POLICIA NACIONAL');
    assert.equal(sigepEntityName('ALCALDIA DE IPIALES'), 'ALCALDIA DE IPIALES');
    assert.equal(sigepEntityName('INSTITUTO 1 DE MAYO'), 'INSTITUTO 1 DE MAYO');
  });

  it('NIT: con dígito de verificación separado o pegado (sólo si cuadra)', () => {
    assert.equal(nitCheckDigit('800099095'), '7');
    assert.equal(normalizeEntityNit('800099095:7'), '800099095');
    assert.equal(normalizeEntityNit('800099095-7'), '800099095');
    assert.equal(normalizeEntityNit('8000990957'), '800099095');
    assert.equal(normalizeEntityNit('8000990951'), null);
    assert.equal(normalizeEntityNit('101010101'), null);
    assert.equal(normalizeEntityNit('000000000'), null);
  });

  it('naturaleza jurídica → macro y cabeza', () => {
    assert.deepEqual(classifyNaturaleza('ALCALDÍA'), { macro: 'government', head: true });
    assert.deepEqual(classifyNaturaleza('GOBERNACIÓN'), { macro: 'government', head: true });
    assert.deepEqual(classifyNaturaleza('PERSONERÍA MUNICIPAL'), { macro: 'government', head: false });
    assert.deepEqual(classifyNaturaleza('EMPRESAS SOCIALES DEL ESTADO'), { macro: 'health_pharma', head: false });
    assert.deepEqual(classifyNaturaleza('EMPRESA DE SERVICIOS PUBLICOS DOMICILIARIO OFICIAL'), { macro: 'energy_mining_environment', head: false });
    assert.deepEqual(classifyNaturaleza('ENTE UNIVERSITARIO AUTÓNOMO'), { macro: null, head: false });
  });
});

describe('buildCoPublicEntityRows', () => {
  it('una fila por NIT con la web, los servidores sumados y el nombre de la cabeza', () => {
    const rows = buildCoPublicEntityRows(
      [chip({ a_o: '2025', periodo: 'OCTUBRE-DICIEMBRE', p_gina_web: null }), chip({})],
      [
        sigep({}),
        sigep({ nombre_de_la_entidad: 'CONCEJO DE IPIALES', naturaleza_jur_dica: 'CONCEJO MUNICIPAL', genero_hombre: '5', genero_mujer: '3' }),
      ],
    );
    assert.equal(rows.length, 1);
    const [row] = rows;
    assert.equal(row.record_identity_key, 'tax:800099095');
    // El CHECK `source_company_snapshots_source_period_format_chk` rechaza texto libre.
    assert.equal(row.source_period, null);
    assert.equal(row.tax_id, '800099095');
    assert.equal(row.legal_name, 'ALCALDIA DE IPIALES');
    assert.equal(row.normalized_legal_name, 'ALCALDIA DE IPIALES');
    assert.equal(row.priority_score, 158);
    assert.equal(row.raw_data.workers, 158);
    assert.equal(row.raw_data.metrics_year, 2026);
    assert.equal(row.raw_data.website_domain, 'ipiales-narino.gov.co');
    assert.equal(row.raw_data.website_domain_source, 'chip_web');
    assert.equal(row.raw_data.macro_industry_key, 'government');
    assert.equal(row.raw_data.entity_head, true);
    assert.equal(row.raw_data.naturaleza, 'ALCALDÍA');
    // El tamaño viaja por el mismo camino que el SII de Chile.
    assert.deepEqual(workforceFromRawData(row.raw_data, 'co_public_entities', 2026), {
      workers: 158,
      year: 2026,
      source: 'co_public_entities',
      salesBracket: null,
    });
  });

  it('sin web publicada, el correo institucional; nunca uno gratuito', () => {
    const rows = buildCoPublicEntityRows(
      [
        chip({ nit: '800111111', p_gina_web: null, e_mail: 'tesoreria@x-municipio.gov.co' }),
        chip({ nit: '800222222', p_gina_web: null, e_mail: 'financiera.terminal@hotmail.com' }),
        chip({ nit: '800333333', p_gina_web: null, e_mail: 'info@empresa-mixta.com.co' }),
      ],
      [],
    );
    assert.deepEqual(
      rows.map((r) => [r.tax_id, r.raw_data.website_domain, r.raw_data.website_domain_source]),
      [
        ['800111111', 'x-municipio.gov.co', 'chip_email'],
        ['800222222', null, null],
        ['800333333', null, null],
      ],
    );
  });

  it('sólo CHIP: sin servidores (nunca se ofrece), pero sirve para el NIT; municipio y departamento son cabeza', () => {
    const rows = buildCoPublicEntityRows(
      [
        chip({ nit: '890801146', razon_social: 'Marulanda', ciudad: 'MARULANDA' }),
        chip({ nit: '800103196', razon_social: 'Departamento del Guaviare', ciudad: 'SAN JOSE DEL GUAVIARE' }),
        chip({ nit: '860511071', razon_social: 'Fondo Rotatorio del Ministerio de Relaciones Exteriores', ciudad: 'BOGOTA' }),
      ],
      [],
    );
    const byNit = new Map(rows.map((r) => [r.tax_id, r]));
    assert.equal(byNit.get('890801146')?.raw_data.workers, null);
    assert.equal(byNit.get('890801146')?.priority_score, 0);
    assert.equal(byNit.get('890801146')?.raw_data.entity_head, true);
    assert.equal(byNit.get('890801146')?.raw_data.macro_industry_key, 'government');
    assert.equal(byNit.get('800103196')?.raw_data.entity_head, true);
    assert.equal(byNit.get('860511071')?.raw_data.entity_head, false);
    assert.equal(byNit.get('860511071')?.raw_data.macro_industry_key, null);
  });

  it('sólo SIGEP: entra sin web; NIT inválidos fuera', () => {
    const rows = buildCoPublicEntityRows(
      [chip({ nit: '000000000' })],
      [sigep({ nit: '899999003', nombre_de_la_entidad: 'MINISTERIO DE DEFENSA NACIONAL', naturaleza_jur_dica: 'MINISTERIO', genero_hombre: '600', genero_mujer: '52' })],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].tax_id, '899999003');
    assert.equal(rows[0].raw_data.website_domain, null);
    assert.equal(rows[0].raw_data.workers, 652);
    assert.equal(rows[0].raw_data.entity_head, true);
  });
});

describe('NIT compartido por entidades distintas en el SIGEP (MinSalud / MinTrabajo)', () => {
  // Forma real medida el 16-10-2026: el SIGEP captura el Ministerio de Salud con el NIT del
  // Ministerio del Trabajo; éste lo trae con el dígito de verificación pegado («8301152263»).
  const chipTrabajo = chip({ nit: '830115226:3', razon_social: 'Ministerio del Trabajo', ciudad: 'BOGOTA', p_gina_web: { url: 'https://www.mintrabajo.gov.co' } });
  const chipSalud = chip({ nit: '900474727:4', razon_social: 'Ministerio de Salud y Protección Social', ciudad: 'BOGOTA', p_gina_web: { url: 'https://www.minsalud.gov.co' } });
  const sigepTrabajo = sigep({ nit: '8301152263', nombre_de_la_entidad: 'MINISTERIO DEL TRABAJO', naturaleza_jur_dica: 'MINISTERIO', genero_hombre: '800', genero_mujer: '1081' });
  const sigepSalud = sigep({ nit: '830115226', nombre_de_la_entidad: 'MINISTERIO DE SALUD Y PROTECCION SOCIAL', naturaleza_jur_dica: 'MINISTERIO', genero_hombre: '250', genero_mujer: '309' });

  it('cada ministerio queda en su NIT con sus propios servidores (antes se fundían en uno)', () => {
    const { rows, nitCollisions } = buildCoPublicEntityRowsWithReport([chipTrabajo, chipSalud], [sigepSalud, sigepTrabajo]);
    const byNit = new Map(rows.map((r) => [r.tax_id, r]));
    assert.equal(rows.length, 2);
    assert.equal(byNit.get('830115226')?.normalized_legal_name, 'MINISTERIO DEL TRABAJO');
    assert.equal(byNit.get('830115226')?.raw_data.workers, 1881);
    assert.equal(byNit.get('900474727')?.normalized_legal_name, 'MINISTERIO DE SALUD Y PROTECCION SOCIAL');
    assert.equal(byNit.get('900474727')?.raw_data.workers, 559);
    assert.equal(byNit.get('900474727')?.raw_data.website_domain, 'minsalud.gov.co');
    assert.equal(byNit.get('900474727')?.raw_data.entity_head, true);
    assert.deepEqual(nitCollisions, [
      {
        nit: '830115226',
        resolution: 'resuelto',
        chipName: 'MINISTERIO DEL TRABAJO',
        kept: 'MINISTERIO DEL TRABAJO',
        moved: [{ name: 'MINISTERIO DE SALUD Y PROTECCION SOCIAL', toNit: '900474727', workers: 559 }],
        dropped: [],
      },
    ]);
  });

  it('el orden de las filas del SIGEP no cambia el resultado', () => {
    const a = buildCoPublicEntityRows([chipTrabajo, chipSalud], [sigepSalud, sigepTrabajo]);
    const b = buildCoPublicEntityRows([chipSalud, chipTrabajo], [sigepTrabajo, sigepSalud]);
    assert.deepEqual(a, b);
  });

  it('sin destino claro, la entidad ajena se saca del NIT (no suma servidores a la equivocada)', () => {
    const chipMaicao = chip({ nit: '892120020', razon_social: 'Maicao', ciudad: 'MAICAO' });
    const rows = buildCoPublicEntityRows(
      [chipMaicao],
      [
        sigep({ nit: '892120020', nombre_de_la_entidad: 'ALCALDIA DE MAICAO', genero_hombre: '40', genero_mujer: '40' }),
        sigep({ nit: '892120020', nombre_de_la_entidad: 'ALCALDIA DE BARAYA', genero_hombre: '5', genero_mujer: '5' }),
      ],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].legal_name, 'ALCALDIA DE MAICAO');
    assert.equal(rows[0].raw_data.workers, 80);
  });

  it('concejo y personería de la misma alcaldía siguen sumando (no son un choque)', () => {
    const { rows, nitCollisions } = buildCoPublicEntityRowsWithReport(
      [chip({})],
      [
        sigep({}),
        sigep({ nombre_de_la_entidad: 'CONCEJO DE IPIALES', naturaleza_jur_dica: 'CONCEJO MUNICIPAL', genero_hombre: '5', genero_mujer: '3' }),
        sigep({ nombre_de_la_entidad: 'PERSONERIA DE IPIALES', naturaleza_jur_dica: 'PERSONERÍA MUNICIPAL', genero_hombre: '4', genero_mujer: '4' }),
      ],
    );
    assert.equal(rows[0].raw_data.workers, 166);
    assert.deepEqual(nitCollisions, []);
  });

  it('sin choques, la salida es la de siempre (mismo resultado que buildCoPublicEntityRows)', () => {
    const rows = buildCoPublicEntityRows([chip({})], [sigep({})]);
    assert.deepEqual(buildCoPublicEntityRowsWithReport([chip({})], [sigep({})]).rows, rows);
  });
});

