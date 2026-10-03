import {
  Briefcase,
  Brain,
  Calendar,
  CheckCircle2,
  MessageSquareText,
  ReceiptText,
  Target,
  UserSearch,
  type LucideIcon,
} from "@/icons";
import type { StatusType } from "@/components/data-display";
import type { ChartTone } from "@/components/charts/tone";
import type { MetricTone } from "@/components/shared/metric-card";
import { serializePipelineFilters, type PipelineFilters } from "@/modules/pipeline/pipeline-filters";
import type { PipelineStatus } from "@/modules/accounts/types";
import type {
  PipelineSignal,
  PipelineSignalId,
  PipelineSignalSeverity,
  PipelineStageId,
  PipelineStageState,
} from "@/modules/pipeline/types";

/** Textos y traducciones a piezas del sistema de la pantalla Pipeline. */

export const PIPELINE_TITLE = "Pipeline";
export const PIPELINE_DESCRIPTION =
  "En qué etapa del proceso de venta está cada empresa, qué pasó en cada una y qué falta.";

/**
 * El primer tramo de las migas: el mismo rótulo que el módulo en el menú
 * lateral (`mainNavItems`), para que la cabecera no repita la sección.
 */
export const PIPELINE_CRUMB_LABEL = "Pipeline SellUp";

/** Lo que dice la nota del resumen mientras las etapas de la derecha no tengan empresas. */
export const FUTURE_STAGES_NOTE = "Las etapas de Inteligencia a Cierre se activarán cuando existan sus agentes.";

/** A dónde va quien todavía no tiene empresas en el pipeline. */
export const PROSPECTS_HREF = "/accounts?tab=prospectos";

export type PipelineView = "recorrido" | "tablero";

export const PIPELINE_VIEWS: readonly { id: PipelineView; label: string }[] = [
  { id: "recorrido", label: "Recorrido" },
  { id: "tablero", label: "Tablero" },
];

export function resolvePipelineView(value: string | undefined): PipelineView {
  return value === "tablero" ? "tablero" : "recorrido";
}

/** La ruta de la pantalla con su vista y su empresa; lo que es por defecto no ensucia la URL. */
export function pipelineHref(view: PipelineView, accountId: string | null, filters?: PipelineFilters): string {
  const params = new URLSearchParams();
  if (view !== "recorrido") params.set("view", view);
  if (accountId) params.set("account", accountId);
  // Los filtros viajan con la vista: sobreviven a elegir empresa y a cambiar de vista.
  if (filters) {
    for (const [key, value] of Object.entries(serializePipelineFilters(filters))) params.set(key, value);
  }
  const query = params.toString();
  return query ? `/pipeline?${query}` : "/pipeline";
}

/** Nombre corto de cada etapa, para la pista, los chips y los badges. */
export const STAGE_SHORT_LABELS: Record<PipelineStageId, string> = {
  prospeccion: "Prospección",
  enriquecimiento: "Enriquecimiento",
  inteligencia: "Inteligencia",
  preparacion: "Preparación",
  reunion: "Reunión",
  cotizacion: "Cotización",
  venta_interna: "Venta interna",
  cierre: "Cierre",
};

/** El tono del chip de la etapa actual de una empresa. */
export const CURRENT_STAGE_STATUS: Record<"enriquecimiento" | "inteligencia" | "preparacion", StatusType> = {
  enriquecimiento: "info",
  inteligencia: "pending",
  preparacion: "active",
};

export function currentStageBadge(stageId: PipelineStageId | null): { status: StatusType; label: string } {
  if (!stageId) return { status: "inactive", label: "Archivada" };
  const status = CURRENT_STAGE_STATUS[stageId as keyof typeof CURRENT_STAGE_STATUS] ?? "neutral";
  return { status, label: STAGE_SHORT_LABELS[stageId] };
}

export const STAGE_STATE_BADGE: Record<PipelineStageState, { status: StatusType; label: string }> = {
  complete: { status: "completed", label: "Completada" },
  current: { status: "info", label: "Etapa actual" },
  upcoming: { status: "neutral", label: "Pendiente" },
  archived: { status: "inactive", label: "Archivada" },
};

export type SignalBadgeVariant = "negative" | "warning" | "neutral";

export const SIGNAL_BADGE_VARIANT: Record<PipelineSignalSeverity, SignalBadgeVariant> = {
  critical: "negative",
  alert: "warning",
  notice: "neutral",
};

/** Nombre de cada señal como filtro del resumen (sin la cifra de días). */
export const SIGNAL_FILTER_LABELS: Record<PipelineSignalId, string> = {
  sin_movimiento: "Sin movimiento",
  sin_contactos: "Sin contactos",
  sin_responsable: "Sin responsable",
  sin_hubspot: "Sin sincronizar con HubSpot",
  corrida_fallida: "Última corrida falló",
  decisor_sin_telefono: "Decisor sin teléfono",
};

export function hasCriticalSignal(signals: readonly PipelineSignal[]): boolean {
  return signals.some((signal) => signal.severity === "critical");
}

/** «hoy», «hace 1 día», «hace 12 días». */
export function daysAgoLabel(days: number): string {
  if (days <= 0) return "hoy";
  return days === 1 ? "hace 1 día" : `hace ${days} días`;
}

/** Los cuatro estados entre los que una persona mueve una empresa, con el nombre de su columna. */
export const BOARD_COLUMNS: readonly { status: Exclude<PipelineStatus, "archived">; title: string; description: string }[] = [
  { status: "new", title: "Nuevas", description: "Recién aprobadas: toca buscar sus contactos." },
  { status: "ready_for_research", title: "Listas para investigar", description: "Con contactos; falta el brief de la cuenta." },
  { status: "research_in_progress", title: "Investigación en curso", description: "Alguien está investigando la cuenta." },
  { status: "ready_for_outreach", title: "Listas para contacto", description: "Investigadas y listas para el primer acercamiento." },
];

export function boardColumnTitle(status: PipelineStatus): string {
  return BOARD_COLUMNS.find((column) => column.status === status)?.title ?? "Archivadas";
}

/** Proveedor u origen del prospecto (`source_primary`). Un valor desconocido se muestra tal cual. */
const SOURCE_PRIMARY_LABELS: Record<string, string> = {
  manual: "A mano",
  hubspot: "HubSpot",
  apollo: "Apollo",
  lusha: "Lusha",
  public_source: "Fuente pública",
  preloaded: "Catálogo precargado",
  web_ai: "Búsqueda web con IA",
  socrata_colombia: "Datos abiertos de Colombia",
  denue_mexico: "DENUE (México)",
  datos_gob_cl: "Datos abiertos de Chile",
  external_import: "Importación",
  other: "Otra",
};

export function sourcePrimaryLabel(value: string | null): string | null {
  if (!value) return null;
  return SOURCE_PRIMARY_LABELS[value] ?? value;
}

/** Qué pasó en HubSpot al aprobar el prospecto (`metadata.approval.hubspot.action`). */
const HUBSPOT_APPROVAL_LABELS: Record<string, string> = {
  created: "Se creó la empresa en HubSpot",
  linked_existing: "Ya existía en HubSpot: se vinculó",
  skipped_possible_match: "No se creó: había una posible coincidencia",
  skipped_not_configured: "Sin conexión con HubSpot",
  failed: "No se pudo crear en HubSpot",
  not_required: "No hizo falta enviarla a HubSpot",
};

export function hubspotApprovalLabel(action: string | null): string | null {
  if (!action) return null;
  return HUBSPOT_APPROVAL_LABELS[action] ?? null;
}

export function formatUsd(value: number): string {
  // Dos decimales, como cualquier importe; solo las fracciones de centavo conservan cuatro.
  return `US$ ${value.toFixed(value !== 0 && Math.abs(value) < 0.01 ? 4 : 2)}`;
}

/** Icono y tonos de cada etapa, en el resumen y en el reparto. */
export const STAGE_VISUAL: Record<PipelineStageId, { icon: LucideIcon; tone: MetricTone; chartTone: ChartTone }> = {
  prospeccion: { icon: Target, tone: "neutral", chartTone: "neutral" },
  enriquecimiento: { icon: UserSearch, tone: "info", chartTone: "brand" },
  inteligencia: { icon: Brain, tone: "warning", chartTone: "warning" },
  preparacion: { icon: MessageSquareText, tone: "positive", chartTone: "positive" },
  reunion: { icon: Calendar, tone: "brand", chartTone: "info" },
  cotizacion: { icon: ReceiptText, tone: "brand", chartTone: "negative" },
  venta_interna: { icon: Briefcase, tone: "brand", chartTone: "neutral" },
  cierre: { icon: CheckCircle2, tone: "positive", chartTone: "positive" },
};

// ── Mover de etapa con contexto ─────────────────────────────────

export const STAGE_MOVE_COPY = {
  title: (company: string, stage: string) => `Mover ${company} a «${stage}»`,
  question: "¿Cómo le damos a SellUp el contexto de esta etapa?",
  groupLabel: "Contexto de la etapa",
  ai: "Que lo haga la IA",
  aiBadge: "Recomendada",
  aiDescription: (agent: string) => `Abre el ${agent.charAt(0).toLowerCase()}${agent.slice(1)} en el panel lateral.`,
  aiSoon: "El agente de esta etapa llega pronto",
  aiUnavailable: "No se puede abrir el agente desde aquí",
  outside: "Ya lo hice por fuera",
  outsideDescription: "Sube los contactos o cuéntanos qué pasó.",
  outsideGroupLabel: "Qué hiciste por fuera",
  contacts: "Subir los contactos",
  contactsDescription: "Abre el alta de contactos de esta empresa.",
  contactsUnavailable: "No se pueden subir contactos desde aquí",
  hubspot: "Ya están en HubSpot: sincronizarlos",
  hubspotSoon: "Pronto: traer los contactos desde HubSpot",
  paste: "Pegar la información",
  pasteDescription: "Notas, contactos o el resumen de una reunión.",
  pasteLabel: "Lo que pasó en esta etapa",
  pasteHint: "Lo guardamos en las notas de la empresa. Más adelante la IA lo convertirá en datos.",
  none: "Moverla sin acción",
  noneDescription: "No recomendado: SellUp se queda sin contexto.",
  noneLabel: "Motivo",
  noneHint: "Una línea que explique por qué; se guarda en las notas de la empresa.",
  tooShort: (min: number) => `Escribe al menos ${min} caracteres.`,
  confirm: {
    pick: "Mover",
    ai: "Mover y abrir el agente",
    contacts: "Mover y subir los contactos",
    paste: "Mover y guardar",
    none: "Mover sin acción",
  },
  saving: "Moviendo…",
  failed: "No se pudo mover la empresa. Inténtalo de nuevo.",
} as const;
