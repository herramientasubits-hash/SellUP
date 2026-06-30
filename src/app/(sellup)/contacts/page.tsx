import { Users, Crown, Target, Star } from 'lucide-react';
import { DataTablePage } from '@/components/shared/data-table-page';
import { MetricCard } from '@/components/shared/metric-card';
import { getAllContacts } from '@/modules/contacts/actions';
import { getAccountsList } from '@/modules/accounts/actions';
import { getCommercialScopeFilterOptions } from '@/modules/access/commercial-scope-filter-options';
import { CreateContactDrawer } from '@/components/contacts/create-contact-drawer';
import { ContactsDataTableClient } from '@/components/contacts/contacts-data-table-client';
import { ContactsEnrichmentCTA } from '@/components/contact-enrichment/contacts-enrichment-cta';
import { ContactsModuleTabsNav } from '@/components/navigation/contacts-module-tabs-nav';
import { ContactCandidatesPanel } from '@/components/contact-enrichment/contact-candidates-panel';

interface ContactsPageProps {
  searchParams: Promise<{ tab?: string }>;
}

export default async function ContactsPage({ searchParams }: ContactsPageProps) {
  const { tab } = await searchParams;

  // Tab "Candidatos por revisar" — staging de Apollo (Hito 17A.4A).
  if (tab === 'candidates') {
    return <ContactCandidatesPanel />;
  }

  // Tab por defecto: "Contactos aprobados" (comportamiento histórico de /contacts).
  // Las pills ya no muestran badge de conteo (ajuste posterior a 17A.4A), así que
  // no hace falta leer el staging de candidatos para el tab principal.
  const [contacts, accountsList, scopeFilterOptions] = await Promise.all([
    getAllContacts(),
    getAccountsList(),
    getCommercialScopeFilterOptions(),
  ]);

  const accounts = accountsList.map((a) => ({ id: a.id, name: a.name }));
  const accountOwners = new Map(
    accountsList.filter((a) => a.owner_id).map((a) => [a.id, a.owner_id!]),
  );

  const total = contacts.length;
  const decisionMakers = contacts.filter((c) => c.role_in_account === 'decision_maker').length;
  const champions = contacts.filter((c) => c.role_in_account === 'champion').length;
  const primary = contacts.filter((c) => c.is_primary).length;

  return (
    <DataTablePage
      title="Contactos"
      description="Centraliza decisores, sponsors y personas clave vinculadas a cuentas y prospectos."
      tabs={<ContactsModuleTabsNav active="approved" />}
      actions={
        <div className="flex items-center gap-2">
          <ContactsEnrichmentCTA />
          <CreateContactDrawer accounts={accounts} />
        </div>
      }
      metrics={
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            title="Total"
            description="Contactos registrados"
            value={total}
            icon={
              <div className="rounded-lg p-1.5 bg-muted/60">
                <Users className="h-4 w-4 text-foreground" />
              </div>
            }
          />
          <MetricCard
            title="Decisores"
            description="Decision makers"
            value={decisionMakers}
            icon={
              <div className="rounded-lg p-1.5 bg-su-brand-soft">
                <Crown className="h-4 w-4 text-su-brand" />
              </div>
            }
          />
          <MetricCard
            title="Champions"
            description="Contactos clave"
            value={champions}
            icon={
              <div className="rounded-lg p-1.5 bg-emerald-500/10">
                <Target className="h-4 w-4 text-emerald-500" />
              </div>
            }
          />
          <MetricCard
            title="Primarios"
            description="Primer contacto por cuenta"
            value={primary}
            icon={
              <div className="rounded-lg p-1.5 bg-amber-500/10">
                <Star className="h-4 w-4 text-amber-500" />
              </div>
            }
          />
        </div>
      }
    >
      <ContactsDataTableClient
        contacts={contacts}
        accountOwners={accountOwners}
        scopeFilterOptions={scopeFilterOptions}
      />
    </DataTablePage>
  );
}
