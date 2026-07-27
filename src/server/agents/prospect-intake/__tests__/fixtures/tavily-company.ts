/**
 * Q3F-5BB.10B1 — Synthetic Tavily / Web AI company fixture (SAFE, no real payload).
 * Fabricated data only; models the web-discovery candidate shape.
 */

import type { WebAiRawCompany } from '../../adapters/tavily';

export const webAiCompanyFixture: WebAiRawCompany = {
  inferredName: 'Umbrella Logistics Ltda',
  url: 'https://umbrella-logistics.example/about',
  sourceUrl: 'https://umbrella-logistics.example/about',
  snippet: 'Empresa sintética de logística para pruebas.',
  country: 'Peru',
  countryCode: 'PE',
  industry: 'logistics',
  confidence: 0.82,
};

/** Minimal web result: only an inferred name + source URL, no LinkedIn/employees. */
export const webAiSparseCompanyFixture: WebAiRawCompany = {
  inferredName: 'Stark Freight',
  sourceUrl: 'https://starkfreight.example/company',
};
