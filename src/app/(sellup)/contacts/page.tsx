import { Suspense } from 'react';
import { ListActionRailProvider } from "@/components/action-rail";
import { DataTablePage } from '@/components/shared/data-table-page';
import { ListPageSkeleton } from '@/components/shared/list-page-skeleton';
import { getAllContacts } from '@/modules/contacts/actions';
import { getAccountsList, getActiveAccountsForPicker } from '@/modules/accounts/actions';
import { getCommercialScopeFilterOptions } from '@/modules/access/commercial-scope-filter-options';
import { CreateContactDrawer } from '@/components/contacts/create-contact-drawer';
import { ContactsDataTableClient } from '@/components/contacts/contacts-data-table-client';
import { ContactsScreenActions } from '@/components/contacts/contacts-screen-actions';
import {
  CONTACTOS_TAB_DESCRIPTIONS,
  CONTACTOS_VIEW_TITLES,
  contactosViewCrumbs,
  type ContactsTabId,
} from '@/components/contacts/contacts-module-copy';
import { Breadcrumbs } from '@/components/navigation/breadcrumbs';
import { ContactsEnrichmentCTA } from '@/components/contact-enrichment/contacts-enrichment-cta';
import { ContactCandidatesPanel } from '@/components/contact-enrichment/contact-candidates-panel';

interface ContactsPageProps {
  searchParams: Promise<{ tab?: string }>;
}

const SKELETON_NOUN: Record<ContactsTabId, string> = {
  approved: 'contactos',
  candidates: 'candidatos por revisar',
  duplicates: 'candidatos duplicados',
  rejected: 'contactos rechazados',
};

export default async function ContactsPage({ searchParams }: ContactsPageProps) {
  const { tab } = await searchParams;
  const activeTab: ContactsTabId =
    tab === 'candidates'
      ? 'candidates'
      : tab === 'duplicates'
        ? 'duplicates'
        : tab === 'rejected'
          ? 'rejected'
          : 'approved';

  // Mientras llegan los datos se ve la pantalla con su forma (cabecera,
  // tabla fantasma) en vez de la pantalla anterior congelada.
  // La `key` hace que el esqueleto vuelva a salir al cambiar de pestaña.
  const skeletonCrumbs = contactosViewCrumbs(activeTab);

  return (
    <Suspense
      key={activeTab}
      fallback={
        <ListPageSkeleton
          title={CONTACTOS_VIEW_TITLES[activeTab]}
          description={CONTACTOS_TAB_DESCRIPTIONS[activeTab]}
          breadcrumbs={skeletonCrumbs ? <Breadcrumbs items={skeletonCrumbs} /> : undefined}
          noun={SKELETON_NOUN[activeTab]}
          columns={7}
        />
      }
    >
      <ContactsTabPanel tab={tab} />
    </Suspense>
  );
}

function ContactsTabPanel({ tab }: { tab?: string }) {
  // Pestaña «Por revisar» — staging de Apollo (Hito 17A.4A).
  if (tab === 'candidates') {
    return <ContactCandidatesPanel queue="pending" />;
  }

  // Cola de duplicados (4O-H3-B-R1) — candidatos que la detección movió a `duplicate` y que
  // siguen esperando una decisión humana. Antes de este hito no había forma de volver a
  // abrirlos: la cola de pendientes filtra `pending_review` y los dejaba fuera para siempre.
  if (tab === 'duplicates') {
    return <ContactCandidatesPanel queue="duplicates" />;
  }

  // «Contactos rechazados» (AGENT2A-CONTACTOS-RECHAZADOS) — candidatos que un humano rechazó.
  if (tab === 'rejected') {
    return <ContactCandidatesPanel queue="rejected" />;
  }

  // Pestaña por defecto: «Contactos» (comportamiento histórico de /contacts).
  return <ApprovedContactsPanel />;
}

async function ApprovedContactsPanel() {
  const [contacts, accountsList, pickerAccounts, scopeFilterOptions] = await Promise.all([
    getAllContacts(),
    getAccountsList(),
    getActiveAccountsForPicker(),
    getCommercialScopeFilterOptions(),
  ]);

  const accounts = pickerAccounts;
  const accountOwners = new Map(
    accountsList.filter((a) => a.owner_id).map((a) => [a.id, a.owner_id!]),
  );

  // Los indicadores (decisores, champions, primarios) los calcula la tabla sobre
  // estas mismas filas y los ofrece como filtros de un toque.
  return (
    <ListActionRailProvider label="Acciones de contactos" gender="m">
      <DataTablePage
        compact
        title={CONTACTOS_VIEW_TITLES.approved}
        description={CONTACTOS_TAB_DESCRIPTIONS.approved}
        actions={<ContactsScreenActions accounts={accounts} />}
      >
        <ContactsDataTableClient
          contacts={contacts}
          accountOwners={accountOwners}
          scopeFilterOptions={scopeFilterOptions}
          emptyActions={
            <div className="flex flex-wrap items-center justify-center gap-2">
              <ContactsEnrichmentCTA />
              <CreateContactDrawer accounts={accounts} triggerVariant="outline" />
            </div>
          }
        />
      </DataTablePage>
    </ListActionRailProvider>
  );
}
