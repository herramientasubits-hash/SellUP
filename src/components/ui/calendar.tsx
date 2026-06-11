"use client";

import * as React from "react";
import {
  DayPicker,
  getDefaultClassNames,
  type DayButton,
  type Locale,
} from "react-day-picker";

import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import { ChevronLeftIcon, ChevronRightIcon, ChevronDownIcon } from "lucide-react";

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  captionLayout = "label",
  buttonVariant = "ghost",
  locale,
  formatters,
  components,
  ...props
}: React.ComponentProps<typeof DayPicker> & {
  buttonVariant?: React.ComponentProps<typeof Button>["variant"];
}) {
  const defaultClassNames = getDefaultClassNames();

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn(
        "group/calendar bg-background p-4 [--cell-radius:var(--radius-md)] [--cell-size:2.5rem]",
        "in-data-[slot=popover-content]:bg-transparent in-data-[slot=popover-content]:p-0",
        "rtl:**:[.rdp-button_next>svg]:rotate-180",
        "rtl:**:[.rdp-button_previous>svg]:rotate-180",
        className
      )}
      captionLayout={captionLayout}
      locale={locale}
      formatters={{
        formatMonthDropdown: (date) =>
          date.toLocaleString(locale?.code, { month: "short" }),
        ...formatters,
      }}
      classNames={{
        root: cn("w-fit", defaultClassNames.root),
        months: cn(
          "relative flex flex-col gap-6 md:flex-row md:gap-8",
          defaultClassNames.months
        ),
        month: cn("flex w-full flex-col gap-3", defaultClassNames.month),
        nav: cn(
          "absolute inset-x-0 flex justify-between px-2 top-4 z-10 pointer-events-none",
          defaultClassNames.nav
        ),
        button_previous: cn(
          buttonVariants({ variant: buttonVariant }),
          "h-7 w-7 p-0 select-none aria-disabled:opacity-50 hover:bg-muted/80 rounded-md transition-colors pointer-events-auto",
          defaultClassNames.button_previous
        ),
        button_next: cn(
          buttonVariants({ variant: buttonVariant }),
          "h-7 w-7 p-0 select-none aria-disabled:opacity-50 hover:bg-muted/80 rounded-md transition-colors pointer-events-auto",
          defaultClassNames.button_next
        ),
        month_caption: cn(
          "flex h-[var(--cell-size)] w-full items-center justify-center px-[var(--cell-size)] text-sm font-semibold text-foreground",
          defaultClassNames.month_caption
        ),
        dropdowns: cn(
          "flex h-[var(--cell-size)] w-full items-center justify-center gap-2 text-sm font-semibold text-foreground",
          defaultClassNames.dropdowns
        ),
        dropdown_root: cn(
          "relative rounded-[var(--cell-radius)]",
          defaultClassNames.dropdown_root
        ),
        dropdown: cn(
          "absolute inset-0 bg-popover opacity-0",
          defaultClassNames.dropdown
        ),
        caption_label: cn(
          "font-semibold select-none",
          captionLayout === "label"
            ? "text-sm text-foreground"
            : "flex items-center gap-1 rounded-[var(--cell-radius)] text-sm [&>svg]:size-4 [&>svg]:text-foreground",
          defaultClassNames.caption_label
        ),
        weekdays: cn("grid grid-cols-7 mb-2", defaultClassNames.weekdays),
        weekday: cn(
          "rounded-[var(--cell-radius)] text-xs font-semibold text-muted-foreground uppercase tracking-wide select-none h-[var(--cell-size)] flex items-center justify-center",
          defaultClassNames.weekday
        ),
        week: cn("grid grid-cols-7", defaultClassNames.week),
        week_number_header: cn(
          "w-[var(--cell-size)] select-none",
          defaultClassNames.week_number_header
        ),
        week_number: cn(
          "text-xs font-normal text-muted-foreground select-none flex items-center justify-center h-[var(--cell-size)]",
          defaultClassNames.week_number
        ),
        day: cn(
          "group/day relative flex h-[var(--cell-size)] items-center justify-center p-0 text-center select-none",
          defaultClassNames.day
        ),
        range_start: cn(
          "relative isolate z-0 rounded-l-[var(--cell-radius)] bg-su-brand/10",
          defaultClassNames.range_start
        ),
        range_middle: cn("rounded-none bg-su-brand/10", defaultClassNames.range_middle),
        range_end: cn(
          "relative isolate z-0 rounded-r-[var(--cell-radius)] bg-su-brand/10",
          defaultClassNames.range_end
        ),
        today: cn(
          "rounded-[var(--cell-radius)] font-semibold text-foreground ring-1 ring-su-brand/50 data-[selected=true]:rounded-none",
          defaultClassNames.today
        ),
        outside: cn(
          "text-muted-foreground/40 aria-selected:text-muted-foreground/40",
          defaultClassNames.outside
        ),
        disabled: cn(
          "text-muted-foreground/30 cursor-not-allowed",
          defaultClassNames.disabled
        ),
        hidden: cn("invisible", defaultClassNames.hidden),
        ...classNames,
      }}
      components={{
        Root: ({ className, rootRef, ...props }: React.ComponentPropsWithoutRef<"div"> & { rootRef?: React.Ref<HTMLDivElement> }) => {
          return (
            <div
              data-slot="calendar"
              ref={rootRef}
              className={cn(className)}
              {...props}
            />
          );
        },
        Chevron: ({ className, orientation, size, disabled, ...props }: { className?: string; orientation?: "up" | "down" | "left" | "right"; size?: number; disabled?: boolean; [key: string]: unknown }) => {
          if (orientation === "left") {
            return (
              <ChevronLeftIcon className={cn("size-4", className)} {...props} />
            );
          }

          if (orientation === "right") {
            return (
              <ChevronRightIcon className={cn("size-4", className)} {...props} />
            );
          }

          return (
            <ChevronDownIcon className={cn("size-4", className)} {...props} />
          );
        },
        DayButton: (props: React.ComponentPropsWithoutRef<typeof DayButton> & { locale?: Partial<Locale> }) => (
          <CalendarDayButton locale={locale} {...props} />
        ),
        WeekNumber: ({ children, ...props }: React.ComponentPropsWithoutRef<"td">) => {
          return (
            <td {...props}>
              <div className="flex h-[var(--cell-size)] w-[var(--cell-size)] items-center justify-center text-center">
                {children}
              </div>
            </td>
          );
        },
        ...components,
      }}
      {...props}
    />
  );
}

function CalendarDayButton({
  className,
  day,
  modifiers,
  locale,
  ...props
}: React.ComponentProps<typeof DayButton> & { locale?: Partial<Locale> }) {
  const defaultClassNames = getDefaultClassNames();

  const ref = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    if (modifiers.focused) ref.current?.focus();
  }, [modifiers.focused]);

  return (
    <Button
      ref={ref}
      variant="ghost"
      size="icon"
      data-day={day.date.toLocaleDateString(locale?.code)}
      data-selected-single={
        modifiers.selected &&
        !modifiers.range_start &&
        !modifiers.range_end &&
        !modifiers.range_middle
      }
      data-range-start={modifiers.range_start}
      data-range-end={modifiers.range_end}
      data-range-middle={modifiers.range_middle}
      className={cn(
        "relative isolate z-10 flex aspect-square h-full w-full flex-col items-center justify-center gap-1 border-0 leading-none font-normal rounded-[var(--cell-radius)] transition-all hover:bg-muted/60 group-data-[focused=true]/day:relative group-data-[focused=true]/day:z-10 group-data-[focused=true]/day:ring-2 group-data-[focused=true]/day:ring-su-brand/60 data-[range-end=true]:rounded-[var(--cell-radius)] data-[range-end=true]:bg-su-brand data-[range-end=true]:text-su-brand-foreground data-[range-end=true]:hover:bg-su-brand/90 data-[range-end=true]:font-bold data-[range-middle=true]:rounded-none data-[range-middle=true]:bg-su-brand/10 data-[range-middle=true]:text-foreground data-[range-middle=true]:hover:bg-su-brand/20 data-[range-start=true]:rounded-[var(--cell-radius)] data-[range-start=true]:bg-su-brand data-[range-start=true]:text-su-brand-foreground data-[range-start=true]:hover:bg-su-brand/90 data-[range-start=true]:font-bold data-[selected-single=true]:bg-su-brand data-[selected-single=true]:text-su-brand-foreground data-[selected-single=true]:hover:bg-su-brand/90 data-[selected-single=true]:font-bold [&>span]:text-[10px] [&>span]:opacity-70",
        defaultClassNames.day,
        className
      )}
      {...props}
    />
  );
}

export { Calendar, CalendarDayButton };