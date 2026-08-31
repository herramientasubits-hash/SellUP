/**
 * Tests — BR-SOURCE-8B-UI-STANDARDIZE — Brazil source catalog standardization.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * BR-PRODUCTION-RELEASE — tres trinquetes INVERTIDOS, ninguno borrado
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * OLD_ASSERTIONS: `br_receita_dados_abertos` es `discovery` + `pending_integration_design` +
 * `not_connected`, y NO aparece en el tab "Operativas IA". Eran ciertas mientras lo único listo
 * era la preparación LOCAL y no existía diseño de integración.
 *
 * WHY_OBSOLETE: los cortes funcionales A→E1 construyeron la integración (snapshot mensual con
 * `snapshot_run_id`, ejecutor + gateway SQL + adapter consumido por Agent 1, periodo congelado y
 * publicación fijada, resolución por nombre canónico exacto, promoción vallada de la identidad
 * fiscal, sanitización por fila). Un trinquete que siguiera exigiendo «pendiente diseño de
 * integración» BLOQUEARÍA la corrección que ese propio estado anticipaba; y `discovery` afirmaba
 * lo contrario de lo que Brasil hace: Receita NO descubre empresas, enriquece a una candidata que
 * ya existe.
 *
 * NEW_INVARIANTS, ESTRICTAMENTE MÁS FUERTES — lo que este hito defiende no es «los valores de
 * antes» sino «el display no sobre-afirma»:
 *   - `sellupUse` es `enrichment` y NUNCA `discovery` (afirmación NUEVA: antes el uso no se
 *     afirmaba por sí mismo, sólo indirectamente vía labels).
 *   - `aiFlowStatus` es `partial_pending_data`, y sigue sin ser `connected` ni
 *     `connected_post_approval`: lo que falta son DATOS, no diseño.
 *   - `connectionMode` es `read_only_snapshot` — el contrato real es un snapshot mensual offline
 *     de sólo lectura — y sigue sin ser `automatic_enrichment` ni `credential_configured`.
 *   - `operationalStatus` SIGUE en `validation_only`, y se afirma explícitamente que NO es
 *     `operational_verified`: sin la migración 133 aplicada y sin snapshot nacional cargado,
 *     Brasil produce cero salida automática en Producción.
 *   - La acción SIGUE siendo "Ver detalle" y NUNCA "Conectar", y la ficha SIGUE omitiendo los
 *     paneles genéricos de conexión. Eso se afirma igual que antes, sobre el modo nuevo.
 *   - Brasil AHORA sí aparece en "Operativas IA" — como parcial/pendiente datos, que es
 *     exactamente para lo que existe ese estado en filterTab.
 *
 * Alinea las fuentes de Brasil con el estándar visual/semántico existente del
 * Source Catalog (mismo patrón que ec_sercop / ec_ekos):
 *   - br_receita_dados_abertos (bulk principal): usa estados estándar
 *     `pending_integration_design` + `not_connected` + `validation_only` en lugar
 *     de los experimentales `dry_run_validated`/`not_persisted`. Acción "Ver
 *     detalle" (nunca "Conectar"); import/runtime/HubSpot/live siguen bloqueados;
 *     la ficha de detalle omite paneles de conexión.
 *   - br_receita_cnpj (referencia institucional) y br_cnpj_ws (API tercero): NO
 *     compiten como fuentes operativas — fuera de "Operativas IA", sin CTA
 *     "Conectar", acción "Ver detalle".
 *
 * El listado NO usa las etiquetas experimentales "Dry-run validado", "Sin
 * persistencia" ni "Validación técnica completada".
 *
 * Aislamiento: otras fuentes BR y de otros países no fueron alteradas.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CATALOG_SOURCES } from '../source-catalog';
import {
  OPERATIONAL_STATUS_LABELS,
  AI_FLOW_STATUS_LABELS,
  CONNECTION_MODE_LABELS,
  SELLUP_USE_LABELS,
} from '../../../../modules/source-catalog/labels';
import { shouldSkipGenericConnectionPanels } from '../../../../modules/source-catalog/connection-panel-guards';
import { getSourceActionPresentation } from '../../../../modules/source-catalog/action-presentation';
import { getSourceCatalogViewModel } from '../../../../modules/source-catalog/queries';
import { filterTab } from '../../../../modules/source-catalog/filter-tab';

const receita = CATALOG_SOURCES.find((s) => s.key === 'br_receita_dados_abertos');
const receitaInstitucional = CATALOG_SOURCES.find((s) => s.key === 'br_receita_cnpj');
const cnpjWs = CATALOG_SOURCES.find((s) => s.key === 'br_cnpj_ws');
const ecScvs = CATALOG_SOURCES.find((s) => s.key === 'ec_scvs');
const sunatBulk = CATALOG_SOURCES.find((s) => s.key === 'pe_sunat_bulk');

const EXPERIMENTAL_LABELS = [
  'Dry-run validado',
  'Sin persistencia',
  'Validación técnica completada',
];

function operativasKeys(): string[] {
  const { sources } = getSourceCatalogViewModel();
  return filterTab(sources, 'operativas').map((s) => s.key);
}

function listingLabelsFor(key: string): string[] {
  const { sources } = getSourceCatalogViewModel();
  const s = sources.find((x) => x.key === key);
  assert.ok(s, `${key} debe existir en el view model`);
  return [
    OPERATIONAL_STATUS_LABELS[s!.operationalStatus],
    AI_FLOW_STATUS_LABELS[s!.aiFlowStatus],
    CONNECTION_MODE_LABELS[s!.connectionMode],
    SELLUP_USE_LABELS[s!.sellupUse],
  ];
}

describe('BR-SOURCE-8B — br_receita_dados_abertos uses standard catalog states', () => {
  it('entry exists and is Brazil', () => {
    assert.ok(receita, 'br_receita_dados_abertos debe existir en el catálogo');
    assert.deepEqual(receita?.countryCodes, ['BR']);
  });

  it('operationalStatus is validation_only (standard, NOT experimental dry_run_validated)', () => {
    assert.equal(receita?.operationalStatus, 'validation_only');
    assert.notEqual(receita?.operationalStatus, 'dry_run_validated');
    assert.notEqual(receita?.operationalStatus, 'operational_verified');
    const label = OPERATIONAL_STATUS_LABELS[receita!.operationalStatus];
    assert.equal(label, 'Solo validación');
  });

  it('sellupUse is enrichment — post-discovery — and NEVER discovery', () => {
    // 🔴 §5 del contrato de release: Brasil NO se presenta como fuente de discovery. Receita
    // entra DESPUÉS del descubrimiento, sobre una candidata que ya existe.
    assert.equal(receita?.sellupUse, 'enrichment');
    assert.notEqual(receita?.sellupUse, 'discovery');
    assert.equal(SELLUP_USE_LABELS[receita!.sellupUse!], 'Enrichment');
  });

  it('aiFlowStatus is partial_pending_data — built, awaiting DATA, not connected', () => {
    assert.equal(receita?.aiFlowStatus, 'partial_pending_data');
    // 🔴 Ya NO es «pendiente diseño de integración»: el diseño existe y está verde en local.
    assert.notEqual(receita?.aiFlowStatus, 'pending_integration_design');
    // 🔴 …y sigue SIN afirmar conexión: la 133 no está aplicada y no hay snapshot nacional.
    assert.notEqual(receita?.aiFlowStatus, 'connected');
    assert.notEqual(receita?.aiFlowStatus, 'connected_post_approval');
    assert.notEqual(receita?.aiFlowStatus, 'snapshot_persisted');
    // …ni las etiquetas experimentales que BR-SOURCE-8B sacó del listado.
    assert.notEqual(receita?.aiFlowStatus, 'dry_run_validated');
    const label = AI_FLOW_STATUS_LABELS[receita!.aiFlowStatus!];
    assert.equal(label, 'Parcial / pendiente datos');
  });

  it('connectionMode is read_only_snapshot — the real access contract', () => {
    // 🔴 No hay API live ni credenciales: se lee un snapshot mensual publicado, offline y de
    // sólo lectura. `not_connected` describía mal ese contrato.
    assert.equal(receita?.connectionMode, 'read_only_snapshot');
    assert.notEqual(receita?.connectionMode, 'not_connected');
    // …y sigue sin afirmar enrichment automático ni credencial configurada.
    assert.notEqual(receita?.connectionMode, 'automatic_enrichment');
    assert.notEqual(receita?.connectionMode, 'credential_configured');
    assert.notEqual(receita?.connectionMode, 'not_persisted');
    const label = CONNECTION_MODE_LABELS[receita!.connectionMode!];
    assert.equal(label, 'Read-only snapshot');
  });

  it('listing labels contain NONE of the experimental labels', () => {
    const labels = listingLabelsFor('br_receita_dados_abertos');
    for (const experimental of EXPERIMENTAL_LABELS) {
      assert.ok(
        !labels.includes(experimental),
        `el listado no debe mostrar "${experimental}" (labels: ${labels.join(' | ')})`,
      );
    }
  });

  it('action is "Ver detalle" (never "Conectar")', () => {
    const action = getSourceActionPresentation({
      connectionMode: receita!.connectionMode!,
      aiFlowStatus: receita!.aiFlowStatus,
    });
    assert.equal(action.kind, 'view_detail');
    assert.equal(action.label, 'Ver detalle');
    assert.notEqual(action.label, 'Conectar');
  });

  it('appears in the "Operativas IA" tab as partial / pending data', () => {
    // 🔴 Trinquete INVERTIDO. Antes quedaba FUERA porque `pending_integration_design` no está en
    // la lista de estados operativos de filterTab. Ahora entra por `partial_pending_data`, que es
    // el estado que ese tab tiene precisamente para una integración construida a la que le faltan
    // datos. Sigue sin ofrecer "Conectar" y sigue sin paneles de conexión (se afirma abajo).
    assert.ok(operativasKeys().includes('br_receita_dados_abertos'));
  });

  it('detail page SKIPS generic connection panels (no connect/test CTA)', () => {
    assert.equal(shouldSkipGenericConnectionPanels(receita!), true);
  });

  it('nextAction states import/runtime/HubSpot/live are blocked', () => {
    const na = (receita?.nextAction ?? '').toLowerCase();
    assert.ok(na.includes('bloquead'), `nextAction debe indicar bloqueo: "${receita?.nextAction}"`);
    assert.ok(na.includes('import'), 'nextAction debe mencionar import');
    assert.ok(na.includes('runtime'), 'nextAction debe mencionar runtime');
    assert.ok(na.includes('hubspot'), 'nextAction debe mencionar HubSpot');
    assert.ok(na.includes('live'), 'nextAction debe mencionar generación live');
  });

  it('riskNotes flag that import/runtime/HubSpot/Agent 1 live are blocked', () => {
    const notes = (receita?.riskNotes ?? []).join(' ').toLowerCase();
    assert.ok(notes.includes('bloquead'), 'riskNotes debe marcar bloqueo');
    assert.ok(notes.includes('hubspot'), 'riskNotes debe mencionar HubSpot');
    assert.ok(notes.includes('agent 1'), 'riskNotes debe mencionar Agent 1');
  });

  it('remains P0 official_registry (metadata preserved)', () => {
    assert.equal(receita?.priority, 'P0');
    assert.equal(receita?.type, 'official_registry');
    assert.equal(receita?.url, 'https://dadosabertos.rfb.gov.br/CNPJ/');
  });
});

describe('BR-SOURCE-8B — Brazil source_key reconciliation preserved', () => {
  it('registry/UI source key is preserved (br_receita_dados_abertos)', () => {
    assert.equal(receita?.key, 'br_receita_dados_abertos');
  });

  it('exposes the canonical technical source key (br_receita_cnpj_dados_abertos)', () => {
    assert.equal(
      receita?.canonicalTechnicalSourceKey,
      'br_receita_cnpj_dados_abertos',
    );
  });

  it('documents the reconciliation between registry and canonical keys', () => {
    const rec = receita?.sourceKeyReconciliation;
    assert.ok(rec, 'sourceKeyReconciliation debe existir');
    assert.equal(rec?.registrySourceKey, 'br_receita_dados_abertos');
    assert.equal(
      rec?.canonicalTechnicalSourceKey,
      'br_receita_cnpj_dados_abertos',
    );
    assert.ok(
      /canónica|canonica/i.test(rec?.reason ?? ''),
      'reason debe explicar la clave canónica',
    );
  });

  it('does NOT duplicate Brazil as a second canonical-keyed source', () => {
    const canonicalKeyed = CATALOG_SOURCES.filter(
      (s) => s.key === 'br_receita_cnpj_dados_abertos',
    );
    assert.equal(
      canonicalKeyed.length,
      0,
      'la clave canónica no debe existir como entrada de catálogo separada',
    );
    const bulkBrazil = CATALOG_SOURCES.filter(
      (s) => s.key === 'br_receita_dados_abertos',
    );
    assert.equal(bulkBrazil.length, 1, 'la fuente bulk de Brasil debe ser única');
  });

  it('the release does NOT flip the source to operational/live/connected', () => {
    // 🔴 Esto es lo que el trinquete original protegía de verdad, y se conserva: el hito de
    // release NO declara Brasil operativa. Mientras la 133 no esté aplicada en Producción y el
    // snapshot nacional no esté cargado, la fuente produce cero salida automática.
    assert.equal(receita?.operationalStatus, 'validation_only');
    assert.notEqual(receita?.operationalStatus, 'operational_verified');
    assert.notEqual(receita?.operationalStatus, 'validated');
    assert.notEqual(receita?.operationalStatus, 'partial_snapshot');
    assert.notEqual(receita?.aiFlowStatus, 'connected');
    assert.notEqual(receita?.aiFlowStatus, 'connected_post_approval');
    assert.notEqual(receita?.connectionMode, 'automatic_enrichment');
    assert.notEqual(receita?.connectionMode, 'credential_configured');
  });

  it('nextAction names the two Production steps that are still pending', () => {
    // 🔴 El display no puede decir «listo» sin decir QUÉ falta: aplicar la 133 y cargar el
    // snapshot nacional. Si alguien borra una de las dos, esta guarda cae.
    const na = receita?.nextAction ?? '';
    assert.match(na, /133/, 'nextAction debe nombrar la migración 133');
    assert.match(na, /snapshot nacional/i, 'nextAction debe nombrar la carga del snapshot nacional');
  });

  it('the listed copy exposes no QSA / sócios / CPF / phone / email / address material', () => {
    // 🔴 §5 del contrato de release. Se mira TODO el copy que el catálogo puede pintar para esta
    // fuente, no sólo un campo.
    const copy = [
      receita?.name,
      receita?.nextAction,
      receita?.recommendedUse,
      ...(receita?.limitations ?? []),
      ...(receita?.riskNotes ?? []),
    ]
      .join(' ')
      .toLowerCase();
    for (const forbidden of ['qsa', 'sócio', 'socio', 'societário', 'societario', 'cpf']) {
      assert.equal(
        copy.includes(forbidden),
        false,
        `el copy del catálogo no debe exponer "${forbidden}"`,
      );
    }
  });
});

describe('BR-SOURCE-8B — secondary Brazil sources do not compete as operational', () => {
  it('br_receita_cnpj: not connectable — "Ver detalle", no "Conectar"', () => {
    assert.ok(receitaInstitucional);
    assert.equal(receitaInstitucional?.connectionMode, 'not_connected');
    assert.equal(receitaInstitucional?.aiFlowStatus, 'pending_integration_design');
    const action = getSourceActionPresentation({
      connectionMode: receitaInstitucional!.connectionMode!,
      aiFlowStatus: receitaInstitucional!.aiFlowStatus,
    });
    assert.equal(action.label, 'Ver detalle');
    assert.notEqual(action.label, 'Conectar');
    assert.notEqual(action.kind, 'connect');
  });

  it('br_receita_cnpj: keeps standard "Solo validación" status, out of Operativas IA', () => {
    assert.equal(receitaInstitucional?.operationalStatus, 'validation_only');
    assert.ok(!operativasKeys().includes('br_receita_cnpj'));
    assert.equal(shouldSkipGenericConnectionPanels(receitaInstitucional!), true);
  });

  it('br_cnpj_ws: not connectable — "Ver detalle", no "Conectar"', () => {
    assert.ok(cnpjWs);
    assert.equal(cnpjWs?.connectionMode, 'not_connected');
    assert.equal(cnpjWs?.aiFlowStatus, 'requires_validation');
    const action = getSourceActionPresentation({
      connectionMode: cnpjWs!.connectionMode!,
      aiFlowStatus: cnpjWs!.aiFlowStatus,
    });
    assert.equal(action.label, 'Ver detalle');
    assert.notEqual(action.label, 'Conectar');
    assert.notEqual(action.kind, 'connect');
  });

  it('br_cnpj_ws: standard "Pendiente validación" status (NOT "Requiere conexión"), out of Operativas IA', () => {
    assert.equal(cnpjWs?.operationalStatus, 'pending_validation');
    assert.notEqual(cnpjWs?.operationalStatus, 'connection_required');
    assert.ok(!operativasKeys().includes('br_cnpj_ws'));
    assert.equal(shouldSkipGenericConnectionPanels(cnpjWs!), true);
  });

  it('no Brazil source shows any experimental listing label', () => {
    for (const key of ['br_receita_dados_abertos', 'br_receita_cnpj', 'br_cnpj_ws']) {
      const labels = listingLabelsFor(key);
      for (const experimental of EXPERIMENTAL_LABELS) {
        assert.ok(
          !labels.includes(experimental),
          `${key} no debe mostrar "${experimental}"`,
        );
      }
    }
  });

  it('no Brazil source shows a "Conectar" CTA', () => {
    const { sources } = getSourceCatalogViewModel();
    const brazil = sources.filter((s) => s.countryCodes.includes('BR'));
    assert.ok(brazil.length >= 3);
    for (const s of brazil) {
      const action = getSourceActionPresentation({
        connectionMode: s.connectionMode,
        aiFlowStatus: s.aiFlowStatus,
      });
      assert.notEqual(action.kind, 'connect', `${s.key} no debe ofrecer "Conectar"`);
      assert.notEqual(action.label, 'Conectar', `${s.key} no debe ofrecer "Conectar"`);
    }
  });
});

describe('BR-SOURCE-8B — isolation of unrelated sources', () => {
  it('ec_scvs unchanged: validated', () => {
    assert.equal(ecScvs?.operationalStatus, 'validated');
  });

  it('pe_sunat_bulk unchanged: connected_post_approval', () => {
    assert.equal(sunatBulk?.aiFlowStatus, 'connected_post_approval');
  });
});
