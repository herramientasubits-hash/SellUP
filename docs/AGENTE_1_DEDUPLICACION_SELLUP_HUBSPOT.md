# Agente 1 — Deduplicación Automática SellUp + HubSpot

**Versión:** 1.0  
**Fecha:** 2026-05-22  
**Estado:** ✅ Implementado — pendiente validación manual  
**Módulo:** `src/server/agents/prospecting-toolkit/`

---

## Objetivo

Antes de presentar empresas candidatas generadas por el Agente 1, el sistema debe verificar si ya existen en SellUp o en HubSpot CRM. Este proceso es determinístico, no usa IA, no usa Apollo, no usa Lusha, y no consume tokens.

---

## Por qué la deduplicación es obligatoria

1. **Evitar sobrescribir cuentas existentes** con datos de menor calidad.
2. **No contaminar el pipeline** con leads que ya son clientes o están en proceso.
3. **No crear duplicados en HubSpot** accidentalmente desde SellUp.
4. **Respetar el trabajo del equipo de RevOps** que mantiene HubSpot limpio.
5. **Costo cero adicional**: la verificación usa solo lecturas a Supabase y HubSpot API.

---

## Inputs

```typescript
type DuplicateCheckInput = {
  name: string;              // Nombre comercial (requerido)
  legalName?: string | null; // Razón social (opcional)
  normalizedName?: string | null; // Pre-normalizado (opcional, se recalcula si falta)
  website?: string | null;   // URL completa
  domain?: string | null;    // Dominio limpio (ej: "siigo.com")
  country?: string | null;   // Nombre del país
  countryCode?: string | null; // Código ISO (ej: "CO")
  taxIdentifier?: string | null; // NIT, RFC, RUT, etc.
};
```

---

## Normalización

### `normalizeCompanyName(name)`

1. Convierte a minúsculas
2. Descompone NFD y elimina diacríticos (tildes, ñ → n, etc.)
3. Elimina sufijos legales del final: `SAS`, `S.A.S.`, `SA`, `S.A.`, `SRL`, `S.R.L.`, `Ltda`, `SpA`, `Inc`, `LLC`, `Corp`, `SL`, `S.L.`, `de C.V.`, `AG`
4. Elimina puntuación restante
5. Compacta espacios

**Ejemplos:**
| Input | Output |
|-------|--------|
| `"Rappi Colombia S.A.S."` | `"rappi colombia"` |
| `"Siigo SAS"` | `"siigo"` |
| `"Globant, Inc."` | `"globant"` |
| `"Bancolombia S.A."` | `"bancolombia"` |

### `normalizeDomain(urlOrDomain)`

- Elimina protocolo (`https://`, `http://`)
- Elimina `www.`
- Elimina path, query, fragmento
- Retorna `null` si no hay dominio válido

**Ejemplos:**
| Input | Output |
|-------|--------|
| `"https://www.siigo.com/co"` | `"siigo.com"` |
| `"www.rappi.com"` | `"rappi.com"` |
| `""` | `null` |

### `normalizeTaxIdentifier(value)`

- Minúsculas
- Elimina guiones, puntos, espacios, guiones bajos
- `"900.123.456-1"` → `"9001234561"`

---

## Reglas SellUp (sellup_duplicate_checker)

Consulta la tabla `accounts` usando `service_role` (bypasea RLS).

| Prioridad | Criterio | Status | Confianza |
|-----------|----------|--------|-----------|
| 1 | `domain` exacto | `existing_in_sellup` | 95 |
| 2 | `tax_identifier` normalizado exacto | `existing_in_sellup` | 92 |
| 3 | `normalized_name` + `country_code` exactos | `existing_in_sellup` | 88 |
| 4 | Nombre contenido en el otro (o viceversa) | `possible_duplicate` | 65 |
| — | Sin matches | `new_candidate` | 85 |
| — | Sin datos útiles | `insufficient_data` | 0 |

---

## Reglas HubSpot (hubspot_duplicate_checker)

Usa el token del Vault (`sellup_integration_hubspot`). Solo lectura vía `POST /crm/v3/objects/companies/search`.

Propiedades solicitadas (confirmadas en portal UBITS): `name`, `domain`, `website`, `country`, `city`, `industry`, `lifecyclestage`, `hs_lead_status`, `nit`.

| Prioridad | Criterio | Status | Confianza |
|-----------|----------|--------|-----------|
| 1 | `domain` exacto | `existing_in_hubspot` | 92 |
| 2 | Nombre normalizado exacto (full-text search) | `existing_in_hubspot` | 82 |
| 3 | Nombre contenido en el resultado | `possible_duplicate` | 65 |
| 4 | Resultado con similitud baja | `possible_duplicate` | 50 |
| — | HubSpot no conectado | `unchecked` | 0 |
| — | Error de API | `error` | 0 |

---

## Estados de salida

| Status | Significado |
|--------|-------------|
| `existing_in_sellup` | Empresa encontrada en SellUp accounts |
| `existing_in_hubspot` | Empresa encontrada en HubSpot CRM |
| `possible_duplicate` | Similitud alta pero no exacta — requiere revisión |
| `new_candidate` | No encontrada en ninguna fuente — parece nueva |
| `insufficient_data` | Sin datos para evaluar (no name, no domain, no country) |
| `unchecked` | HubSpot no disponible — SellUp clean pero sin verificar HubSpot |
| `error` | Error técnico en uno o más checkers |

**Prioridad de consolidación:**  
`existing_in_sellup` > `existing_in_hubspot` > `possible_duplicate` > `insufficient_data` > `unchecked` > `error` > `new_candidate`

---

## Casos de prueba

| Caso | Input | Resultado esperado |
|------|-------|--------------------|
| 1 — Empresa en HubSpot | `name: "Rappi"`, `domain: "rappi.com"` | `existing_in_hubspot` |
| 2 — Empresa en SellUp | Cuenta existente en accounts | `existing_in_sellup` |
| 3 — Empresa nueva | `name: "Empresa Nueva QA Dedup 2026"`, `domain: "dedup-qa-2026.example.com"` | `new_candidate` |
| 4 — Datos insuficientes | `name: ""`, `country: "Colombia"` | `insufficient_data` |
| 5 — Posible duplicado | `name: "Rappi Colombia SAS"` | `existing_in_hubspot` o `possible_duplicate` |

---

## Límites conocidos

1. **Sin búsqueda fuzzy avanzada**: no usa Levenshtein ni embeddings. Solo substring matching. Casos como "Bancolombia" vs "Banco de Colombia" no se detectan.
2. **HubSpot full-text search**: la API de búsqueda por nombre usa el índice de HubSpot que puede devolver resultados inesperados para nombres cortos.
3. **Sin verificación de `nit` en HubSpot** para multi-país: el campo `nit` existe en portal UBITS pero es tipo `number`. Se devuelve como dato pero no se usa como criterio de match primario.
4. **Sin deduplicación entre candidatos del mismo batch**: este toolkit verifica contra SellUp y HubSpot existentes, no contra otros candidatos del batch en curso.
5. **Cuentas archivadas excluidas**: el checker de SellUp filtra `archived_at IS NULL`. Una empresa archivada no se detecta como duplicado.

---

## Próximo paso

1. **Validar casos de prueba** con datos reales del portal UBITS.
2. **Integrar en el pipeline del Agente 1** reemplazando `checkHubSpotCompanyDuplicate` de `hubspot-company-search.ts` por `checkCompanyDuplicate` del toolkit.
3. **Agregar verificación SellUp** al pipeline del Agente 1 (actualmente solo verifica HubSpot).
4. **Observabilidad**: registrar `provider_usage_logs` para cada ejecución del toolkit en el contexto de un `agent_run`.

---

*Documento creado el 2026-05-22 para el Hito 1 de Deduplicación del Agente 1.*
