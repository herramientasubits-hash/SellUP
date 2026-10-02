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
import { Breadcrumbs } from '@/components/navigation/breadcrumbs';
import {
  ProspectsModulePanel,
  loadGenerateProspectsAgent,
  type ProspectsPanelSearchParams,
} from '@/components/prospects/prospects-module-panel';
import {
  EMPRESAS_TAB_DESCRIPTIONS,
  EMPRESAS_VIEW_TITLES,
  empresasViewCrumbs,
  type ModuleTabId,
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
  // «Empresas» aloja sus tres vistas (Empresas / Por revisar / Descartadas), a
  // las que se llega desde el menú lateral: con `?tab=prospectos` se pinta su
  // panel de servidor en el sitio, sin cambiar de ruta. La página no lleva
  // pestañas: el título dice la vista y las migas, el módulo.
  const { tab, ...prospectsParams } = await searchParams;
  const activeTab: ModuleTabId =
    tab !== 'prospectos' ? 'empresas' : prospectsParams.view === 'descartadas' ? 'descartadas' : 'prospectos';

  // Mientras llegan los datos se ve la pantalla con su forma (cabecera,
  // tabla fantasma) en vez de la pantalla anterior congelada.
  // La `key` hace que el esqueleto vuelva a salir al cambiar de pestaña.
  const skeletonCrumbs = empresasViewCrumbs(activeTab);

  return (
    <Suspense
      key={activeTab}
      fallback={
        <ListPageSkeleton
          title={EMPRESAS_VIEW_TITLES[activeTab]}
          description={EMPRESAS_TAB_DESCRIPTIONS[activeTab]}
          breadcrumbs={skeletonCrumbs ? <Breadcrumbs items={skeletonCrumbs} /> : undefined}
          noun={SKELETON_NOUN[activeTab]}
          columns={activeTab === 'empresas' ? 7 : 6}
        />
      }
    >
      {activeTab === 'empresas' ? <AccountsPanel /> : <ProspectsModulePanel params={prospectsParams} />}
    </Suspense>
  );
}

async function AccountsPanel() {
  // El agente «Generar con IA» es el mismo asistente de «Por revisar», resuelto
  // por la misma carga de servidor y en paralelo con los datos de la pestaña.
  const [accounts, users, scopeFilterOptions, generateAgent] = await Promise.all([
    getAccountsList(),
    getActiveUsers(),
    getCommercialScopeFilterOptions(),
    loadGenerateProspectsAgent(),
  ]);

  return (
    <ListActionRailProvider label="Acciones de empresas" gender="f">
      <DataTablePage
        compact
        title={EMPRESAS_VIEW_TITLES.empresas}
        description={EMPRESAS_TAB_DESCRIPTIONS.empresas}
        actions={<AccountsScreenActions users={users} generateAgent={generateAgent} />}
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
