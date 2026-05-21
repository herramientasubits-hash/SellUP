import { Users, Crown, Target, Star, Archive } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { SurfaceCard } from '@/components/shared/surface-card';
import { getAllContacts } from '@/modules/contacts/actions';
import { getAccountsList } from '@/modules/accounts/actions';
import { CreateContactDrawer } from '@/components/contacts/create-contact-drawer';
import { ContactsTableClient } from '@/components/contacts/contacts-table-client';

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
  const inactiveOrArchived = contacts.filter((c) =>
    ['inactive', 'archived', 'left_company', 'do_not_contact'].includes(c.contact_status),
  ).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Contactos"
        description="Centraliza decisores, sponsors y personas clave vinculadas a cuentas y prospectos."
        actions={<CreateContactDrawer accounts={accounts} />}
      />

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          { icon: Users,  label: 'Total',     value: total,             color: 'text-foreground' },
          { icon: Crown,  label: 'Decisores', value: decisionMakers,    color: 'text-su-brand' },
          { icon: Target, label: 'Champions', value: champions,         color: 'text-emerald-500' },
          { icon: Star,   label: 'Primarios', value: primary,           color: 'text-amber-500' },
          { icon: Archive,label: 'Inactivos', value: inactiveOrArchived,color: 'text-muted-foreground' },
        ].map(({ icon: Icon, label, value, color }) => (
          <SurfaceCard key={label} className="p-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted/60">
                <Icon className={`h-3.5 w-3.5 ${color}`} />
              </div>
              <div>
                <p className="text-lg font-semibold leading-none text-foreground">{value}</p>
                <p className="mt-0.5 text-[10px] font-medium uppercase tracking-widest text-muted-foreground/50">
                  {label}
                </p>
              </div>
            </div>
          </SurfaceCard>
        ))}
      </div>

      {/* Tabla interactiva (client component) */}
      <ContactsTableClient contacts={contacts} />
    </div>
  );
}
