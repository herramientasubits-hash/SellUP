"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { ChevronRight, Palette } from "@/icons";

import { cn } from "@/lib/utils";
import { useActionsPlacement, useCompactViewport, type ActionsPlacement } from "@/components/action-rail";
import { SegmentedControl } from "@/components/selection/segmented-control";
import { Text } from "@/components/typography";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const PERSONALIZATION_LABEL = "Personalización";
/** SellUp tiene un solo tema de color: el Azul de Thema. */
const THEME_NAME = "Azul";

const THEME_MODES = [
  { value: "light", label: "Claro" },
  { value: "dark", label: "Oscuro" },
  { value: "system", label: "Como el sistema" },
];

const ACTIONS_PLACEMENT_LABEL = "Acciones de la pantalla";

const ACTIONS_PLACEMENTS: { value: ActionsPlacement; label: string }[] = [
  { value: "rail", label: "Barra flotante" },
  { value: "inline", label: "En la pantalla" },
];

const ACTIONS_PLACEMENT_HINT: Record<ActionsPlacement, string> = {
  rail: "Las acciones van en una barra flotante que puedes mover.",
  inline: "Las acciones van en la cabecera de cada pantalla.",
};

export interface PersonalizationMenuProps {
  className?: string;
}

/**
 * PersonalizationMenu — port de Thema `app-shell/PersonalizationMenu.tsx`.
 *
 * «Cómo se ve y cómo se usa la plataforma», en una sola puerta dentro del menú
 * de la marca: la fila enseña la muestra del tema activo y abre al lado —sin
 * tapar el menú que la contiene; en pantalla estrecha cuelga del propio ítem—
 * un panel con:
 *
 * - **Tema**: Claro / Oscuro / Como el sistema. Thema ofrece además presets de
 *   color e idioma; SellUp tiene un solo tema (el Azul) y un solo idioma, así
 *   que esas secciones no existen aquí.
 * - **Acciones de la pantalla**: en la barra flotante o en la cabecera de cada
 *   pantalla (`useActionsPlacement`). Es la misma preferencia que ofrecen los
 *   ajustes de la barra, y el único sitio desde el que se vuelve a encender la
 *   barra una vez apagada.
 *
 * @example
 * <WorkspaceMenu … extra={<PersonalizationMenu />} />
 */
export function PersonalizationMenu({ className }: PersonalizationMenuProps) {
  const { theme, setTheme } = useTheme();
  const [placement, setPlacement] = useActionsPlacement();
  const [open, setOpen] = React.useState(false);
  const isCompact = useCompactViewport();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={`${PERSONALIZATION_LABEL}: tema ${THEME_NAME}`}
            data-slot="personalization-switch"
            className={cn(
              "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-foreground outline-none transition-colors hover:bg-accent focus-visible:bg-accent",
              open && "bg-accent",
              className,
            )}
          >
            <Palette aria-hidden className="size-4 shrink-0 text-text-muted" />
            <span className="flex-1 text-left">{PERSONALIZATION_LABEL}</span>
            {/* La muestra del tema activo: se reconoce sin abrir nada. */}
            <span
              aria-hidden
              data-slot="theme-swatch"
              className="size-3.5 shrink-0 rounded-full bg-brand-gradient ring-1 ring-border/60"
            />
            <ChevronRight
              aria-hidden
              className={cn("size-4 shrink-0 text-text-muted transition-transform duration-200", open && "translate-x-0.5")}
            />
          </button>
        }
      />

      <PopoverContent
        side={isCompact ? "bottom" : "right"}
        align={isCompact ? "end" : "start"}
        sideOffset={isCompact ? 6 : 10}
        aria-label={PERSONALIZATION_LABEL}
        className="flex max-h-[75vh] w-88 max-w-[calc(100vw-2rem)] flex-col gap-4 overflow-y-auto rounded-2xl p-4"
      >
        <section data-slot="theme-mode" className="flex flex-col gap-2">
          <Text as="h3" size="xs" weight="semibold" tone="secondary">
            Tema
          </Text>
          <SegmentedControl
            size="sm"
            fullWidth
            ariaLabel="Tema"
            options={THEME_MODES}
            value={theme ?? "system"}
            onChange={setTheme}
          />
        </section>

        <section data-slot="actions-placement" className="flex flex-col gap-2">
          <Text as="h3" size="xs" weight="semibold" tone="secondary">
            {ACTIONS_PLACEMENT_LABEL}
          </Text>
          <SegmentedControl
            size="sm"
            fullWidth
            ariaLabel={ACTIONS_PLACEMENT_LABEL}
            options={ACTIONS_PLACEMENTS}
            value={placement}
            onChange={(value) => setPlacement(value as ActionsPlacement)}
          />
          <Text as="p" size="xs" tone="muted">
            {ACTIONS_PLACEMENT_HINT[placement]}
          </Text>
        </section>
      </PopoverContent>
    </Popover>
  );
}
