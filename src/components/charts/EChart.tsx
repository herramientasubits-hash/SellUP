"use client";

import * as React from "react";
import echarts from "./registerECharts";
import type { EChartsInstance, EChartProps } from "./types";
import { getSellUpChartTheme } from "./theme";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/feedback/EmptyState";

/**
 * EChart
 *
 * Core SellUp wrapper for Apache ECharts.
 * Handles lifecycle (init, dispose), responsiveness (resize), and theming.
 *
 * The chart container div is always present in the DOM so that ECharts
 * initializes exactly once on mount regardless of the initial loading or
 * empty state. Loading and empty states are rendered as absolute overlays,
 * avoiding the lifecycle bug where chartRef.current would be null on init.
 *
 * @example
 * <EChart option={{ ... }} height={400} />
 */
export function EChart({
  option,
  height = 300,
  loading = false,
  empty = false,
  className,
  style,
  onChartReady,
}: EChartProps) {
  const chartRef = React.useRef<HTMLDivElement>(null);
  const instanceRef = React.useRef<EChartsInstance | null>(null);

  /**
   * Keep a ref to the latest option so the MutationObserver can read it
   * without being listed as a dependency — which would recreate the observer
   * on every option change.
   */
  const optionRef = React.useRef(option);
  React.useEffect(() => {
    optionRef.current = option;
  }, [option]);

  /**
   * Initialize ECharts once on mount.
   * chartRef.current is always available here because the chart div is
   * unconditionally rendered (loading/empty use overlays, not early returns).
   * onChartReady is called after setOption so the instance already has data.
   */
  React.useEffect(() => {
    if (!chartRef.current) return;

    const theme = getSellUpChartTheme();
    const instance = echarts.init(chartRef.current, theme);
    instanceRef.current = instance;

    instance.setOption(option);
    onChartReady?.(instance);

    return () => {
      instance.dispose();
      instanceRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Sync options when they change.
   * Skipped during loading/empty to avoid rendering while the chart is hidden.
   * Also runs when loading/empty change to false, refreshing the chart with
   * the current option as soon as the canvas becomes visible.
   */
  React.useEffect(() => {
    if (instanceRef.current && !loading && !empty) {
      instanceRef.current.setOption(option, true);
    }
  }, [option, loading, empty]);

  /**
   * Responsive resize.
   * ResizeObserver watches the chart container; window resize is a fallback.
   * Both are cleaned up on unmount to prevent memory leaks.
   */
  React.useEffect(() => {
    const handleResize = () => {
      instanceRef.current?.resize();
    };

    const resizeObserver = new ResizeObserver(handleResize);
    if (chartRef.current) {
      resizeObserver.observe(chartRef.current);
    }

    window.addEventListener("resize", handleResize);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  /**
   * Theme sync: re-resolves CSS tokens when the .dark class toggles on <html>.
   * Only visual properties that change between light and dark are updated;
   * series data is untouched.
   *
   * Uses optionRef (not option) so the observer is stable across renders —
   * deps are empty, meaning the observer is created once and never recreated.
   * attributeFilter: ['class'] limits observation to class attribute changes only.
   */
  React.useEffect(() => {
    const observer = new MutationObserver(() => {
      if (!instanceRef.current) return;
      const newTheme = getSellUpChartTheme();
      instanceRef.current.setOption({
        color: newTheme.color,
        textStyle: newTheme.textStyle,
        tooltip: newTheme.tooltip,
      });
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => observer.disconnect();
  }, []);

  return (
    <div
      className={cn("relative w-full", className)}
      style={{ ...style, height }}
    >
      {/**
       * Chart canvas — always in the DOM.
       * Hidden via visibility (not display:none) so the container retains
       * its dimensions and ResizeObserver continues to work correctly.
       */}
      <div
        ref={chartRef}
        className="w-full h-full"
        style={{ visibility: loading || empty ? "hidden" : "visible" }}
      />

      {loading && (
        <div className="absolute inset-0">
          <Skeleton className="size-full rounded-xl" />
        </div>
      )}

      {empty && (
        <div className="absolute inset-0 flex items-center justify-center">
          <EmptyState
            title="Sin datos disponibles"
            description="No hay información para mostrar en este gráfico actualmente."
            className="p-0"
          />
        </div>
      )}
    </div>
  );
}