"use client";

import * as React from "react";
import { Bell, ExternalLink } from "@/icons";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { ListItem, ListItemGroup } from "@/components/data-display";
import { cn } from "@/lib/utils";
import { formatInAppZone } from "@/lib/format-date";
import type { UserNotification, NotificationFilter } from "@/modules/notifications/types";

const MS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const DAYS_PER_WEEK = 7;
const SKELETON_ROWS = 3;

export function formatRelativeDate(dateString: string, now: Date = new Date()): string {
  const date = new Date(dateString);
  const diffMins = Math.floor((now.getTime() - date.getTime()) / MS_PER_MINUTE);
  const diffHours = Math.floor(diffMins / MINUTES_PER_HOUR);
  const diffDays = Math.floor(diffHours / HOURS_PER_DAY);

  if (diffMins < 1) return "Ahora";
  if (diffMins < MINUTES_PER_HOUR) return `hace ${diffMins} min`;
  if (diffHours < HOURS_PER_DAY) return `hace ${diffHours}h`;
  if (diffDays === 1) return "ayer";
  if (diffDays < DAYS_PER_WEEK) return `hace ${diffDays}d`;
  return formatInAppZone(date, { day: "numeric", month: "short" });
}

function NotificationItem({
  notification,
  onRead,
}: {
  notification: UserNotification;
  onRead: (id: string, url: string | null) => void;
}) {
  const isUnread = !notification.is_read;

  // `ListItem` recorta título y descripción a una línea; una notificación
  // necesita su mensaje completo, así que ambos envuelven dentro de la fila.
  return (
    <ListItem
      size="sm"
      data-unread={isUnread ? "true" : undefined}
      onClick={() => onRead(notification.id, notification.action_url)}
      className={cn("items-start", isUnread && "bg-primary/5")}
      leading={
        <span
          aria-hidden="true"
          className={cn(
            "mt-1.5 size-1.5 shrink-0 rounded-full",
            isUnread ? "bg-primary" : "bg-transparent",
          )}
        />
      }
      title={
        <span
          className={cn(
            "block whitespace-normal break-words leading-snug",
            isUnread ? "font-semibold" : "font-normal",
          )}
        >
          {notification.title}
        </span>
      }
      description={
        <span className="block whitespace-normal">
          <span className="line-clamp-3 break-words leading-relaxed">{notification.message}</span>
          {notification.action_label && (
            <span className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-primary group-hover/list-item:underline">
              {notification.action_label}
              <ExternalLink className="size-3" aria-hidden="true" />
            </span>
          )}
        </span>
      }
      meta={formatRelativeDate(notification.created_at)}
    />
  );
}

interface NotificationListProps {
  notifications: readonly UserNotification[];
  loading: boolean;
  filter: NotificationFilter;
  onRead: (id: string, url: string | null) => void;
}

/** La lista del panel de notificaciones: cargando, vacía o con sus avisos. */
export function NotificationList({ notifications, loading, filter, onRead }: NotificationListProps) {
  if (loading) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true">
        {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
          <Skeleton key={i} className="h-16 rounded-xl" />
        ))}
      </div>
    );
  }

  if (notifications.length === 0) {
    return (
      <EmptyState
        icon={Bell}
        title={filter === "unread" ? "Estás al día" : "Aún no tienes notificaciones"}
        description={
          filter === "unread"
            ? "No tienes notificaciones sin leer."
            : "Aquí verás los avisos de tu equipo y de tus búsquedas."
        }
        variant="plain"
      />
    );
  }

  return (
    <ListItemGroup>
      {notifications.map((n) => (
        <NotificationItem key={n.id} notification={n} onRead={onRead} />
      ))}
    </ListItemGroup>
  );
}
