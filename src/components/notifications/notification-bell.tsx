"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck } from "@/icons";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  getMyNotifications,
  markNotificationAsRead,
  markAllMyNotificationsAsRead,
} from "@/modules/notifications/actions";
import type { UserNotification, NotificationFilter } from "@/modules/notifications/types";
import { NotificationList } from "./notification-list";

interface NotificationBellProps {
  initialUnreadCount: number;
}

/** «1 nueva» / «3 nuevas»: el recuento de la cabecera del panel. */
export function unreadLabel(count: number): string {
  return count === 1 ? "1 nueva" : `${count > 99 ? "99+" : count} nuevas`;
}

/**
 * La campana de la cabecera — anatomía de Thema (`app-shell/AppHeader`,
 * bloque de notificaciones): un POPOVER anclado a la campana, no un drawer.
 * Leer un aviso es un vistazo; no merece tapar la pantalla.
 *
 * Dentro: el título con «N nuevas», la lista (lo no leído con punto y en
 * negrita) y el pie con «Ver todas» / «Ver solo las nuevas». Pulsar un aviso
 * lo marca como leído y, si lleva a algún sitio, navega y cierra.
 */
export function NotificationBell({ initialUnreadCount }: NotificationBellProps) {
  const router = useRouter();
  const [unreadCount, setUnreadCount] = React.useState(initialUnreadCount);
  const [open, setOpen] = React.useState(false);
  const [notifications, setNotifications] = React.useState<UserNotification[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [markingAll, setMarkingAll] = React.useState(false);
  const [filter, setFilter] = React.useState<NotificationFilter>("unread");

  const loadNotifications = React.useCallback(async (nextFilter: NotificationFilter) => {
    setLoading(true);
    try {
      const data = await getMyNotifications(nextFilter);
      setNotifications(data);
      setUnreadCount(data.filter((n) => !n.is_read).length);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) void loadNotifications(filter);
  };

  const handleFilterChange = (nextFilter: NotificationFilter) => {
    setFilter(nextFilter);
    void loadNotifications(nextFilter);
  };

  const handleRead = async (id: string, url: string | null) => {
    await markNotificationAsRead(id);
    const updated = notifications.map((n) => (n.id === id ? { ...n, is_read: true } : n));
    setNotifications(updated);
    setUnreadCount(updated.filter((n) => !n.is_read).length);
    if (url) {
      setOpen(false);
      router.push(url);
    }
  };

  const handleMarkAll = async () => {
    setMarkingAll(true);
    try {
      await markAllMyNotificationsAsRead();
      setNotifications(notifications.map((n) => ({ ...n, is_read: true })));
      setUnreadCount(0);
    } finally {
      setMarkingAll(false);
    }
  };

  const hasUnread = unreadCount > 0;
  const displayed =
    filter === "unread" ? notifications.filter((n) => !n.is_read) : notifications;
  const triggerLabel = hasUnread
    ? `Notificaciones: ${unreadCount} sin leer`
    : "Notificaciones";

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <button
            type="button"
            title="Notificaciones"
            aria-label={triggerLabel}
            className={cn(
              "relative flex size-8 shrink-0 items-center justify-center rounded-full border border-border/70 bg-card text-text-muted transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
              open && "bg-surface-muted text-foreground",
            )}
          >
            <Bell className="size-4" />
            {hasUnread && (
              <span
                aria-hidden
                data-slot="notification-dot"
                className="absolute right-1.5 top-1 size-2 rounded-full border-2 border-card bg-primary"
              />
            )}
          </button>
        }
      />
      <PopoverContent
        align="end"
        sideOffset={8}
        aria-label="Notificaciones"
        className="flex w-[min(340px,calc(100vw-1.5rem))] flex-col overflow-hidden p-0"
      >
        <div className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
          <span className="text-sm font-semibold text-foreground">Notificaciones</span>
          <span className="flex items-center gap-1.5">
            {hasUnread && (
              <span
                data-slot="notification-unread-count"
                className="inline-flex h-5 items-center rounded-full bg-primary px-2 text-xs font-semibold tabular-nums text-primary-foreground"
              >
                {unreadLabel(unreadCount)}
              </span>
            )}
            {hasUnread && (
              <Button variant="ghost" size="xs" disabled={markingAll} onClick={handleMarkAll}>
                <CheckCheck className="size-3.5" aria-hidden="true" />
                Marcar leídas
              </Button>
            )}
          </span>
        </div>

        <div className="max-h-96 overflow-y-auto p-2">
          <NotificationList
            notifications={displayed}
            loading={loading}
            filter={filter}
            onRead={handleRead}
          />
        </div>

        <div className="border-t border-border/60 px-4 py-2.5">
          <button
            type="button"
            onClick={() => handleFilterChange(filter === "unread" ? "all" : "unread")}
            className="rounded-sm text-xs font-semibold text-primary transition-colors hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            {filter === "unread" ? "Ver todas las notificaciones" : "Ver solo las nuevas"}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
