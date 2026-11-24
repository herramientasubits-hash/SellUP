import { Suspense } from 'react';
import { ListActionRailProvider } from "@/components/action-rail";
import { DataTablePage } from '@/components/shared/data-table-page';
import { ListPageSkeleton } from '@/components/shared/list-page-skeleton';
import { AccountsScreenActions } from '@/components/accounts/accounts-screen-actions';
import { AccountsDataTableClient } from '@/components/accounts/accounts-data-table-client';
import { loadAccountNextSteps } from '@/modules/accounts/next-step.server';
import { loadAccountListSignals } from '@/modules/accounts/list-signals.server';
import { getHubSpotPortalId } from '@/server/agents/prospecting-toolkit/hubspot-duplicate-checker';
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
import { getAccountsList, getActiveUsers } from '@/modules/accounts/actions';
import { getCommercialScopeFilterOptions } from '@/modules/access/commercial-scope-filter-options';
import { getCurrentUser } from '@/modules/access/actions';
import { isAgent3FirstCallEnabled } from '@/lib/feature-flags.server';
import { checkCapability } from '@/modules/access/capabilities.server';
import { SearchesPanel } from '@/components/searches/searches-panel';

interface PageProps {
  /** `focus`: en Búsquedas, la búsqueda que se pidió ver («Ver búsqueda» desde Por revisar). */
  searchParams: Promise<{ tab?: string; focus?: string } & ProspectsPanelSearchParams>;
}

const SKELETON_NOUN: Record<ModuleTabId, string> = {
  empresas: 'empresas',
  busquedas: 'búsquedas',
  prospectos: 'empresas por revisar',
  descartadas: 'empresas descartadas',
};

// Prod 24-11 — «Aprobar» en masa en Prospectos corre en esta ruta: cada aprobación crea la
// empresa y su ficha en HubSpot, de a una (hasta 25). Necesita más que el tiempo por defecto.
export const maxDuration = 300;

export default async function AccountsPage({ searchParams }: PageProps) {
  // «Empresas» aloja sus tres vistas (Empresas / Por revisar / Descartadas), a
  // las que se llega desde el menú lateral: con `?tab=prospectos` se pinta su
  // panel de servidor en el sitio, sin cambiar de ruta. La página no lleva
  // pestañas: el título dice la vista y las migas, el módulo.
  const { tab, focus, ...prospectsParams } = await searchParams;
  const activeTab: ModuleTabId =
    tab === 'busquedas'
      ? 'busquedas'
      : tab !== 'prospectos'
        ? 'empresas'
        : prospectsParams.view === 'descartadas'
          ? 'descartadas'
          : 'prospectos';

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
          columns={activeTab === 'empresas' ? 10 : 6}
        />
      }
    >
      {activeTab === 'empresas' ? (
        <AccountsPanel />
      ) : activeTab === 'busquedas' ? (
        <SearchesPanel focusSearchId={focus ?? null} />
      ) : (
        <ProspectsModulePanel params={prospectsParams} />
      )}
    </Suspense>
  );
}

async function AccountsPanel() {
  // El agente «Generar con IA» es el mismo asistente de «Por revisar», resuelto
  // por la misma carga de servidor y en paralelo con los datos de la pestaña.
  const [accounts, users, scopeFilterOptions, generateAgent, currentUser, enrichBulkCheck, hubspotPortalId] = await Promise.all([
    getAccountsList(),
    getActiveUsers(),
    getCommercialScopeFilterOptions(),
    loadGenerateProspectsAgent(),
    getCurrentUser(),
    checkCapability('enriquecerMasivo'),
    // Para abrir la empresa en HubSpot desde la tabla (como en Contactos).
    getHubSpotPortalId(),
  ]);
  const canEnrichBulk = enrichBulkCheck.ok;
  // El siguiente paso de cada empresa (contactos, Agente 2 y Agente 3), en lotes.
  // Y sus cifras de la lista (contactos, actividad en SellUp y HubSpot), en paralelo.
  const [nextSteps, signals] = await Promise.all([loadAccountNextSteps(accounts), loadAccountListSignals(accounts)]);
  const accountsWithSteps = accounts.map((account) => ({
    ...account,
    next_step: nextSteps[account.id],
    signals: signals[account.id],
  }));
  // ALWAYS-OWNER-ON-CREATE-1 — al crear una empresa, el responsable por defecto es quien la crea.
  const currentUserId = currentUser?.id ?? null;

  return (
    <ListActionRailProvider label="Acciones de empresas" gender="f">
      <DataTablePage
        compact
        title={EMPRESAS_VIEW_TITLES.empresas}
        description={EMPRESAS_TAB_DESCRIPTIONS.empresas}
        actions={
          <AccountsScreenActions users={users} currentUserId={currentUserId} generateAgent={generateAgent} firstCallEnabled={isAgent3FirstCallEnabled()} />
        }
      >
        <AccountsDataTableClient
          accounts={accountsWithSteps}
          users={users}
          scopeFilterOptions={scopeFilterOptions}
          firstCallEnabled={isAgent3FirstCallEnabled()}
          canEnrichBulk={canEnrichBulk}
          hubspotPortalId={hubspotPortalId}
        />
      </DataTablePage>
    </ListActionRailProvider>
  );
}
