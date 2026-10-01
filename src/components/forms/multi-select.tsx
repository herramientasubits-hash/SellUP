"use client";

import * as React from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export type MultiSelectOption = {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
};

export type MultiSelectProps = {
  options: MultiSelectOption[];
  value?: string[];
  onValueChange?: (value: string[]) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  className?: string;
  /** Maximum number of selections allowed. Omit for unlimited. */
  maxSelections?: number;
  /** Called when the user attempts to select beyond maxSelections. */
  onMaxSelectionsReached?: () => void;
  /** Compact mode: reduces item padding and clamps descriptions to 1 line */
  compact?: boolean;
  /** Additional className for the popover content */
  contentClassName?: string;
};

export function MultiSelect({
  options,
  value = [],
  onValueChange,
  placeholder = "Seleccionar opciones",
  searchPlaceholder = "Buscar...",
  emptyMessage = "No se encontraron resultados.",
  disabled = false,
  className,
  maxSelections,
  onMaxSelectionsReached,
  compact = false,
  contentClassName,
}: MultiSelectProps) {
  const [open, setOpen] = React.useState(false);

  const handleUnselect = (optionValue: string) => {
    onValueChange?.(value.filter((val) => val !== optionValue));
  };

  const handleSelect = (optionValue: string) => {
    if (value.includes(optionValue)) {
      handleUnselect(optionValue);
    } else {
      if (maxSelections !== undefined && value.length >= maxSelections) {
        onMaxSelectionsReached?.();
        return;
      }
      onValueChange?.([...value, optionValue]);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className={cn(
              "h-auto min-h-10 w-full justify-between bg-card px-3 py-1.5 text-foreground font-normal dark:bg-muted",
              className
            )}
          >
            <div className="flex min-w-0 flex-wrap gap-1 text-left">
              {value.length > 0 ? (
                value.map((val) => {
                  const option = options.find((o) => o.value === val);
                  return (
                    <Badge
                      key={val}
                      variant="secondary"
                      className="flex items-center gap-1 pr-1 pl-2 h-6 border-border/50">
                      {option?.label}
                      <div
                        role="button"
                        tabIndex={0}
                        className="ml-1 cursor-pointer rounded-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                        aria-label={`Remover ${option?.label}`}
                        title={`Remover ${option?.label}`}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            handleUnselect(val);
                          }
                        }}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleUnselect(val);
                        }}
                      >
                        <X className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                      </div>
                    </Badge>
                  );
                })
              ) : (
                <span className="text-muted-foreground">{placeholder}</span>
              )}
            </div>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </Button>
        }
      />
      {/* Use --anchor-width (Base UI variable) to match trigger width, capped at available space */}
      <PopoverContent
        className={cn(
          "w-(--anchor-width) max-w-(--available-width) p-0 rounded-xl border border-border/60 shadow-drawer",
          contentClassName,
        )}
      >
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList className="max-h-[280px] overflow-y-auto">
            <CommandEmpty>{emptyMessage}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                  onSelect={() => handleSelect(option.value)}
                  className={cn(
                    "flex flex-col items-start",
                    compact && "py-1.5",
                  )}
                >
                  <div className="flex items-center w-full">
                    <span className={cn("flex-1 text-sm", compact && "font-medium")}>{option.label}</span>
                    {value.includes(option.value) && (
                      <Check className={cn("ml-2 h-4 w-4 shrink-0")} />
                    )}
                  </div>
                  {option.description && (
                    <span
                      className={cn(
                        "text-xs text-muted-foreground leading-tight mt-0.5",
                        compact && "line-clamp-1",
                      )}
                    >
                      {option.description}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}