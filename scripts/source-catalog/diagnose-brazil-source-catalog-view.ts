/**
 * BR-SOURCE-8D — Read-only diagnostic for the production Brazil Source Catalog listing.
 *
 * Prints the FINAL row model that `SourceCatalogClient` consumes for the three
 * Brazil sources, using the exact same pure functions the UI uses:
 *   - getSourceCatalogViewModel()  (page.tsx data source)
 *   - filterTab()                  (tab membership: "Operativas IA")
 *   - getSourceActionPresentation()(action column: "Conectar" vs "Ver detalle")
 *   - label maps                   (visible labels)
 *   - shouldSkipGenericConnectionPanels() (detail-view connection panels)
 *
 * SAFETY: pure/offline. Does NOT read Supabase, does NOT call
 * getSourceConnectionStatusOverrides(), does NOT trigger any connection,
 * credential, import, or write. Prints no secrets and no CNPJ/CPF/person data.
 */

import { getSourceCatalogViewModel } from '../../src/modules/source-catalog/queries';
import { filterTab } from '../../src/modules/source-catalog/filter-tab';
import { getSourceActionPresentation } from '../../src/modules/source-catalog/action-presentation';
import { shouldSkipGenericConnectionPanels } from '../../src/modules/source-catalog/connection-panel-guards';
import {
  OPERATIONAL_STATUS_LABELS,
  AI_FLOW_STATUS_LABELS,
  CONNECTION_MODE_LABELS,
} from '../../src/modules/source-catalog/labels';

const BRAZIL_KEYS = ['br_receita_dados_abertos', 'br_receita_cnpj', 'br_cnpj_ws'];

const { sources } = getSourceCatalogViewModel();
const operativasKeys = new Set(filterTab(sources, 'operativas').map((s) => s.key));
const manualesKeys = new Set(filterTab(sources, 'manuales').map((s) => s.key));

for (const key of BRAZIL_KEYS) {
  const s = sources.find((x) => x.key === key);
  if (!s) {
    console.log(`\n=== ${key} === NOT FOUND IN VIEW MODEL`);
    continue;
  }
  const action = getSourceActionPresentation({
    connectionMode: s.connectionMode,
    aiFlowStatus: s.aiFlowStatus,
  });
  const tabs: string[] = ['todas'];
  if (operativasKeys.has(key)) tabs.push('operativas');
  if (manualesKeys.has(key)) tabs.push('manuales');

  console.log(`\n=== ${key} ===`);
  console.log(`  sourceKey                       : ${s.key}`);
  console.log(`  label (name)                    : ${s.name}`);
  console.log(`  tab membership                  : ${tabs.join(', ')}`);
  console.log(`  in "Operativas IA"              : ${operativasKeys.has(key)}`);
  console.log(`  aiFlowStatus raw                : ${s.aiFlowStatus}`);
  console.log(`  aiFlowStatus label              : ${AI_FLOW_STATUS_LABELS[s.aiFlowStatus]}`);
  console.log(`  connectionMode raw              : ${s.connectionMode}`);
  console.log(`  connectionMode label            : ${CONNECTION_MODE_LABELS[s.connectionMode]}`);
  console.log(`  operationalStatus raw           : ${s.operationalStatus}`);
  console.log(`  operationalStatus label         : ${OPERATIONAL_STATUS_LABELS[s.operationalStatus]}`);
  console.log(`  action kind                     : ${action.kind}`);
  console.log(`  action label                    : ${action.label}`);
  console.log(`  shouldSkipGenericConnectionPanels: ${shouldSkipGenericConnectionPanels(s)}`);
  console.log(`  nextAction                      : ${s.nextAction}`);
}
