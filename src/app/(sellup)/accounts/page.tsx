import { Suspense } from 'react';
import Link from 'next/link';
import { ClipboardCheck } from "@/icons";
import { ListActionRailProvider } from "@/components/action-rail";
import { DataTablePage } from '@/components/shared/data-table-page';
import { ListPageSkeleton } from '@/components/shared/list-page-skeleton';
import { buttonVariants } from '@/components/ui/button';
import { CreateAccountDrawer } from '@/components/accounts/create-account-drawer';
import { AccountsScreenActions } from '@/components/accounts/accounts-screen-actions';
import { AccountsDataTableClient } from '@/components/accounts/accounts-data-table-client';
import { ModuleTabsNav, type ModuleTabId } from '@/components/navigation/module-tabs-nav';
import {
  ProspectsModulePanel,
  type ProspectsPanelSearchParams,
} from '@/components/prospects/prospects-module-panel';
import {
  EMPRESAS_MODULE_TITLE,
  EMPRESAS_TAB_DESCRIPTIONS,
} from '@/components/prospects/empresas-module-copy';
import { PROSPECTOS_TAB_ROUTE } from '@/config/navigation';
import { getAccountsList, getActiveUsers } from '@/modules/accounts/actions';
import { getCommercialScopeFilterOptions } from '@/modules/access/commercial-scope-filter-options';

interface PageProps {
  searchParams: Promise<{ tab?: string } & ProspectsPanelSearchParams>;
}

const SKELETON_NOUN: Record<ModuleTabId, string> = {
  empresas: 'empresas',
  prospectos: 'empresas por revisar',
  descartadas: 'empresas descartadas',
};

export default async function AccountsPage({ searchParams }: PageProps) {
  // «Empresas» es la única entrada del módulo y aloja sus tres pestañas
  // (Empresas / Por revisar / Descartadas). «Por revisar» y «Descartadas» viven
  // aquí como pestañas internas: con `?tab=prospectos` se pinta su panel de
  // servidor en el sitio, sin salir del módulo ni cambiar de ruta.
  const { tab, ...prospectsParams } = await searchParams;
  const activeTab: ModuleTabId =
    tab !== 'prospectos' ? 'empresas' : prospectsParams.view === 'descartadas' ? 'descartadas' : 'prospectos';

  // Mientras llegan los datos se ve la pantalla con su forma (cabecera,
  // pestaña activa, tabla fantasma) en vez de la pantalla anterior congelada.
  // La `key` hace que el esqueleto vuelva a salir al cambiar de pestaña.
  return (
    <Suspense
      key={activeTab}
      fallback={
        <ListPageSkeleton
          title={EMPRESAS_MODULE_TITLE}
          description={EMPRESAS_TAB_DESCRIPTIONS[activeTab]}
          tabs={<ModuleTabsNav active={activeTab} />}
          noun={SKELETON_NOUN[activeTab]}
          columns={activeTab === 'empresas' ? 7 : 6}
          // «Descartadas» no tiene barra flotante de acciones.
          reserveActionRail={activeTab !== 'descartadas'}
        />
      }
    >
      {activeTab === 'empresas' ? <AccountsPanel /> : <ProspectsModulePanel params={prospectsParams} />}
    </Suspense>
  );
}

async function AccountsPanel() {
  const [accounts, users, scopeFilterOptions] = await Promise.all([
    getAccountsList(),
    getActiveUsers(),
    getCommercialScopeFilterOptions(),
  ]);

  return (
    <ListActionRailProvider label="Acciones de empresas" gender="f">
      <DataTablePage
        compact
        title={EMPRESAS_MODULE_TITLE}
        description={EMPRESAS_TAB_DESCRIPTIONS.empresas}
        tabs={<ModuleTabsNav active="empresas" counts={{ empresas: accounts.length }} />}
        actions={<AccountsScreenActions users={users} />}
      >
        <AccountsDataTableClient
          accounts={accounts}
          users={users}
          scopeFilterOptions={scopeFilterOptions}
          emptyActions={
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Link
                href={PROSPECTOS_TAB_ROUTE}
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                <ClipboardCheck aria-hidden="true" />
                Revisar prospectos
              </Link>
              <CreateAccountDrawer users={users} />
            </div>
          }
        />
      </DataTablePage>
    </ListActionRailProvider>
  );
}
