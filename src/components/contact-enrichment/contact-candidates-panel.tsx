import { Inbox, Sparkles, Mail, Link2 } from 'lucide-react';
import { DataTablePage } from '@/components/shared/data-table-page';
import { MetricCard } from '@/components/shared/metric-card';
import { CreateContactDrawer } from '@/components/contacts/create-contact-drawer';
import { ContactsEnrichmentCTA } from '@/components/contact-enrichment/contacts-enrichment-cta';
import { ContactsModuleTabsNav } from '@/components/navigation/contacts-module-tabs-nav';
import { ContactCandidatesDataTableClient } from '@/components/contact-enrichment/contact-candidates-data-table-client';
import { getPendingContactCandidates } from '@/modules/contact-enrichment/actions';
import { getAccountsList } from '@/modules/accounts/actions';
import { getCommercialScopeFilterOptions } from '@/modules/access/commercial-scope-filter-options';

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
  const [candidates, accountsList, scopeFilterOptions] = await Promise.all([
    getPendingContactCandidates(),
    getAccountsList(),
    getCommercialScopeFilterOptions(),
  ]);

  const accounts = accountsList.map((a) => ({ id: a.id, name: a.name }));
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
      />
    </DataTablePage>
  );
}
