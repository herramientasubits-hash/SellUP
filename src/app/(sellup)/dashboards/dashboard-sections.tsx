// TABLEROS-1 — Las pestañas de /dashboards. Sólo presentación: todo llega
// calculado de `computeDashboard`. Convención de los tableros: lo de USO (buscado,
// pendiente) va separado de lo que es RESULTADO (aprobado = enriquecido).

import Link from "next/link";
import { Clock, Database, Users } from "@/icons";
import { BarList, type BarListItem } from "@/components/charts/BarList";
import { DistributionBar } from "@/components/charts/DistributionBar";
import { DonutChart } from "@/components/charts/DonutChart";
import { TableShell } from "@/components/data-display";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MetricStrip, type MetricStripItem } from "@/components/shared/metric-strip";
import { Frame, FrameHeader, FramePanel } from "@/components/shared/frame";
import type { CountItem, DashboardData, PersonRow, TeamRow } from "@/modules/dashboards/dashboard-core";
import type { DashboardScopeKind } from "@/modules/dashboards/dashboard-scope";
import { CompletenessBySourceChart, SeriesBarChart, SeriesLineChart } from "./dashboard-charts";

const CHART_ROW = "grid gap-4 lg:grid-cols-2";
const NUMERIC_CELL = "text-right tabular-nums text-muted-foreground";
const DONUT_HEIGHT = 260;
const RANKING_LIMIT = 10;

const COUNT_FORMAT = new Intl.NumberFormat("es-CO");
export const formatCount = (value: number) => COUNT_FORMAT.format(value);
export const formatRate = (value: number | null) => (value === null ? "—" : `${value.toLocaleString("es-CO")} %`);

function items(list: readonly CountItem[]): BarListItem[] {
  return list.map((item) => ({ id: item.key, label: item.label, value: item.value }));
}

function donutData(list: readonly CountItem[]) {
  return list.map((item) => ({ label: item.label, value: item.value }));
}

function relativeDays(iso: string | null, now: number): string {
  if (!iso) return "Sin movimiento";
  const days = Math.floor((now - Date.parse(iso)) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "Hoy";
  if (days === 1) return "Ayer";
  return `Hace ${days} días`;
}

// ── Resumen ────────────────────────────────────────────────────────────────────

export function SummarySection({ data, scopeKind }: { data: DashboardData; scopeKind: DashboardScopeKind }) {
  const { usage, results } = data;
  const pendingTotal = usage.pendingCompanies + usage.pendingContacts;
  const oldPending = data.pendingAging.find((row) => row.key === "8_plus");
  const oldPendingTotal = (oldPending?.companies ?? 0) + (oldPending?.contacts ?? 0);

  const usageItems: MetricStripItem[] = [
    { label: "Búsquedas de empresas", value: formatCount(usage.companySearches), description: "búsquedas lanzadas" },
    { label: "Solicitudes de contactos", value: formatCount(usage.contactRequests), description: "empresas a las que se buscaron contactos" },
    {
      label: "Encontrado",
      value: formatCount(usage.companiesFound + usage.contactsFound),
      description: `${formatCount(usage.companiesFound)} empresas · ${formatCount(usage.contactsFound)} contactos`,
      hint: "Lo que trajeron las búsquedas del periodo, de las fuentes elegidas. Es uso: todavía no es resultado.",
    },
    {
      label: "Pendiente por revisar",
      value: formatCount(pendingTotal),
      description: `${formatCount(usage.pendingCompanies)} empresas · ${formatCount(usage.pendingContacts)} contactos`,
      hint: "De lo encontrado en el periodo, lo que nadie ha aprobado ni descartado.",
      aside: oldPendingTotal > 0 ? <Badge variant="warning">{formatCount(oldPendingTotal)} con más de 7 días</Badge> : undefined,
    },
    scopeKind === "self"
      ? { label: "Días con actividad", value: formatCount(usage.activeDays), description: "días en que buscaste o revisaste" }
      : { label: "Personas activas", value: formatCount(usage.activePeople), description: "buscaron o revisaron algo" },
  ];

  const resultItems: MetricStripItem[] = [
    {
      label: "Empresas enriquecidas",
      value: formatCount(results.companiesEnriched),
      description: `${formatCount(results.companiesApproved)} aprobadas · ${formatCount(results.hubspotCompaniesEnriched)} de HubSpot completadas`,
      hint: "Empresas aprobadas en la revisión más empresas de HubSpot a las que SellUp les completó datos («Enriquecer empresa de HubSpot»).",
    },
    {
      label: "Contactos enriquecidos",
      value: formatCount(results.contactsEnriched),
      description: `${formatCount(results.contactsFromHubspot)} ya estaban en HubSpot · ${formatCount(results.contactsNew)} nuevos`,
      hint: "Contactos aprobados en la revisión. «Ya estaban en HubSpot»: SellUp completó un contacto que existía; «nuevos»: no estaban.",
    },
    {
      label: "Tasa de aprobación",
      value: formatRate(results.approvalRate),
      description: "de lo revisado, cuánto se aprobó",
      hint: "Aprobado ÷ (aprobado + descartado + duplicado), empresas y contactos juntos.",
    },
    {
      label: "Contactos completos",
      value: formatRate(results.contactsFullRate),
      description: `${formatCount(results.contactsFull)} con correo, teléfono y LinkedIn`,
    },
  ];

  return (
    <div className="space-y-6">
      <MetricStrip title="Uso del sistema" description="Lo que se buscó y lo que espera revisión." items={usageItems} aria-label="Uso del sistema" />
      <MetricStrip
        title="Resultados"
        description="Sólo lo aprobado o revisado cuenta como enriquecido."
        items={resultItems}
        aria-label="Resultados"
      />
      <section aria-label="Uso y resultado en el tiempo" className={CHART_ROW}>
        <SeriesBarChart
          title="Encontrado frente a enriquecido"
          description="Empresas y contactos juntos. Claro: encontrado (uso). Fuerte: enriquecido (resultado)."
          set={data.overview}
          usageKeys={["found"]}
        />
        <DistributionBar
          title="Pendiente por revisar, por antigüedad"
          description="Lo encontrado en el periodo que aún nadie revisó."
          unit="por revisar"
          formatValue={formatCount}
          segments={data.pendingAging.map((row) => ({
            id: row.key,
            label: row.label,
            value: row.companies + row.contacts,
            tone: row.key === "0_2" ? "positive" : row.key === "3_7" ? "warning" : "negative",
            hint: `${formatCount(row.companies)} empresas · ${formatCount(row.contacts)} contactos`,
          }))}
          emptyLabel="No hay nada pendiente por revisar."
        />
      </section>
      {data.comparison && (
        <SeriesLineChart
          title="Comparativa por persona"
          description="Empresas y contactos enriquecidos (aprobados) por periodo, de cada persona elegida."
          set={data.comparison}
        />
      )}
    </div>
  );
}

// ── Empresas ───────────────────────────────────────────────────────────────────

export function CompaniesSection({ data }: { data: DashboardData }) {
  const { usage, results, companies } = data;
  const hubspotTotal = companies.hubspotOutcome.reduce((sum, item) => sum + item.value, 0);
  const metrics: MetricStripItem[] = [
    { label: "Búsquedas", value: formatCount(usage.companySearches), description: "búsquedas de empresas" },
    { label: "Encontradas", value: formatCount(usage.companiesFound), description: "por esas búsquedas" },
    { label: "Por revisar", value: formatCount(usage.pendingCompanies), description: "de lo encontrado" },
    {
      label: "Enriquecidas",
      value: formatCount(results.companiesEnriched),
      description: `${formatCount(results.companiesApproved)} aprobadas · ${formatCount(results.hubspotCompaniesEnriched)} de HubSpot`,
    },
    {
      label: "Tasa de aprobación",
      value: formatRate(
        results.companiesApproved + results.companiesRejected > 0
          ? Math.round((results.companiesApproved / (results.companiesApproved + results.companiesRejected)) * 1000) / 10
          : null,
      ),
      description: `${formatCount(results.companiesRejected)} descartadas o duplicadas`,
    },
  ];

  return (
    <div className="space-y-6">
      <MetricStrip items={metrics} aria-label="Cifras de empresas" />
      <section aria-label="Empresas en el tiempo" className={CHART_ROW}>
        <SeriesBarChart
          title="Empresas enriquecidas por periodo"
          description="Aprobadas y de HubSpot completadas, por fuente (o agrupadas, según el filtro)."
          set={companies.results}
          stacked
        />
        <SeriesLineChart
          title="Tasa de aprobación de empresas"
          description="De las empresas revisadas en cada periodo, cuántas se aprobaron."
          set={companies.approvalRate}
          percent
        />
      </section>
      <section aria-label="Cómo son las empresas enriquecidas" className={CHART_ROW}>
        <BarList
          title="Por tamaño"
          description="Empresas enriquecidas por número de empleados. El segmento interno llega después."
          items={items(companies.bySize)}
          sorted={false}
          formatValue={formatCount}
          emptyLabel="Aún no hay empresas enriquecidas en el periodo."
        />
        <BarList
          title="Por país"
          items={items(companies.byCountry)}
          formatValue={formatCount}
          limit={RANKING_LIMIT}
          emptyLabel="Aún no hay empresas enriquecidas en el periodo."
        />
      </section>
      <section aria-label="Industria y fuente" className={CHART_ROW}>
        <BarList
          title="Por industria"
          description={companies.byIndustry.length > RANKING_LIMIT ? `Las ${RANKING_LIMIT} con más empresas.` : undefined}
          items={items(companies.byIndustry)}
          formatValue={formatCount}
          limit={RANKING_LIMIT}
          emptyLabel="Aún no hay empresas enriquecidas en el periodo."
        />
        <BarList
          title="Por fuente"
          description="De dónde vino cada empresa enriquecida."
          items={items(companies.bySource)}
          formatValue={formatCount}
          emptyLabel="Aún no hay empresas enriquecidas en el periodo."
        />
      </section>
      <section aria-label="Empresas de HubSpot" className={CHART_ROW}>
        <DistributionBar
          title="Enriquecer empresa de HubSpot"
          description={`Pedidos terminados en el periodo: ${formatCount(hubspotTotal)}.`}
          unit="empresas"
          formatValue={formatCount}
          segments={companies.hubspotOutcome.map((item) => ({
            id: item.key,
            label: item.label,
            value: item.value,
            tone: item.key === "completed" ? "positive" : item.key === "partial" ? "warning" : "neutral",
          }))}
          emptyLabel="Nadie pidió enriquecer una empresa de HubSpot en el periodo."
        />
        <BarList
          title="Qué datos completó SellUp"
          description="En las empresas de HubSpot enriquecidas (una empresa puede sumar varios)."
          items={items(companies.filledFields)}
          formatValue={formatCount}
          emptyLabel="Aún no hay datos completados en el periodo."
        />
      </section>
    </div>
  );
}

// ── Contactos ──────────────────────────────────────────────────────────────────

export function ContactsSection({ data }: { data: DashboardData }) {
  const { usage, results, contacts } = data;
  const metrics: MetricStripItem[] = [
    { label: "Solicitudes", value: formatCount(usage.contactRequests), description: "empresas a las que se buscaron contactos" },
    { label: "Encontrados", value: formatCount(usage.contactsFound), description: "candidatos que trajeron" },
    { label: "Por revisar", value: formatCount(usage.pendingContacts), description: "de lo encontrado" },
    {
      label: "Enriquecidos",
      value: formatCount(results.contactsEnriched),
      description: `${formatCount(results.contactsFromHubspot)} de HubSpot · ${formatCount(results.contactsNew)} nuevos`,
    },
    {
      label: "Completos",
      value: formatRate(results.contactsFullRate),
      description: "con correo, teléfono y LinkedIn",
      hint: "Cuenta lo del candidato y lo que quedó en el contacto de SellUp (un teléfono revelado después de aprobar también suma).",
    },
  ];

  return (
    <div className="space-y-6">
      <MetricStrip items={metrics} aria-label="Cifras de contactos" />
      <section aria-label="Solicitudes en el tiempo" className={CHART_ROW}>
        <SeriesBarChart
          title="Solicitudes por periodo y estado"
          description="«Enriquecida»: tiene al menos un contacto aprobado. Lo demás es uso."
          set={contacts.requestStates}
          stacked
          semantic
        />
        <SeriesLineChart
          title="Tasa de enriquecimiento por periodo"
          description="De las solicitudes de cada periodo, cuántas terminaron con un contacto aprobado."
          set={contacts.enrichmentRate}
          percent
        />
      </section>
      <section aria-label="Contactos enriquecidos" className={CHART_ROW}>
        <SeriesBarChart
          title="Contactos enriquecidos por periodo"
          description="Aprobados, por fuente (o agrupados, según el filtro)."
          set={contacts.results}
          stacked
        />
        <DonutChart
          title="Completos frente a faltantes"
          description="Contactos enriquecidos según los datos que tienen."
          data={donutData(contacts.completeness)}
          height={DONUT_HEIGHT}
          seriesName="Contactos"
          empty={contacts.completeness.length === 0}
          summary={contacts.completeness.map((item) => `${item.label}: ${item.value}`).join(" · ")}
        />
      </section>
      <section aria-label="Completitud y seniority" className={CHART_ROW}>
        <CompletenessBySourceChart
          title="Completitud por fuente"
          description="Qué le falta a lo que trae cada fuente. Entre paréntesis, cuántos contactos."
          rows={contacts.completenessBySource}
        />
        <BarList
          title="Por seniority"
          items={items(contacts.seniority)}
          sorted={false}
          formatValue={formatCount}
          emptyLabel="Aún no hay contactos enriquecidos en el periodo."
        />
      </section>
      <section aria-label="Procedencia" className={CHART_ROW}>
        <DistributionBar
          title="Procedencia"
          description="¿El contacto ya estaba en HubSpot o es nuevo?"
          unit="contactos"
          formatValue={formatCount}
          segments={contacts.origin.map((item) => ({
            id: item.key,
            label: item.label,
            value: item.value,
            tone: item.key === "new" ? "brand" : "info",
          }))}
          emptyLabel="Aún no hay contactos enriquecidos en el periodo."
        />
        <BarList
          title="Qué datos completó SellUp en HubSpot"
          description="En contactos que ya estaban en HubSpot: campos vacíos allá que SellUp llenó."
          items={items(contacts.hubspotFilled)}
          formatValue={formatCount}
          emptyLabel="Aún no hay datos completados en HubSpot en el periodo."
        />
      </section>
    </div>
  );
}

// ── Equipo (admin y líderes) ───────────────────────────────────────────────────

function HeaderCells({ labels }: { labels: readonly string[] }) {
  return (
    <TableHeader>
      <TableRow>
        {labels.map((label, index) => (
          <TableHead key={label} scope="col" className={index === 0 ? "text-left" : "text-right"}>
            {label}
          </TableHead>
        ))}
      </TableRow>
    </TableHeader>
  );
}

const TEAM_COLUMNS = ["Equipo", "Personas", "Búsquedas", "Solicitudes", "Encontrado", "Por revisar", "Enriquecido", "Aprobación"];
const PERSON_COLUMNS = [
  "Persona",
  "Equipo",
  "Búsquedas",
  "Solicitudes",
  "Encontrado",
  "Por revisar",
  "Empresas enriq.",
  "Contactos enriq.",
  "Aprobación",
  "Último movimiento",
];

export function TeamSection({
  teams,
  people,
  personHref,
  now,
}: {
  teams: readonly TeamRow[];
  people: readonly PersonRow[];
  /** Enlace que filtra el tablero por una persona. */
  personHref: (id: string) => string;
  now: number;
}) {
  return (
    <div className="space-y-6">
      <TableShell
        title="Por equipo"
        description="El uso y los resultados de cada equipo. Un equipo suma a sus personas (las de sus subequipos van en el suyo)."
        empty={teams.length === 0}
        emptyState={<EmptyState variant="plain" icon={Users} title="Nadie coincide con estos filtros" />}
      >
        <Table>
          <HeaderCells labels={TEAM_COLUMNS} />
          <TableBody>
            {teams.map((team) => (
              <TableRow key={team.key}>
                <TableCell className="font-medium text-foreground">{team.name}</TableCell>
                <TableCell className={NUMERIC_CELL}>{formatCount(team.people)}</TableCell>
                <TableCell className={NUMERIC_CELL}>{formatCount(team.companySearches)}</TableCell>
                <TableCell className={NUMERIC_CELL}>{formatCount(team.contactRequests)}</TableCell>
                <TableCell className={NUMERIC_CELL}>{formatCount(team.found)}</TableCell>
                <TableCell className={NUMERIC_CELL}>{formatCount(team.pending)}</TableCell>
                <TableCell className="text-right font-medium tabular-nums text-foreground">{formatCount(team.enriched)}</TableCell>
                <TableCell className={NUMERIC_CELL}>{formatRate(team.approvalRate)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableShell>

      <TableShell
        title="Por persona"
        description="El uso se acredita a quien buscó; lo enriquecido, a quien aprobó. Quien no hizo nada aparece en cero. Pulsa un nombre para ver su tablero."
        empty={people.length === 0}
        emptyState={<EmptyState variant="plain" icon={Users} title="Nadie coincide con estos filtros" />}
      >
        <Table>
          <HeaderCells labels={PERSON_COLUMNS} />
          <TableBody>
            {people.map((person) => {
              const active =
                person.companySearches + person.contactRequests + person.companiesEnriched + person.contactsEnriched + person.rejected > 0;
              return (
                <TableRow key={person.id} className={active ? undefined : "opacity-60"}>
                  <TableCell>
                    <div className="flex flex-col">
                      <Link href={personHref(person.id)} className="font-medium text-foreground hover:text-primary hover:underline">
                        {person.name}
                      </Link>
                      {person.email && <span className="text-xs text-muted-foreground">{person.email}</span>}
                    </div>
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">{person.teamName}</TableCell>
                  <TableCell className={NUMERIC_CELL}>{formatCount(person.companySearches)}</TableCell>
                  <TableCell className={NUMERIC_CELL}>{formatCount(person.contactRequests)}</TableCell>
                  <TableCell className={NUMERIC_CELL}>{formatCount(person.companiesFound + person.contactsFound)}</TableCell>
                  <TableCell className={NUMERIC_CELL}>{formatCount(person.pending)}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums text-foreground">{formatCount(person.companiesEnriched)}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums text-foreground">{formatCount(person.contactsEnriched)}</TableCell>
                  <TableCell className={NUMERIC_CELL}>{formatRate(person.approvalRate)}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{relativeDays(person.lastActivityAt, now)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableShell>
    </div>
  );
}

// ── Lo que falta ───────────────────────────────────────────────────────────────

const PENDING_WORK: readonly { title: string; detail: string; unlocks: string }[] = [
  {
    title: "Registro de enriquecimiento",
    detail:
      "Una fila por cada vez que SellUp completa un dato de una empresa o un contacto: qué campo, de qué fuente, quién lo pidió, quién lo aprobó y cuándo. Hoy sólo queda el ÚLTIMO estado de cada registro.",
    unlocks: "Historial exacto, detalle por campo y fuente, y no perder nada si alguien vuelve a revisar.",
  },
  {
    title: "Tabla de vistas guardadas",
    detail: "Hoy las vistas viven en el navegador de cada persona y se comparten con un enlace.",
    unlocks: "Que las vistas sigan a la persona en cualquier equipo y se puedan compartir con el equipo.",
  },
  {
    title: "Sumas en la base de datos",
    detail: "Hoy las cifras se calculan en el servidor leyendo las filas del periodo; desde el 11-11 el volumen es bajo.",
    unlocks: "Tableros rápidos con años de datos y muchos equipos.",
  },
  {
    title: "Segmento de empresa",
    detail: "Es un cálculo interno de Ubits que aún no vive en SellUp. Mientras tanto se corta por Tamaño.",
    unlocks: "Cortar empresas y resultados por segmento.",
  },
];

const KNOWN_LIMITS: readonly string[] = [
  "Los datos completados son el último estado de cada empresa o contacto, no cada evento.",
  "«Enriquecer empresa de HubSpot» no pasa por aprobación: se acredita a quien lo pidió, cuando terminó. Lo demás se acredita a quien aprobó.",
  "Las búsquedas y solicitudes no tienen fuente: el filtro de fuente aplica a lo encontrado y a lo aprobado.",
  "Si alguien revisa dos veces el mismo registro, cuenta la última revisión.",
  "Los datos empiezan el 11 de noviembre de 2026, día del lanzamiento a los equipos internos.",
];

export function PendingWorkSection() {
  return (
    <div className="space-y-6">
      <Frame>
        <FrameHeader
          title="Lo que falta para el resto de la reportería"
          description="Necesita tablas nuevas en la base de datos. Está anotado en docs/tableros-faltantes.md."
        />
        <FramePanel>
          <ul className="divide-y divide-border/60">
            {PENDING_WORK.map((item) => (
              <li key={item.title} className="flex gap-3 py-3 first:pt-0 last:pb-0">
                <Database className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-medium text-foreground">{item.title}</p>
                  <p className="text-sm text-muted-foreground">{item.detail}</p>
                  <p className="text-sm text-foreground">
                    <span className="text-muted-foreground">Habilita: </span>
                    {item.unlocks}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </FramePanel>
      </Frame>
      <Frame>
        <FrameHeader title="Cómo leer las cifras de hoy" description="Limitaciones de esta primera versión." />
        <FramePanel>
          <ul className="space-y-2">
            {KNOWN_LIMITS.map((limit) => (
              <li key={limit} className="flex gap-2 text-sm text-muted-foreground">
                <Clock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span>{limit}</span>
              </li>
            ))}
          </ul>
        </FramePanel>
      </Frame>
    </div>
  );
}
