import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describeDiscardReason, discardReasonDetail } from '../discard-reason-labels';

const root = path.resolve(__dirname, '../../../..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');

describe('motivo de descarte en palabras (QA dueña 13-11)', () => {
  it('«Otro motivo» con código conocido dice el motivo real', () => {
    const item = { disposition: 'other' as const, reasonCode: 'known_employee_count_below_min', reasonDetail: 'known_employee_count_below_min' };
    assert.equal(describeDiscardReason(item), 'Tiene menos empleados que el mínimo de la búsqueda');
    assert.equal(discardReasonDetail(item), null);
  });

  it('el código de Lusha se traduce y nunca se muestra como detalle', () => {
    const item = { disposition: 'sector_rejected' as const, reasonCode: 'sub_industry_branch_parent_only', reasonDetail: 'sub_industry_branch_parent_only' };
    assert.match(describeDiscardReason(item), /industria general/);
    assert.equal(discardReasonDetail(item), null);
  });

  it('una frase escrita se conserva como detalle', () => {
    const item = { disposition: 'final_validation_rejected' as const, reasonCode: 'missing_domain_final', reasonDetail: 'Fuente oficial sin sitio web: Claude buscará su sitio.' };
    assert.equal(describeDiscardReason(item), 'Sin sitio web: no se pudo verificar la empresa');
    assert.equal(discardReasonDetail(item), 'Fuente oficial sin sitio web: Claude buscará su sitio.');
  });

  it('código desconocido: el motivo general, sin el código', () => {
    assert.equal(describeDiscardReason({ disposition: 'hubspot_duplicate', reasonCode: 'algo_nuevo', reasonDetail: 'algo_nuevo' }), 'Ya existente en HubSpot');
    assert.equal(describeDiscardReason({ disposition: 'other', reasonCode: null, reasonDetail: null }), 'Otro motivo');
    assert.equal(describeDiscardReason({ disposition: 'other', reasonCode: null, reasonDetail: 'No es cliente objetivo' }), 'No es cliente objetivo');
  });

  it('el panel no muestra códigos ni la evidencia técnica', () => {
    const sheet = read('src/components/prospects/discarded-prospect-detail-sheet.tsx');
    for (const gone of ['Código del motivo', 'Evidencia guardada', 'JSON.stringify', 'item.reasonCode', 'item.roundOrigin', 'resultingCandidateId']) {
      assert.ok(!sheet.includes(gone), `el panel todavía muestra ${gone}`);
    }
    const table = read('src/components/prospects/discarded-prospects-data-table-client.tsx');
    assert.ok(!table.includes("?? 'Otro motivo'"));
  });
});
