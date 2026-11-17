/**
 * Todos los datos de HubSpot (dueña 17-11, FNL Laboratory): definiciones del portal +
 * valores del registro → secciones como en la ficha de HubSpot, sólo con lo que tiene dato.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  HUBSPOT_PROPERTY_VALUE_MAX_CHARS,
  buildPropertySections,
  filterPropertySections,
  formatPropertyValue,
  ownerIdsInValues,
  parsePropertyDefinitions,
  parsePropertyGroups,
  readablePropertyNames,
  type HubSpotPropertyDefinition,
} from '../hubspot-properties-core';

const def = (over: Partial<HubSpotPropertyDefinition> & { name: string }): HubSpotPropertyDefinition => ({
  label: over.name,
  groupName: 'companyinformation',
  type: 'string',
  fieldType: 'text',
  hidden: false,
  options: [],
  referencedObjectType: null,
  displayOrder: 0,
  ...over,
});

describe('definiciones del portal', () => {
  it('lee nombre, etiqueta, grupo y opciones; descarta lo que no tiene forma', () => {
    const defs = parsePropertyDefinitions({
      results: [
        { name: 'estado_de_atacabilidad', label: 'Estado de atacabilidad', groupName: 'calificacion', type: 'enumeration', fieldType: 'select', options: [{ value: 'si', label: 'Atacable' }] },
        { name: 'bad name;drop', label: 'x' },
        { label: 'sin nombre' },
        null,
      ],
    });
    assert.equal(defs.length, 1);
    assert.equal(defs[0].label, 'Estado de atacabilidad');
    assert.deepEqual(defs[0].options, [{ value: 'si', label: 'Atacable' }]);
    assert.deepEqual(parsePropertyDefinitions({ results: 'no' }), []);
  });

  it('pide sólo las visibles', () => {
    assert.deepEqual(readablePropertyNames([def({ name: 'a' }), def({ name: 'b', hidden: true })]), ['a']);
  });

  it('lee los grupos con su orden', () => {
    assert.deepEqual(parsePropertyGroups({ results: [{ name: 'g', label: 'Calificación de cuenta', displayOrder: 3 }, {}] }), [
      { name: 'g', label: 'Calificación de cuenta', displayOrder: 3 },
    ]);
  });
});

describe('valores legibles', () => {
  it('opciones por su etiqueta (también varias separadas por ;)', () => {
    const d = def({ name: 'area', type: 'enumeration', options: [{ value: 'rrhh', label: 'Recursos Humanos' }, { value: 'ti', label: 'Tecnología' }] });
    assert.deepEqual(formatPropertyValue(d, 'rrhh;ti'), { value: 'Recursos Humanos, Tecnología', kind: 'text' });
  });

  it('sí/no, dueños por su nombre y fechas en ISO', () => {
    assert.deepEqual(formatPropertyValue(def({ name: 'is_public', type: 'bool', fieldType: 'booleancheckbox' }), 'true'), { value: 'Sí', kind: 'text' });
    const owner = def({ name: 'hubspot_owner_id', type: 'enumeration', referencedObjectType: 'OWNER' });
    assert.deepEqual(formatPropertyValue(owner, '55', new Map([['55', 'Bastian Zambrano']])), { value: 'Bastian Zambrano', kind: 'text' });
    assert.deepEqual(formatPropertyValue(owner, '77'), { value: '77', kind: 'text' });
    assert.deepEqual(formatPropertyValue(def({ name: 'createdate', type: 'datetime' }), '2026-11-17T18:14:00Z'), {
      value: '2026-11-17T18:14:00.000Z',
      kind: 'datetime',
    });
    assert.equal(formatPropertyValue(def({ name: 'founded', type: 'date' }), '1700000000000')?.kind, 'date');
  });

  it('enlaces sólo http(s), teléfonos y correos con su tipo', () => {
    assert.deepEqual(formatPropertyValue(def({ name: 'linkedin_company_page' }), 'linkedin.com/company/fnl'), {
      value: 'https://linkedin.com/company/fnl',
      kind: 'url',
    });
    assert.equal(formatPropertyValue(def({ name: 'website' }), 'javascript:alert(1)')?.kind, 'text');
    assert.equal(formatPropertyValue(def({ name: 'phone', fieldType: 'phonenumber' }), '+56-9-3929-5290')?.kind, 'phone');
    assert.deepEqual(formatPropertyValue(def({ name: 'email' }), 'Stephanie.Lopez@FNL.cl'), { value: 'stephanie.lopez@fnl.cl', kind: 'email' });
  });

  it('un id va tal cual (sin puntos de miles); una cantidad, como número', () => {
    assert.deepEqual(formatPropertyValue(def({ name: 'hs_created_by_user_id', label: 'Created by user ID', type: 'number' }), '101471957'), {
      value: '101471957',
      kind: 'text',
    });
    assert.deepEqual(formatPropertyValue(def({ name: 'hs_object_id', label: 'Record ID', type: 'number' }), '61081648756')?.kind, 'text');
    assert.deepEqual(formatPropertyValue(def({ name: 'numberofemployees', label: 'Number of Employees', type: 'number' }), '350'), {
      value: '350',
      kind: 'number',
    });
  });

  it('vacío no se muestra y un texto enorme se recorta', () => {
    assert.equal(formatPropertyValue(def({ name: 'x' }), '   '), null);
    assert.equal(formatPropertyValue(def({ name: 'x' }), null), null);
    assert.equal(formatPropertyValue(def({ name: 'description' }), 'a'.repeat(5000))?.value.length, HUBSPOT_PROPERTY_VALUE_MAX_CHARS);
  });

  it('encuentra los ids de dueño del registro', () => {
    const defs = [def({ name: 'hubspot_owner_id', type: 'enumeration', referencedObjectType: 'OWNER' }), def({ name: 'name' })];
    assert.deepEqual(ownerIdsInValues(defs, { hubspot_owner_id: '55', name: 'FNL' }), ['55']);
  });
});

describe('secciones como en HubSpot', () => {
  const defs = [
    def({ name: 'name', label: 'Company name', groupName: 'companyinformation', displayOrder: 1 }),
    def({ name: 'phone', label: 'Phone Number', groupName: 'companyinformation', fieldType: 'phonenumber', displayOrder: 2 }),
    def({ name: 'estado', label: 'Estado de atacabilidad', groupName: 'calificacion' }),
    def({ name: 'secreta', label: 'Oculta', hidden: true }),
    def({ name: 'suelta', label: 'Sin grupo conocido', groupName: 'otro_grupo' }),
  ];
  const groups = [
    { name: 'calificacion', label: 'Calificación de cuenta', displayOrder: 2 },
    { name: 'companyinformation', label: 'Company information', displayOrder: 1 },
  ];

  it('agrupa en el orden del portal, sólo con dato y sin las ocultas', () => {
    const sections = buildPropertySections(defs, groups, { name: 'FNL Laboratory', phone: '+56-9-3929-5290', secreta: 'x', estado: '', suelta: 'v' });
    assert.deepEqual(sections.map((s) => s.label), ['Company information', 'otro_grupo']);
    assert.deepEqual(sections[0].entries.map((e) => e.label), ['Company name', 'Phone Number']);
  });

  it('el buscador filtra por etiqueta o valor, sin tildes', () => {
    const sections = buildPropertySections(defs, groups, { name: 'FNL Laboratory', phone: '+56', estado: 'Atacable' });
    assert.deepEqual(filterPropertySections(sections, 'calificacion').map((s) => s.label), ['Calificación de cuenta']);
    assert.deepEqual(filterPropertySections(sections, 'laboratory')[0].entries.map((e) => e.name), ['name']);
    assert.equal(filterPropertySections(sections, '  ').length, 2);
    assert.equal(filterPropertySections(sections, 'nada-que-ver').length, 0);
  });
});
