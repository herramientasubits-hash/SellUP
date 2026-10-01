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
 *  - Every token in globals.css is a complete CSS color (`hsl(219 90% 49%)`),
 *    not a bare channel list. zrender (the ECharts canvas renderer) does not
 *    parse CSS Level 4 space syntax, so each token is resolved through a
 *    probe element: the browser returns a plain `rgb(r, g, b)` string.
 *  - Series colors come from the Thema chart tokens `--chart-1..5`, which
 *    already swap between light and dark.
 *  - UI colors (text, borders, tooltip) come from the shadcn tokens, which
 *    also switch under the .dark class on <html>.
 */
export function getSellUpChartTheme(): SellUpChartTheme {
  const probe = document.createElement("span");
  probe.style.display = "none";
  document.documentElement.appendChild(probe);

  /** Resolves `var(--token)` to a canvas-safe color string. */
  const resolve = (name: string, fallback: string): string => {
    probe.style.color = "";
    probe.style.color = `var(${name})`;
    const value = getComputedStyle(probe).color;
    return value && value !== "" ? value : fallback;
  };

  // --- Series colors: Thema chart palette (--chart-1..5) ---
  const seriesColors = [
    resolve("--chart-1", "rgb(12, 91, 239)"),
    resolve("--chart-2", "rgb(124, 58, 237)"),
    resolve("--chart-3", "rgb(14, 165, 233)"),
    resolve("--chart-4", "rgb(5, 150, 105)"),
    resolve("--chart-5", "rgb(255, 123, 13)"),
  ];

  // --- UI colors: adapt between light and dark via the .dark class ---
  const colorText = resolve("--foreground", "rgb(48, 54, 70)");
  const colorMuted = resolve("--muted-foreground", "rgb(92, 98, 112)");
  const colorBorder = resolve("--border", "rgb(208, 210, 214)");
  const colorBg = resolve("--popover", "rgb(255, 255, 255)");

  probe.remove();

  return {
    color: seriesColors,
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