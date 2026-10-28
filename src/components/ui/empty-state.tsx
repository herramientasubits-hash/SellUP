import * as React from "react";
import {
  Activity,
  AlertTriangle,
  Archive,
  BarChart3,
  Bell,
  Briefcase,
  Building2,
  Calendar,
  Check,
  ClipboardCheck,
  Coins,
  Database,
  FileSearch,
  FileText,
  Folder,
  Globe,
  History,
  Inbox,
  LayoutDashboard,
  Lock,
  Mail,
  MessageSquare,
  Phone,
  PhoneCall,
  ScrollText,
  Search,
  Settings,
  ShieldAlert,
  Star,
  Tag,
  Target,
  Upload,
  User,
  UserCheck,
  Users,
  UserSearch,
  type LucideIcon,
} from "@/icons";

import { cn } from "@/lib/utils";

/**
 * EmptyState — el vacío de UBITS (Empty de flux-ui, tal como lo usa el playground):
 * sin marco, una ilustración de vidrio de 72px, título de 18px en medium y la
 * descripción en gris, con la acción debajo.
 *
 * La ilustración sale del ícono que pasa la pantalla: cada ícono de interfaz tiene
 * su par en el set «Iconos Glass» de UBITS (`public/iconos-glass`). Si no tiene par,
 * se pinta el ícono en una baldosa gris de 40px.
 *
 * @example
 *   <EmptyState
 *     icon={Inbox}
 *     title="No hay prospectos"
 *     description="Genera un lote con IA para empezar."
 *     action={<AIButton>Generar con IA</AIButton>}
 *   />
 */
interface EmptyStateProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  /**
   * Opcional: un vacío dentro de un drawer o panel cuyo título ya está en la
   * cabecera puede dar solo la descripción, sin repetirlo.
   */
  title?: string;
  description?: string;
  icon?: LucideIcon;
  action?: React.ReactNode;
  /**
   * `card` (por defecto): el vacío que ocupa la página, con más aire.
   * `plain`: un vacío dentro de una card o una tabla que ya tiene su propia superficie.
   */
  variant?: "card" | "plain";
}

/** Ícono de interfaz → ilustración de vidrio de UBITS. */
const GLASS_BY_ICON = new Map<LucideIcon, string>([
  [Users, "glass-profile"],
  [User, "glass-profile"],
  [UserCheck, "glass-tick"],
  [UserSearch, "glass-search"],
  [Search, "glass-search"],
  [FileSearch, "glass-search"],
  [Inbox, "glass-folder"],
  [Folder, "glass-folder"],
  [Archive, "glass-folder"],
  [Building2, "glass-home"],
  [Briefcase, "glass-bag"],
  [Activity, "glass-activity"],
  [LayoutDashboard, "glass-chart"],
  [BarChart3, "glass-chart"],
  [Database, "glass-graph"],
  [Target, "glass-discovery"],
  [Globe, "glass-location"],
  [Mail, "glass-message"],
  [MessageSquare, "glass-chat"],
  [Phone, "glass-chat"],
  [PhoneCall, "glass-chat"],
  [Bell, "glass-notification"],
  [Lock, "glass-lock"],
  [ShieldAlert, "glass-danger"],
  [AlertTriangle, "glass-danger"],
  [Calendar, "glass-calendar"],
  [History, "glass-clock"],
  [ClipboardCheck, "glass-tick"],
  [Check, "glass-tick"],
  [Tag, "glass-ticket-star"],
  [Star, "glass-star"],
  [Upload, "glass-paper-plus"],
  [ScrollText, "glass-document"],
  [FileText, "glass-document"],
  [Coins, "glass-wallet"],
  [Settings, "glass-setting"],
]);

function GlassIllustration({ name }: { name: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- ilustración fija de 72px con su versión 2x
    <img
      src={`/iconos-glass/${name}@1x.png`}
      srcSet={`/iconos-glass/${name}@1x.png 1x, /iconos-glass/${name}@2x.png 2x`}
      width={72}
      height={72}
      alt=""
      aria-hidden="true"
      draggable={false}
      className="size-18 select-none"
    />
  );
}

function EmptyState({
  title,
  description,
  icon: Icon,
  action,
  variant = "card",
  className,
  ...props
}: EmptyStateProps) {
  const glass = Icon ? GLASS_BY_ICON.get(Icon) : undefined;
  return (
    <div
      data-slot="empty"
      className={cn(
        "flex w-full min-w-0 flex-col items-center justify-center gap-4 text-center text-balance",
        variant === "plain" ? "px-6 py-8" : "rounded-lg p-12",
        className,
      )}
      {...props}
    >
      {glass ? (
        <GlassIllustration name={glass} />
      ) : (
        Icon && (
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
            <Icon size={24} strokeWidth={1.75} />
          </div>
        )
      )}
      {(title || description) && (
        <div className="flex max-w-sm flex-col items-center gap-2">
          {title && <h3 className="text-lg font-medium tracking-tight text-foreground">{title}</h3>}
          {description && <p className="text-sm/relaxed text-muted-foreground">{description}</p>}
        </div>
      )}
      {action && <div className="flex flex-wrap items-center justify-center gap-2">{action}</div>}
    </div>
  );
}

export { EmptyState };
export type { EmptyStateProps };
