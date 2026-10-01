"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ListTree, Search, type LucideIcon } from "@/icons";

import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { Kbd } from "@/components/ui/kbd";

/** Un destino de la navegación. */
export interface SearchNavigateItem {
  id: string;
  /** Nombre de la pantalla: «Lotes de prospección». */
  label: string;
  /** Ruta a la que lleva. */
  href: string;
  icon?: LucideIcon;
  /** Sección a la que pertenece; se lee antes del nombre: «Admin › Usuarios». */
  section?: string;
  /** Términos por los que se encuentra pero que no se muestran: alias, siglas. */
  keywords?: readonly string[];
}

export interface GlobalSearchProps {
  /** Los destinos entre los que se busca. */
  navigate: readonly SearchNavigateItem[];
  placeholder?: string;
  className?: string;
}

/** Sin tildes y en minúsculas: «prospeccion» encuentra «Prospección». */
function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/**
 * Palabra a palabra, no la frase entera: «lotes prospeccion» encuentra
 * «Lotes de prospección» aunque la frase no aparezca tal cual. Cada palabra
 * tiene que estar en algún campo; el orden no importa.
 */
function matches(haystack: readonly string[], needle: string): boolean {
  const words = fold(needle).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const text = fold(haystack.join(" "));
  return words.every((word) => text.includes(word));
}

function Hint({ keys, label }: { keys: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <kbd className="font-sans text-xs text-muted-foreground">{keys}</kbd>
      {label}
    </span>
  );
}

/**
 * La búsqueda general del producto (⌘K / Ctrl+K).
 *
 * Un solo campo para cuando alguien no sabe dónde está algo. Los resultados
 * salen del índice que le pasa quien la monta —el árbol de navegación de la
 * aplicación—, así que el componente no sabe nada del dominio.
 *
 * En Thema el mismo campo también abre registros y pregunta al agente; SellUp
 * no tiene índice de registros ni agente detrás de la búsqueda, así que aquí
 * solo hay destinos de navegación («Ir a»).
 *
 * El filtrado se hace aquí y no en cmdk (`shouldFilter={false}`) porque el
 * recuento necesita saber cuántos resultados hay antes de pintarlos, y porque
 * la coincidencia ignora tildes.
 *
 * @example
 * // En el header (`src/components/layout/app-header.tsx`):
 * <GlobalSearch
 *   placeholder="Buscar…"
 *   navigate={[
 *     { id: "home", label: "Inicio", href: "/", icon: Home },
 *     { id: "batches", label: "Lotes de prospección", href: "/prospect-batches", icon: Layers },
 *     { id: "users", label: "Usuarios", href: "/admin/users", icon: Users, section: "Admin" },
 *   ]}
 * />
 */
export function GlobalSearch({ navigate, placeholder = "Buscar…", className }: GlobalSearchProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        // Cada apertura empieza en limpio: abrir la búsqueda con los restos de
        // la anterior es desconcertante.
        setQuery("");
        setIsOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const trimmed = query.trim();
  const found = React.useMemo(
    () =>
      navigate.filter((item) =>
        matches([item.label, item.section ?? "", ...(item.keywords ?? [])], trimmed),
      ),
    [navigate, trimmed],
  );
  const count = found.length;

  const openSearch = () => {
    setQuery("");
    setIsOpen(true);
  };

  const goTo = (href: string) => {
    setIsOpen(false);
    router.push(href);
  };

  return (
    <>
      <button
        type="button"
        onClick={openSearch}
        aria-label="Abrir la búsqueda general"
        className={cn(
          "flex h-8 items-center gap-2 rounded-md border border-border/60 bg-card px-2.5 text-sm text-text-muted transition-colors",
          "hover:bg-surface-muted hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40",
          className,
        )}
      >
        <Search className="size-3.5" aria-hidden="true" />
        <span className="hidden sm:inline">{placeholder}</span>
        <Kbd className="ml-1 hidden sm:inline-flex">⌘K</Kbd>
      </button>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent
          showCloseButton={false}
          className="top-[12%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-2xl"
        >
          <DialogTitle className="sr-only">Búsqueda general</DialogTitle>
          <DialogDescription className="sr-only">Busca una pantalla y ve a ella.</DialogDescription>

          <Command shouldFilter={false} loop className="rounded-none bg-transparent">
            <div className="relative">
              <CommandInput
                value={query}
                onValueChange={setQuery}
                placeholder={placeholder}
                className="h-12 pr-12"
              />
              <Kbd className="absolute right-3 top-1/2 hidden -translate-y-1/2 sm:inline-flex">esc</Kbd>
            </div>

            <div className="flex items-center border-b border-border/60 px-3 py-2">
              <span className="text-xs font-medium text-muted-foreground">Ir a</span>
              <span className="ml-auto shrink-0 text-xs tabular-nums text-text-muted">
                {count} {count === 1 ? "resultado" : "resultados"}
              </span>
            </div>

            <CommandList className="max-h-[min(60vh,26rem)]">
              {count === 0 && (
                <CommandEmpty>
                  {trimmed ? `Nada que coincida con «${trimmed}».` : "No hay destinos disponibles."}
                </CommandEmpty>
              )}

              {count > 0 && (
                <CommandGroup>
                  {found.map((item) => {
                    const Icon = item.icon ?? ListTree;
                    // Etiqueta explícita: el «›» que separa las partes es
                    // decorativo, y sin esto un lector de pantalla leería
                    // «AdminUsuarios» todo junto.
                    const label = [item.section, item.label].filter(Boolean).join(", ");
                    return (
                      <CommandItem
                        key={item.id}
                        value={`navigate-${item.id}`}
                        aria-label={label}
                        onSelect={() => goTo(item.href)}
                        className="gap-2.5 px-2.5 py-2 data-[selected=true]:before:absolute data-[selected=true]:before:inset-y-1 data-[selected=true]:before:left-0 data-[selected=true]:before:w-0.5 data-[selected=true]:before:rounded-full data-[selected=true]:before:bg-primary"
                      >
                        <Icon className="size-4 shrink-0 text-text-muted" aria-hidden="true" />
                        <span className="flex min-w-0 flex-1 items-baseline gap-x-1.5 truncate">
                          {item.section && (
                            <>
                              <span className="text-muted-foreground">{item.section}</span>
                              <span aria-hidden className="text-text-muted">
                                ›
                              </span>
                            </>
                          )}
                          <span className="font-semibold text-foreground">{item.label}</span>
                        </span>
                        <CommandShortcut className="shrink-0 tracking-normal">Navegar</CommandShortcut>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              )}
            </CommandList>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/60 px-3 py-2 text-xs text-text-muted">
              <Hint keys="↑↓" label="moverse" />
              <Hint keys="↵" label="abrir" />
              <Hint keys="esc" label="cerrar" />
            </div>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  );
}
