"use client";

import * as React from "react";

import { FolderPlus, Link2, Paperclip, Plus } from "@/icons";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { Text } from "@/components/typography";

import { t } from "./messages";
import type { ChatConnector } from "./types";

export interface ChatAttachMenuProps {
  connectors?: readonly ChatConnector[];
  onToggleConnector?: (id: string, connected: boolean) => void;
  onAddConnectors?: () => void;
  onPickFiles: () => void;
  maxFiles: number;
  maxSizeMb: number;
  disabled?: boolean;
}

function MenuTile({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border/70 bg-card text-muted-foreground [&_svg]:size-4">
      {children}
    </span>
  );
}

/**
 * El «+» de la caja (Thema · `ChatAttachMenu`): conectores (con su interruptor)
 * y archivos del equipo. El atajo ⌘U lo escucha la caja; aquí solo se enseña.
 */
export function ChatAttachMenu({
  connectors,
  onToggleConnector,
  onAddConnectors,
  onPickFiles,
  maxFiles,
  maxSizeMb,
  disabled,
}: ChatAttachMenuProps) {
  const [open, setOpen] = React.useState(false);
  const hasConnectors = Boolean(connectors && (connectors.length > 0 || onAddConnectors));
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        disabled={disabled}
        aria-label={t("chat.add")}
        title={t("chat.add")}
        data-testid="chat-attach"
        className={cn(
          "flex size-9 items-center justify-center rounded-full border border-border/70 bg-card text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50",
          open && "border-primary/40 bg-primary/10 text-primary",
        )}
      >
        <Plus className="size-4" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" sideOffset={8} className="w-72 rounded-xl p-1">
        {hasConnectors && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="items-center gap-3 rounded-lg px-2 py-2">
              <MenuTile>
                <Link2 aria-hidden />
              </MenuTile>
              <span className="flex min-w-0 flex-col">
                <span className="text-sm font-medium text-foreground">{t("chat.connectors")}</span>
                <span className="text-xs text-text-muted">{t("chat.connectorsHint")}</span>
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-64 rounded-xl p-1">
              {onAddConnectors && (
                <>
                  <DropdownMenuItem onClick={onAddConnectors} className="gap-2 rounded-lg">
                    <Plus aria-hidden />
                    {t("chat.connectorsAdd")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuGroup>
                {connectors && connectors.length > 0 && (
                  <DropdownMenuLabel className="text-xs font-semibold text-text-muted">
                    {t("chat.connectorsConnected")}
                  </DropdownMenuLabel>
                )}
                {connectors?.map((connector) => (
                  <DropdownMenuItem
                    key={connector.id}
                    role="menuitemcheckbox"
                    aria-checked={connector.connected}
                    className="justify-between gap-3 rounded-lg"
                    // Cambiar un interruptor no cierra el menú: se pueden tocar varios seguidos.
                    closeOnClick={false}
                    onClick={() => onToggleConnector?.(connector.id, !connector.connected)}
                  >
                    <span className="text-sm">{connector.label}</span>
                    <Switch checked={connector.connected} tabIndex={-1} aria-hidden className="pointer-events-none" />
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
        <DropdownMenuItem onClick={onPickFiles} className="items-center gap-3 rounded-lg px-2 py-2">
          <MenuTile>
            <Paperclip aria-hidden />
          </MenuTile>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-sm font-medium text-foreground">{t("chat.attachFiles")}</span>
            <span className="text-xs text-text-muted">{t("chat.attachFilesHint")}</span>
          </span>
          <DropdownMenuShortcut>⌘U</DropdownMenuShortcut>
        </DropdownMenuItem>
        <div className="-mx-1 -mb-1 mt-1 flex items-center gap-2 rounded-b-xl border-t border-border/60 bg-surface-muted px-3 py-2">
          <FolderPlus className="size-3.5 text-text-muted" aria-hidden />
          <Text size="xs" tone="muted">
            {t("chat.attachLimits", { files: maxFiles, size: maxSizeMb })}
          </Text>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
