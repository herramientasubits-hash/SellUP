import type {
  InapiDryRunInput,
  InapiDryRunOutput,
  InapiNormalizedSignal,
  InapiDatasetConfig,
  InapiRawRecord,
  InapiTrademarkRawRecord,
  InapiPatentRawRecord,
} from './types';
import { fetchInapiResourceIds, queryInapiByName } from './inapi-client';
import {
  normalizeTrademarkRawRecord,
  normalizePatentRawRecord,
  detectRecordType,
  parseApplicant,
  extractApplicantCountryCode,
} from './normalizers';
import { matchByName, isStrongMatch, isWeakMatch } from './name-matcher';

const DATASETS: InapiDatasetConfig[] = [
  {
    datasetId: '69e70f06-39e8-4fe7-984a-f2cbf548d115',
    datasetKey: 'solicitudes_de_marcas',
    signalType: 'trademark_application',
    resourceSelector: '2026',
  },
  {
    datasetId: '89c07955-e3a6-4519-b4cf-49e5d63fb95c',
    datasetKey: 'registros_de_marcas',
    signalType: 'trademark_registration',
    resourceSelector: '2026',
  },
  {
    datasetId: '14d2cbaf-8160-4c14-aeab-4c595662f660',
    datasetKey: 'solicitudes_de_patentes',
    signalType: 'patent_application',
    resourceSelector: '2026',
  },
  {
    datasetId: '1352aea2-dd82-4311-bd8d-099f922a3426',
    datasetKey: 'registros_de_patentes',
    signalType: 'patent_registration',
    resourceSelector: '2026',
  },
];

const CKAN_NAME_MAP: Record<string, string> = {
  '69e70f06-39e8-4fe7-984a-f2cbf548d115': 'solicitudes-de-marcas',
  '89c07955-e3a6-4519-b4cf-49e5d63fb95c': 'registros-de-marcas',
  '14d2cbaf-8160-4c14-aeab-4c595662f660': 'solicitudes-de-patentes',
  '1352aea2-dd82-4311-bd8d-099f922a3426': 'registros-de-patentes',
};

function selectResource(resources: { id: string; name: string; datastore_active?: boolean }[], selector: string): string | null {
  const candidates = resources.filter((r) => r.datastore_active !== false);
  if (candidates.length === 0) return null;

  const bySelector = candidates.filter((r) => r.name.includes(selector));
  if (bySelector.length > 0) return bySelector[0].id;

  const sorted = candidates.sort((a, b) => b.name.localeCompare(a.name));
  return sorted[0].id;
}

function processTrademarkRecord(
  raw: InapiTrademarkRawRecord,
  config: InapiDatasetConfig,
  companyName: string,
): InapiNormalizedSignal | null {
  const normalized = normalizeTrademarkRawRecord(raw);
  if (!normalized.applicantName) return null;

  const match = matchByName(companyName, normalized.applicantName);

  const parsed = parseApplicant(raw.Applicants);
  const countryCode = parsed?.countryCode ?? null;
  const originCountry = countryCode === 'CL' ? 'Chile' : countryCode ?? 'unknown';

  const applicantWithoutCountry = parsed?.applicantName ?? normalized.applicantName;

  return {
    datasetKey: config.datasetKey,
    signalType: config.signalType,
    applicantRaw: normalized.applicantRaw ?? '',
    applicantNormalized: applicantWithoutCountry,
    matchedName: match.matchedName,
    matchMethod: match.matchMethod,
    confidenceScore: match.confidenceScore,
    brandName: normalized.brandName,
    patentTitle: null,
    applicationNumber: normalized.applicationNumber,
    registrationNumber: normalized.registrationNumber,
    status: normalized.status,
    filingDate: normalized.filingDate,
    registrationDate: normalized.registrationDate,
    classesOrIpc: normalized.nizaClasses,
    country: originCountry,
    rawRecordId: normalized.rawRecordId,
  };
}

function processPatentRecord(
  raw: InapiPatentRawRecord,
  config: InapiDatasetConfig,
  companyName: string,
): InapiNormalizedSignal | null {
  const normalized = normalizePatentRawRecord(raw);
  if (!normalized.applicantName) return null;

  const match = matchByName(companyName, normalized.applicantName);

  const parsed = parseApplicant(raw.Applicants);
  const countryCode = parsed?.countryCode ?? null;
  const originCountry = countryCode === 'CL' ? 'Chile' : countryCode ?? 'unknown';

  const applicantWithoutCountry = parsed?.applicantName ?? normalized.applicantName;

  return {
    datasetKey: config.datasetKey,
    signalType: config.signalType,
    applicantRaw: normalized.applicantRaw ?? '',
    applicantNormalized: applicantWithoutCountry,
    matchedName: match.matchedName,
    matchMethod: match.matchMethod,
    confidenceScore: match.confidenceScore,
    brandName: null,
    patentTitle: normalized.patentTitle,
    applicationNumber: normalized.applicationNumber,
    registrationNumber: normalized.registrationNumber,
    status: normalized.status,
    filingDate: normalized.filingDate,
    registrationDate: normalized.registrationDate,
    classesOrIpc: normalized.ipc,
    country: originCountry,
    rawRecordId: normalized.rawRecordId,
  };
}

export async function runInapiChileDryRun(
  input: InapiDryRunInput,
): Promise<InapiDryRunOutput> {
  const { companyName, legalName } = input;
  const limitPerDataset = Math.min(input.limitPerDataset ?? 5, 50);

  const executedAt = new Date().toISOString();
  const signals: InapiNormalizedSignal[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];

  let totalRecordsRead = 0;
  let datasetsChecked = 0;

  warnings.push('INAPI does not provide structured RUT — matching is name-based only');
  warnings.push('Name matching is non-deterministic and must not create companies automatically');
  warnings.push('INAPI is a signal-only source — do not use for tax identifier resolution');

  const searchName = legalName ?? companyName;

  for (const config of DATASETS) {
    datasetsChecked++;

    const resourceResult = await fetchInapiResourceIds(config.datasetId);
    if (!resourceResult.ok) {
      errors.push(`[${CKAN_NAME_MAP[config.datasetId] ?? config.datasetId}] ${resourceResult.error}`);
      continue;
    }

    const resourceId = selectResource(resourceResult.resources, config.resourceSelector);
    if (!resourceId) {
      errors.push(`[${CKAN_NAME_MAP[config.datasetId] ?? config.datasetId}] No se pudo seleccionar resource`);
      continue;
    }

    const recordsResult = await queryInapiByName(resourceId, searchName, limitPerDataset);
    if (!recordsResult.ok) {
      errors.push(`[${CKAN_NAME_MAP[config.datasetId] ?? config.datasetId}] ${recordsResult.error}`);
      continue;
    }

    totalRecordsRead += recordsResult.records.length;

    for (const rawRecord of recordsResult.records) {
      if (!rawRecord || typeof rawRecord !== 'object') continue;

      const recordType = detectRecordType(rawRecord as InapiRawRecord);
      let signal: InapiNormalizedSignal | null = null;

      if (recordType === 'trademark') {
        signal = processTrademarkRecord(rawRecord as InapiTrademarkRawRecord, config, searchName);
      } else {
        signal = processPatentRecord(rawRecord as InapiPatentRawRecord, config, searchName);
      }

      if (signal && signal.confidenceScore > 0) {
        signals.push(signal);
      }
    }
  }

  const strongMatches = signals.filter((s) => isStrongMatch(s.confidenceScore));
  const weakMatches = signals.filter((s) => isWeakMatch(s.confidenceScore));
  const possibleMatches = signals.filter((s) => s.confidenceScore > 0 && s.confidenceScore < 0.60);
  const noMatches = totalRecordsRead - signals.length;

  signals.forEach((signal) => {
    if (signal.country !== 'Chile') {
      warnings.push(
        `Applicant "${signal.applicantRaw}" has non-CL country "${signal.country}" — signal confidence downgraded to informational`,
      );
      signal.confidenceScore = Math.min(signal.confidenceScore, 0.40);
    }
  });

  return {
    sourceKey: 'cl_inapi',
    mode: 'name_signal_dry_run',
    input: {
      companyName,
      legalName,
    },
    executedAt,
    summary: {
      datasetsChecked,
      recordsRead: totalRecordsRead,
      possibleMatches: possibleMatches.length,
      strongMatches: strongMatches.length,
      weakMatches: weakMatches.length,
      noMatches,
    },
    signals,
    warnings,
    errors,
  };
}
