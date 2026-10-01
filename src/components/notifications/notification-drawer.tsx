"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck, ExternalLink } from "lucide-react";
import { DrawerShell } from "@/components/shared/drawer-shell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState as SystemEmptyState } from "@/components/ui/empty-state";
import { ListItem, ListItemGroup } from "@/components/data-display";
import { cn } from "@/lib/utils";
import type { UserNotification, NotificationFilter } from "@/modules/notifications/types";

interface NotificationDrawerProps {
  open: boolean;
  notifications: UserNotification[];
  loading: boolean;
  filter: NotificationFilter;
  onClose: () => void;
  onFilterChange: (filter: NotificationFilter) => void;
  onRead: (id: string, url: string | null) => Promise<string | null>;
  onMarkAll: () => Promise<void>;
}

function formatRelativeDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return "Ahora";
  if (diffMins < 60) return `hace ${diffMins} min`;
  if (diffHours < 24) return `hace ${diffHours}h`;
  if (diffDays === 1) return "ayer";
  if (diffDays < 7) return `hace ${diffDays}d`;
  return date.toLocaleDateString("es-CO", { day: "numeric", month: "short" });
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
      onClick={() => onRead(notification.id, notification.action_url)}
      className={cn("items-start", isUnread && "bg-primary/5")}
      leading={
        <span
          aria-hidden="true"
          className={cn(
            "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
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
            <span className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary group-hover/list-item:underline">
              {notification.action_label}
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </span>
          )}
        </span>
      }
      meta={formatRelativeDate(notification.created_at)}
    />
  );
}

function EmptyState({ filter }: { filter: NotificationFilter }) {
  return (
    <SystemEmptyState
      icon={Bell}
      title={
        filter === "unread"
          ? "No tienes notificaciones sin leer."
          : "No tienes notificaciones por ahora."
      }
      variant="plain"
    />
  );
}

export function NotificationDrawer({
  open,
  notifications,
  loading,
  filter,
  onClose,
  onFilterChange,
  onRead,
  onMarkAll,
}: NotificationDrawerProps) {
  const router = useRouter();
  const [markingAll, setMarkingAll] = React.useState(false);

  const handleRead = async (id: string, url: string | null) => {
    const targetUrl = await onRead(id, url);
    if (targetUrl) {
      onClose();
      router.push(targetUrl);
    }
  };

  const handleMarkAll = async () => {
    setMarkingAll(true);
    await onMarkAll();
    setMarkingAll(false);
  };

  const displayed =
    filter === "unread" ? notifications.filter((n) => !n.is_read) : notifications;

  const unreadCount = notifications.filter((n) => !n.is_read).length;
  const hasUnread = unreadCount > 0;

  return (
    <DrawerShell
      open={open}
      onOpenChange={(isOpen) => !isOpen && onClose()}
      title="Notificaciones"
      icon={<Bell className="h-4 w-4" />}
      size="sm"
    >
      <div className="flex flex-col gap-4">
        {/* Tabs + acción */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 pb-3">
          <div className="flex gap-0.5 rounded-lg bg-tab-track p-0.5">
            {(["unread", "all"] as NotificationFilter[]).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => onFilterChange(f)}
                aria-pressed={filter === f}
                className={[
                  "rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40",
                  filter === f
                    ? "bg-card text-primary shadow-card"
                    : "text-muted-foreground hover:text-foreground",
                ].join(" ")}
              >
                {f === "unread" ? (
                  <span className="flex items-center gap-1.5">
                    No leídas
                    {hasUnread && (
                      <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-xs font-semibold tabular-nums text-primary-foreground">
                        {unreadCount}
                      </span>
                    )}
                  </span>
                ) : (
                  "Todas"
                )}
              </button>
            ))}
          </div>

          {hasUnread && (
            <Button
              variant="ghost"
              size="xs"
              disabled={markingAll}
              onClick={handleMarkAll}
            >
              <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
              Marcar leídas
            </Button>
          )}
        </div>

        {/* Lista */}
        <div>
          {loading ? (
            <div className="flex flex-col gap-2" aria-busy="true">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-16 rounded-lg" />
              ))}
            </div>
          ) : displayed.length === 0 ? (
            <EmptyState filter={filter} />
          ) : (
            <ListItemGroup>
              {displayed.map((n) => (
                <NotificationItem key={n.id} notification={n} onRead={handleRead} />
              ))}
            </ListItemGroup>
          )}
        </div>
      </div>
    </DrawerShell>
  );
}
