import * as echarts from "echarts/core";
import {
  BarChart,
  LineChart,
  PieChart,
  HeatmapChart,
} from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  VisualMapComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

/**
 * registerECharts
 *
 * Modular registration of Apache ECharts components to minimize bundle size.
 * Only components required for the current base wrapper are included.
 *
 * HeatmapChart + VisualMapComponent registered for advanced charts.
 * Do not pre-register components that are not yet in use.
 */
echarts.use([
  BarChart,
  LineChart,
  PieChart,
  HeatmapChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  VisualMapComponent,
  CanvasRenderer,
]);

export default echarts;