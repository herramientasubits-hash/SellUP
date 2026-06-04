"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck, ExternalLink } from "lucide-react";
import { DrawerShell } from "@/components/shared/drawer-shell";
import { Button } from "@/components/ui/button";
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
  return (
    <button
      type="button"
      onClick={() => onRead(notification.id, notification.action_url)}
      className={[
        "group relative w-full rounded-lg px-4 py-3 text-left transition-colors",
        "hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        !notification.is_read && "bg-su-brand-soft/40",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {!notification.is_read && (
        <span className="absolute left-1.5 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-su-brand" />
      )}

      <div className="pl-1.5">
        <div className="flex items-start justify-between gap-2">
          <span
            className={[
              "text-sm leading-snug",
              notification.is_read
                ? "font-normal text-foreground"
                : "font-semibold text-foreground",
            ].join(" ")}
          >
            {notification.title}
          </span>
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {formatRelativeDate(notification.created_at)}
          </span>
        </div>

        <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
          {notification.message}
        </p>

        {notification.action_label && (
          <span className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-su-brand group-hover:underline">
            {notification.action_label}
            <ExternalLink className="h-3 w-3" />
          </span>
        )}
      </div>
    </button>
  );
}

function EmptyState({ filter }: { filter: NotificationFilter }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <Bell className="h-5 w-5 text-muted-foreground" />
      </div>
      <p className="text-sm text-muted-foreground">
        {filter === "unread"
          ? "No tienes notificaciones sin leer."
          : "No tienes notificaciones por ahora."}
      </p>
    </div>
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
      icon={<Bell className="h-4 w-4 text-su-brand" />}
      size="sm"
    >
      <div className="flex flex-col gap-4">
        {/* Tabs + acción */}
        <div className="flex items-center justify-between pb-3 border-b border-border/40">
          <div className="flex gap-0.5 rounded-md bg-muted p-0.5">
            {(["unread", "all"] as NotificationFilter[]).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => onFilterChange(f)}
                className={[
                  "rounded px-2.5 py-1 text-xs font-medium transition-colors",
                  filter === f
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                ].join(" ")}
              >
                {f === "unread" ? (
                  <span className="flex items-center gap-1.5">
                    No leídas
                    {hasUnread && (
                      <span className="flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-su-brand px-1 text-[10px] font-bold text-white">
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
              size="sm"
              disabled={markingAll}
              onClick={handleMarkAll}
              className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Marcar leídas
            </Button>
          )}
        </div>

        {/* Lista */}
        <div>
          {loading ? (
            <div className="flex flex-col gap-1">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-16 animate-pulse rounded-lg bg-muted/60" />
              ))}
            </div>
          ) : displayed.length === 0 ? (
            <EmptyState filter={filter} />
          ) : (
            <div className="flex flex-col gap-0.5">
              {displayed.map((n) => (
                <NotificationItem key={n.id} notification={n} onRead={handleRead} />
              ))}
            </div>
          )}
        </div>
      </div>
    </DrawerShell>
  );
}
