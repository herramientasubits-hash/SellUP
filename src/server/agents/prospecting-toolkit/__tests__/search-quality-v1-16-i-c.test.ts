/**
 * Tests — Agent 1 v1.16I-C — ICP Size Gate solo en detalle de Prospecto
 *
 * Sin Tavily real. Sin APIs externas. Sin LLM. Sin Supabase.
 * Prueba únicamente la capa UI (getIcpSizeGateUiState) y que la tabla global
 * no expone ningún helper del gate.
 *
 * F1  — detail con decision=pass → muestra "ICP >200 validado"
 * F2  — detail con decision=needs_validation → muestra "Tamaño pendiente de validación"
 * F3  — detail con decision=block → muestra "Fuera de ICP por tamaño"
 * F4  — detail sin metadata → muestra "Sin evaluación de tamaño"
 * F5  — fallback desde rich_profile.size.icp_size_gate → detecta decision correctamente
 * F6  — company_size sin icp_size_gate → estado sigue "Sin evaluación de tamaño"
 * F7  — requires_human_review=true → requiresHumanReview=true en UI state
 * F8  — tabla global (prospects-data-table-client) no importa ni usa icp-size-gate-ui
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { getIcpSizeGateUiState } from '../../../../components/prospect-batches/icp-size-gate-ui';

// ─── F1 — decision=pass ──────────────────────────────────────────────────────

describe('F1 — metadata.icp_size_gate.decision=pass → badge "ICP >200 validado"', () => {
  const meta = {
    icp_size_gate: {
      decision: 'pass',
      size_status: 'estimated_above_threshold',
      threshold: 200,
      normalized_min_employees: 10001,
      normalized_max_employees: null,
      reason: 'Size range minimum (10001) exceeds ICP threshold of 200',
      requires_human_review: false,
    },
  };

  it('decision = pass', () => {
    const state = getIcpSizeGateUiState(meta);
    assert.equal(state.decision, 'pass');
  });

  it('tone = success', () => {
    const state = getIcpSizeGateUiState(meta);
    assert.equal(state.tone, 'success');
  });

  it('label contiene ICP >200', () => {
    const state = getIcpSizeGateUiState(meta);
    assert.ok(state.label.includes('>200') || state.label.includes('ICP'), `label inesperado: ${state.label}`);
  });

  it('requiresHumanReview = false', () => {
    const state = getIcpSizeGateUiState(meta);
    assert.equal(state.requiresHumanReview, false);
  });

  it('rangeLabel muestra rango (10001+)', () => {
    const state = getIcpSizeGateUiState(meta);
    assert.ok(state.rangeLabel !== null, 'rangeLabel debe estar presente para pass');
  });
});

// ─── F2 — decision=needs_validation ─────────────────────────────────────────

describe('F2 — metadata.icp_size_gate.decision=needs_validation → "Tamaño pendiente de validación"', () => {
  const meta = {
    icp_size_gate: {
      decision: 'needs_validation',
      size_status: 'unknown',
      threshold: 200,
      normalized_min_employees: null,
      normalized_max_employees: null,
      reason: 'Company size unknown',
      requires_human_review: true,
    },
  };

  it('decision = needs_validation', () => {
    const state = getIcpSizeGateUiState(meta);
    assert.equal(state.decision, 'needs_validation');
  });

  it('tone = warning', () => {
    const state = getIcpSizeGateUiState(meta);
    assert.equal(state.tone, 'warning');
  });

  it('label indica pendiente', () => {
    const state = getIcpSizeGateUiState(meta);
    assert.ok(state.label.toLowerCase().includes('pendiente'), `label inesperado: ${state.label}`);
  });

  it('description contiene mensaje de validación', () => {
    const state = getIcpSizeGateUiState(meta);
    assert.ok(
      state.description.length > 0,
      'description debe tener mensaje de validación',
    );
  });

  it('requiresHumanReview = true (inherited from gate)', () => {
    const state = getIcpSizeGateUiState(meta);
    assert.equal(state.requiresHumanReview, true);
  });
});

// ─── F3 — decision=block ─────────────────────────────────────────────────────

describe('F3 — metadata.icp_size_gate.decision=block → "Fuera de ICP por tamaño"', () => {
  const meta = {
    icp_size_gate: {
      decision: 'block',
      size_status: 'estimated_below_threshold',
      threshold: 200,
      normalized_min_employees: 51,
      normalized_max_employees: 200,
      reason: 'Size range maximum (200) does not exceed ICP threshold of 200',
      requires_human_review: false,
    },
  };

  it('decision = block', () => {
    const state = getIcpSizeGateUiState(meta);
    assert.equal(state.decision, 'block');
  });

  it('tone = danger', () => {
    const state = getIcpSizeGateUiState(meta);
    assert.equal(state.tone, 'danger');
  });

  it('description menciona fuera de ICP', () => {
    const state = getIcpSizeGateUiState(meta);
    assert.ok(
      state.description.toLowerCase().includes('fuera') ||
        state.description.toLowerCase().includes('icp') ||
        state.description.toLowerCase().includes('tamaño'),
      `description inesperada: ${state.description}`,
    );
  });

  it('reason está presente', () => {
    const state = getIcpSizeGateUiState(meta);
    assert.ok(state.reason !== null, 'reason debe estar presente cuando hay decision=block');
  });

  it('rangeLabel refleja rango 51-200', () => {
    const state = getIcpSizeGateUiState(meta);
    assert.ok(
      state.rangeLabel !== null && state.rangeLabel.includes('51'),
      `rangeLabel inesperado: ${state.rangeLabel}`,
    );
  });
});

// ─── F4 — sin metadata ───────────────────────────────────────────────────────

describe('F4 — sin metadata → "Sin evaluación de tamaño"', () => {
  it('metadata=null → decision=null', () => {
    const state = getIcpSizeGateUiState(null);
    assert.equal(state.decision, null);
  });

  it('metadata=undefined → decision=null', () => {
    const state = getIcpSizeGateUiState(undefined);
    assert.equal(state.decision, null);
  });

  it('tone = neutral cuando sin metadata', () => {
    const state = getIcpSizeGateUiState(null);
    assert.equal(state.tone, 'neutral');
  });

  it('metadata={} sin icp_size_gate → decision=null', () => {
    const state = getIcpSizeGateUiState({});
    assert.equal(state.decision, null);
  });

  it('description no está vacía (mensaje informativo)', () => {
    const state = getIcpSizeGateUiState(null);
    assert.ok(state.description.length > 0, 'description debe tener contenido para null metadata');
  });

  it('requiresHumanReview = false (no gate, no review)', () => {
    const state = getIcpSizeGateUiState(null);
    assert.equal(state.requiresHumanReview, false);
  });
});

// ─── F5 — fallback rich_profile.size.icp_size_gate ───────────────────────────

describe('F5 — fallback desde rich_profile.size.icp_size_gate → decision detectada', () => {
  const metaWithRichProfilePass = {
    rich_profile: {
      size: {
        estimated_range: '10001+',
        icp_size_gate: {
          decision: 'pass',
          size_status: 'estimated_above_threshold',
          threshold: 200,
          normalized_min_employees: 10001,
          normalized_max_employees: null,
          reason: 'Above threshold via rich_profile',
          requires_human_review: false,
        },
      },
    },
  };

  const metaWithRichProfileBlock = {
    rich_profile: {
      size: {
        estimated_range: '51-200',
        icp_size_gate: {
          decision: 'block',
          size_status: 'estimated_below_threshold',
          threshold: 200,
          normalized_min_employees: 51,
          normalized_max_employees: 200,
          reason: 'Below threshold via rich_profile',
          requires_human_review: false,
        },
      },
    },
  };

  it('rich_profile.size.icp_size_gate.decision=pass → UI decision=pass', () => {
    const state = getIcpSizeGateUiState(metaWithRichProfilePass);
    assert.equal(state.decision, 'pass');
  });

  it('rich_profile.size.icp_size_gate.decision=block → UI decision=block', () => {
    const state = getIcpSizeGateUiState(metaWithRichProfileBlock);
    assert.equal(state.decision, 'block');
  });

  it('rich_profile fallback usa estimated_range como rangeLabel', () => {
    const state = getIcpSizeGateUiState(metaWithRichProfilePass);
    assert.equal(state.rangeLabel, '10001+');
  });

  it('icp_size_gate primario toma precedencia sobre rich_profile fallback', () => {
    const metaBoth = {
      icp_size_gate: { decision: 'pass', reason: 'primario', requires_human_review: false },
      rich_profile: {
        size: {
          icp_size_gate: { decision: 'block', reason: 'fallback', requires_human_review: false },
        },
      },
    };
    const state = getIcpSizeGateUiState(metaBoth);
    assert.equal(state.decision, 'pass', 'icp_size_gate primario debe tener precedencia');
  });
});

// ─── F6 — company_size sin icp_size_gate ─────────────────────────────────────

describe('F6 — company_size sin icp_size_gate → estado "Sin evaluación de tamaño"', () => {
  it('metadata={} + companySizeRaw="201-500" → decision=null (company_size no define gate)', () => {
    const state = getIcpSizeGateUiState({}, '201-500');
    assert.equal(
      state.decision,
      null,
      'company_size solo no debe definir decision del gate',
    );
  });

  it('company_size aparece como rangeLabel de apoyo', () => {
    const state = getIcpSizeGateUiState({}, '201-500');
    assert.equal(state.rangeLabel, '201-500', 'rangeLabel debe usar company_size como dato de apoyo');
  });

  it('tone sigue siendo neutral (sin gate)', () => {
    const state = getIcpSizeGateUiState({}, '500+');
    assert.equal(state.tone, 'neutral');
  });

  it('metadata=null + companySizeRaw="10001+" → rangeLabel="10001+" pero decision=null', () => {
    const state = getIcpSizeGateUiState(null, '10001+');
    assert.equal(state.decision, null);
    assert.equal(state.rangeLabel, '10001+');
  });
});

// ─── F7 — requires_human_review=true ─────────────────────────────────────────

describe('F7 — requires_human_review=true → requiresHumanReview=true en UI state', () => {
  const metaHumanReview = {
    icp_size_gate: {
      decision: 'needs_validation',
      size_status: 'unknown',
      threshold: 200,
      normalized_min_employees: null,
      normalized_max_employees: null,
      reason: 'Tamaño no confirmado, requiere validación',
      requires_human_review: true,
    },
  };

  it('requiresHumanReview = true cuando gate.requires_human_review=true', () => {
    const state = getIcpSizeGateUiState(metaHumanReview);
    assert.equal(state.requiresHumanReview, true);
  });

  it('requiresHumanReview = false cuando gate.requires_human_review=false', () => {
    const metaNoReview = {
      icp_size_gate: {
        decision: 'pass',
        requires_human_review: false,
      },
    };
    const state = getIcpSizeGateUiState(metaNoReview);
    assert.equal(state.requiresHumanReview, false);
  });

  it('rich_profile fallback también propaga requires_human_review', () => {
    const metaRich = {
      rich_profile: {
        size: {
          icp_size_gate: {
            decision: 'needs_validation',
            requires_human_review: true,
          },
        },
      },
    };
    const state = getIcpSizeGateUiState(metaRich);
    assert.equal(state.requiresHumanReview, true);
  });
});

// ─── F8 — tabla global no importa ni usa icp-size-gate-ui ────────────────────

describe('F8 — tabla global (prospects-data-table-client) sin referencias a icp-size-gate-ui', () => {
  const tableFilePath = path.resolve(
    process.cwd(),
    'src/components/prospects/prospects-data-table-client.tsx',
  );

  it('archivo prospects-data-table-client.tsx existe', () => {
    assert.ok(fs.existsSync(tableFilePath), 'el archivo de la tabla global debe existir');
  });

  it('no importa icp-size-gate-ui', () => {
    const content = fs.readFileSync(tableFilePath, 'utf-8');
    assert.ok(
      !content.includes('icp-size-gate-ui'),
      'la tabla no debe importar icp-size-gate-ui',
    );
  });

  it('no usa getIcpSizeGateUiState', () => {
    const content = fs.readFileSync(tableFilePath, 'utf-8');
    assert.ok(
      !content.includes('getIcpSizeGateUiState'),
      'la tabla no debe llamar a getIcpSizeGateUiState',
    );
  });

  it('no renderiza badge ICP >200', () => {
    const content = fs.readFileSync(tableFilePath, 'utf-8');
    assert.ok(
      !content.includes('ICP >200') && !content.includes('ICP >200'),
      'la tabla no debe renderizar el badge "ICP >200"',
    );
  });

  it('no renderiza "Tamaño pendiente"', () => {
    const content = fs.readFileSync(tableFilePath, 'utf-8');
    assert.ok(
      !content.includes('Tamaño pendiente'),
      'la tabla no debe mostrar "Tamaño pendiente"',
    );
  });

  it('no renderiza "≤200 bloqueado"', () => {
    const content = fs.readFileSync(tableFilePath, 'utf-8');
    assert.ok(
      !content.includes('≤200 bloqueado'),
      'la tabla no debe mostrar "≤200 bloqueado"',
    );
  });

  it('no renderiza "Sin dato tamaño"', () => {
    const content = fs.readFileSync(tableFilePath, 'utf-8');
    assert.ok(
      !content.includes('Sin dato tamaño'),
      'la tabla no debe mostrar "Sin dato tamaño"',
    );
  });
});
