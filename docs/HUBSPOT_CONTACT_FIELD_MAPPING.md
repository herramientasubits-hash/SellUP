# HubSpot Contact Field Mapping — SellUp ↔ HubSpot Contact

**Versión:** 0.1 (Validado)  
**Fecha:** 2026-05-21  
**Estado:** ✅ Validado contra portal real de HubSpot de UBITS (2026-05-21)

---

## Objetivo

Establecer el mapeo entre los campos de la tabla `contacts` de SellUp y las propiedades de contactos (Contact) en HubSpot CRM del portal real de UBITS. El mapping fue validado el 2026-05-21 mediante una llamada de solo lectura a `GET /crm/v3/properties/contacts` usando las credenciales almacenadas en Supabase Vault (`sellup_integration_hubspot`). **No se escribió ni modificó nada en HubSpot durante la validación.**

**Datos del portal UBITS al 2026-05-21:**
- Total propiedades de contacto: **730**
- Propiedades `hs_*` internas: **304**
- Propiedades estándar: **426**
- Propiedades custom creadas por usuarios UBITS: **241**

---

## Tabla de Mapping Principal: SellUp → HubSpot Contact

| SellUp Field | HubSpot Property | Tipo en portal | fieldType | Estado | Notas |
|---|---|---|---|---|---|
| `id` | — | — | — | ✅ No sync | UUID interno SellUp. |
| `account_id` | `associatedcompanyid` | number | number | ✅ Confirmado | Relación cuenta-contacto. Requiere mapear `accounts.hubspot_company_id` → `associatedcompanyid`. |
| `first_name` | `firstname` | string | text | ✅ Confirmado | Mapeo directo. Grupo: `contactinformation`. |
| `last_name` | `lastname` | string | text | ✅ Confirmado | Mapeo directo. Grupo: `contactinformation`. |
| `full_name` | — | — | — | ⚠️ Calcular | HubSpot no tiene `full_name`. Se debe reconstruir desde `firstname + lastname` en la sincronización. |
| `email` | `email` | string | text | ✅ Confirmado | Campo primario. Grupo: `contactinformation`. |
| `phone` | `phone` | string | phonenumber | ✅ Confirmado | Mapeo directo. Grupo: `contactinformation`. |
| `mobile_phone` | `mobilephone` | string | phonenumber | ✅ Confirmado | Mapeo directo. Grupo: `contactinformation`. |
| `linkedin_url` | `hs_linkedin_url` | string | text | ✅ Confirmado | HubSpot tiene `hs_linkedin_url` en grupo `socialmediainformation`. También existe `linkedinbio` (biografía, no URL). |
| `job_title` | `jobtitle` | string | text | ✅ Confirmado | Mapeo directo. Grupo: `contactinformation`. |
| `department` | `sellup_department` | — | — | ⚠️ Crear | HubSpot NO tiene `department` estándar para contactos. UBITS no tiene un custom equivalente claro. Crear `sellup_department`. |
| `seniority` | `seniority` | string | text | ✅ Confirmado | ¡Existe nativamente! Grupo: `contactinformation`. Advertencia: es text libre, no enum. Definir mapeo de valores SellUp → HubSpot en la sync. |
| `role_in_account` | `sellup_role_in_account` | — | — | ⚠️ Crear | Sin equivalente en HubSpot estándar ni en UBITS custom. Crear property custom `sellup_role_in_account` (enumeration). |
| `contact_status` | `sellup_contact_status` | — | — | ⚠️ Crear | `hs_lead_status` y `lifecyclestage` existen pero no reflejan el estado operativo de SellUp. Crear `sellup_contact_status`. |
| `source` | `sellup_source` | — | — | ⚠️ Crear | `original_source` de HubSpot es read-only. Crear `sellup_source` para fuentes propias (manual, apollo, lusha, agent_1). |
| `hubspot_contact_id` | — | — | — | ✅ No sync | Clave de enlace almacenada en SellUp. |
| `is_primary` | `sellup_is_primary` | — | — | ⚠️ Crear | Sin equivalente en HubSpot. Campo útil si se expone en HubSpot para los vendedores. Crear como `booleancheckbox`. |
| `email_confidence` | `sellup_email_confidence` | — | — | ⚠️ Crear | Sin equivalente. Crear como enumeration (unknown/low/medium/high/verified). Opcional: mapear desde Apollo/Lusha data. |
| `phone_confidence` | `sellup_phone_confidence` | — | — | ⚠️ Crear | Similar a email_confidence. Opcional. |
| `notes` | `hs_note_body` | — | — | ⚠️ Evaluar | HubSpot Notes son objetos separados (Notes CRM). No es un campo de contacto. Alternativa: usar `description` o crear `sellup_notes`. |
| `metadata` | — | — | — | ✅ No sync | JSONB interno. No sincronizar directamente. |
| `created_by` / `updated_by` | — | — | — | ✅ No sync | Auditoría interna SellUp. |
| `created_at` | `createdate` | datetime | date | ✅ No sync | Read-only en HubSpot. |
| `updated_at` | `lastmodifieddate` | datetime | date | ✅ No sync | Read-only en HubSpot. |
| `archived_at` / `archived_by` | — | — | — | ✅ No sync | Lógica de archivado interna SellUp. |

---

## Propiedades estándar confirmadas en portal UBITS

Todas verificadas mediante la llamada real el 2026-05-21:

| HubSpot Property | fieldType | Grupo | Verificado |
|---|---|---|---|
| `firstname` | text | contactinformation | ✅ |
| `lastname` | text | contactinformation | ✅ |
| `email` | text | contactinformation | ✅ |
| `phone` | phonenumber | contactinformation | ✅ |
| `mobilephone` | phonenumber | contactinformation | ✅ |
| `jobtitle` | text | contactinformation | ✅ |
| `seniority` | text | contactinformation | ✅ |
| `hubspot_owner_id` | select | contactinformation | ✅ |
| `lifecyclestage` | radio | contactinformation | ✅ |
| `hs_lead_status` | radio | contactinformation | ✅ |
| `hs_linkedin_url` | text | socialmediainformation | ✅ |
| `linkedinbio` | text | socialmediainformation | ✅ |
| `associatedcompanyid` | number | contactinformation | ✅ |
| `createdate` | date | contactinformation | ✅ |
| `lastmodifieddate` | date | contactinformation | ✅ |
| `hs_email_bounce` | number | emailinformation | ✅ |
| `hs_email_optout` | booleancheckbox | emailinformation | ✅ |

**Notable:** `department` NO existe como propiedad estándar de contactos en HubSpot. Requiere custom property.

---

## Campos Custom UBITS relevantes para Contactos

Los siguientes campos custom del portal UBITS son relevantes para la integración de contactos (muestra de los 241 custom encontrados):

| HubSpot Custom Property | fieldType | Label UBITS | Relevancia |
|---|---|---|---|
| `account_executive` | select | Account Executive | Asignación de AE — relacionado con `owner_id` |
| `activar_contacto_para_automatizar_interaccion` | radio | Activar contacto para automatizar interacción | Señal de automatización — útil para agentes futuros |
| `billing_user` | select | Billing User [Auto] | Rol económico — mapeable a `role_in_account = economic_buyer` |
| `anos_de_experiencia` | number | Años de experiencia en HR | Datos de enriquecimiento — metadata |
| `altas_y_bajas` | booleancheckbox | Altas y bajas | RRHH específico de UBITS — no sync |

---

## Seniority: Mapeo de Valores

HubSpot `seniority` es texto libre en el portal UBITS. Mapeo propuesto SellUp → HubSpot:

| SellUp `seniority` | HubSpot `seniority` (texto libre) |
|---|---|
| `c_level` | `C-Level` |
| `vp` | `VP` |
| `director` | `Director` |
| `manager` | `Manager` |
| `individual_contributor` | `Individual Contributor` |
| `unknown` | `""` (vacío) |

---

## Custom Properties a Crear en HubSpot

Antes de activar la sincronización bidireccional, crear las siguientes propiedades custom en el portal UBITS:

| Property Name | Label | Type | fieldType | Opciones |
|---|---|---|---|---|
| `sellup_department` | SellUp — Área / Departamento | string | text | — |
| `sellup_role_in_account` | SellUp — Rol en cuenta | enumeration | select | decision_maker, economic_buyer, champion, influencer, evaluator, technical_stakeholder, hr_leader, learning_leader, procurement, unknown |
| `sellup_contact_status` | SellUp — Estado de contacto | enumeration | select | active, inactive, left_company, do_not_contact, archived |
| `sellup_source` | SellUp — Fuente | enumeration | select | manual, hubspot, apollo, lusha, agent_1, imported, other |
| `sellup_is_primary` | SellUp — Contacto primario | booleancheckbox | booleancheckbox | — |
| `sellup_email_confidence` | SellUp — Confianza email | enumeration | select | unknown, low, medium, high, verified |
| `sellup_phone_confidence` | SellUp — Confianza teléfono | enumeration | select | unknown, low, medium, high, verified |

---

## Estrategia de Deduplicación

HubSpot deduplica contactos por `email`. Para la sync SellUp → HubSpot:
1. Buscar contacto existente por `email` antes de crear uno nuevo.
2. Si existe, actualizar y guardar `hubspot_contact_id` en SellUp.
3. Si no existe, crear nuevo y guardar el ID retornado.
4. Usar `associatedcompanyid` para vincular al Company (`accounts.hubspot_company_id`).

---

## Pendientes Antes de Sincronización Activa

- [ ] Crear 7 custom properties listadas arriba en portal HubSpot de UBITS
- [ ] Validar mapeo de seniority values con equipo comercial UBITS
- [ ] Definir estrategia de sync bidireccional (SellUp master o HubSpot master)
- [ ] Resolver conflicto `notes`: ¿campo `description` o objeto Note separado?
- [ ] Implementar lógica de deduplicación por email
- [ ] Validar gestión de contactos sin email (LinkedIn/Phone only)
- [ ] Definir frecuencia de sync: event-driven vs batch
- [ ] Gestión de ownership: resolver `hubspot_owner_id` desde `internal_users.email`

---

## Campos NO Sincronizados (Justificación)

| SellUp Field | Razón |
|---|---|
| `metadata` | JSONB variable — definir subkeys específicas antes de sincronizar |
| `email_confidence` / `phone_confidence` | Datos de enriquecimiento interno — sync opcional en fase futura |
| `archived_at` / `archived_by` | Lógica de archivado interna SellUp |
| `created_by` / `updated_by` | Auditoría interna — no relevante para HubSpot |
| `contact_audit` (tabla) | Auditoría interna — no tiene equivalente en HubSpot |
