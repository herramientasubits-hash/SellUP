import { Users, Crown, Target, Star } from 'lucide-react';
import { DataTablePage } from '@/components/shared/data-table-page';
import { MetricCard } from '@/components/shared/metric-card';
import { getAllContacts } from '@/modules/contacts/actions';
import { getAccountsList } from '@/modules/accounts/actions';
import { CreateContactDrawer } from '@/components/contacts/create-contact-drawer';
import { ContactsDataTableClient } from '@/components/contacts/contacts-data-table-client';

export default async function ContactsPage() {
  const [contacts, accountsList] = await Promise.all([
    getAllContacts(),
    getAccountsList(),
  ]);

  const accounts = accountsList.map((a) => ({ id: a.id, name: a.name }));

  const total = contacts.length;
  const decisionMakers = contacts.filter((c) => c.role_in_account === 'decision_maker').length;
  const champions = contacts.filter((c) => c.role_in_account === 'champion').length;
  const primary = contacts.filter((c) => c.is_primary).length;

  return (
    <DataTablePage
      title="Contactos"
      description="Centraliza decisores, sponsors y personas clave vinculadas a cuentas y prospectos."
      actions={<CreateContactDrawer accounts={accounts} />}
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
      <ContactsDataTableClient contacts={contacts} />
    </DataTablePage>
  );
}
