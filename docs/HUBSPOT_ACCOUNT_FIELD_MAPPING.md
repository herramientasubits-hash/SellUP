# HubSpot Account Field Mapping — SellUp ↔ HubSpot Company

**Versión:** 0.1 (Preliminar)  
**Fecha:** 2026-05-21  
**Estado:** ⚠️ No validado contra portal real de HubSpot de UBITS

---

## Objetivo

Este documento establece un mapeo preliminar entre los campos de la tabla `accounts` de SellUp y las propiedades estándar de compañías (Company) en HubSpot CRM, con el propósito de validar la alineación de campos antes de construir cualquier mecanismo de sincronización. Dado que no existe un token de HubSpot API configurado en el proyecto (`.env.local` no contiene `HUBSPOT_API_KEY`), este mapeo se basa en las propiedades estándar publicadas en la documentación oficial de HubSpot y en convenciones ampliamente conocidas para la API de HubSpot Companies. El documento no reemplaza una validación real contra el portal de UBITS: las propiedades custom que UBITS haya creado en su instancia de HubSpot pueden diferir de las sugeridas aquí. Toda decisión de implementación debe confirmarse una vez que se cuente con acceso de API al portal de HubSpot de UBITS.

---

## Tabla de Mapping: SellUp → HubSpot Company

| SellUp Field | HubSpot Property | Type in HubSpot | Mapping Type | Notes |
|---|---|---|---|---|
| `id` | — | — | Internal | UUID interno de SellUp. No se sincroniza. |
| `name` | `name` | Single-line text | Standard | Nombre comercial de la empresa. Mapeo directo. |
| `legal_name` | `sellup_legal_name` | Single-line text | Custom | En LATAM el nombre legal (razón social) frecuentemente difiere del nombre comercial. HubSpot `name` almacena el nombre de marca; crear propiedad custom para razón social. |
| `normalized_name` | — | — | Internal | Campo de índice de búsqueda interno generado por SellUp. No se sincroniza. |
| `website` | `website` | URL | Standard | URL del sitio web. Mapeo directo. |
| `domain` | `domain` | Single-line text | Standard | Dominio principal (e.g. `bancolombia.com`). Usado como clave de deduplicación. |
| `country` | `country` | Single-line text | Standard | Nombre del país en texto. HubSpot acepta nombre completo o código. |
| `country_code` | `sellup_country_code` | Single-line text | Custom | Código ISO 3166-1 alpha-2 (e.g. `CO`, `MX`, `PE`). HubSpot no tiene campo nativo separado para código de país; usar custom o incluir en `country`. |
| `city` | `city` | Single-line text | Standard | Ciudad. Mapeo directo. |
| `region` | `state` | Single-line text | Standard | Departamento / estado / provincia. HubSpot usa `state` para región subnacional. |
| `industry` | `industry` | Enumeration | Standard | Industria. Los valores del enum de HubSpot son en inglés; considerar mapeo de valores LATAM a opciones estándar o usar custom enum. |
| `company_size` | `numberofemployees` | Number | Standard | HubSpot almacena número de empleados. Si `company_size` es un rango de texto (e.g. "50-200"), se requiere transformación o crear propiedad custom adicional `sellup_company_size_range`. |
| `tax_identifier` | `sellup_tax_identifier` | Single-line text | Custom | NIT, RFC, RUT, RUC, CUIT, CNPJ, RNC, RTN, cédula jurídica, etc. Identificador fiscal definitivo en LATAM; clave de deduplicación de alta confianza. No tiene equivalente en HubSpot estándar. |
| `tax_identifier_type` | `sellup_tax_identifier_type` | Enumeration | Custom | Tipo de identificador fiscal. Crear enum con valores: `NIT`, `RFC`, `RUT`, `RUC`, `CUIT`, `CNPJ`, `RNC`, `RTN`, `cedula_juridica`, `other`. |
| `source` | `original_source` / `sellup_source` | Enumeration | Custom | `original_source` de HubSpot tiene valores fijos y limitados; no refleja fuentes propias de SellUp (`agent_1`, `apollo`, `lusha`, etc.). Crear `sellup_source` con los valores del enum de SellUp. |
| `pipeline_status` | `sellup_pipeline_status` | Enumeration | Custom | El ciclo de vida interno de SellUp (`new`, `ready_for_research`, `research_in_progress`, `ready_for_outreach`, `archived`) no tiene equivalente directo en `lifecyclestage` de HubSpot. Evaluar si mapear a `lifecyclestage` o mantener como propiedad custom separada (ver sección de pendientes). |
| `pipeline_substatus` | `sellup_pipeline_substatus` | Single-line text / Enumeration | Custom | Sub-estado granular de SellUp. Sin equivalente en HubSpot estándar. |
| `owner_id` | `hubspot_owner_id` | HubSpot User | Standard | Propietario en HubSpot. El mapeo requiere resolver `internal_user.email` → HubSpot Owner ID (ver sección de pendientes). |
| `hubspot_company_id` | — | — | Internal | Almacenado en SellUp como referencia al registro HubSpot. Es la clave de enlace, no un campo a sincronizar hacia HubSpot. |
| `metadata` | — | — | Internal | JSONB de estructura variable. No sincronizar hasta definir esquema y estrategia. |
| `notes` | `description` | Multi-line text | Standard | HubSpot `description` es el campo de notas/descripción de la empresa. Considerar si se hace append o reemplazo en sync bidireccional. |
| `created_at` | `createdate` | DateTime | Internal | `createdate` en HubSpot es gestionado por HubSpot y es de solo lectura. No sincronizar desde SellUp. |
| `updated_at` | `hs_lastmodifieddate` | DateTime | Internal | Gestionado por HubSpot. Solo lectura. |
| `archived_at` | — | — | Internal | Lógica de archivado interna de SellUp. No sincronizar. |
| `archived_by` | — | — | Internal | Auditoría interna. No sincronizar. |
| `created_by` | — | — | Internal | Auditoría interna. No sincronizar. |
| `updated_by` | — | — | Internal | Auditoría interna. No sincronizar. |

---

## Campos alineados con propiedades estándar

Los siguientes campos de SellUp tienen correspondencia directa con propiedades estándar de HubSpot Company sin requerir customización:

| SellUp Field | HubSpot Property (API name) | Notas |
|---|---|---|
| `name` | `name` | Nombre comercial. Mapeo directo 1:1. |
| `website` | `website` | URL completa. Asegurar formato `https://`. |
| `domain` | `domain` | Dominio sin protocolo ni `www`. Clave de deduplicación primaria en HubSpot. |
| `country` | `country` | Nombre del país. HubSpot acepta texto libre pero también tiene listas internas. |
| `city` | `city` | Ciudad principal. |
| `region` | `state` | HubSpot llama al campo `state` (estado/provincia). En contexto LATAM equivale a departamento, estado, región o provincia. |
| `industry` | `industry` | Enum. Los valores predeterminados de HubSpot son en inglés; posible necesidad de mapeo de valores. |
| `company_size` | `numberofemployees` | HubSpot espera número entero. Si SellUp almacena rangos textuales, aplicar transformación. |
| `owner_id` | `hubspot_owner_id` | Requiere resolución de ID interno SellUp → HubSpot Owner ID vía email. |
| `notes` | `description` | Campo de descripción/notas. Definir estrategia de merge en sync bidireccional. |

---

## Campos que requieren propiedades custom

Los siguientes campos no tienen equivalente en propiedades estándar de HubSpot y requieren la creación de propiedades custom en el portal de UBITS. Se sugieren nombres de propiedades con el prefijo `sellup_` para facilitar identificación y evitar conflictos:

| SellUp Field | Propiedad Custom Sugerida | Tipo HubSpot | Justificación |
|---|---|---|---|
| `legal_name` | `sellup_legal_name` | Single-line text | En mercados LATAM la razón social es campo legal distinto al nombre de marca. HubSpot `name` es para nombre comercial. |
| `tax_identifier` | `sellup_tax_identifier` | Single-line text | Identificador fiscal único por empresa (NIT, RFC, RUT, CNPJ, etc.). Sin equivalente en HubSpot estándar. Es el identificador más definitivo para deduplicación en LATAM. |
| `tax_identifier_type` | `sellup_tax_identifier_type` | Enumeration | Tipo de documento fiscal por país. Valores: `NIT` (Colombia), `RFC` (México), `RUT` (Chile/Uruguay), `RUC` (Perú/Ecuador/Paraguay), `CUIT` (Argentina), `CNPJ` (Brasil), `RNC` (Rep. Dominicana), `RTN` (Honduras), `cedula_juridica` (Costa Rica/Panamá), `other`. |
| `country_code` | `sellup_country_code` | Single-line text | Código ISO 3166-1 alpha-2. HubSpot no tiene un campo nativo separado para código de país. Alternativa: enriquecer `country` con código directamente. |
| `pipeline_status` | `sellup_pipeline_status` | Enumeration | El pipeline interno de SellUp (`new`, `ready_for_research`, `research_in_progress`, `ready_for_outreach`, `archived`) no tiene mapeo exacto en `lifecyclestage`. Ver discusión en sección de pendientes. |
| `pipeline_substatus` | `sellup_pipeline_substatus` | Single-line text | Sub-estado granular sin equivalente en HubSpot. |
| `source` | `sellup_source` | Enumeration | Las fuentes de SellUp (`manual`, `agent_1`, `hubspot`, `apollo`, `imported`, `other`) no tienen equivalente exacto en `original_source` de HubSpot, que es de solo lectura y valores fijos. |

### Nota sobre `pipeline_status` vs `lifecyclestage`

HubSpot `lifecyclestage` maneja el ciclo de vida de un contacto/empresa en el embudo de ventas y marketing (valores: `subscriber`, `lead`, `marketingqualifiedlead`, `salesqualifiedlead`, `opportunity`, `customer`, `evangelist`, `other`). El `pipeline_status` de SellUp refleja el estado de investigación y preparación para outreach, que es un concepto más granular y distinto al lifecycle de HubSpot. Se recomienda:

- Mantener `sellup_pipeline_status` como propiedad custom independiente.
- Opcionalmente definir un mapeo de valores hacia `lifecyclestage` para dashboards de HubSpot, pero sin sobreescribir la lógica de `lifecyclestage` que HubSpot gestiona automáticamente.

---

## Campos que NO deben sincronizarse todavía

Los siguientes campos son internos de SellUp o tienen dependencias de diseño pendientes que impiden definir una estrategia de sync segura:

| Campo | Razón para no sincronizar |
|---|---|
| `id` | UUID interno de SellUp. Clave primaria local; no tiene significado en HubSpot. |
| `normalized_name` | Campo de índice de búsqueda generado internamente por SellUp para deduplicación y búsqueda fuzzy. No relevante para HubSpot. |
| `pipeline_status` / `pipeline_substatus` | Hasta que se defina el mapeo con `lifecyclestage` o se confirme la creación de propiedades custom en HubSpot de UBITS. |
| `metadata` | JSONB de estructura variable. No sincronizar hasta que se defina qué subkeys deben exponerse y en qué propiedades de HubSpot. |
| `archived_at` / `archived_by` | La lógica de archivado de SellUp es interna. En HubSpot las compañías se "archivan" mediante su propio mecanismo. Coordinar comportamiento antes de implementar. |
| `created_by` / `updated_by` | Auditoría interna de SellUp. No corresponde a propiedades de HubSpot. |
| `created_at` / `updated_at` | `createdate` y `hs_lastmodifieddate` en HubSpot son de solo lectura y gestionados por HubSpot. No sincronizar desde SellUp. |
| Source `agent_1` | El agente de prospección no está completamente implementado. Evitar sincronizar compañías con source `agent_1` hasta que el flujo esté validado. |

---

## Reglas de deduplicación recomendadas

Al sincronizar una cuenta de SellUp hacia HubSpot (o al importar registros de HubSpot a SellUp), aplicar la siguiente jerarquía de matching para evitar duplicados:

| Prioridad | Criterio | Confianza | Notas |
|---|---|---|---|
| 1 | `hubspot_company_id` (almacenado en SellUp) | **Alta** | Una vez que se realiza la primera sincronización y SellUp almacena el ID de HubSpot, este es el identificador definitivo. No hay ambigüedad. |
| 2 | `domain` (normalizado) | **Alta** | Dominio sin protocolo, sin `www`, en minúsculas (e.g. `bancolombia.com`). HubSpot usa domain como clave de deduplicación nativa. Confiable para empresas con presencia web establecida. |
| 3 | `tax_identifier` (si está disponible) | **Alta** | En LATAM el identificador fiscal es único por empresa y país. Cuando está disponible, es el identificador más definitivo. Requiere que `sellup_tax_identifier` esté creado como propiedad custom en HubSpot. |
| 4 | `normalized_name` + `country` (fuzzy match) | **Media** | Fallback para empresas sin dominio conocido ni tax_identifier. Requiere umbral de similitud explícito y revisión humana para casos ambiguos. |

**Recomendación operativa:** En la primera sincronización, ejecutar el matching en orden de prioridad y marcar manualmente los casos que no resuelvan de forma unívoca antes de escribir a HubSpot.

---

## Pendientes antes de construir sincronización

Los siguientes puntos deben resolverse antes de implementar cualquier mecanismo de sync real:

1. **Confirmar propiedades custom del portal de UBITS**  
   Configurar `HUBSPOT_API_KEY` en `.env.local` y ejecutar `GET /crm/v3/properties/companies` para obtener el catálogo real de propiedades del portal de UBITS. Las propiedades custom sugeridas en este documento pueden ya existir con nombres diferentes, o pueden requerirse propiedades adicionales no anticipadas aquí.

2. **Definir mapeo de `lifecyclestage` / `hs_lead_status` hacia `pipeline_status`**  
   Decidir si `pipeline_status` de SellUp tiene una correspondencia con `lifecyclestage` de HubSpot o si se gestiona completamente como propiedad custom independiente. Documentar la tabla de equivalencias de valores si se define un mapeo.

3. **Crear propiedades custom en HubSpot**  
   Una vez validadas contra el portal real, crear las propiedades: `sellup_legal_name`, `sellup_tax_identifier`, `sellup_tax_identifier_type`, `sellup_country_code`, `sellup_pipeline_status`, `sellup_pipeline_substatus`, `sellup_source`. Confirmar nombres, tipos y grupos de propiedades.

4. **Definir owner mapping: SellUp `internal_user` → HubSpot Owner**  
   El campo `owner_id` en SellUp referencia `internal_users`. Para mapear a `hubspot_owner_id` se necesita: (a) que cada `internal_user` tenga un email que coincida con un usuario de HubSpot, y (b) un endpoint o tabla de lookup que traduzca `internal_user.id` → `hubspot_owner_id`. Definir si este mapeo se construye en tiempo de sync o se precarga.

5. **Definir dirección de sincronización**  
   Decidir entre tres modelos:
   - **Unidireccional SellUp → HubSpot:** SellUp es fuente de verdad para accounts. HubSpot recibe actualizaciones pero no escribe de vuelta.
   - **Bidireccional:** Cambios en HubSpot (e.g. owner, notas, lifecycle) se sincronizan de vuelta a SellUp. Requiere estrategia de resolución de conflictos.
   - **Pull-only desde HubSpot:** HubSpot es fuente de verdad; SellUp importa y enriquece pero no escribe.

6. **Definir estrategia de población de `hubspot_company_id`**  
   Aclarar si `hubspot_company_id` se pre-popula durante la importación inicial desde HubSpot, o si se asigna en la primera escritura hacia HubSpot desde SellUp. Este punto impacta la lógica de deduplicación desde el inicio.

7. **Definir estrategia de conflicto**  
   Cuando el mismo campo se modifica en SellUp y en HubSpot entre dos ciclos de sync, definir la política: "last write wins", "SellUp siempre gana", "HubSpot siempre gana" o "flag manual review". Especialmente relevante para `name`, `owner_id`, `notes`, y campos del pipeline.

8. **Validar enum de `industry`**  
   Los valores del enum `industry` de HubSpot están en inglés y siguen una clasificación que puede no reflejar sectores LATAM comunes (e.g. floricultura, minería artesanal, servicios de nómina). Mapear los valores de industria de UBITS a las opciones disponibles en HubSpot o evaluar usar `sellup_industry` como custom property.

9. **Definir tratamiento de `notes` en sync bidireccional**  
   Si `notes` (SellUp) ↔ `description` (HubSpot) se sincroniza en ambas direcciones, definir si se hace reemplazo completo, append con timestamp, o se mantienen como campos independientes.

---

## Estado

> ⚠️ **Mapping preliminar — no validado contra el portal real de HubSpot de UBITS.**  
> Pendiente revisión con `HUBSPOT_API_KEY` configurado y acceso real a la API.  
> No implementar sincronización basándose únicamente en este documento.

---

*Documento generado el 2026-05-21. Revisar y actualizar tras obtener acceso al portal HubSpot de UBITS.*
