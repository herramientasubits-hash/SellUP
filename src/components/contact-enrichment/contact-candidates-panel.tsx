import { ListActionRailProvider } from "@/components/action-rail";
import { DataTablePage } from '@/components/shared/data-table-page';
import {
  CONTACTOS_TAB_DESCRIPTIONS,
  CONTACTOS_VIEW_TITLES,
  contactosViewCrumbs,
} from '@/components/contacts/contacts-module-copy';
import { ContactsScreenActions } from '@/components/contacts/contacts-screen-actions';
import { Breadcrumbs } from '@/components/navigation/breadcrumbs';
import { ContactCandidatesDataTableClient } from '@/components/contact-enrichment/contact-candidates-data-table-client';
import {
  getDuplicateContactCandidates,
  getPendingContactCandidates,
  getRejectedContactCandidates,
} from '@/modules/contact-enrichment/actions';
import { getAccountsList, getActiveAccountsForPicker } from '@/modules/accounts/actions';
import { getCommercialScopeFilterOptions } from '@/modules/access/commercial-scope-filter-options';
import { getCurrentUser } from '@/modules/access/actions';
import { getHubSpotPortalId } from '@/server/agents/prospecting-toolkit/hubspot-duplicate-checker';
import {
  isApolloPhoneRevealEnabled,
  isLushaPhoneRevealFallbackEnabled,
  isPhoneRevealWaterfallEnabled,
} from '@/lib/feature-flags.server';
import { LUSHA_PHONE_FALLBACK_AUTHORIZED_ROLE_KEYS } from '@/modules/contact-enrichment/lusha-phone-fallback-core';
// Autoridad CANÓNICA del reveal, IMPORTADA en vez de copiada
// (AGENT2A-WATERFALL-DEFAULT-REVEAL-BEHAVIOR-1). Aquí había una copia literal de la
// pareja `['admin', 'commercial_manager']`: dos listas que "eran espejo" por
// convención, no por construcción. Resuelto server-side; el server action revalida.
import { isPhoneRevealRoleAuthorized } from '@/modules/contact-enrichment/phone-reveal-authorized-roles';

// 4O-H3-B-R1 / AGENT2A-P0-R2 — el tipo de cola vive en su propio módulo sin runtime para que
// también lo pueda importar la tabla (client component) sin arrastrar este server component.
export type { ContactCandidatesQueue } from './contact-candidates-panel-queue';
import type { ContactCandidatesQueue } from './contact-candidates-panel-queue';

interface ContactCandidatesPanelProps {
  queue?: ContactCandidatesQueue;
}

/**
 * Tab "Candidatos por revisar" del módulo Contactos (Hito 17A.4A).
 *
 * Renderiza `contact_enrichment_candidates` en `pending_review` con el contexto
 * de empresa del run. Es un listado de solo lectura: aprobar/rechazar y crear
 * contactos finales llegan en 17A.4B — aquí NO hay acciones de mutación. Mantiene
 * el header y los CTAs del módulo para no perder el wizard
 * conversacional ni "Crear contacto".
 */
export async function ContactCandidatesPanel({
  queue = 'pending',
}: ContactCandidatesPanelProps = {}) {
  const isDuplicateQueue = queue === 'duplicates';
  const view = queue === 'duplicates' ? 'duplicates' : queue === 'rejected' ? 'rejected' : 'candidates';

  const [candidates, accountsList, accounts, scopeFilterOptions, currentUser, hubspotPortalId] =
    await Promise.all([
      // 4O-H3-B-R1: dos colas, dos lecturas. Los duplicados NO se mezclan en el listado de
      // pendientes: un duplicado ya tiene veredicto y lo que espera es otra decisión.
      isDuplicateQueue
        ? getDuplicateContactCandidates()
        : queue === 'rejected'
          ? getRejectedContactCandidates()
          : getPendingContactCandidates(),
      getAccountsList(),
      getActiveAccountsForPicker(),
      getCommercialScopeFilterOptions(),
      getCurrentUser(),
      // Para que «HubSpot ID empresa» abra la ficha en el portal correcto. Sin conexión: null.
      getHubSpotPortalId(),
    ]);

  // Gobierno del reveal de teléfono (PHONE-3D.4): el flag y el rol se resuelven
  // aquí (server component) y viajan como booleanos planos. Con el flag OFF
  // (default de producción) el botón "Revelar teléfono" no se renderiza.
  // AGENT2A-CONTACTOS-RECHAZADOS: sobre un rechazado no se gastan créditos; para revelar,
  // primero se envía a revisar. Por eso en esa cola los botones de reveal no existen.
  const isRejectedQueue = queue === 'rejected';
  const phoneRevealEnabled = !isRejectedQueue && isApolloPhoneRevealEnabled();
  const phoneRevealAuthorized = isPhoneRevealRoleAuthorized(currentUser?.role_key ?? null);

  // Gobierno del fallback Lusha (LUSHA-PHONE-FALLBACK-1): flag + rol se
  // resuelven aquí (server component) y viajan como booleanos planos. Con el
  // flag OFF (default de producción) el botón no se renderiza en ningún caso.
  const lushaPhoneFallbackEnabled = !isRejectedQueue && isLushaPhoneRevealFallbackEnabled();
  const lushaPhoneFallbackAuthorized =
    !!currentUser?.role_key &&
    LUSHA_PHONE_FALLBACK_AUTHORIZED_ROLE_KEYS.includes(currentUser.role_key);

  // Gobierno del waterfall Apollo → Lusha (AGENT2A-PHONE-WATERFALL-1, contrato de
  // Product corregido en AGENT2A-WATERFALL-DEFAULT-REVEAL-BEHAVIOR-1): el ROL ya no
  // lo estrecha. El waterfall es el comportamiento NORMAL del botón «Revelar
  // teléfono» para cualquier actor que ya pudiera revelar, y el único interruptor es
  // el flag. Con el flag OFF (default histórico) la UI conserva el flujo Apollo-only.
  //
  // `phoneRevealWaterfallAuthorized` se DERIVA de `phoneRevealAuthorized` en vez de
  // recalcularse: es literalmente la misma pregunta, y recalcularla es lo que
  // permitiría que las dos respuestas volvieran a divergir.
  const phoneRevealWaterfallEnabled = !isRejectedQueue && isPhoneRevealWaterfallEnabled();
  const phoneRevealWaterfallAuthorized = phoneRevealAuthorized;

  const accountOwners = new Map(
    accountsList.filter((a) => a.owner_id).map((a) => [a.id, a.owner_id!]),
  );

  // Los indicadores (alta relevancia, con email, con LinkedIn) los calcula la
  // tabla sobre estas mismas filas y los ofrece como filtros de un toque.
  return (
    <ListActionRailProvider label="Acciones de contactos" gender="m">
    <DataTablePage
      compact
      title={CONTACTOS_VIEW_TITLES[view]}
      description={CONTACTOS_TAB_DESCRIPTIONS[view]}
      // 4O-H3-B-R1 (§ 11): cada cola cuenta lo suyo en el título de su tabla;
      // los duplicados nunca se suman a «Por revisar».
      breadcrumbs={<Breadcrumbs items={contactosViewCrumbs(view) ?? []} />}
      // AGENT2A-CONTACTOS-RECHAZADOS: en «Contactos rechazados» no se crea ni se busca: la barra
      // sólo ofrece «Enviar a revisar» sobre lo que se marque o abra.
      actions={queue === 'rejected' ? undefined : <ContactsScreenActions accounts={accounts} />}
    >
      <ContactCandidatesDataTableClient
        candidates={candidates}
        // AGENT2A-P0-R2: la tabla necesita saber en qué cola está. Sin esto su título y su
        // estado vacío se anunciaban siempre como «Candidatos por revisar», contradiciendo
        // a la pill «Duplicados» que estaba justo encima.
        queue={queue}
        accountOwners={accountOwners}
        scopeFilterOptions={scopeFilterOptions}
        phoneRevealEnabled={phoneRevealEnabled}
        phoneRevealAuthorized={phoneRevealAuthorized}
        lushaPhoneFallbackEnabled={lushaPhoneFallbackEnabled}
        lushaPhoneFallbackAuthorized={lushaPhoneFallbackAuthorized}
        phoneRevealWaterfallEnabled={phoneRevealWaterfallEnabled}
        phoneRevealWaterfallAuthorized={phoneRevealWaterfallAuthorized}
        hubspotPortalId={hubspotPortalId}
      />
    </DataTablePage>
    </ListActionRailProvider>
  );
}
