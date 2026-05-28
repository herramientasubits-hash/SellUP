import { CATALOG_SOURCES } from '@/server/agents/prospecting-toolkit/source-catalog';
import type {
  CatalogSource,
  CatalogSourceOperationalStatus,
  SourcePriority,
} from '@/server/agents/prospecting-toolkit/types';

export type SourceViewModel = {
  key: string;
  name: string;
  countryCodes: string[];
  sectors: string[];
  type: CatalogSource['type'];
  priority: SourcePriority;
  automationLevel: CatalogSource['automationLevel'];
  operationalStatus: CatalogSourceOperationalStatus;
  url: string | null;
  recommendedUse: string;
  limitations: string[];
  riskNotes: string[];
};

export type SourceCatalogMetrics = {
  total: number;
  byOperationalStatus: Record<string, number>;
  byPriority: Record<string, number>;
  byCountry: Record<string, number>;
  byType: Record<string, number>;
  byAutomationLevel: Record<string, number>;
};

export type SourceCatalogFilters = {
  countries: string[];
  operationalStatuses: CatalogSourceOperationalStatus[];
  priorities: SourcePriority[];
  types: CatalogSource['type'][];
  automationLevels: CatalogSource['automationLevel'][];
  sectors: string[];
};

export type SourceCatalogViewModel = {
  sources: SourceViewModel[];
  metrics: SourceCatalogMetrics;
  filters: SourceCatalogFilters;
};

export function getSourceCatalogViewModel(): SourceCatalogViewModel {
  const sources: SourceViewModel[] = CATALOG_SOURCES.map((s) => ({
    key: s.key,
    name: s.name,
    countryCodes: s.countryCodes,
    sectors: s.sectors,
    type: s.type,
    priority: s.priority,
    automationLevel: s.automationLevel,
    operationalStatus: s.operationalStatus,
    url: s.url ?? null,
    recommendedUse: s.recommendedUse,
    limitations: s.limitations ?? [],
    riskNotes: s.riskNotes ?? [],
  }));

  const byOperationalStatus: Record<string, number> = {};
  const byPriority: Record<string, number> = {};
  const byCountry: Record<string, number> = {};
  const byType: Record<string, number> = {};
  const byAutomationLevel: Record<string, number> = {};

  for (const s of sources) {
    byOperationalStatus[s.operationalStatus] =
      (byOperationalStatus[s.operationalStatus] ?? 0) + 1;
    byPriority[s.priority] = (byPriority[s.priority] ?? 0) + 1;
    byType[s.type] = (byType[s.type] ?? 0) + 1;
    byAutomationLevel[s.automationLevel] =
      (byAutomationLevel[s.automationLevel] ?? 0) + 1;
    for (const c of s.countryCodes) {
      byCountry[c] = (byCountry[c] ?? 0) + 1;
    }
  }

  const uniqueSorted = <T extends string>(arr: T[]): T[] =>
    [...new Set(arr)].sort() as T[];

  const allCountries = sources.flatMap((s) => s.countryCodes);
  const allSectors = sources.flatMap((s) => s.sectors);

  const filters: SourceCatalogFilters = {
    countries: uniqueSorted(allCountries),
    operationalStatuses: uniqueSorted(
      sources.map((s) => s.operationalStatus),
    ) as CatalogSourceOperationalStatus[],
    priorities: uniqueSorted(sources.map((s) => s.priority)) as SourcePriority[],
    types: uniqueSorted(sources.map((s) => s.type)) as CatalogSource['type'][],
    automationLevels: uniqueSorted(
      sources.map((s) => s.automationLevel),
    ) as CatalogSource['automationLevel'][],
    sectors: uniqueSorted(allSectors),
  };

  return {
    sources,
    metrics: {
      total: sources.length,
      byOperationalStatus,
      byPriority,
      byCountry,
      byType,
      byAutomationLevel,
    },
    filters,
  };
}
