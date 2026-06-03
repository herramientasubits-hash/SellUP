/**
 * HubSpot Company Create — Hito 16AP.2 / 16AK.5B / 16AK.5C
 *
 * Crea una nueva Company en HubSpot via POST /crm/v3/objects/companies.
 * Solo escritura; nunca actualiza ni hace merge de companies existentes.
 *
 * Guardrails:
 * - Token resuelto desde Vault; nunca expuesto ni logueado.
 * - Solo propiedades seguras para V1 (no deals, contactos, tasks, notas).
 * - NIT Colombia: se limpia dígito de verificación antes de enviar.
 * - Si falla, retorna ok:false con error sanitizado.
 * - sentPropertyKeys y sentPropertiesAudit permiten auditoría sin exponer token.
 */

import { createClient as createAdminClient } from '@supabase/supabase-js';

const VAULT_SECRET_NAME = 'sellup_integration_hubspot';

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service credentials not configured');
  return createAdminClient(url, key);
}

async function getHubSpotToken(): Promise<string | null> {
  try {
    const admin = getAdminClient();
    const { data, error } = await admin.rpc('get_vault_secret_decrypted', {
      p_name: VAULT_SECRET_NAME,
    });
    if (error) return null;
    return (data as string | null) ?? null;
  } catch {
    return null;
  }
}

// NIT Colombia: "900123456-7" → "900123456", "800236140" → "800236140"
function cleanNitForHubSpot(taxIdentifier: string): string {
  return taxIdentifier.replace(/-\d+$/, '').replace(/\s/g, '').trim();
}

export interface CreateHubSpotCompanyInput {
  name: string;
  country?: string | null;
  countryCode?: string | null;
  taxIdentifier?: string | null;
  website?: string | null;
  domain?: string | null;
  city?: string | null;
  region?: string | null;
  /** Legal/official name — pending custom field confirmation in HubSpot portal */
  legalName?: string | null;
  /** Number of employees — sent only if parseable as positive integer */
  numberOfEmployees?: string | null;
  hubspotOwnerId?: string | null;
  linkedinUrl?: string | null;
  industry?: string | null;
  description?: string | null;
  // Source info
  sourcePrimary?: string | null;
  batchName?: string | null;
  // Actor info
  approvedByEmail?: string | null;
  approvedByName?: string | null;
}

export interface CreateHubSpotCompanySentAudit {
  name: string;
  country: string | null;
  nit: string | null;
  domain: string | null;
  city: string | null;
  state: string | null;
  lifecyclestage: string;
  numberofemployees: string | null;
  hubspot_owner_id: string | null;
  description?: string | null;
  linkedin_company_page?: string | null;
  [key: string]: string | null | undefined;
}

export interface CreateHubSpotCompanyResult {
  ok: boolean;
  success: boolean;
  hubspotCompanyId?: string;
  company_id?: string;
  company_name?: string;
  error?: string;
  statusCode?: number;
  sentPropertyKeys?: string[];
  properties_sent?: Record<string, string>;
  sentPropertiesAudit?: CreateHubSpotCompanySentAudit;
  skippedProperties?: string[];
  properties_skipped?: string[];
  ownerMappingStatus?: 'mapped' | 'skipped_missing_mapping' | 'skipped';
  owner_assigned?: boolean;
  owner_id?: string;
  owner_email?: string;
  account_executive_assigned?: boolean;
  account_executive_property?: string;
  account_executive_value?: string;
  warnings?: string[];
}

export interface HubSpotOwner {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
}

export interface HubSpotPropertyOption {
  value: string;
  label: string;
}

export interface HubSpotProperty {
  name: string;
  label: string;
  fieldType: string;
  type: string;
  options?: HubSpotPropertyOption[];
  referencedObjectType?: string;
  externalOptions?: boolean;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

export function parseEmployeeEstimateToHubSpotNumber(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  
  let cleanValue = value.toLowerCase().trim();
  cleanValue = cleanValue.replace(/(empleados|empleado|employees|employee)/gi, '').trim();
  cleanValue = cleanValue.replace(/(mas de|more than|de|over|under)/gi, '').trim();

  if (cleanValue.includes('-')) {
    const parts = cleanValue.split('-');
    const minPart = parts[0].trim();
    const parsedMin = parseNumberString(minPart);
    if (parsedMin !== undefined) return parsedMin;
  }
  
  const parsed = parseNumberString(cleanValue);
  if (parsed !== undefined) return parsed;

  return undefined;
}

function parseNumberString(str: string): number | undefined {
  const cleanStr = str.replace(/[^\d]/g, '');
  if (!cleanStr) return undefined;
  const num = parseInt(cleanStr, 10);
  return isNaN(num) ? undefined : num;
}

export function getCountryNameFromCode(code: string | null | undefined): string | null {
  if (!code) return null;
  const countryMap: Record<string, string> = {
    CO: 'Colombia',
    GT: 'Guatemala',
    CL: 'Chile',
    MX: 'México',
    PE: 'Perú',
    AR: 'Argentina',
    EC: 'Ecuador',
    BR: 'Brasil',
    UY: 'Uruguay',
    PA: 'Panamá',
    CR: 'Costa Rica',
    SV: 'El Salvador',
    HN: 'Honduras',
    NI: 'Nicaragua',
    DO: 'República Dominicana',
    BO: 'Bolivia',
    PY: 'Paraguay',
    VE: 'Venezuela',
  };
  return countryMap[code.toUpperCase()] ?? null;
}

export async function findHubSpotOwnerByEmail(
  email: string,
  token: string
): Promise<HubSpotOwner | null> {
  const url = `https://api.hubapi.com/crm/v3/owners?email=${encodeURIComponent(email)}&archived=false`;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { results?: HubSpotOwner[] };
    if (data.results && data.results.length > 0) {
      return data.results[0];
    }
    return null;
  } catch {
    return null;
  }
}

export async function getHubSpotCompanyPropertiesMetadata(
  token: string
): Promise<HubSpotProperty[]> {
  try {
    const response = await fetch('https://api.hubapi.com/crm/v3/properties/companies', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
    if (!response.ok) return [];
    const data = (await response.json()) as { results?: HubSpotProperty[] };
    return data.results ?? [];
  } catch {
    return [];
  }
}

export function findPropertyInternalName(
  properties: HubSpotProperty[],
  candidates: { names: string[]; labels: string[] }
): string | null {
  for (const nameCandidate of candidates.names) {
    const match = properties.find(
      (p) => p.name.toLowerCase() === nameCandidate.toLowerCase()
    );
    if (match) return match.name;
  }
  
  const normalizeText = (text: string) =>
    text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '');
  
  const normalizedLabels = candidates.labels.map(normalizeText);
  for (const prop of properties) {
    const normalizedPropLabel = normalizeText(prop.label);
    const normalizedPropName = normalizeText(prop.name);
    if (normalizedLabels.includes(normalizedPropLabel) || normalizedLabels.includes(normalizedPropName)) {
      return prop.name;
    }
  }
  return null;
}

const SAFE_STANDARD_PROPERTIES = [
  'name',
  'domain',
  'website',
  'country',
  'city',
  'state',
  'industry',
  'numberofemployees',
  'description',
  'linkedin_company_page',
  'linkedinbio',
  'account_executive',
  'lifecyclestage',
  'hubspot_owner_id'
];

export async function createHubSpotCompany(
  input: CreateHubSpotCompanyInput
): Promise<CreateHubSpotCompanyResult> {
  const token = await getHubSpotToken();
  if (!token) {
    return { ok: false, success: false, error: 'TOKEN_UNAVAILABLE', owner_assigned: false, account_executive_assigned: false, warnings: [] };
  }

  const warnings: string[] = [];
  const skippedProperties: string[] = [];

  // 1. Fetch HubSpot Properties metadata to resolve custom property names dynamically
  const hubspotProps = await getHubSpotCompanyPropertiesMetadata(token);

  // 2. Resolve owner dynamically
  let finalOwnerId: string | null = null;
  let owner_assigned = false;
  let owner_id: string | undefined;
  let owner_email: string | undefined;
  let ownerMappingStatus: 'mapped' | 'skipped_missing_mapping' | 'skipped' = 'skipped';

  if (input.approvedByEmail) {
    const owner = await findHubSpotOwnerByEmail(input.approvedByEmail, token);
    if (owner) {
      finalOwnerId = owner.id;
      owner_assigned = true;
      owner_id = owner.id;
      owner_email = owner.email;
      ownerMappingStatus = 'mapped';
    } else {
      owner_assigned = false;
      ownerMappingStatus = 'skipped_missing_mapping';
      warnings.push('hubspot_owner_not_found');
    }
  } else if (input.hubspotOwnerId) {
    if (input.hubspotOwnerId === 'skipped_missing_mapping') {
      ownerMappingStatus = 'skipped_missing_mapping';
      warnings.push('hubspot_owner_not_found');
    } else {
      finalOwnerId = input.hubspotOwnerId;
      owner_assigned = true;
      owner_id = input.hubspotOwnerId;
      ownerMappingStatus = 'mapped';
    }
  }

  // 3. Setup properties dictionary
  const properties: Record<string, string> = { name: input.name };

  // 4. Lifecyclestage MQL
  properties.lifecyclestage = 'marketingqualifiedlead';

  // 5. Standard fields
  if (input.website) properties.website = input.website;
  if (input.domain) properties.domain = input.domain;
  if (input.city) properties.city = input.city;
  if (input.region) properties.state = input.region;
  if (input.description) properties.description = input.description;
  if (finalOwnerId) properties.hubspot_owner_id = finalOwnerId;

  // TAREA 2: Mapear LinkedIn corporativo dinámicamente
  let linkedinPropName: string | null = null;
  const hasLinkedinCompanyPage = hubspotProps.some(p => p.name === 'linkedin_company_page');
  if (hasLinkedinCompanyPage) {
    linkedinPropName = 'linkedin_company_page';
  } else {
    const customLinkedinProp = findPropertyInternalName(hubspotProps, {
      names: ['linkedin_url', 'linkedin_company_url', 'linkedin_page', 'linkedin'],
      labels: ['LinkedIn URL', 'LinkedIn Company URL', 'LinkedIn Page', 'LinkedIn']
    });
    if (customLinkedinProp) {
      linkedinPropName = customLinkedinProp;
    }
  }

  if (input.linkedinUrl) {
    if (linkedinPropName) {
      properties[linkedinPropName] = input.linkedinUrl;
    } else {
      skippedProperties.push('linkedin_company_page (property not found)');
      warnings.push('hubspot_linkedin_property_not_found');
    }
  }

  // Si existe linkedinbio y tenemos bio/descripción real, enviarla (no URL)
  const hasLinkedinBio = hubspotProps.some(p => p.name === 'linkedinbio');
  if (hasLinkedinBio && input.description) {
    properties.linkedinbio = input.description;
  }

  // TAREA 3 & 4: Mapear Account Executive dinámicamente
  let aePropName: string | null = null;
  let account_executive_assigned = false;
  let account_executive_property: string | undefined;
  let account_executive_value: string | undefined;

  aePropName = findPropertyInternalName(hubspotProps, {
    names: ['account_executive', 'account_executive_id', 'account_executive_owner', 'ejecutivo_de_cuenta', 'ae_owner', 'hs_account_executive'],
    labels: ['Account Executive', 'Account executive', 'Ejecutivo de cuenta', 'AE', 'Owner comercial']
  });

  if (aePropName) {
    account_executive_property = aePropName;
    const aeProp = hubspotProps.find(p => p.name === aePropName);
    if (aeProp) {
      const ownerName = owner_id ? (input.approvedByName || '') : '';
      
      if (aeProp.referencedObjectType === 'OWNER' || aeProp.name === 'hubspot_owner_id') {
        // Type A: HubSpot Owner
        if (finalOwnerId) {
          properties[aePropName] = finalOwnerId;
          account_executive_assigned = true;
          account_executive_value = finalOwnerId;
        } else {
          skippedProperties.push(`${aePropName}: no owner resolved to assign`);
          warnings.push('hubspot_account_executive_value_not_supported');
        }
      } else if (aeProp.type === 'enumeration') {
        // Type B: Enumeration
        if (aeProp.options && aeProp.options.length > 0 && finalOwnerId) {
          const ownerIdLower = finalOwnerId.toLowerCase();
          const emailLower = owner_email?.toLowerCase();
          const nameLower = ownerName?.toLowerCase();

          const matchOption = aeProp.options.find(opt => {
            const val = opt.value.toLowerCase();
            const label = opt.label.toLowerCase();

            return (
              (ownerIdLower && (val === ownerIdLower || label === ownerIdLower)) ||
              (emailLower && (val === emailLower || label === emailLower)) ||
              (nameLower && (val === nameLower || label === nameLower || label.includes(nameLower) || nameLower.includes(label)))
            );
          });

          if (matchOption) {
            properties[aePropName] = matchOption.value;
            account_executive_assigned = true;
            account_executive_value = matchOption.value;
          } else {
            skippedProperties.push(`${aePropName}: no matching option in enumeration for owner`);
            warnings.push('hubspot_account_executive_value_not_supported');
          }
        } else {
          skippedProperties.push(`${aePropName}: enumeration options are empty or no owner resolved`);
          warnings.push('hubspot_account_executive_value_not_supported');
        }
      } else if (aeProp.type === 'string') {
        // Type C: String
        const isTechnical = aeProp.name.toLowerCase().includes('email') || aeProp.name.toLowerCase().includes('id') || aeProp.name.toLowerCase().includes('user') ||
                            aeProp.label.toLowerCase().includes('email') || aeProp.label.toLowerCase().includes('id') || aeProp.label.toLowerCase().includes('usuario');

        if (isTechnical) {
          if (owner_email) {
            properties[aePropName] = owner_email;
            account_executive_assigned = true;
            account_executive_value = owner_email;
          } else {
            skippedProperties.push(`${aePropName}: owner email not found for technical string field`);
            warnings.push('hubspot_account_executive_value_not_supported');
          }
        } else {
          const valToSend = ownerName || owner_email || finalOwnerId;
          if (valToSend) {
            properties[aePropName] = valToSend;
            account_executive_assigned = true;
            account_executive_value = valToSend;
          } else {
            skippedProperties.push(`${aePropName}: no owner info available to assign`);
            warnings.push('hubspot_account_executive_value_not_supported');
          }
        }
      } else {
        // Type D: Other
        skippedProperties.push(`${aePropName}: field type "${aeProp.type}" not supported`);
        warnings.push('hubspot_account_executive_value_not_supported');
      }
    }
  } else {
    skippedProperties.push('account_executive (property not found)');
    warnings.push('hubspot_account_executive_property_not_found');
  }

  // Country normalisation
  const normalizedCountryName = getCountryNameFromCode(input.countryCode) ?? input.country;
  if (normalizedCountryName) {
    properties.country = normalizedCountryName;
  }

  // Employee count parsing
  const parsedEmployees = parseEmployeeEstimateToHubSpotNumber(input.numberOfEmployees);
  if (parsedEmployees !== undefined) {
    properties.numberofemployees = String(parsedEmployees);
  } else if (input.numberOfEmployees) {
    skippedProperties.push(`numberOfEmployees: could not parse "${input.numberOfEmployees}"`);
  }

  // Industry verification / custom macro_industria fallback
  if (input.industry) {
    const standardIndustryProp = hubspotProps.find(p => p.name === 'industry');
    const matchedOption = standardIndustryProp?.options?.find(
      opt => opt.value.toLowerCase() === input.industry!.toLowerCase() ||
             opt.label.toLowerCase() === input.industry!.toLowerCase()
    );
    if (matchedOption) {
      properties.industry = matchedOption.value;
    } else {
      const macroIndustriaPropName = findPropertyInternalName(hubspotProps, {
        names: ['macro_industria'],
        labels: ['Macro industria', 'Macro-industria']
      });
      if (macroIndustriaPropName) {
        properties[macroIndustriaPropName] = input.industry;
      } else {
        skippedProperties.push(`industry: UBITS taxonomy "${input.industry}" doesn't match standard HubSpot options and macro_industria was not found`);
      }
    }
  }

  // Custom properties resolution
  // 1) Pais
  const customPaisName = findPropertyInternalName(hubspotProps, {
    names: ['pais'],
    labels: ['País', 'Pais']
  });
  if (customPaisName && normalizedCountryName) {
    properties[customPaisName] = normalizedCountryName;
  }

  // 2) Identificación Fiscal (NIT - RFC - RUC)
  let cleanNit: string | null = null;
  if (input.taxIdentifier) {
    const isCO = input.countryCode === 'CO';
    const taxIdVal = isCO ? cleanNitForHubSpot(input.taxIdentifier) : input.taxIdentifier;
    
    if (!isCO || taxIdVal.length >= 5) {
      const customTaxIdName = findPropertyInternalName(hubspotProps, {
        names: ['identificacion_fiscal', 'nit', 'rfc', 'ruc', 'tax_id'],
        labels: ['Identificación Fiscal (NIT - RFC - RUC)', 'Identificación Fiscal', 'nit', 'rfc', 'ruc', 'tax id', 'tax_id']
      });
      if (customTaxIdName) {
        properties[customTaxIdName] = taxIdVal;
        cleanNit = taxIdVal;
      } else {
        skippedProperties.push('taxIdentifier (tax_id custom field not found)');
      }
    }
  }

  // 3) Razón Social
  if (input.legalName) {
    const customRazonSocialName = findPropertyInternalName(hubspotProps, {
      names: ['razon_social_de_la_empresa', 'razon_social', 'company_legal_name'],
      labels: ['Razón Social de la Empresa', 'Razón Social', 'Razón social de la empresa', 'Company Legal Name']
    });
    if (customRazonSocialName) {
      properties[customRazonSocialName] = input.legalName;
    } else {
      skippedProperties.push('legalName (razon_social custom field not found)');
    }
  }

  // 4) Source/Origen
  const customSourceName = findPropertyInternalName(hubspotProps, {
    names: ['sellup_source', 'origen', 'source'],
    labels: ['SellUp Source', 'Origen', 'Source']
  });
  if (customSourceName) {
    let sourceVal = 'SellUp';
    if (input.sourcePrimary === 'external_import') {
      sourceVal = 'Importación externa';
    }
    if (input.batchName) {
      sourceVal = input.batchName;
    }
    properties[customSourceName] = sourceVal;
  }

  const sendRequest = async (propsToSend: Record<string, string>) => {
    return await fetch('https://api.hubapi.com/crm/v3/objects/companies', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ properties: propsToSend }),
    });
  };

  try {
    let response = await sendRequest(properties);
    
    // Fallback retry if validation error (HTTP 400)
    if (!response.ok && response.status === 400) {
      const errBody = await response.json().catch(() => ({}));
      const errMsg = errBody.message || '';
      warnings.push(`validation_error: ${errMsg}`);
      
      const match = /Property\s+['"]?([a-zA-Z0-9_-]+)['"]?\s+does\s+not\s+exist/i.exec(errMsg) ||
                    /Property\s+['"]?([a-zA-Z0-9_-]+)['"]?\s+is\s+read-only/i.exec(errMsg);
      
      let retryProps = { ...properties };
      if (match) {
        const invalidProp = match[1];
        delete retryProps[invalidProp];
        skippedProperties.push(`${invalidProp} (removed on validation retry)`);
      } else {
        // Fallback retry using ONLY standard safe properties
        const filteredProps: Record<string, string> = {};
        for (const k of Object.keys(properties)) {
          if (SAFE_STANDARD_PROPERTIES.includes(k)) {
            filteredProps[k] = properties[k];
          } else {
            skippedProperties.push(k);
          }
        }
        retryProps = filteredProps;
      }
      
      response = await sendRequest(retryProps);
      if (!response.ok) {
        const finalErrBody = await response.json().catch(() => ({}));
        const finalMsg = finalErrBody.message || `HTTP_${response.status}`;
        return {
          ok: false,
          success: false,
          error: finalMsg,
          statusCode: response.status,
          sentPropertyKeys: Object.keys(properties),
          properties_sent: properties,
          skippedProperties,
          properties_skipped: skippedProperties,
          ownerMappingStatus,
          owner_assigned,
          owner_id,
          owner_email,
          account_executive_assigned,
          account_executive_property,
          account_executive_value,
          warnings,
        };
      }
    } else if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      return {
        ok: false,
        success: false,
        error: errBody.message || `HTTP_${response.status}`,
        statusCode: response.status,
        sentPropertyKeys: Object.keys(properties),
        properties_sent: properties,
        skippedProperties,
        properties_skipped: skippedProperties,
        ownerMappingStatus,
        owner_assigned,
        owner_id,
        owner_email,
        account_executive_assigned,
        account_executive_property,
        account_executive_value,
        warnings,
      };
    }

    const data = (await response.json()) as { id?: string };
    if (!data.id) {
      return {
        ok: false,
        success: false,
        error: 'NO_ID_IN_RESPONSE',
        sentPropertyKeys: Object.keys(properties),
        properties_sent: properties,
        skippedProperties,
        properties_skipped: skippedProperties,
        ownerMappingStatus,
        owner_assigned,
        owner_id,
        owner_email,
        account_executive_assigned,
        account_executive_property,
        account_executive_value,
        warnings,
      };
    }

    const sentPropertiesAudit: CreateHubSpotCompanySentAudit = {
      name: input.name,
      country: properties.country ?? null,
      nit: cleanNit,
      domain: properties.domain ?? null,
      city: properties.city ?? null,
      state: properties.state ?? null,
      lifecyclestage: 'marketingqualifiedlead',
      numberofemployees: properties.numberofemployees ?? null,
      hubspot_owner_id: properties.hubspot_owner_id ?? null,
      description: properties.description ?? null,
      linkedin_company_page: linkedinPropName ? (properties[linkedinPropName] ?? null) : null,
    };

    if (linkedinPropName && properties[linkedinPropName]) {
      sentPropertiesAudit[linkedinPropName] = properties[linkedinPropName];
    }
    if (aePropName && properties[aePropName]) {
      sentPropertiesAudit[aePropName] = properties[aePropName];
    }

    return {
      ok: true,
      success: true,
      hubspotCompanyId: data.id,
      company_id: data.id,
      company_name: input.name,
      sentPropertyKeys: Object.keys(properties),
      properties_sent: properties,
      sentPropertiesAudit,
      skippedProperties,
      properties_skipped: skippedProperties,
      ownerMappingStatus,
      owner_assigned,
      owner_id,
      owner_email,
      account_executive_assigned,
      account_executive_property,
      account_executive_value,
      warnings,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message.slice(0, 200) : 'Network error';
    return {
      ok: false,
      success: false,
      error: msg,
      sentPropertyKeys: Object.keys(properties),
      properties_sent: properties,
      skippedProperties,
      properties_skipped: skippedProperties,
      ownerMappingStatus,
      owner_assigned,
      owner_id,
      owner_email,
      account_executive_assigned,
      account_executive_property,
      account_executive_value,
      warnings,
    };
  }
}

// ── Read-only diagnostic helper ─────────────────────────────────────────────
// Confirma qué propiedades guardó HubSpot para una company existente.
// No escribe ni modifica nada.

export interface HubSpotCompanyPropertiesResult {
  ok: boolean;
  companyId?: string;
  properties?: Record<string, string | null>;
  error?: string;
  statusCode?: number;
}

export async function readHubSpotCompanyProperties(
  hubspotCompanyId: string,
  propertyNames: string[]
): Promise<HubSpotCompanyPropertiesResult> {
  const token = await getHubSpotToken();
  if (!token) {
    return { ok: false, error: 'TOKEN_UNAVAILABLE' };
  }

  const propsParam = propertyNames.map(encodeURIComponent).join(',');
  const url = `https://api.hubapi.com/crm/v3/objects/companies/${encodeURIComponent(hubspotCompanyId)}?properties=${propsParam}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      return { ok: false, error: `HTTP_${response.status}`, statusCode: response.status };
    }

    const data = (await response.json()) as {
      id?: string;
      properties?: Record<string, string | null>;
    };
    return { ok: true, companyId: data.id, properties: data.properties ?? {} };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message.slice(0, 200) : 'Network error';
    return { ok: false, error: msg };
  }
}
