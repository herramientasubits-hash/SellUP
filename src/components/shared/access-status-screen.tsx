import type { ReactNode } from "react";
import { LogOut, Mail, type LucideIcon } from "@/icons";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/layout/app-sidebar";
import { signOut } from "@/modules/auth/actions";
import { cn } from "@/lib/utils";

export type AccessStatusTone = "warning" | "negative" | "neutral";

const TONE_CHIP: Record<AccessStatusTone, string> = {
  warning: "bg-warning/15 text-warning",
  negative: "bg-destructive/10 text-destructive",
  neutral: "bg-surface-muted text-muted-foreground",
};

interface AccessStatusScreenProps {
  icon: LucideIcon;
  tone: AccessStatusTone;
  title: string;
  description: string;
  /** El correo con el que entró la persona; se muestra para que sepa qué cuenta es. */
  email?: string | null;
  /** La acción propia del estado (por ejemplo, solicitar reingreso). Va antes de «Cerrar sesión». */
  primaryAction?: ReactNode;
}

/**
 * AccessStatusScreen — la pantalla de un acceso que no puede entrar todavía
 * (pendiente, rechazado, suspendido, archivado). Una tarjeta centrada con la
 * marca arriba, el estado en un chip del tono, qué pasa y qué puede hacer.
 *
 * Las cuatro pantallas comparten esta anatomía; solo cambian icono, tono,
 * textos y, si la hay, la acción propia.
 */
export function AccessStatusScreen({
  icon: Icon,
  tone,
  title,
  description,
  email,
  primaryAction,
}: AccessStatusScreenProps) {
  return (
    <main className="flex w-full max-w-md flex-col items-center gap-6">
      <BrandMark />

      <section
        aria-labelledby="access-status-title"
        className="flex w-full flex-col items-center rounded-2xl border border-border/60 bg-card px-6 py-8 text-center shadow-card sm:px-8"
      >
        <span
          aria-hidden
          className={cn("mb-5 flex size-12 items-center justify-center rounded-xl", TONE_CHIP[tone])}
        >
          <Icon className="size-6" />
        </span>

        <h1
          id="access-status-title"
          className="mb-2 text-2xl font-semibold tracking-tight text-foreground"
        >
          {title}
        </h1>

        <p className="mb-6 text-sm leading-relaxed text-muted-foreground">{description}</p>

        {email && (
          <p className="mb-6 flex w-full min-w-0 items-center justify-center gap-2 rounded-xl bg-surface-muted px-4 py-2.5">
            <Mail className="size-4 shrink-0 text-text-muted" aria-hidden="true" />
            <span className="min-w-0 truncate text-sm font-medium text-foreground" title={email}>
              {email}
            </span>
          </p>
        )}

        <div className="flex w-full flex-col gap-2">
          {primaryAction}
          <form action={signOut} className="w-full">
            <Button type="submit" variant="outline" className="w-full">
              <LogOut className="size-4" aria-hidden="true" />
              Cerrar sesión
            </Button>
          </form>
        </div>
      </section>
    </main>
  );
}
