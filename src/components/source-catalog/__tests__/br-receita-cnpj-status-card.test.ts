/**
 * Tests — BR-SOURCE-8-UI — BrReceitaCnpjStatusCard display invariants.
 *
 * Verifica los datos e invariantes presentacionales del status card sin
 * renderizar React (constantes y guards exportados):
 *   - Ready: Legal/Privacy, Parser, Validador de manifiesto, Dry-run local.
 *   - Blocked: Importación, Runtime, Agent 1 live, HubSpot sync.
 *   - Ningún flag habilitado; ninguna etiqueta de CTA peligrosa.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BR_RECEITA_CNPJ_SOURCE_KEY,
  BR_RECEITA_REGISTRY_SOURCE_KEY,
  BR_RECEITA_CANONICAL_TECHNICAL_SOURCE_KEY,
  BR_RECEITA_SOURCE_KEY_RECONCILIATION_COPY,
  BR_RECEITA_READY_ITEMS,
  BR_RECEITA_BLOCKED_ITEMS,
  isBrReceitaLegalApproved,
  isBrReceitaParserReady,
  isBrReceitaManifestValidatorReady,
  isBrReceitaLocalDryRunReady,
  isBrReceitaImportEnabled,
  isBrReceitaRuntimeEnabled,
  isBrReceitaAgent1LiveEnabled,
  isBrReceitaHubspotSyncEnabled,
  isBrReceitaLiveGenerationEnabled,
} from '../br-receita-cnpj-status-card';

const readyLabels = BR_RECEITA_READY_ITEMS.map((i) => i.label);
const blockedLabels = BR_RECEITA_BLOCKED_ITEMS.map((i) => i.label);

describe('BR-SOURCE-8-UI — BrReceitaCnpjStatusCard', () => {
  it('targets the existing Brazil source key', () => {
    assert.equal(BR_RECEITA_CNPJ_SOURCE_KEY, 'br_receita_dados_abertos');
  });

  it('ready items cover Legal/Privacy, Parser, Manifest validator, Local dry-run', () => {
    assert.ok(readyLabels.some((l) => /legal/i.test(l)));
    assert.ok(readyLabels.some((l) => /parser/i.test(l)));
    assert.ok(readyLabels.some((l) => /manifiesto/i.test(l)));
    assert.ok(readyLabels.some((l) => /dry-run/i.test(l)));
  });

  it('blocked items cover Import, Runtime, Agent 1 live, HubSpot sync', () => {
    assert.ok(blockedLabels.some((l) => /importaci/i.test(l)));
    assert.ok(blockedLabels.some((l) => /runtime/i.test(l)));
    assert.ok(blockedLabels.some((l) => /agent 1/i.test(l)));
    assert.ok(blockedLabels.some((l) => /hubspot/i.test(l)));
  });

  it('ready guards are all true', () => {
    assert.equal(isBrReceitaLegalApproved(), true);
    assert.equal(isBrReceitaParserReady(), true);
    assert.equal(isBrReceitaManifestValidatorReady(), true);
    assert.equal(isBrReceitaLocalDryRunReady(), true);
  });

  it('blocked guards are all false (fail-closed)', () => {
    assert.equal(isBrReceitaImportEnabled(), false);
    assert.equal(isBrReceitaRuntimeEnabled(), false);
    assert.equal(isBrReceitaAgent1LiveEnabled(), false);
    assert.equal(isBrReceitaHubspotSyncEnabled(), false);
    assert.equal(isBrReceitaLiveGenerationEnabled(), false);
  });

  it('exposes the source key reconciliation (registry key preserved)', () => {
    assert.equal(BR_RECEITA_REGISTRY_SOURCE_KEY, 'br_receita_dados_abertos');
    assert.equal(BR_RECEITA_CNPJ_SOURCE_KEY, BR_RECEITA_REGISTRY_SOURCE_KEY);
    assert.equal(
      BR_RECEITA_CANONICAL_TECHNICAL_SOURCE_KEY,
      'br_receita_cnpj_dados_abertos',
    );
    assert.notEqual(
      BR_RECEITA_REGISTRY_SOURCE_KEY,
      BR_RECEITA_CANONICAL_TECHNICAL_SOURCE_KEY,
    );
  });

  it('reconciliation copy names the canonical technical key', () => {
    assert.ok(
      BR_RECEITA_SOURCE_KEY_RECONCILIATION_COPY.includes(
        'br_receita_cnpj_dados_abertos',
      ),
      'la copy debe mencionar la clave canónica',
    );
    const copy = BR_RECEITA_SOURCE_KEY_RECONCILIATION_COPY.toLowerCase();
    assert.ok(!/\bimportar\b/.test(copy), 'la copy no debe invitar a importar');
    assert.ok(!/\bconectar\b/.test(copy), 'la copy no debe invitar a conectar');
    assert.ok(!/\bactivar\b/.test(copy), 'la copy no debe invitar a activar');
    assert.ok(!/\bdescargar\b/.test(copy), 'la copy no debe invitar a descargar');
  });

  it('no item text implies an active/connected/importable state', () => {
    const allText = [...BR_RECEITA_READY_ITEMS, ...BR_RECEITA_BLOCKED_ITEMS]
      .map((i) => `${i.label} ${i.detail}`)
      .join(' ')
      .toLowerCase();
    assert.ok(!allText.includes('importar '), 'no debe invitar a "Importar"');
    assert.ok(!allText.includes('conectar '), 'no debe invitar a "Conectar"');
    assert.ok(!allText.includes('activar '), 'no debe invitar a "Activar"');
    assert.ok(!allText.includes('sincronizar '), 'no debe invitar a "Sincronizar"');
    assert.ok(!allText.includes('descargar '), 'no debe invitar a "Descargar"');
  });
});
