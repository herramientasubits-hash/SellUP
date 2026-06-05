"use client";

import { Slider as SliderPrimitive } from "@base-ui/react/slider";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Slider — range input with 1 or 2 thumbs.
 *
 * Built on Base UI's Slider namespace (7 parts):
 *   Slider.Root     → <Slider>          : data-slot=slider
 *   Slider.Control  → rendered inside Root, wraps track + thumbs
 *   Slider.Track    → track background  : data-slot=slider-track
 *   Slider.Indicator→ filled range      : data-slot=slider-range (visually)
 *   Slider.Thumb    → draggable handle  : data-slot=slider-thumb
 *   Slider.Label    → accessible label  : not rendered (consumer provides)
 *   Slider.Value    → current value display (optional)
 *
 * Supports horizontal (default) and vertical orientations via
 * `orientation` prop. Renders one thumb per value in the array.
 *
 * No headless state lib needed — Base UI handles keyboard, touch, and
 * focus management.
 */
function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root>) {
  const _values = React.useMemo(
    () =>
      Array.isArray(value)
        ? value
        : Array.isArray(defaultValue)
          ? defaultValue
          : [min, max],
    [value, defaultValue, min, max],
  );

  return (
    <SliderPrimitive.Root
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      className={cn(
        "relative flex w-full touch-none items-center select-none data-disabled:opacity-50 data-vertical:h-full data-vertical:min-h-40 data-vertical:w-auto data-vertical:flex-col",
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Control className="relative flex w-full items-center data-vertical:h-full data-vertical:w-auto data-vertical:flex-col">
        <SliderPrimitive.Track
          data-slot="slider-track"
          className="relative grow overflow-hidden rounded-full bg-secondary data-horizontal:h-1.5 data-horizontal:w-full data-vertical:h-full data-vertical:w-1.5"
        >
          <SliderPrimitive.Indicator
            data-slot="slider-range"
            className="absolute bg-primary select-none data-horizontal:h-full data-vertical:w-full"
          />
        </SliderPrimitive.Track>
        {Array.from({ length: _values.length }, (_, index) => (
          <SliderPrimitive.Thumb
            data-slot="slider-thumb"
            key={index}
            className="relative block size-4 shrink-0 rounded-full border-2 border-primary bg-card shadow-sm transition-[color,box-shadow,transform] select-none hover:scale-110 hover:shadow-md focus-visible:ring-4 focus-visible:ring-primary/20 focus-visible:outline-none active:scale-95 disabled:pointer-events-none disabled:opacity-50"
          />
        ))}
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  );
}

export { Slider };
