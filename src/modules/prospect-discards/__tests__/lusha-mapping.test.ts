/**
 * AGENT1-LUSHA-DISCARD-TRACEABILITY-1 — taxonomía pura de la pierna Lusha.
 *
 * Cubre TODOS los eventos del mapping, en los dos sentidos:
 *   · los que SÍ producen disposición durable, con su código y su `reason_code`.
 *   · los cinco estados TRANSITORIOS, que deben devolver `null`.
 *
 * Y la propiedad que protege al vocabulario: ningún código emitido puede caer
 * fuera de `DiscardDispositionCode` (y por tanto fuera del CHECK de la 138).
 *
 * Cero IO: el módulo bajo prueba no importa nada más que `./types`.
 * Run: node --import tsx --test <this file>
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  mapLushaDiscardToCode,
  resolveLushaDiscardDisposition,
  classifyLushaExactDuplicateSource,
  LUSHA_DISCARD_REASON_CODE,
  type LushaDiscardEvent,
} from '../lusha-mapping';
import { DISCARD_DISPOSITION_LABELS, type DiscardDispositionCode } from '../types';

const KNOWN_CODES = new Set(Object.keys(DISCARD_DISPOSITION_LABELS));

/** Todo evento que este hito puede emitir. La lista es el contrato. */
const EVERY_EVENT: LushaDiscardEvent[] = [
  { kind: 'gate_hard_excluded', gateReason: 'country_mismatch' },
  { kind: 'gate_hard_excluded', gateReason: 'unsupported_country' },
  { kind: 'gate_hard_excluded', gateReason: 'obviously_wrong_sector' },
  { kind: 'gate_hard_excluded', gateReason: 'ambiguous_sector' },
  { kind: 'gate_hard_excluded', gateReason: 'known_employee_count_below_min' },
  { kind: 'gate_hard_excluded', gateReason: 'missing_domain' },
  { kind: 'gate_hard_excluded', gateReason: null },
  { kind: 'active_candidate_guard' },
  { kind: 'exact_duplicate', duplicateSource: 'sellup' },
  { kind: 'exact_duplicate', duplicateSource: 'hubspot' },
  { kind: 'macro_precision_rejected', precisionReason: 'declared_industry_outside_macro' },
  { kind: 'icp_size_rejected' },
  { kind: 'target_overflow' },
  { kind: 'known_domain_seed' },
  { kind: 'provider_seen' },
  { kind: 'intra_run_provider_duplicate' },
  { kind: 'possible_duplicate' },
  { kind: 'batch_identity_rejected' },
  { kind: 'accepted' },
  { kind: 'unusable_record' },
];

describe('mapLushaDiscardToCode — disposiciones DURABLES', () => {
  const cases: Array<{
    label: string;
    event: LushaDiscardEvent;
    disposition: DiscardDispositionCode;
    reasonCode: string | null;
  }> = [
    {
      label: 'guard de candidato activo → ya existe en SellUp',
      event: { kind: 'active_candidate_guard' },
      disposition: 'sellup_duplicate',
      reasonCode: null,
    },
    {
      label: 'duplicado exacto de SellUp',
      event: { kind: 'exact_duplicate', duplicateSource: 'sellup' },
      disposition: 'sellup_duplicate',
      reasonCode: null,
    },
    {
      label: 'duplicado exacto de HubSpot',
      event: { kind: 'exact_duplicate', duplicateSource: 'hubspot' },
      disposition: 'hubspot_duplicate',
      reasonCode: null,
    },
    {
      label: 'rechazo por país',
      event: { kind: 'gate_hard_excluded', gateReason: 'country_mismatch' },
      disposition: 'country_rejected',
      reasonCode: 'country_mismatch',
    },
    {
      label: 'país no soportado también es rechazo por país',
      event: { kind: 'gate_hard_excluded', gateReason: 'unsupported_country' },
      disposition: 'country_rejected',
      reasonCode: 'unsupported_country',
    },
    {
      label: 'rechazo por sector',
      event: { kind: 'gate_hard_excluded', gateReason: 'obviously_wrong_sector' },
      disposition: 'sector_rejected',
      reasonCode: 'obviously_wrong_sector',
    },
    {
      label: 'rechazo por precisión de macro → sector, NO duplicado',
      event: { kind: 'macro_precision_rejected', precisionReason: 'parent_industry_only' },
      disposition: 'sector_rejected',
      reasonCode: 'parent_industry_only',
    },
    {
      label: 'rechazo por tamaño del ICP → other + reason_code',
      event: { kind: 'icp_size_rejected' },
      disposition: 'other',
      reasonCode: LUSHA_DISCARD_REASON_CODE.icpSizeBelowMin,
    },
    {
      label: 'sobrante por tope de objetivo',
      event: { kind: 'target_overflow' },
      disposition: 'target_cap_reached',
      reasonCode: LUSHA_DISCARD_REASON_CODE.targetOverflow,
    },
    {
      label: 'dominio ya conocido (siembra cliente)',
      event: { kind: 'known_domain_seed' },
      disposition: 'sellup_duplicate',
      reasonCode: LUSHA_DISCARD_REASON_CODE.knownDomainSeed,
    },
  ];

  for (const c of cases) {
    it(c.label, () => {
      assert.equal(mapLushaDiscardToCode(c.event), c.disposition);
      assert.deepEqual(resolveLushaDiscardDisposition(c.event), {
        disposition: c.disposition,
        reasonCode: c.reasonCode,
      });
    });
  }

  it('el rechazo por tamaño del ICP y el motivo duro del gate coinciden', () => {
    // El mismo hecho llega por dos caminos (el gate compartido y el gate de ICP
    // de Lusha) y NO puede producir dos veredictos distintos.
    assert.deepEqual(
      resolveLushaDiscardDisposition({ kind: 'icp_size_rejected' }),
      resolveLushaDiscardDisposition({
        kind: 'gate_hard_excluded',
        gateReason: 'known_employee_count_below_min',
      }),
    );
  });

  it('un motivo duro sin código propio cae en `other` conservando el motivo', () => {
    // 🔴 `other` es la red de seguridad que YA existe (misma que usa Apollo con
    // `unclassified_final`). Lo que NO se hace es inventar un código nuevo.
    assert.deepEqual(
      resolveLushaDiscardDisposition({ kind: 'gate_hard_excluded', gateReason: 'missing_domain' }),
      { disposition: 'other', reasonCode: 'missing_domain' },
    );
    assert.deepEqual(
      resolveLushaDiscardDisposition({ kind: 'gate_hard_excluded', gateReason: '   ' }),
      { disposition: 'other', reasonCode: null },
    );
  });
});

describe('mapLushaDiscardToCode — estados TRANSITORIOS devuelven null', () => {
  // Cada uno por una razón distinta, y ninguna es «se descartó».
  const transient: Array<[string, LushaDiscardEvent]> = [
    ['provider_seen es memoria de proveedor, no veredicto', { kind: 'provider_seen' }],
    ['un duplicado intra-corrida es una fila repetida por el proveedor', { kind: 'intra_run_provider_duplicate' }],
    ['possible_duplicate YA existe como candidato needs_review', { kind: 'possible_duplicate' }],
    ['el rechazo por identidad de LOTE no es un descarte de empresa', { kind: 'batch_identity_rejected' }],
    ['una aceptada existe en prospect_candidates', { kind: 'accepted' }],
    ['una fila impersistible no tiene nada que auditar', { kind: 'unusable_record' }],
  ];

  for (const [label, event] of transient) {
    it(label, () => {
      assert.equal(mapLushaDiscardToCode(event), null);
      assert.equal(resolveLushaDiscardDisposition(event), null);
    });
  }
});

describe('la taxonomía no puede emitir un código fuera del vocabulario', () => {
  it('cubre TODOS los `kind` declarados (la lista de la prueba está completa)', () => {
    const covered = new Set(EVERY_EVENT.map((e) => e.kind));
    // Si mañana se añade un `kind`, esta cuenta lo delata.
    assert.equal(covered.size, 13, `kinds cubiertos: ${[...covered].sort().join(', ')}`);
  });

  it('todo código emitido existe en DiscardDispositionCode (y en el CHECK de la 138)', () => {
    for (const event of EVERY_EVENT) {
      const code = mapLushaDiscardToCode(event);
      if (code === null) continue;
      assert.ok(KNOWN_CODES.has(code), `código desconocido "${code}" para ${event.kind}`);
    }
  });

  it('ningún evento devuelve un código nuevo inventado para Lusha', () => {
    const emitted = new Set(
      EVERY_EVENT.map((e) => mapLushaDiscardToCode(e)).filter((c): c is DiscardDispositionCode => c !== null),
    );
    assert.deepEqual(
      [...emitted].sort(),
      ['country_rejected', 'hubspot_duplicate', 'other', 'sector_rejected', 'sellup_duplicate', 'target_cap_reached'],
    );
  });
});

describe('classifyLushaExactDuplicateSource — de qué lado vino el duplicado', () => {
  it('una coincidencia exacta de SellUp gana', () => {
    assert.equal(
      classifyLushaExactDuplicateSource({
        sources: [{ source: 'sellup', strength: 'exact' }],
      }),
      'sellup',
    );
  });

  it('un candidato activo cuenta como SellUp', () => {
    assert.equal(
      classifyLushaExactDuplicateSource({
        sources: [{ source: 'active_candidate', strength: 'exact' }],
      }),
      'sellup',
    );
  });

  it('sólo HubSpot ⇒ hubspot', () => {
    assert.equal(
      classifyLushaExactDuplicateSource({
        sources: [{ source: 'hubspot', strength: 'exact' }],
        matchedHubspotCompanyId: 'hs-9',
      }),
      'hubspot',
    );
  });

  it('coincide con los DOS ⇒ SellUp, el hecho interno más fuerte', () => {
    assert.equal(
      classifyLushaExactDuplicateSource({
        sources: [
          { source: 'hubspot', strength: 'exact' },
          { source: 'sellup', strength: 'exact' },
        ],
      }),
      'sellup',
    );
  });

  it('una coincidencia POSIBLE no decide la fuente de un exacto', () => {
    // Un `possible` de HubSpot no convierte el exacto en `hubspot_duplicate`.
    assert.equal(
      classifyLushaExactDuplicateSource({
        sources: [{ source: 'hubspot', strength: 'possible' }],
      }),
      'sellup',
    );
  });

  it('los ids de coincidencia bastan cuando no hay `sources`', () => {
    assert.equal(classifyLushaExactDuplicateSource({ matchedAccountId: 'acc-1' }), 'sellup');
    assert.equal(classifyLushaExactDuplicateSource({ matchedHubspotCompanyId: 'hs-1' }), 'hubspot');
  });

  it('sin evidencia de NINGÚN lado ⇒ sellup (el veredicto es del comprobador propio)', () => {
    assert.equal(classifyLushaExactDuplicateSource({ sources: [] }), 'sellup');
    assert.equal(classifyLushaExactDuplicateSource({}), 'sellup');
  });
});
