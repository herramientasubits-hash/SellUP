// TABLEROS-1 — «Tableros»: el análisis del uso del sistema y de lo enriquecido.
//
// Quién ve qué (dueño 25-11), con el alcance comercial de siempre:
//   - admin: todo el equipo comercial;
//   - líder/manager: su gente en cascada (grupos + reportes);
//   - BD/KAM: SÓLO su propia actividad, aunque pegue otro id en la URL.
// Los datos empiezan el 11-11-2026 (lanzamiento a los equipos internos).
//
// Fase 1: sólo lee tablas que ya existen. Lo que necesita tablas nuevas está en
// la pestaña «Lo que falta» y en docs/tableros-faltantes.md.

import { Lock } from "@/icons";
import { PageHeader } from "@/components/shared/page-header";
import { InfoHint } from "@/components/shared/info-hint";
import { EmptyState } from "@/components/ui/empty-state";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { TabsContent } from "@/components/ui/tabs";
import { UrlTabs, type UrlTab } from "@/components/navigation/url-tabs";
import { countryName } from "@/components/shared/table-cells";
import { loadDashboard } from "@/modules/dashboards/dashboard-queries.server";
import {
  DASHBOARDS_LAUNCH_DAY,
  describeRange,
  parseDashboardFilters,
  toDashboardQuery,
} from "@/modules/dashboards/dashboard-filters";
import { DASHBOARD_SOURCE_ORDER, dashboardSourceLabel } from "@/modules/dashboards/dashboard-sources";
import { DashboardFiltersClient, type DashboardFilterOptions } from "./dashboard-filters-client";
import { SavedViewsMenu } from "./saved-views-client";
import { CompaniesSection, ContactsSection, PendingWorkSection, SummarySection, TeamSection } from "./dashboard-sections";

// Lecturas vivas (revisiones y búsquedas cambian a cada rato): nunca de caché.
export const dynamic = "force-dynamic";

const BASE_TABS: readonly UrlTab[] = [
  { id: "resumen", label: "Resumen" },
  { id: "empresas", label: "Empresas" },
  { id: "contactos", label: "Contactos" },
];
const TEAM_TAB: UrlTab = { id: "equipo", label: "Equipo" };
const PENDING_TAB: UrlTab = { id: "lo-que-falta", label: "Lo que falta" };

const DESCRIPTION_BY_SCOPE = {
  admin: "El uso del sistema y lo que se enriqueció, de todo el equipo comercial.",
  team: "El uso del sistema y lo que se enriqueció, de tu equipo.",
  self: "Tu actividad: lo que buscaste y lo que aprobaste. Sólo tú ves estas cifras.",
} as const;

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function readParam(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

function launchLabel(): string {
  const [year, month, day] = DASHBOARDS_LAUNCH_DAY.split("-");
  return `${Number(day)}/${Number(month)}/${year}`;
}

export default async function DashboardsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const filters = parseDashboardFilters(params);
  const result = await loadDashboard(filters, { countryLabel: (code) => countryName(code) ?? code });

  const howItIsMeasured = (
    <InfoHint label="Cómo se mide" showLabel>
      Lo buscado y lo pendiente por revisar es uso del sistema; sólo lo aprobado cuenta como enriquecido. El uso
      se acredita a quien buscó y lo enriquecido a quien aprobó. Los datos empiezan el {launchLabel()}, día del
      lanzamiento.
    </InfoHint>
  );

  if (result.kind === "denied") {
    return (
      <div className="space-y-6">
        <PageHeader title="Tableros" description="El uso del sistema y lo que se enriqueció." actions={howItIsMeasured} />
        <EmptyState
          icon={Lock}
          title="No pudimos saber quién eres"
          description="Vuelve a iniciar sesión. Si sigue pasando, pide ayuda a una persona administradora."
        />
      </div>
    );
  }

  const { data, range, directory, scopeKind } = result;
  const options: DashboardFilterOptions = {
    scopeKind,
    users: directory.users,
    groups: directory.groups,
    sources: DASHBOARD_SOURCE_ORDER.map((key) => ({ value: key, label: dashboardSourceLabel(key) })),
    countries: directory.countries.map((code) => ({ value: code, label: countryName(code) ?? code })),
  };

  const currentQuery = new URLSearchParams(
    Object.entries(params).flatMap(([key, value]) => (typeof value === "string" ? [[key, value]] : [])),
  ).toString();
  const personHref = (id: string) => {
    const query = toDashboardQuery(currentQuery, { ...filters, people: [id] });
    return query ? `/dashboards?${query}` : "/dashboards";
  };

  const tabs = [...BASE_TABS, ...(scopeKind === "self" ? [] : [TEAM_TAB]), PENDING_TAB];
  const ignored = result.ignoredTeams.length + (scopeKind === "self" ? 0 : result.ignoredPeople.length);
  const now = Date.parse(result.now);

  return (
    <div className="space-y-6">
      <PageHeader
        title={scopeKind === "self" ? "Tableros · Mi actividad" : "Tableros"}
        description={DESCRIPTION_BY_SCOPE[scopeKind]}
        actions={
          <>
            <DashboardFiltersClient part="controls" options={options} filters={filters} />
            <SavedViewsMenu />
            {howItIsMeasured}
          </>
        }
      />

      <DashboardFiltersClient part="chips" options={options} filters={filters} />

      <p className="text-sm text-muted-foreground">
        {describeRange(range)}
        {range.clampedToLaunch && ` · Los datos empiezan el ${launchLabel()}, día del lanzamiento.`}
      </p>

      {range.isEmpty && (
        <Alert variant="warning" role="note">
          <AlertTitle>El periodo es anterior al lanzamiento</AlertTitle>
          <AlertDescription>
            SellUp se lanzó a los equipos internos el {launchLabel()}. Elige un periodo desde esa fecha.
          </AlertDescription>
        </Alert>
      )}

      {result.readErrors.length > 0 && (
        <Alert variant="destructive">
          <AlertTitle>No se pudieron leer todas las cifras</AlertTitle>
          <AlertDescription>
            Faltan: {result.readErrors.join(", ")}. Lo que ves puede estar incompleto; vuelve a cargar en unos minutos.
          </AlertDescription>
        </Alert>
      )}

      {result.truncated && (
        <Alert variant="warning" role="note">
          <AlertTitle>Las cifras pueden quedarse cortas</AlertTitle>
          <AlertDescription>Hay más registros de los que se pueden leer de una vez. Elige un periodo más corto.</AlertDescription>
        </Alert>
      )}

      {ignored > 0 && (
        <Alert variant="warning" role="note">
          <AlertTitle>Algún filtro no aplica</AlertTitle>
          <AlertDescription>
            Hay equipos o personas en el enlace que no están en tu alcance; no se muestran.
          </AlertDescription>
        </Alert>
      )}

      <UrlTabs ariaLabel="Secciones de los tableros" tabs={tabs} initialTab={readParam(params.tab)}>
        <TabsContent value="resumen">
          <SummarySection data={data} scopeKind={scopeKind} />
        </TabsContent>
        <TabsContent value="empresas">
          <CompaniesSection data={data} />
        </TabsContent>
        <TabsContent value="contactos">
          <ContactsSection data={data} />
        </TabsContent>
        {scopeKind !== "self" && (
          <TabsContent value="equipo">
            <TeamSection teams={data.teams} people={data.people} personHref={personHref} now={now} />
          </TabsContent>
        )}
        <TabsContent value="lo-que-falta">
          <PendingWorkSection />
        </TabsContent>
      </UrlTabs>
    </div>
  );
}
