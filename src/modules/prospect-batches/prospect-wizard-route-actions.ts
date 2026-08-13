'use server';

/**
 * READ-ONLY dry-route verifier action — Q3F-5BB.10C3-FIX-1 (P1-3)
 *
 * Resolves — server-side, through the CANONICAL flag parsers — which provider
 * the "Generar con IA" wizard WOULD use for the given criteria, and whether that
 * path could reach Apollo. It runs NO provider, NO wizard execution, NO Lusha
 * search, and performs NO database write.
 *
 * Sole purpose: a pre-QA gate. It lets an operator confirm, without opening the
 * wizard in production, that a Lusha-eligible search with ENABLE_LUSHA_PREVIEW
 * off resolves to `blocked_lusha_disabled` / `wouldUseApollo: false` — the exact
 * invariant whose absence caused the 10C3 incident.
 *
 * Import discipline (proven by prospect-wizard-route-static.test.ts): this file
 * imports the pure route resolver, the canonical flag helpers, the auth gate,
 * and the read-only catalog loader — and NOTHING that can spend: no execution
 * action, no Lusha/Apollo/Tavily client, no DB-write helper. Its only reads are
 * the authenticated user (auth) and the active industry catalog (needed to map
 * industria → Lusha sector).
 *
 * ── Estado: entrypoint DORMIDO (AGENT1-MACRO-CATALOG-PRE119-LEGACY-READERS-1 § 9)
 *
 * `resolveProspectWizardRouteAction` no tiene NINGÚN importador en runtime: la
 * única referencia en el repositorio es la ruta de este fichero dentro de
 * `prospect-wizard-route-static.test.ts`, que verifica su disciplina de imports.
 * Nadie —ni página, ni componente, ni otra acción— lo invoca. Se creó como puerta
 * de verificación previa a una QA manual y se dejó disponible para la siguiente.
 *
 * Por eso sigue usando `loadActiveCatalog`, que lee `active_industry_catalog` y
 * por tanto queda vacío bajo la taxonomía macro (esa vista hace INNER JOIN con
 * `subindustries`). La consecuencia está ACOTADA y es fail-closed: bajo el
 * catálogo v2 esta acción devolvería `CATALOG_UNAVAILABLE` en vez de una ruta.
 * No degrada a una ruta que pueda gastar, no afecta a ninguna superficie viva, y
 * su propósito —mapear industria → sector Lusha— es intrínsecamente de la
 * taxonomía legacy: `resolveProspectWizardRoute` razona sobre subindustrias.
 *
 * Si algún día se vuelve a conectar a una superficie viva, el cambio que toca es
 * enrutarlo por `loadActiveDiscoveryCatalog` y decidir qué significa la ruta
 * Lusha sin subindustrias — una decisión de producto, no una de compatibilidad.
 * Reescribirlo ahora sería ampliar el diff sin retirar ningún riesgo real.
 */

import {
  isLushaPreviewEnabled,
  isProspectChatWizardExecutionEnabled,
} from '@/lib/feature-flags.server';
import { loadActiveCatalog } from '@/modules/industry-catalog/loader';
import { requireActiveUser } from '@/modules/prospect-batches/actions';
import {
  resolveProspectWizardRoute,
  type ProspectWizardRoute,
} from '@/modules/prospect-batches/prospect-wizard-route';
import type { WizardLushaCriteriaState } from '@/modules/prospect-batches/wizard-lusha-criteria';

export interface ResolveProspectWizardRouteActionInput {
  countryCode: string | null;
  industryId: string | null;
  subindustryIds: string[];
  additionalCriteriaRaw: string | null;
}

export type ResolveProspectWizardRouteActionResult =
  | { ok: true; route: ProspectWizardRoute }
  | { ok: false; code: 'UNAUTHORIZED' | 'CATALOG_UNAVAILABLE' };

export async function resolveProspectWizardRouteAction(
  input: ResolveProspectWizardRouteActionInput,
): Promise<ResolveProspectWizardRouteActionResult> {
  try {
    await requireActiveUser();
  } catch {
    return { ok: false, code: 'UNAUTHORIZED' };
  }

  let catalog;
  try {
    catalog = await loadActiveCatalog();
  } catch {
    return { ok: false, code: 'CATALOG_UNAVAILABLE' };
  }

  const criteria: WizardLushaCriteriaState = {
    countryCode: input.countryCode,
    industryId: input.industryId,
    subindustryIds: input.subindustryIds,
    additionalCriteriaRaw: input.additionalCriteriaRaw,
  };

  const route = resolveProspectWizardRoute({
    criteria,
    catalog,
    lushaPreviewEnabled: isLushaPreviewEnabled(),
    executionEnabled: isProspectChatWizardExecutionEnabled(),
  });

  return { ok: true, route };
}
