import { Inbox, Sparkles, Mail, Link2 } from 'lucide-react';
import { DataTablePage } from '@/components/shared/data-table-page';
import { MetricCard } from '@/components/shared/metric-card';
import { CreateContactDrawer } from '@/components/contacts/create-contact-drawer';
import { ContactsEnrichmentCTA } from '@/components/contact-enrichment/contacts-enrichment-cta';
import { ContactsModuleTabsNav } from '@/components/navigation/contacts-module-tabs-nav';
import { ContactCandidatesDataTableClient } from '@/components/contact-enrichment/contact-candidates-data-table-client';
import { getPendingContactCandidates } from '@/modules/contact-enrichment/actions';
import { getAccountsList, getActiveAccountsForPicker } from '@/modules/accounts/actions';
import { getCommercialScopeFilterOptions } from '@/modules/access/commercial-scope-filter-options';
import { getCurrentUser } from '@/modules/access/actions';
import {
  isApolloPhoneRevealEnabled,
  isLushaPhoneRevealFallbackEnabled,
  isPhoneRevealWaterfallEnabled,
} from '@/lib/feature-flags.server';
import { LUSHA_PHONE_FALLBACK_AUTHORIZED_ROLE_KEYS } from '@/modules/contact-enrichment/lusha-phone-fallback-core';
import { PHONE_REVEAL_WATERFALL_AUTHORIZED_ROLE_KEYS } from '@/modules/contact-enrichment/phone-reveal-waterfall-core';

// Roles autorizados a revelar teléfono (PHONE-3D.4). Espejo del gate del server
// action (PHONE_REVEAL_AUTHORIZED_ROLE_KEYS en phone-reveal-core): Administrador
// y Manager comercial. Resuelto server-side; el server action revalida el rol.
const PHONE_REVEAL_AUTHORIZED_ROLE_KEYS = ['admin', 'commercial_manager'] as const;

/**
 * Tab "Candidatos por revisar" del módulo Contactos (Hito 17A.4A).
 *
 * Renderiza `contact_enrichment_candidates` en `pending_review` con el contexto
 * de empresa del run. Es un listado de solo lectura: aprobar/rechazar y crear
 * contactos finales llegan en 17A.4B — aquí NO hay acciones de mutación. Mantiene
 * el header, los CTAs y el switcher de pills del módulo para no perder el wizard
 * conversacional ni "Crear contacto".
 */
export async function ContactCandidatesPanel() {
  const [candidates, accountsList, accounts, scopeFilterOptions, currentUser] =
    await Promise.all([
      getPendingContactCandidates(),
      getAccountsList(),
      getActiveAccountsForPicker(),
      getCommercialScopeFilterOptions(),
      getCurrentUser(),
    ]);

  // Gobierno del reveal de teléfono (PHONE-3D.4): el flag y el rol se resuelven
  // aquí (server component) y viajan como booleanos planos. Con el flag OFF
  // (default de producción) el botón "Revelar teléfono" no se renderiza.
  const phoneRevealEnabled = isApolloPhoneRevealEnabled();
  const phoneRevealAuthorized =
    !!currentUser?.role_key &&
    (PHONE_REVEAL_AUTHORIZED_ROLE_KEYS as readonly string[]).includes(
      currentUser.role_key,
    );

  // Gobierno del fallback Lusha (LUSHA-PHONE-FALLBACK-1): flag + rol se
  // resuelven aquí (server component) y viajan como booleanos planos. Con el
  // flag OFF (default de producción) el botón no se renderiza en ningún caso.
  const lushaPhoneFallbackEnabled = isLushaPhoneRevealFallbackEnabled();
  const lushaPhoneFallbackAuthorized =
    !!currentUser?.role_key &&
    LUSHA_PHONE_FALLBACK_AUTHORIZED_ROLE_KEYS.includes(currentUser.role_key);

  // Gobierno del waterfall Apollo → Lusha (AGENT2A-PHONE-WATERFALL-1): flag + rol
  // se resuelven aquí (server component) y viajan como booleanos planos. Es
  // admin-only, más estrecho que el reveal Apollo: con el flag OFF (default de
  // producción) o un rol `commercial_manager`, la UI conserva el flujo Apollo-only.
  const phoneRevealWaterfallEnabled = isPhoneRevealWaterfallEnabled();
  const phoneRevealWaterfallAuthorized =
    !!currentUser?.role_key &&
    PHONE_REVEAL_WATERFALL_AUTHORIZED_ROLE_KEYS.includes(currentUser.role_key);

  const accountOwners = new Map(
    accountsList.filter((a) => a.owner_id).map((a) => [a.id, a.owner_id!]),
  );

  const total = candidates.length;
  const highRelevance = candidates.filter(
    (c) => c.enrichment_metadata?.relevance?.status === 'high_relevance',
  ).length;
  const withEmail = candidates.filter((c) => !!c.email).length;
  const withLinkedin = candidates.filter((c) => !!c.linkedin_url).length;

  return (
    <DataTablePage
      title="Contactos"
      description="Centraliza decisores, sponsors y personas clave vinculadas a cuentas y prospectos."
      tabs={<ContactsModuleTabsNav active="candidates" />}
      actions={
        <div className="flex items-center gap-2">
          <ContactsEnrichmentCTA />
          <CreateContactDrawer accounts={accounts} />
        </div>
      }
      metrics={
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            title="Por revisar"
            description="Candidatos pendientes"
            value={total}
            icon={
              <div className="rounded-lg p-1.5 bg-amber-500/10">
                <Inbox className="h-4 w-4 text-amber-500" />
              </div>
            }
          />
          <MetricCard
            title="Alta relevancia"
            description="Mejor encaje detectado"
            value={highRelevance}
            icon={
              <div className="rounded-lg p-1.5 bg-su-brand-soft">
                <Sparkles className="h-4 w-4 text-su-brand" />
              </div>
            }
          />
          <MetricCard
            title="Con email"
            description="Tienen correo"
            value={withEmail}
            icon={
              <div className="rounded-lg p-1.5 bg-emerald-500/10">
                <Mail className="h-4 w-4 text-emerald-500" />
              </div>
            }
          />
          <MetricCard
            title="Con LinkedIn"
            description="Tienen perfil"
            value={withLinkedin}
            icon={
              <div className="rounded-lg p-1.5 bg-blue-500/10">
                <Link2 className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              </div>
            }
          />
        </div>
      }
    >
      <ContactCandidatesDataTableClient
        candidates={candidates}
        accountOwners={accountOwners}
        scopeFilterOptions={scopeFilterOptions}
        phoneRevealEnabled={phoneRevealEnabled}
        phoneRevealAuthorized={phoneRevealAuthorized}
        lushaPhoneFallbackEnabled={lushaPhoneFallbackEnabled}
        lushaPhoneFallbackAuthorized={lushaPhoneFallbackAuthorized}
        phoneRevealWaterfallEnabled={phoneRevealWaterfallEnabled}
        phoneRevealWaterfallAuthorized={phoneRevealWaterfallAuthorized}
      />
    </DataTablePage>
  );
}
