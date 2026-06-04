"use client";

import * as React from "react";
import { Bell } from "lucide-react";
import { TooltipIconButton } from "@/components/ui/tooltip-icon-button";
import {
  getMyNotifications,
  markNotificationAsRead,
  markAllMyNotificationsAsRead,
} from "@/modules/notifications/actions";
import type { UserNotification, NotificationFilter } from "@/modules/notifications/types";
import { NotificationDrawer } from "./notification-drawer";

interface NotificationBellProps {
  initialUnreadCount: number;
  /**
   * Color scheme context. "default" places the bell in the header (light
   * background). "sidebar" places it on the dark rail.
   */
  variant?: "default" | "sidebar";
}

export function NotificationBell({
  initialUnreadCount,
  variant = "default",
}: NotificationBellProps) {
  const [unreadCount, setUnreadCount] = React.useState(initialUnreadCount);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [notifications, setNotifications] = React.useState<UserNotification[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [filter, setFilter] = React.useState<NotificationFilter>("unread");

  const loadNotifications = React.useCallback(async (f: NotificationFilter) => {
    setLoading(true);
    const data = await getMyNotifications(f);
    setNotifications(data);
    setUnreadCount(data.filter((n) => !n.is_read).length);
    setLoading(false);
  }, []);

  const handleOpen = () => {
    setDrawerOpen(true);
    void loadNotifications(filter);
  };

  const handleClose = () => {
    setDrawerOpen(false);
  };

  const handleFilterChange = (f: NotificationFilter) => {
    setFilter(f);
    void loadNotifications(f);
  };

  const handleRead = async (id: string, url: string | null) => {
    await markNotificationAsRead(id);
    const updated = notifications.map((n) =>
      n.id === id ? { ...n, is_read: true } : n
    );
    setNotifications(updated);
    setUnreadCount(updated.filter((n) => !n.is_read).length);
    return url;
  };

  const handleMarkAll = async () => {
    await markAllMyNotificationsAsRead();
    const updated = notifications.map((n) => ({ ...n, is_read: true }));
    setUnreadCount(0);
  };

  const sidebarClasses =
    "h-8 w-8 text-sidebar-foreground/55 hover:bg-white/[0.06] hover:text-sidebar-foreground";

  return (
    <>
      <TooltipIconButton
        variant="ghost"
        size="icon"
        icon={
          <>
            <Bell className="h-4 w-4" />
            {unreadCount > 0 && (
              <span
                aria-hidden
                className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-su-brand px-0.5 text-[10px] font-bold leading-none text-white"
              >
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </>
        }
        label={unreadCount > 0 ? `Notificaciones (${unreadCount} sin leer)` : "Notificaciones"}
        ariaLabel={
          unreadCount > 0
            ? `${unreadCount} notificaciones sin leer`
            : "Notificaciones"
        }
        onClick={handleOpen}
        side={variant === "sidebar" ? "right" : "bottom"}
        className={
          variant === "sidebar"
            ? `relative ${sidebarClasses}`
            : "relative h-8 w-8"
        }
      />

      <NotificationDrawer
        open={drawerOpen}
        notifications={notifications}
        loading={loading}
        filter={filter}
        onClose={handleClose}
        onFilterChange={handleFilterChange}
        onRead={handleRead}
        onMarkAll={handleMarkAll}
      />
    </>
  );
}
