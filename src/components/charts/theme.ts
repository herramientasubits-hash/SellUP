/**
 * SellUpChartTheme
 *
 * Typed structure of the ECharts theme object produced by getSellUpChartTheme.
 * Exported so consumers can type references to the theme if needed.
 */
export interface SellUpChartTheme {
  color: string[];
  textStyle: { fontFamily: string; color: string };
  title: { textStyle: { fontWeight: string; color: string } };
  grid: {
    containLabel: boolean;
    borderWidth: number;
    left: number;
    right: number;
    top: number;
    bottom: number;
  };
  categoryAxis: {
    axisLine: { show: boolean; lineStyle: { color: string } };
    axisTick: { show: boolean };
    axisLabel: { color: string; fontSize: number };
    splitLine: { show: boolean };
  };
  valueAxis: {
    axisLine: { show: boolean };
    axisTick: { show: boolean };
    axisLabel: { color: string; fontSize: number };
    splitLine: { show: boolean; lineStyle: { color: string; type: string } };
  };
  legend: {
    textStyle: { color: string; fontSize: number };
    itemWidth: number;
    itemHeight: number;
    itemGap: number;
  };
  tooltip: {
    backgroundColor: string;
    borderColor: string;
    borderWidth: number;
    padding: number[];
    textStyle: { color: string; fontSize: number };
    axisPointer: {
      lineStyle: { color: string; width: number };
      shadowStyle: { color: string };
    };
  };
}

/**
 * getSellUpChartTheme
 *
 * Resolves SellUp Design System tokens at runtime via getComputedStyle and maps
 * them to an ECharts visual configuration object.
 *
 * IMPORTANT: CSS custom properties (var(--token)) cannot be used directly with
 * the Canvas API or ECharts. This function always returns concrete resolved
 * color values ready for canvas rendering.
 *
 * Token resolution strategy:
 *  - Direct SellUp tokens: return raw HEX values, stable across
 *    light/dark because brand colors are intentionally theme-invariant.
 *    Used for series colors to maintain semantic visual consistency.
 *  - shadcn HSL-channel tokens (globals.css): values are space-separated HSL
 *    channels (e.g. "215 19% 23%") and must be wrapped in hsl() with commas
 *    for compatibility with zrender (ECharts canvas renderer).
 *    These tokens switch values under the .dark class on <html>.
 */
export function getSellUpChartTheme(): SellUpChartTheme {
  const css = getComputedStyle(document.documentElement);
  const get = (name: string): string => css.getPropertyValue(name).trim();

  /**
   * Wraps space-separated HSL channels (e.g. "215 19% 23%") into a
   * comma-separated hsl() string for zrender/Canvas compatibility.
   * CSS Level 4 space syntax is not universally supported by canvas engines.
   */
  const hsl = (channels: string): string =>
    `hsl(${channels.replace(/\s+/g, ", ")})`;

  // --- Series colors: direct SellUp brand tokens (HEX values) ---
  // These are intentionally theme-invariant. Brand, positive, warning, negative,
  // and neutral gray provide a semantically grounded 5-color palette.
  // If a chart requires more than 5 series, override option.color directly.
  const brand = get("--su-brand"); // primary blue
  const positive = get("--color-emerald-500"); // green
  const warning = get("--color-amber-500"); // amber
  const negative = get("--destructive"); // red
  const neutral = get("--muted-foreground"); // neutral gray

  // --- UI colors: shadcn HSL-channel tokens (globals.css) ---
  // These adapt between light and dark mode via the .dark class on <html>.
  const colorText = hsl(get("--foreground"));
  const colorMuted = hsl(get("--muted-foreground"));
  const colorBorder = hsl(get("--border"));
  const colorBg = hsl(get("--background"));

  return {
    color: [brand, positive, warning, negative, neutral],
    textStyle: {
      fontFamily: "Inter, sans-serif",
      color: colorText,
    },
    title: {
      textStyle: {
        fontWeight: "bold",
        color: colorText,
      },
    },
    grid: {
      containLabel: true,
      borderWidth: 0,
      left: 10,
      right: 10,
      top: 40,
      bottom: 10,
    },
    categoryAxis: {
      axisLine: {
        show: true,
        lineStyle: { color: colorBorder },
      },
      axisTick: {
        show: false,
      },
      axisLabel: {
        color: colorMuted,
        fontSize: 11,
      },
      splitLine: {
        show: false,
      },
    },
    valueAxis: {
      axisLine: {
        show: false,
      },
      axisTick: {
        show: false,
      },
      axisLabel: {
        color: colorMuted,
        fontSize: 11,
      },
      splitLine: {
        show: true,
        lineStyle: {
          color: colorBorder,
          type: "dashed",
        },
      },
    },
    legend: {
      textStyle: {
        color: colorMuted,
        fontSize: 11,
      },
      itemWidth: 12,
      itemHeight: 12,
      itemGap: 16,
    },
    tooltip: {
      backgroundColor: colorBg,
      borderColor: colorBorder,
      borderWidth: 1,
      padding: [8, 12],
      textStyle: {
        color: colorText,
        fontSize: 12,
      },
      axisPointer: {
        lineStyle: {
          color: colorMuted,
          width: 1,
        },
        shadowStyle: {
          color: "rgba(0, 0, 0, 0.03)",
        },
      },
    },
  };
}