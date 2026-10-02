import type { ReactNode } from "react";
import { CheckCircle2, CircleDashed, Clock, ShieldCheck, WifiOff, XCircle, type LucideIcon } from "@/icons";

import { cn } from "@/lib/utils";
import { formatAppDateTime } from "@/lib/format-date";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { SurfaceCard, SurfaceCardHeader } from "@/components/shared/surface-card";
import { StatusBadge, type StatusType } from "@/components/data-display/status-badge";
import { Heading } from '@/components/typography';

// ─── Estado de la conexión ────────────────────────────────────────────────────

export type IntegrationHealth = "connected" | "error" | "disconnected" | "not_tested" | "not_connected";

interface HealthPresentation {
  label: string;
  /** Qué significa y qué hacer, en una frase. */
  hint: (name: string) => string;
  icon: LucideIcon;
  status: StatusType;
  iconClassName: string;
}

const HEALTH: Record<IntegrationHealth, HealthPresentation> = {
  connected: {
    label: "Conectado",
    hint: (name) => `SellUp puede hablar con ${name}.`,
    icon: CheckCircle2,
    status: "active",
    iconClassName: "bg-success/10 text-success",
  },
  error: {
    label: "Con error",
    hint: (name) => `La última prueba con ${name} falló. Revisa el aviso y vuelve a probar.`,
    icon: XCircle,
    status: "error",
    iconClassName: "bg-destructive/10 text-destructive",
  },
  disconnected: {
    label: "Desconectado",
    hint: (name) => `${name} se desconectó. Vuelve a conectarlo para seguir usándolo.`,
    icon: WifiOff,
    status: "warning",
    iconClassName: "bg-warning/15 text-warning",
  },
  not_tested: {
    label: "Sin probar",
    hint: () => "La credencial está guardada. Prueba la conexión para confirmar que funciona.",
    icon: Clock,
    status: "neutral",
    iconClassName: "bg-surface-muted text-muted-foreground",
  },
  not_connected: {
    label: "Sin conectar",
    hint: (name) => `Conecta ${name} para empezar a usarlo desde SellUp.`,
    icon: CircleDashed,
    status: "inactive",
    iconClassName: "bg-surface-muted text-muted-foreground",
  },
};

/**
 * Traduce lo que guarda la conexión a un solo estado legible. Sin credencial
 * no hay nada que probar: es «Sin conectar», diga lo que diga el estado.
 */
export function resolveIntegrationHealth(
  hasCredential: boolean,
  connectionStatus: string | null | undefined,
): IntegrationHealth {
  if (!hasCredential) return "not_connected";
  if (connectionStatus === "connected" || connectionStatus === "error" || connectionStatus === "disconnected") {
    return connectionStatus;
  }
  return "not_tested";
}

export interface IntegrationFact {
  label: string;
  value: ReactNode;
}

interface IntegrationStatusCardProps {
  /** Cómo se llama la herramienta: «HubSpot», «Slack». */
  name: string;
  hasCredential: boolean;
  connectionStatus: string | null | undefined;
  lastTestedAt: string | null | undefined;
  lastError?: string | null;
  /** Datos que le sirven a quien usa la integración (canal, cuenta). Lo técnico va en «Detalles técnicos». */
  facts?: readonly IntegrationFact[];
  /** Los botones: probar, conectar, reconectar. */
  children?: ReactNode;
  className?: string;
}

/**
 * IntegrationStatusCard — lo primero que se ve en la pantalla de una
 * integración: si funciona, cuándo se probó por última vez, qué falló y qué se
 * puede hacer ahora. Una sola tarjeta en vez de «estado» y «acciones» por
 * separado.
 */
export function IntegrationStatusCard({
  name,
  hasCredential,
  connectionStatus,
  lastTestedAt,
  lastError,
  facts = [],
  children,
  className,
}: IntegrationStatusCardProps) {
  const health = resolveIntegrationHealth(hasCredential, connectionStatus);
  const presentation = HEALTH[health];
  const Icon = presentation.icon;

  return (
    <SurfaceCard className={cn("flex flex-col gap-5", className)}>
      <div className="flex items-start gap-4">
        <span
          aria-hidden
          className={cn("flex size-11 shrink-0 items-center justify-center rounded-xl", presentation.iconClassName)}
        >
          <Icon className="size-5" />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Heading level={6} as="h2" className="leading-tight">
              Estado de la conexión
            </Heading>
            <StatusBadge status={presentation.status} label={presentation.label} />
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">{presentation.hint(name)}</p>
        </div>
      </div>

      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="text-xs font-medium text-muted-foreground">Última prueba</dt>
          <dd className="mt-0.5 text-sm text-foreground">
            {lastTestedAt ? formatAppDateTime(lastTestedAt) : <span className="text-text-muted">Aún no se ha probado</span>}
          </dd>
        </div>
        {facts.map((fact) => (
          <div key={fact.label} className="min-w-0">
            <dt className="text-xs font-medium text-muted-foreground">{fact.label}</dt>
            <dd className="mt-0.5 break-words text-sm text-foreground">{fact.value}</dd>
          </div>
        ))}
      </dl>

      {lastError && (
        <Alert variant="destructive">
          <p className="text-sm font-semibold">Lo que falló la última vez</p>
          <p className="break-words text-xs leading-relaxed">{lastError}</p>
        </Alert>
      )}

      {children && <div className="border-t border-border/60 pt-4">{children}</div>}

      <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
        <ShieldCheck aria-hidden className="mt-0.5 size-3.5 shrink-0 text-primary" />
        La credencial se guarda cifrada en el servidor: nunca se muestra en el navegador ni queda en registros.
      </p>
    </SurfaceCard>
  );
}

// ─── Qué puede hacer SellUp con la integración ───────────────────────────────

export type CapabilityState = "ready" | "missing" | "pending" | "soon" | "off";

export interface IntegrationCapability {
  label: string;
  state: CapabilityState;
  /** Qué hace falta para tenerla. Solo se lee cuando falta. */
  hint?: string;
}

const CAPABILITY_BADGE: Record<CapabilityState, { label: string; variant: "positive" | "warning" | "neutral" }> = {
  ready: { label: "Disponible", variant: "positive" },
  missing: { label: "Falta permiso", variant: "warning" },
  // Aún no se sabe: no hay conexión o no se ha probado.
  pending: { label: "Por comprobar", variant: "neutral" },
  soon: { label: "Próximamente", variant: "neutral" },
  off: { label: "No incluido", variant: "neutral" },
};

interface IntegrationCapabilitiesProps {
  name: string;
  description?: string;
  capabilities: readonly IntegrationCapability[];
  /** Un resumen encima de la lista (p. ej. si ya se puede sincronizar). */
  children?: ReactNode;
  className?: string;
}

/**
 * IntegrationCapabilities — qué puede hacer SellUp con la herramienta, dicho en
 * tareas («Crear contactos») y no en permisos (`crm.objects.contacts.write`).
 */
export function IntegrationCapabilities({
  name,
  description,
  capabilities,
  children,
  className,
}: IntegrationCapabilitiesProps) {
  return (
    <SurfaceCard className={className}>
      <SurfaceCardHeader title={`Qué puede hacer SellUp con ${name}`} description={description} />
      <div className="space-y-4">
        {children}
        <ul className="divide-y divide-border/60">
          {capabilities.map((capability) => {
            const badge = CAPABILITY_BADGE[capability.state];
            const isAvailable = capability.state === "ready";
            return (
              <li key={capability.label} className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className={cn("text-sm", isAvailable ? "text-foreground" : "text-muted-foreground")}>
                    {capability.label}
                  </p>
                  {capability.hint && capability.state === "missing" && (
                    <p className="mt-0.5 text-xs leading-relaxed text-warning">{capability.hint}</p>
                  )}
                </div>
                <Badge variant={badge.variant} className="shrink-0">
                  {badge.label}
                </Badge>
              </li>
            );
          })}
        </ul>
      </div>
    </SurfaceCard>
  );
}

// ─── Fila de dato técnico ─────────────────────────────────────────────────────

/** Un par etiqueta/valor dentro de «Detalles técnicos». */
export function TechnicalRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 border-b border-border/60 py-2.5 first:pt-0 last:border-b-0 last:pb-0">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 break-all text-right text-xs font-medium text-foreground">{children}</span>
    </div>
  );
}
