# HubSpot Account Field Mapping — SellUp ↔ HubSpot Company

**Versión:** 0.2 (Validado)  
**Fecha:** 2026-05-21  
**Estado:** ✅ Validado contra portal real de HubSpot de UBITS (2026-05-21)

---

## Objetivo

Este documento establece el mapeo entre los campos de la tabla `accounts` de SellUp y las propiedades de compañías (Company) en HubSpot CRM del portal real de UBITS. El mapping fue validado el 2026-05-21 mediante una llamada de solo lectura a `GET /crm/v3/properties/companies` usando las credenciales almacenadas en Supabase Vault (`sellup_integration_hubspot`). No se escribió ni modificó nada en HubSpot durante la validación.

**Datos del portal UBITS (al 2026-05-21):**
- Total propiedades: **567**
- Propiedades `hs_*` internas de HubSpot: **201**
- Propiedades estándar: **350**
- Propiedades custom creadas en portal UBITS: **266**

---

## Tabla de Mapping: SellUp → HubSpot Company

| SellUp Field | HubSpot Property | Type en portal | Mapping | Estado | Notas |
|---|---|---|---|---|---|
| `id` | — | — | Internal | ✅ No sync | UUID interno de SellUp. |
| `name` | `name` | string/text | Standard | ✅ Confirmado | Nombre comercial. Mapeo directo. |
| `legal_name` | `sellup_legal_name` | — | Custom pendiente | ⚠️ Crear | `nombre_comercial` existe en UBITS pero es diferente. Crear `sellup_legal_name` para razón social. |
| `normalized_name` | — | — | Internal | ✅ No sync | Índice interno de búsqueda. |
| `website` | `website` | string/text | Standard | ✅ Confirmado | URL completa. Mapeo directo. |
| `domain` | `domain` | string/text | Standard | ✅ Confirmado | Clave de deduplicación primaria. |
| `country` | `country` | string/text | Standard | ✅ Confirmado | Nombre del país en texto. Ver también `pais` (custom enum). |
| `country_code` | `sellup_country_code` | — | Custom pendiente | ⚠️ Crear | HubSpot no tiene campo nativo para código ISO. UBITS tampoco lo tiene. |
| `city` | `city` | string/text | Standard | ✅ Confirmado | Mapeo directo. |
| `region` | `state` | string/text | Standard | ✅ Confirmado | HubSpot usa `state` para región subnacional (departamento/estado/provincia). |
| `industry` | `industry` | enumeration | Standard | ✅ Confirmado | Valores en inglés + 1 valor custom UBITS: `Agroindustry`. Ver sección de valores. |
| `company_size` | `numberofemployees` / `tamano_empresa` | number / enumeration | Standard + Custom UBITS | ✅ Ambos existen | `numberofemployees` espera entero. UBITS tiene `tamano_empresa` (enum de rangos). Evaluar cuál usar según estrategia de sync. |
| `tax_identifier` | `nit` (Colombia) / `sellup_tax_identifier` | number / pendiente | Parcial | ⚠️ Revisar | `nit` ya existe en UBITS (tipo number). Problema: NIT con dígito de verificación (`900000000-1`) no cabe en number. Además no cubre RFC/RUT/CNPJ/etc. Crear `sellup_tax_identifier` (text) para cobertura multi-país. |
| `tax_identifier_type` | `tipo_de_documento_colombia` / `sellup_tax_identifier_type` | enumeration / pendiente | Parcial | ⚠️ Revisar | `tipo_de_documento_colombia` existe en UBITS solo para Colombia. Crear `sellup_tax_identifier_type` para cobertura LatAm completa. |
| `source` | `sellup_source` | — | Custom pendiente | ⚠️ Crear | `original_source` de HubSpot es de solo lectura y no refleja fuentes propias de SellUp. |
| `pipeline_status` | `sellup_pipeline_status` | — | Custom pendiente | ⚠️ Crear | No tiene equivalente exacto en `lifecyclestage`. Ver sección de mapeo de estados. |
| `pipeline_substatus` | `sellup_pipeline_substatus` | — | Custom pendiente | ⚠️ Crear | Sin equivalente en HubSpot. |
| `owner_id` | `hubspot_owner_id` | enumeration | Standard | ✅ Confirmado | Existe. Requiere resolver `internal_user.email` → HubSpot Owner ID. |
| `hubspot_company_id` | — | — | Internal | ✅ No sync | Clave de enlace almacenada en SellUp. |
| `metadata` | — | — | Internal | ✅ No sync | JSONB variable. Definir subkeys antes de sincronizar. |
| `notes` | `description` | string/textarea | Standard | ✅ Confirmado | Textarea en HubSpot. Definir estrategia de merge en sync bidireccional. |
| `created_at` | `createdate` | datetime | Internal | ✅ No sync | Read-only en HubSpot. |
| `updated_at` | `hs_lastmodifieddate` | datetime | Internal | ✅ No sync | Read-only en HubSpot. |
| `archived_at` / `archived_by` | — | — | Internal | ✅ No sync | Lógica de archivado interna. |
| `created_by` / `updated_by` | — | — | Internal | ✅ No sync | Auditoría interna. |

---

## Campos estándar confirmados en portal UBITS

Todos los siguientes campos existen en el portal real (16/16 verificados):

| HubSpot Property | Tipo | fieldType | Grupo |
|---|---|---|---|
| `name` | string | text | companyinformation |
| `domain` | string | text | companyinformation |
| `website` | string | text | companyinformation |
| `phone` | string | phonenumber | companyinformation |
| `city` | string | text | companyinformation |
| `state` | string | text | companyinformation |
| `country` | string | text | companyinformation |
| `zip` | string | text | companyinformation |
| `address` | string | text | companyinformation |
| `industry` | enumeration | select | companyinformation |
| `numberofemployees` | number | number | companyinformation |
| `annualrevenue` | number | number | companyinformation |
| `description` | string | textarea | companyinformation |
| `hubspot_owner_id` | enumeration | select | companyinformation |
| `hs_lead_status` | enumeration | radio | companyinformation |
| `lifecyclestage` | enumeration | radio | companyinformation |

---

## Propiedades custom del portal UBITS relevantes para SellUp

El portal UBITS tiene 266 propiedades custom. Las siguientes son relevantes para el mapping:

| Propiedad UBITS | Label | Tipo | Relevancia para SellUp |
|---|---|---|---|
| `nit` | NIT | number | Cubre `tax_identifier` para Colombia. Problema: tipo number no soporta formato `NIT-dígito`. |
| `tipo_de_documento_colombia` | Tipo de Documento Identificación Fiscal | enumeration | Cubre `tax_identifier_type` para Colombia únicamente. |
| `nombre_comercial` | Nombre comercial | string | Diferente de `legal_name`. UBITS distingue nombre comercial de razón social. |
| `tamano_empresa` | Tamaño empresa | enumeration | Alternativa a `numberofemployees` con rangos textuales. Evaluar cuál usar. |
| `pais` | País | enumeration | Alternativa enum a `country` (string). UBITS ya tiene lista de países. |
| `estado` | Estado | enumeration | Estado de la cuenta (interno UBITS, no de SellUp). No confundir con `pipeline_status`. |
| `enrichment_source` | enrichment_source | string | Similar al `source` de SellUp. UBITS ya usa este campo. Evaluar si reutilizar. |
| `account_executive` | Account Executive | enumeration | Similar al `owner_id` de SellUp. UBITS puede tener AE diferente al HubSpot Owner. |
| `sales_team_country` | Sales Team Country | enumeration | Útil para contexto LATAM multi-país. |
| `ubits_region_for_company` | Company Region | string | Región geográfica interna UBITS. |
| `health_score` | Health Score | number | Usado en Customer Success. Referencia para futuras fases. |
| `lead_scoring` | Lead Scoring 2025 | number | Lead scoring interno UBITS. Referencia para Agente 1. |

---

## Valores del campo `industry` en portal UBITS

HubSpot estándar tiene 147 valores en inglés. UBITS agregó 1 valor custom:
- **`Agroindustry`** → label: "Agroindustry"

Los demás valores son el estándar de HubSpot en UPPER_SNAKE_CASE (e.g. `BANKING`, `FINANCIAL_SERVICES`, `INFORMATION_TECHNOLOGY_AND_SERVICES`, `E_LEARNING`, `EDUCATION_MANAGEMENT`).

**Implicación para SellUp:** Las industrias en `src/modules/accounts/types.ts` están en español. Al sincronizar hacia HubSpot se requerirá un mapeo de valores español → UPPER_SNAKE_CASE inglés. Ver pendiente #4.

---

## Valores del campo `lifecyclestage` en portal UBITS

| Valor API | Label en portal |
|---|---|
| `subscriber` | Suscriptor |
| `258335528` | No asignado *(custom UBITS)* |
| `lead` | Lead |
| `marketingqualifiedlead` | Lead calificado por marketing |
| `salesqualifiedlead` | Lead calificado por ventas |
| `opportunity` | Oportunidad |
| `customer` | Cliente |
| `evangelist` | Evangelizador |
| `other` | Otra |

**Implicación:** `258335528` es un stage custom de UBITS ("No asignado"). Los nuevos prospectos en SellUp con `pipeline_status = 'new'` posiblemente deberían mapearse a `258335528` (No asignado) o `lead` al sincronizar.

---

## Valores del campo `hs_lead_status` en portal UBITS

| Valor | Label |
|---|---|
| `New` | New |
| `Recycled` | Recycled |
| `Attempted to Contact` | Attempted to Contact |
| `Need Audit` | Need Audit |
| `Audited` | Audited |
| `Connected` | Connected |
| `Open Deal` | Open Deal |
| `Unqualified / lost` | Unqualified / lost |
| `Customer` | Customer |
| `Bad Timing` | Bad Timing |
| `Went Dark` | Went Dark |
| `MKT Recovery` | MKT Recovery |

**Implicación:** `hs_lead_status` en UBITS ya tiene un workflow de seguimiento SDR definido. El `pipeline_status` de SellUp (orientado a investigación y prospección) es complementario, no equivalente.

---

## Propiedades custom que deben crearse en portal UBITS

Las siguientes propiedades sugeridas **no existen aún** en el portal y deben crearse antes de implementar sync:

| Propiedad a crear | Tipo sugerido | Justificación |
|---|---|---|
| `sellup_legal_name` | Single-line text | Razón social legal, diferente del nombre comercial. |
| `sellup_tax_identifier` | Single-line text | Identificador fiscal multi-país (NIT/RFC/RUT/CNPJ/etc). Texto para soportar formatos con guiones y dígito de verificación. |
| `sellup_tax_identifier_type` | Enumeration | Tipo de documento fiscal multi-país. Valores: `NIT`, `RFC`, `RUT`, `RUC`, `CUIT`, `CNPJ`, `RNC`, `RTN`, `cedula_juridica`, `other`. |
| `sellup_country_code` | Single-line text | Código ISO 3166-1 alpha-2 (`CO`, `MX`, `PE`, etc.). |
| `sellup_pipeline_status` | Enumeration | Estado del pipeline de SellUp. Valores: `new`, `ready_for_research`, `research_in_progress`, `ready_for_outreach`, `archived`. |
| `sellup_pipeline_substatus` | Single-line text | Sub-estado granular de SellUp. |
| `sellup_source` | Enumeration | Fuente de creación. Valores: `manual`, `agent_1`, `hubspot`, `apollo`, `lusha`, `imported`, `other`. |

---

## Mapeo propuesto `pipeline_status` → `lifecyclestage`

Para cuando se implemente sync, una correspondencia sugerida (no definitiva — requiere validación con equipo UBITS):

| SellUp `pipeline_status` | HubSpot `lifecyclestage` sugerido | HubSpot `hs_lead_status` sugerido |
|---|---|---|
| `new` | `258335528` (No asignado) | `New` |
| `ready_for_research` | `lead` | `Need Audit` |
| `research_in_progress` | `lead` | `Audited` |
| `ready_for_outreach` | `salesqualifiedlead` | `Attempted to Contact` |
| `archived` | No sincronizar o `other` | `Unqualified / lost` |

**Nota:** Este mapeo es orientativo. La decisión final debe tomarse con el equipo de RevOps/CRM de UBITS para no interferir con sus workflows de automatización existentes.

---

## Reglas de deduplicación recomendadas

| Prioridad | Criterio | Confianza | Notas |
|---|---|---|---|
| 1 | `hubspot_company_id` (almacenado en SellUp) | **Alta** | Identificador definitivo post-primera-sync. |
| 2 | `domain` normalizado | **Alta** | Clave nativa de HubSpot. Sin protocolo, sin `www`, en minúsculas. |
| 3 | `tax_identifier` (`nit` en UBITS) | **Alta** | Cuando disponible. Requiere `sellup_tax_identifier` creado en HubSpot. |
| 4 | `normalized_name` + `country` (fuzzy) | **Media** | Fallback. Requiere revisión humana para casos ambiguos. |

---

## Campos que NO deben sincronizarse aún

| Campo | Razón |
|---|---|
| `id` | UUID interno de SellUp. Sin significado en HubSpot. |
| `normalized_name` | Índice interno generado. |
| `pipeline_status` / `pipeline_substatus` | Hasta definir mapeo con `lifecyclestage` con equipo UBITS. |
| `metadata` | JSONB variable. Definir subkeys antes de sincronizar. |
| `archived_at` / `archived_by` | Coordinar comportamiento con lógica de archivado de HubSpot. |
| `created_by` / `updated_by` | Auditoría interna. |
| `created_at` / `updated_at` | Read-only en HubSpot. |
| Source `agent_1` | Agente no completamente implementado. |

---

## Pendientes antes de construir sincronización

1. **Decisión sobre `tax_identifier` y `nit`**  
   El portal UBITS ya tiene `nit` (type: number, solo Colombia). Para cobertura multi-país y para soportar NIT con dígito de verificación se recomienda crear `sellup_tax_identifier` (text). Confirmar con equipo si se migra `nit` o se mantienen ambos.

2. **Crear propiedades custom en HubSpot**  
   Las 7 propiedades listadas en la sección anterior no existen aún. Crearlas requiere acceso de administrador al portal de HubSpot de UBITS o un script con el scope `crm.schemas.companies.write`.

3. **Definir mapeo de valores `industry` (español → UPPER_SNAKE_CASE)**  
   Los valores de industria de SellUp están en español. Necesario un diccionario de traducción. El valor `Agroindustry` de UBITS puede añadirse a la lista de `INDUSTRIES` de SellUp.

4. **Validar mapeo `pipeline_status` → `lifecyclestage` / `hs_lead_status` con equipo UBITS**  
   UBITS tiene flujos de automatización sobre `lifecyclestage` y `hs_lead_status`. Cualquier escritura desde SellUp debe coordinarse para no romper workflows existentes.

5. **Resolver owner mapping: `internal_user` → HubSpot Owner ID**  
   Construir tabla de lookup `internal_users.email` → `hubspot_owner_id`. Puede precargarse consultando `GET /crm/v3/owners`.

6. **Definir dirección de sincronización**  
   Unidireccional SellUp → HubSpot, bidireccional, o pull-only desde HubSpot.

7. **Definir estrategia de merge en `notes` ↔ `description`**  
   Reemplazo completo, append con timestamp, o campos independientes.

8. **Evaluar `tamano_empresa` vs `numberofemployees`**  
   UBITS usa `tamano_empresa` (enum de rangos). SellUp también usa rangos textuales en `company_size`. Evaluar si mapear SellUp `company_size` → `tamano_empresa` directamente en vez de `numberofemployees`.

---

## Estado

> ✅ **Mapping validado contra el portal real de HubSpot de UBITS el 2026-05-21.**  
> Validación de solo lectura — sin escrituras a HubSpot.  
> Las propiedades custom sugeridas aún deben crearse antes de implementar sincronización.  
> Pendiente coordinación con equipo UBITS/RevOps para decisiones de sync bidireccional.

---

*Documento actualizado el 2026-05-21 tras validación contra portal real (567 propiedades, 266 custom).*
