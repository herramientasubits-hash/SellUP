export type InapiDatasetKey =
  | 'solicitudes_de_marcas'
  | 'registros_de_marcas'
  | 'solicitudes_de_patentes'
  | 'registros_de_patentes';

export type InapiSignalType =
  | 'trademark_application'
  | 'trademark_registration'
  | 'patent_application'
  | 'patent_registration';

export type MatchMethod =
  | 'exact_normalized'
  | 'contains_normalized'
  | 'token_similarity'
  | 'no_match';

export type InapiTrademarkRawRecord = {
  _id?: unknown;
  ApplicationType?: unknown;
  ApplicationSeq?: unknown;
  ApplicationSerie?: unknown;
  ApplicationNumber?: unknown;
  RegistrationNumber?: unknown;
  NizaClasses?: unknown;
  VienaClasses?: unknown;
  Regions?: unknown;
  Applicants?: unknown;
  Representatives?: unknown;
  LocationApplicants?: unknown;
  StateApplicants?: unknown;
  LocationRepresentatives?: unknown;
  StateRepresentatives?: unknown;
  FilingDate?: unknown;
  PublicationDate?: unknown;
  RegistrationDate?: unknown;
  ExpirationDate?: unknown;
  BrandName?: unknown;
  Translation?: unknown;
  LabelDescription?: unknown;
  ProtectionDescription?: unknown;
  SignType?: unknown;
  TypeName?: unknown;
  SubtypeName?: unknown;
  Status?: unknown;
  IMAGE?: unknown;
  LastUpdatedDate?: unknown;
  [key: string]: unknown;
};

export type InapiPatentRawRecord = {
  _id?: unknown;
  ApplicationNumber?: unknown;
  RegistrationNumber?: unknown;
  Applicants?: unknown;
  Representatives?: unknown;
  Inventors?: unknown;
  FilingDate?: unknown;
  PublicationDate?: unknown;
  RegistrationDate?: unknown;
  ExpirationDate?: unknown;
  Title?: unknown;
  TypeName?: unknown;
  SubtypeName?: unknown;
  Status?: unknown;
  Country?: unknown;
  LocationApplicants?: unknown;
  ApplicantRegion?: unknown;
  LocationRepresentatives?: unknown;
  RepresentativeRegion?: unknown;
  PCTApplicationDate?: unknown;
  PCTPublicationDate?: unknown;
  Priorities?: unknown;
  IPC?: unknown;
  LastUpdatedDate?: unknown;
  [key: string]: unknown;
};

export type InapiRawRecord = InapiTrademarkRawRecord | InapiPatentRawRecord;

export type InapiCkanResponse = {
  success: boolean;
  result?: {
    total?: number;
    records?: unknown[];
  };
  error?: {
    message?: string;
    __type?: string;
  };
};

export type InapiPackageShowResource = {
  id: string;
  name: string;
  format?: string;
  datastore_active?: boolean;
};

export type InapiPackageShowResponse = {
  success: boolean;
  result?: {
    id?: string;
    name?: string;
    resources?: InapiPackageShowResource[];
  };
  error?: {
    message?: string;
    __type?: string;
  };
};

export type ApplicantParsed = {
  countryCode: string | null;
  applicantName: string;
  raw: string;
};

export type InapiDatasetConfig = {
  datasetId: string;
  datasetKey: InapiDatasetKey;
  signalType: InapiSignalType;
  resourceSelector: string;
};

export type NameMatchResult = {
  matchedName: string;
  matchMethod: MatchMethod;
  confidenceScore: number;
};

export type InapiNormalizedSignal = {
  datasetKey: InapiDatasetKey;
  signalType: InapiSignalType;
  applicantRaw: string;
  applicantNormalized: string;
  matchedName: string;
  matchMethod: MatchMethod;
  confidenceScore: number;
  brandName: string | null;
  patentTitle: string | null;
  applicationNumber: string | null;
  registrationNumber: string | null;
  status: string | null;
  filingDate: string | null;
  registrationDate: string | null;
  classesOrIpc: string | null;
  country: string;
  rawRecordId: string | null;
};

export type InapiDryRunInput = {
  companyName: string;
  legalName?: string;
  limitPerDataset?: number;
};

export type InapiDryRunSummary = {
  datasetsChecked: number;
  recordsRead: number;
  possibleMatches: number;
  strongMatches: number;
  weakMatches: number;
  noMatches: number;
};

export type InapiDryRunOutput = {
  sourceKey: 'cl_inapi';
  mode: 'name_signal_dry_run';
  input: {
    companyName: string;
    legalName?: string;
  };
  executedAt: string;
  summary: InapiDryRunSummary;
  signals: InapiNormalizedSignal[];
  warnings: string[];
  errors: string[];
};
