# Agente 1 — Generación y enriquecimiento de prospectos

**Versión:** 0.2 — Diseño funcional  
**Fecha:** 2026-05-21  
**Estado:** Borrador — pendiente revisión antes de construcción  
**Autor:** SellUp Product Architecture  
**Aplica a:** SellUp MVP — módulo de prospección  
**Documentos relacionados:** [Catálogo de fuentes de prospección por país y sector](./CATALOGO_FUENTES_PROSPECCION_POR_PAIS_SECTOR.md)

---

## Tabla de contenidos

1. [Resumen ejecutivo](#1-resumen-ejecutivo)
2. [Principios funcionales](#2-principios-funcionales)
3. [Input del usuario](#3-input-del-usuario)
4. [Flujo general del agente](#4-flujo-general-del-agente)
5. [Cascada de fuentes](#5-cascada-de-fuentes)
6. [Reglas de deduplicación y normalización](#6-reglas-de-deduplicación-y-normalización)
7. [Lote de prospectos candidatos](#7-lote-de-prospectos-candidatos)
8. [Revisión humana](#8-revisión-humana)
9. [Sincronización con HubSpot](#9-sincronización-con-hubspot)
10. [Uso de Apollo](#10-uso-de-apollo)
11. [Uso de Lusha](#11-uso-de-lusha)
12. [Uso de IA](#12-uso-de-ia)
13. [Medición de costos y efectividad](#13-medición-de-costos-y-efectividad)
14. [Notificaciones Slack](#14-notificaciones-slack)
15. [Estados del agent_run](#15-estados-del-agent_run)
16. [Errores y fallbacks](#16-errores-y-fallbacks)
17. [Qué NO construye el Agente 1](#17-qué-no-construye-el-agente-1)
18. [Modelo de datos futuro sugerido](#18-modelo-de-datos-futuro-sugerido)
19. [UI futura sugerida](#19-ui-futura-sugerida)
20. [Decisiones pendientes](#20-decisiones-pendientes)
21. [Recomendación final](#21-recomendación-final)

---

## 1. Resumen ejecutivo

El **Agente 1** es el primer agente operativo de SellUp. Su función es generar lotes de prospectos calificados a partir de criterios definidos por el usuario —país, industria, tamaño de empresa, cantidad objetivo— consultando fuentes en cascada de menor a mayor costo, y produciendo un conjunto de candidatos revisables antes de crear ningún dato definitivo en el sistema.

### Problema que resuelve

El proceso manual de búsqueda de prospectos es lento, costoso y propenso a duplicados. Los equipos comerciales pierden tiempo buscando empresas manualmente en Apollo o Lusha sin un criterio sistemático, sin deduplicación, sin trazabilidad de costos y sin un flujo de revisión antes de contaminar HubSpot con datos de baja calidad.

### Qué hace el agente

- Recibe criterios del usuario (país, industria, cantidad, tamaño, etc.)
- Consulta fuentes en orden de menor a mayor costo
- Normaliza los resultados (nombres, dominios, países, industrias)
- Detecta duplicados y empresas relacionadas
- Calcula un score de confianza por candidato
- Genera un **lote de candidatos** para revisión humana
- **No crea cuentas definitivas automáticamente**
- Solo después de aprobación humana el candidato se convierte en cuenta y puede sincronizarse con HubSpot
- Registra fuente, costo y calidad de cada resultado desde el inicio

### Por qué existe

SellUp necesita una forma controlada, medible y no contaminante de incorporar prospectos al pipeline. El agente actúa como capa de inteligencia entre las fuentes externas (Apollo, Lusha, web) y el CRM, protegiendo la calidad de datos y generando métricas de efectividad desde el primer uso.

---

## 2. Principios funcionales

Estos principios son no negociables en el diseño e implementación del agente.

### 2.1 Cascada de costos ascendente

Siempre se consultan primero las fuentes gratuitas o de menor costo antes de escalar a proveedores de crédito. No se llama a Apollo si la base interna ya tiene suficientes candidatos. No se llama a Lusha si Apollo ya proveyó los datos necesarios.

### 2.2 Sin creación automática de cuentas definitivas

El agente genera candidatos, no cuentas. Ningún prospecto se convierte en cuenta de SellUp ni se registra en HubSpot sin aprobación explícita del usuario. Esto protege la calidad de datos y evita que HubSpot se llene de registros no validados.

### 2.3 Sin basura en HubSpot

HubSpot es el CRM de referencia del equipo comercial. No se crean ni actualizan empresas en HubSpot sin revisión humana previa. Tampoco se sobrescriben campos críticos de empresas existentes sin confirmación.

### 2.4 Medir todo desde el inicio

Cada ejecución del agente registra: fuente utilizada, créditos/costo consumido, candidatos generados, candidatos aprobados, candidatos descartados, duplicados detectados. Esta información alimenta el módulo `/ai-usage`.

### 2.5 Distinguir duplicado exacto de empresa relacionada

Una empresa puede ser "nueva en Colombia" aunque su matriz exista en HubSpot como empresa de otro país. El agente no debe descartar automáticamente una empresa solo porque existe una entidad similar; debe clasificarla correctamente para que el usuario decida.

### 2.6 Lusha como recurso de enriquecimiento, no de búsqueda inicial

Lusha es costoso y tiene créditos compartidos. No se usa para descubrir empresas desde cero. Se usa solo para enriquecer contactos o datos de valor en empresas que ya son candidatas aprobadas o en proceso de aprobación.

### 2.7 Web/IA como último recurso

El uso de búsqueda web o IA general para encontrar prospectos tiene mayor latencia, menor estructura y mayor costo de procesamiento. Se usa solo cuando las fuentes estructuradas no alcanzan la cantidad objetivo y el usuario optó por búsqueda profunda.

### 2.8 Trazabilidad total

Cada ejecución queda registrada en `agent_runs`. Cada paso del proceso queda en `agent_run_steps`. Cada llamada a proveedor externo queda en `provider_usage_logs`. No debe existir ninguna ejecución que no pueda auditarse.

### 2.9 Normalización antes de comparar

No se puede comparar ni deduplicar sin normalización previa. Nombre de empresa, dominio, país e industria deben normalizarse antes de buscar coincidencias. Dos registros con ortografía diferente del mismo nombre son el mismo candidato.

### 2.10 El usuario es la fuente de verdad final

El agente produce candidatos con scores y recomendaciones. El usuario aprueba, descarta o reclasifica. El agente sugiere, el usuario decide.

---

## 3. Input del usuario

### 3.1 Campos obligatorios

| Campo | Tipo | Descripción |
|---|---|---|
| `country` | `string` | País objetivo. Ej: Colombia, México, Perú |
| `industry` | `string` | Industria o sector. Ej: Textil, Manufactura, Tecnología |
| `target_count` | `integer` | Cantidad objetivo de candidatos a generar |

### 3.2 Campos opcionales

| Campo | Tipo | Descripción |
|---|---|---|
| `company_size` | `enum` | Rango de empleados: micro (1–10), pequeña (11–50), mediana (51–200), grande (200+) |
| `city_or_region` | `string` | Ciudad o región específica dentro del país |
| `keywords` | `string[]` | Palabras clave adicionales para refinar la búsqueda |
| `exclude_existing_hubspot` | `boolean` | Si es `true`, excluye empresas que ya existen en HubSpot como clientes activos |
| `search_depth` | `enum` | `basic`, `standard`, `deep` — define hasta qué fuentes se escala |

**Profundidades de búsqueda:**

- `basic`: solo base interna, HubSpot y fuentes precargadas
- `standard`: agrega Apollo si no se alcanza el objetivo
- `deep`: agrega web/IA como último recurso tras Apollo

### 3.3 Configuración avanzada (fase futura)

Estas opciones se documentan para diseño futuro pero no forman parte del MVP:

| Opción | Descripción |
|---|---|
| `use_lusha_enrichment` | Permite enriquecimiento con Lusha en candidatos aprobados |
| `sync_approved_to_hubspot` | Sincroniza automáticamente los aprobados con HubSpot tras revisión |
| `slack_notification` | Envía notificación al finalizar el lote |
| `cost_limit_usd` | Umbral de costo máximo por ejecución (detiene el agente si se supera) |

---

## 4. Flujo general del agente

```
[Usuario] → crea solicitud con criterios
     ↓
[Sistema] → valida input, crea agent_run (estado: pending)
     ↓
[Agente] → inicia ejecución (estado: running)
     ↓
[Paso 1] → consulta base interna de SellUp
     ↓
[Paso 2] → consulta HubSpot: contexto, duplicados, empresas existentes
     ↓
[Paso 3] → consulta fuentes precargadas (listas de empresas, directorios, etc.)
     ↓
¿Se alcanza target_count con alta confianza?
     ├── SÍ → saltar a normalización
     └── NO → continuar cascada
          ↓
[Paso 4] → consulta proveedor configurado (si existe)
     ↓
¿Se alcanza target_count?
     ├── SÍ → saltar a normalización
     └── NO → continuar cascada
          ↓
[Paso 5] → consulta Apollo (si search_depth ≥ standard)
     ↓
¿Hay candidatos con datos de contacto insuficientes que requieren enriquecimiento?
     ├── NO → saltar a normalización
     └── SÍ → [Paso 6] enriquecimiento Lusha (solo si habilitado y candidatos ya identificados)
          ↓
[Paso 7] → web/IA como fallback (solo si search_depth = deep y no se alcanzó objetivo)
     ↓
[Normalización] → normalizar nombres, dominios, países, industrias
     ↓
[Deduplicación] → detectar duplicados exactos, posibles duplicados, empresas relacionadas
     ↓
[Scoring] → calcular confianza por candidato
     ↓
[Creación de lote] → crear prospect_batch con todos los candidatos clasificados
     ↓
[Notificación] → notificar al usuario por Slack (si habilitado)
     ↓
agent_run → estado: completed / needs_review
     ↓
[Revisión humana] → usuario aprueba, descarta, reclasifica o profundiza
     ↓
[Conversión] → candidatos aprobados se convierten en cuentas en SellUp
     ↓
[HubSpot sync] → si el usuario lo aprueba, se crean/actualizan en HubSpot como prospectos
     ↓
[Métricas] → actualizar provider_usage_logs, result_quality_events, costos
```

---

## 5. Cascada de fuentes

| Orden | Fuente | Uso principal | Costo esperado | Cuándo se detiene |
|---|---|---|---|---|
| 1 | Base interna SellUp | Empresas ya conocidas, cuentas existentes, lotes previos | Cero | Si hay suficientes candidatos de alta confianza |
| 2 | HubSpot | Contexto de empresas existentes, detección de duplicados tempranos | Cero (API incluida) | Si se alcanzan candidatos suficientes o todos son duplicados HubSpot |
| 3 | Fuentes precargadas | Listas de empresas, directorios sectoriales, bases públicas cargadas manualmente | Cero o costo fijo | Si se completa el objetivo con buena confianza |
| 4 | Proveedor configurado | Proveedor de datos externo adicional configurado en `/settings/prospecting` | Variable | Si se alcanza el objetivo |
| 5 | Apollo | Búsqueda de empresas por país/industria/tamaño | Créditos por resultado (ver pricing configurado) | Si se alcanza el objetivo o se agota el presupuesto |
| 6 | Lusha | Enriquecimiento de contactos/personas en candidatos ya identificados | Créditos por contacto (ver pricing configurado) | Solo se usa puntualmente, no recorre todo el lote automáticamente |
| 7 | Web / IA general | Búsqueda no estructurada como último recurso | Alto (latencia + tokens IA) | Solo si search_depth = deep y no se alcanzó objetivo |

### Fuentes precargadas — referencia oficial

Las fuentes clasificadas como "Fuentes precargadas" en el nivel 3 de la cascada están documentadas en detalle en el catálogo oficial del proyecto:

**[Catálogo de fuentes de prospección por país y sector](./CATALOGO_FUENTES_PROSPECCION_POR_PAIS_SECTOR.md)** — v0.2

El catálogo cubre 17 países de LatAm (CO, MX, CL, PE, EC, AR, BR, UY, PY, BO, CR, PA, GT, SV, HN, NI, DO), incluye identificadores fiscales por país, priorización P0/P1/P2, nivel de automatización por fuente, fuentes sectoriales regionales, taxonomía de keywords con códigos CIIU/SCIAN, y riesgos legales relevantes (LGPD, Ley 1581, LFPDPPP).

Toda decisión sobre qué fuente precargar para un país o sector específico debe consultarse en ese documento antes de implementar el nivel 3 de la cascada.

### Por qué Lusha va después de Apollo

Apollo está optimizado para búsqueda de empresas y retorna datos estructurados (nombre, dominio, industria, tamaño, país). Lusha está optimizado para datos de personas/contactos dentro de una empresa: emails directos, teléfonos, cargo. Usar Lusha para descubrir empresas desde cero sería desperdiciar créditos de alto valor en una función para la que Apollo es más eficiente y más barato. Lusha se reserva para cuando ya se sabe qué empresa se quiere enriquecer.

---

## 6. Reglas de deduplicación y normalización

### 6.1 Normalización previa

Antes de comparar cualquier candidato con registros existentes se normaliza:

- **Nombre de empresa:** minúsculas, sin tildes, sin caracteres especiales, sin sufijos legales (S.A., S.A.S., LTDA, LLC, Corp, Inc)
- **Dominio:** sin protocolo, sin www, lowercase
- **País:** código ISO 3166-1 (CO, MX, PE, CL…)
- **Industria:** taxonomía interna SellUp (definir en fase técnica)

### 6.2 Tipos de coincidencia

| Tipo | Criterio | Acción recomendada |
|---|---|---|
| Duplicado exacto | Mismo dominio **o** mismo `hubspot_company_id` | No crear — descartar automáticamente |
| Posible duplicado | Nombre normalizado con similitud ≥ 85%, dominio dudoso o ausente | Marcar para revisión humana |
| Empresa relacionada | Misma marca o grupo, diferente país o razón social | Permitir — crear relación con empresa existente |
| Nueva empresa | Sin coincidencia relevante | Candidato nuevo |
| Incierto | Datos insuficientes para clasificar | Marcar para revisión humana |

### 6.3 Ejemplos prácticos

| Candidato | Registro existente en HubSpot | Clasificación | Acción |
|---|---|---|---|
| Coca-Cola Colombia | Coca-Cola México | Empresa relacionada | Crear con link a entidad matriz |
| Coca-Cola Colombia S.A.S. | Coca-Cola Colombia | Posible duplicado | Revisión: mismo dominio? |
| Coca-Cola FEMSA | The Coca-Cola Company | Empresa relacionada | Crear — son entidades independientes |
| The Coca-Cola Company | The Coca-Cola Company | Duplicado exacto | Descartar |
| Colfibras S.A. | — | Nueva empresa | Candidato nuevo |
| Textiles El Éxito | Éxito Textiles | Posible duplicado | Revisión — nombre normalizado similar |

### 6.4 Score de confianza del candidato

El score de confianza (0–100) se calcula con estos factores:

| Factor | Peso |
|---|---|
| Dominio verificado | Alto |
| Sitio web activo | Medio |
| País confirmado | Alto |
| Industria confirmada | Medio |
| Tamaño confirmado | Bajo |
| Múltiples fuentes coinciden | Alto |
| Datos de contacto disponibles | Medio |
| Sin ambigüedad de nombre | Medio |

Se definen umbrales en la fase técnica (ver §20 Decisiones pendientes).

---

## 7. Lote de prospectos candidatos

### 7.1 Definición

Un **lote** (`prospect_batch`) es el resultado de una ejecución del Agente 1. Agrupa todos los candidatos generados en una sola solicitud para que el usuario los revise de forma centralizada. Un lote tiene un dueño, fecha de creación, criterios de búsqueda, estado global y resumen de costos.

### 7.2 Campos por candidato (`prospect_candidate`)

| Campo | Tipo | Descripción |
|---|---|---|
| `id` | UUID | Identificador único del candidato |
| `batch_id` | UUID | Lote al que pertenece |
| `name` | string | Nombre original encontrado |
| `name_normalized` | string | Nombre normalizado sin sufijos legales |
| `domain` | string | Dominio web normalizado |
| `website` | string | URL completa del sitio |
| `country` | string | País (código ISO) |
| `city` | string | Ciudad o región |
| `industry` | string | Industria según taxonomía SellUp |
| `company_size` | string | Rango de tamaño |
| `primary_source` | string | Fuente que aportó el candidato |
| `sources_consulted` | string[] | Todas las fuentes que devolvieron este candidato |
| `duplicate_status` | enum | `none`, `exact`, `possible`, `related` |
| `confidence_score` | integer | 0–100 |
| `estimated_cost_usd` | decimal | Costo estimado atribuido a este candidato |
| `missing_fields` | string[] | Campos faltantes o de baja confianza |
| `hubspot_match_id` | string | ID de empresa HubSpot si se detectó coincidencia |
| `recommended_action` | enum | `approve`, `review`, `discard` |
| `status` | enum | Estado actual del candidato (ver §7.3) |
| `reviewer_notes` | string | Notas del usuario durante revisión |
| `reviewed_at` | timestamp | Cuándo fue revisado |
| `reviewed_by` | UUID | Usuario que realizó la revisión |

### 7.3 Estados del candidato

| Estado | Descripción |
|---|---|
| `generated` | Recién creado por el agente |
| `normalized` | Pasó por normalización de nombre, dominio, país, industria |
| `duplicate_detected` | Se detectó como duplicado exacto de registro existente |
| `related_company` | Se identificó como empresa relacionada a una existente |
| `needs_review` | Requiere decisión humana (posible duplicado, datos insuficientes) |
| `approved` | Usuario aprobó el candidato |
| `discarded` | Usuario lo descartó |
| `converted_to_account` | Se convirtió en cuenta dentro de SellUp |
| `sent_to_hubspot` | Se creó o actualizó en HubSpot como prospecto |

---

## 8. Revisión humana

La revisión humana es **obligatoria y no omitible** antes de que cualquier candidato se convierta en cuenta o se sincronice con HubSpot. Esta es una decisión de diseño central: el agente produce candidatos, el usuario decide.

### 8.1 Acciones disponibles por candidato

| Acción | Resultado |
|---|---|
| **Aprobar** | El candidato pasa a estado `approved` y puede convertirse en cuenta |
| **Descartar** | El candidato pasa a estado `discarded` y no se procesa más |
| **Marcar como duplicado** | Se vincula con la cuenta existente y se descarta como nuevo |
| **Vincular con empresa existente** | Se asocia a una cuenta de SellUp ya registrada sin crear duplicado |
| **Marcar como empresa relacionada** | Se crea relación con entidad existente (ej: filial o subsidiaria) |
| **Pedir profundización** | Se solicita al agente más información sobre este candidato (enriquecimiento puntual) |
| **Convertir en cuenta** | Solo disponible para candidatos aprobados — crea la cuenta en SellUp |

### 8.2 Acciones masivas

El usuario debe poder aplicar acciones sobre múltiples candidatos seleccionados:

- Aprobar todos los seleccionados
- Descartar todos los seleccionados
- Marcar todos los de baja confianza para revisión
- Convertir todos los aprobados en cuentas

### 8.3 Por qué es obligatoria

- **Protege la calidad de datos en HubSpot.** Un equipo comercial no puede operar con un CRM lleno de empresas incorrectas o duplicadas.
- **Protege los créditos de enriquecimiento.** No se puede enriquecer con Lusha lo que aún no fue validado como candidato viable.
- **Responsabilidad humana en el pipeline.** El agente es un asistente, no un ejecutor autónomo de decisiones comerciales.

---

## 9. Sincronización con HubSpot

### 9.1 Flujo de match contra HubSpot

Antes de crear cualquier empresa en HubSpot se sigue este orden de búsqueda:

1. **Por dominio** — si el candidato tiene dominio, buscar empresa existente con ese dominio
2. **Por nombre normalizado** — si no hay match por dominio, buscar por nombre normalizado
3. **Por similitud** — si los anteriores no arrojan resultado, comparar por similitud de nombre (threshold a definir)

### 9.2 Acciones según resultado del match

| Resultado del match | Acción |
|---|---|
| Se encuentra empresa → misma entidad | Vincular candidato con `hubspot_company_id`, no crear nuevo registro |
| Se encuentra empresa → entidad relacionada | Crear relación, marcar para revisión |
| No se encuentra empresa | Si el usuario aprueba, crear empresa en HubSpot como prospecto |

### 9.3 Creación de empresa en HubSpot

- Solo se crea si el usuario aprobó el candidato **y** habilitó la sincronización con HubSpot
- Se crea con un **tag o estado de prospecto** que la identifique como generada por el agente
- No se sobrescriben campos críticos de empresas ya existentes sin revisión
- Los campos exactos a mapear entre `prospect_candidate` y HubSpot se definen en la fase técnica (ver §20)

### 9.4 Pendiente de diseño técnico

La definición exacta de campos a crear en HubSpot (`name`, `domain`, `industry`, `country`, `lifecyclestage`, `hs_lead_status`, etc.) y el manejo de propiedades personalizadas se documenta en una fase técnica posterior.

---

## 10. Uso de Apollo

### 10.1 Rol de Apollo

Apollo es la fuente principal para búsqueda de empresas cuando las fuentes internas no alcanzan el objetivo. Permite buscar por país, industria, tamaño de empresa y otros filtros con retorno estructurado.

### 10.2 Qué se registra

- Créditos consumidos por llamada
- Costo estimado en USD según pricing configurado en `provider_pricing_config`
- Número de resultados devueltos
- Número de resultados que pasaron normalización
- Número de resultados que pasaron deduplicación
- Número de resultados que el usuario aprobó
- Resultados brutos guardados de forma controlada (evitar regurgitar los mismos candidatos en lotes posteriores)

### 10.3 Normalización de datos Apollo

Los resultados de Apollo devuelven objetos del tipo `organization`. Se normalizan a la estructura interna de `prospect_candidate`:

- `organization.name` → `name`
- `organization.primary_domain` → `domain`
- `organization.country` → `country`
- `organization.industry` → `industry` (mapear a taxonomía SellUp)
- `organization.estimated_num_employees` → `company_size`

### 10.4 Métricas de efectividad Apollo

| Métrica | Descripción |
|---|---|
| `apollo_results_returned` | Total de empresas devueltas por Apollo |
| `apollo_results_useful` | Empresas que pasaron deduplicación y normalización |
| `apollo_results_approved` | Empresas que el usuario aprobó |
| `apollo_cost_per_approved` | Costo total Apollo / candidatos aprobados |
| `apollo_duplicate_rate` | Porcentaje de resultados Apollo que eran duplicados |

---

## 11. Uso de Lusha

### 11.1 Rol de Lusha

Lusha se usa de forma **conservadora y puntual**. No se usa para buscar empresas. Se usa exclusivamente para enriquecer datos de contacto (personas, emails, teléfonos) en empresas que ya son candidatas aprobadas o en fase de aprobación.

### 11.2 Cuándo se usa

- El usuario solicita explícitamente enriquecimiento de contactos en un candidato aprobado
- Un candidato tiene alta confianza como empresa pero no tiene datos de contacto útiles
- El usuario habilita `use_lusha_enrichment` en la configuración avanzada (fase futura)

### 11.3 Cuándo NO se usa

- Como primer paso de búsqueda de empresas
- Para enriquecer candidatos que aún no fueron aprobados
- Para recorrer automáticamente todo el lote sin selección previa
- Si los créditos disponibles son bajos (umbral a definir)

### 11.4 Estado de validación

> **Nota de diseño:** A la fecha de este documento, Lusha está conectado técnicamente en SellUp pero aún no ha sido validado funcionalmente con una API Key real. Este documento no asume que Lusha está operativo en producción. La integración funcional se valida en fase técnica posterior.

### 11.5 Qué se registra

- Créditos consumidos por consulta
- Costo estimado en USD según pricing configurado
- Número de personas consultadas
- Número de contactos con email encontrado
- Número de contactos con teléfono encontrado
- Costo por contacto útil

### 11.6 Métricas de efectividad Lusha

| Métrica | Descripción |
|---|---|
| `lusha_contacts_queried` | Total de personas consultadas |
| `lusha_emails_found` | Emails directos encontrados |
| `lusha_phones_found` | Teléfonos encontrados |
| `lusha_cost_per_useful_contact` | Costo total Lusha / contactos con dato útil |

---

## 12. Uso de IA

### 12.1 Casos de uso válidos

| Caso | Descripción |
|---|---|
| Normalización de nombres | Identificar y eliminar sufijos legales, unificar variantes ortográficas |
| Clasificación de industria | Mapear industria libre del usuario a taxonomía interna SellUp |
| Deduplicación inteligente | Evaluar si dos nombres similares son la misma empresa |
| Resumen de empresa | Generar descripción breve de un candidato para facilitar la revisión |
| Evaluación de relevancia | Puntuar si un candidato es relevante según los criterios del usuario |
| Fallback web/IA | Búsqueda no estructurada cuando las fuentes estructuradas fallan |

### 12.2 Principios de uso de IA

- **Input reducido:** No se manda todo el universo de datos al modelo. Se prepara el contexto mínimo necesario para la tarea.
- **Salidas estructuradas:** Se usa structured output (JSON) para minimizar errores de parsing.
- **Llamadas atómicas:** Cada llamada de IA tiene una responsabilidad única. No se mezclan normalización, scoring y resumen en una sola llamada.
- **Costos registrados:** Cada llamada de IA se registra en `provider_usage_logs` con tokens consumidos y costo estimado.
- **No decisiones críticas:** La IA asiste la clasificación pero no toma decisiones irreversibles (crear cuentas, sincronizar HubSpot). Esas decisiones son humanas.

### 12.3 Proveedor de IA

Se usa el proveedor configurado en `/settings/prospecting` (compatible con la configuración de providers IA de SellUp). El modelo a usar se define en la fase técnica según balance costo/calidad.

---

## 13. Medición de costos y efectividad

### 13.1 Conexión con la foundation existente

El Agente 1 se integra con la foundation de uso, costos y efectividad ya construida:

| Tabla | Uso en el Agente 1 |
|---|---|
| `agent_runs` | Registro de cada ejecución del agente |
| `agent_run_steps` | Registro de cada paso: consulta interna, Apollo, Lusha, IA, etc. |
| `provider_usage_logs` | Llamadas a Apollo, Lusha, IA con créditos y costo |
| `provider_pricing_config` | Costo por crédito Apollo y Lusha ya configurados |
| `result_quality_events` | Eventos de calidad: aprobación, descarte, conversión |

### 13.2 Qué se registra en cada etapa

| Etapa | Qué se registra |
|---|---|
| Creación de solicitud | `agent_run` con criterios del usuario |
| Consulta base interna | Número de resultados encontrados (costo cero) |
| Consulta HubSpot | Número de duplicados detectados, número de matches |
| Consulta fuentes precargadas | Número de resultados, fuente |
| Consulta Apollo | Llamada API, créditos, resultados, costo |
| Enriquecimiento Lusha | Llamada API, créditos, contactos, costo |
| Llamadas IA | Proveedor, tokens input/output, costo |
| Creación del lote | Resumen: candidatos totales, por estado, costo total estimado |
| Revisión humana | Eventos de aprobación, descarte, reclasificación |
| Conversión a cuenta | Evento de conversión |
| Sincronización HubSpot | Evento de sync, éxito o error |

### 13.3 Métricas clave del lote

| Métrica | Descripción |
|---|---|
| `total_cost_usd` | Costo total del lote (sum de todos los proveedores) |
| `cost_per_candidate` | total_cost / candidatos generados |
| `cost_per_approved` | total_cost / candidatos aprobados |
| `duplicate_rate` | duplicados detectados / total candidatos |
| `discard_rate` | descartados / total candidatos |
| `approval_rate` | aprobados / total candidatos |
| `best_source_by_approval` | Fuente con mayor tasa de aprobación |
| `most_expensive_source` | Fuente con mayor costo por candidato aprobado |
| `execution_time_seconds` | Tiempo total de ejecución del agente |

---

## 14. Notificaciones Slack

### 14.1 Cuándo notificar

| Evento | Notificación |
|---|---|
| Lote completado y listo para revisión | Sí — siempre |
| Falla de integración (Apollo, Lusha, HubSpot) | Sí — alerta |
| Costo estimado supera umbral configurado | Sí — alerta (umbral a definir en §20) |
| Alta tasa de duplicados (>50%) | Sí — aviso |
| Sin resultados suficientes | Sí — aviso con sugerencia |
| Candidatos convertidos en cuentas | Opcional — resumen post-revisión |

### 14.2 Ejemplo de mensaje de lote completado

```
🔍 Lote de prospectos generado
Criterios: Colombia · Textil · 30 candidatos objetivo

📊 Resultados:
• 18 candidatos nuevos (alta confianza)
• 5 posibles duplicados para revisión
• 7 descartados por baja calidad o duplicado exacto

💰 Costo estimado: $X.XX USD
  → Apollo: $X.XX (15 créditos)
  → IA (normalización): $X.XX

📋 Revisa el lote → [enlace al lote]
```

### 14.3 Canal de destino

El canal de Slack destino se configura en `/settings/integrations`. Por defecto se notifica al canal del equipo o al usuario que creó la solicitud. Esta lógica se define en la fase técnica.

---

## 15. Estados del agent_run

| Estado | Descripción | Cuándo ocurre |
|---|---|---|
| `pending` | Solicitud creada, aún no iniciada | Al crear la solicitud |
| `running` | El agente está ejecutando pasos | Al iniciar la ejecución |
| `completed` | Ejecución finalizada sin errores | Cuando el lote fue creado exitosamente |
| `failed` | Ejecución falló por error crítico | Error no recuperable en alguna fuente o paso |
| `cancelled` | El usuario canceló la ejecución | Solo si se implementa cancelación en UI |
| `needs_review` | El lote se generó pero tiene candidatos que requieren atención especial | Muchos posibles duplicados, datos insuficientes, costo alto |

### Transiciones válidas

```
pending → running → completed
pending → running → failed
pending → running → completed → needs_review
pending → cancelled
running → cancelled
```

---

## 16. Errores y fallbacks

| Escenario | Comportamiento recomendado |
|---|---|
| Apollo no disponible | Registrar error en `agent_run_steps`, continuar con fuentes disponibles, notificar al usuario |
| Lusha no disponible | Si es enriquecimiento opcional, omitir y continuar. Si es mandatorio, marcar candidatos como incompletos |
| HubSpot falla | Omitir consulta de duplicados en HubSpot, crear lote con advertencia de "sin validación HubSpot" |
| Rate limit alcanzado | Pausar esa fuente, continuar con siguiente en cascada, registrar en logs |
| Sin resultados suficientes | Crear lote con lo encontrado, notificar cuánto se encontró vs cuánto se pedía, sugerir ampliar criterios o profundidad |
| Alta tasa de duplicados (>50%) | Crear lote, marcar estado `needs_review`, notificar por Slack con sugerencia de revisar criterios |
| Error de IA | Fallar graciosamente: omitir enriquecimiento por IA en ese candidato, continuar sin normalización por IA, registrar |
| Costo estimado alto | Si supera umbral configurado, pausar ejecución y pedir confirmación del usuario antes de continuar (implementación futura) |
| Input inválido | Validar en frontend antes de crear el `agent_run`. Errores claros: país no reconocido, industria vacía, cantidad fuera de rango |

---

## 17. Qué NO construye el Agente 1

Para evitar scope creep desde el diseño inicial, se documenta explícitamente lo que este agente **no hace**:

- ❌ No genera speech comercial ni mensajes de prospección
- ❌ No crea business cases ni propuestas
- ❌ No procesa reuniones ni resúmenes de llamadas
- ❌ No genera cotizaciones
- ❌ No envía correos automáticamente a los prospectos
- ❌ No crea contactos (personas) masivamente sin aprobación — solo empresas
- ❌ No reemplaza HubSpot como CRM — lo alimenta de forma controlada
- ❌ No califica leads en etapas del funnel — eso es responsabilidad del Agente 2 o del equipo comercial
- ❌ No toma decisiones irreversibles sin revisión humana

---

## 18. Modelo de datos futuro sugerido

Este modelo se propone como referencia de diseño. **No se construyen migraciones en esta fase.** La implementación se define en la fase de construcción.

### 18.1 Entidades principales

```
prospect_batches
─────────────────
id                UUID PK
agent_run_id      UUID FK → agent_runs
created_by        UUID FK → users
country           text
industry          text
target_count      integer
search_depth      text
status            text          -- draft, generating, ready_for_review, reviewed, completed
total_candidates  integer
approved_count    integer
discarded_count   integer
duplicate_count   integer
estimated_cost_usd decimal
created_at        timestamptz
completed_at      timestamptz

prospect_candidates
───────────────────
id                    UUID PK
batch_id              UUID FK → prospect_batches
name                  text
name_normalized       text
domain                text
website               text
country               text
city                  text
industry              text
company_size          text
primary_source        text
sources_consulted     text[]
duplicate_status      text
confidence_score      integer
estimated_cost_usd    decimal
missing_fields        text[]
hubspot_match_id      text
recommended_action    text
status                text
reviewer_notes        text
reviewed_at           timestamptz
reviewed_by           UUID FK → users

prospect_candidate_sources
──────────────────────────
id              UUID PK
candidate_id    UUID FK → prospect_candidates
source          text
raw_data        jsonb          -- datos brutos del proveedor
fetched_at      timestamptz

prospect_candidate_matches
──────────────────────────
id              UUID PK
candidate_id    UUID FK → prospect_candidates
match_type      text          -- exact, possible, related
matched_with    UUID          -- account o hubspot_company_id
notes           text

accounts
────────
id              UUID PK
candidate_id    UUID FK → prospect_candidates (nullable — origen del agente)
name            text
domain          text
...             (campos de cuenta a definir)
hubspot_id      text
created_from    text          -- 'agent_1', 'manual', 'hubspot_import'
created_at      timestamptz
```

### 18.2 Relación con foundation de usage

```
agent_runs ──1:N──> agent_run_steps
agent_runs ──1:1──> prospect_batches
prospect_batches ──1:N──> prospect_candidates
prospect_candidates ──1:N──> prospect_candidate_sources
agent_run_steps ──1:N──> provider_usage_logs
prospect_candidates ──1:N──> result_quality_events (aprobaciones, descartes, conversiones)
```

---

## 19. UI futura sugerida

Estas pantallas se documentan para orientar el diseño visual en la fase de construcción. **No se construyen en esta fase.**

### 19.1 Pantallas requeridas

| Pantalla | Descripción |
|---|---|
| **Botón "Generar prospectos"** | Punto de entrada visible en el módulo de prospección |
| **Formulario de solicitud** | Campos obligatorios y opcionales, selector de profundidad, estimación de costo |
| **Vista de progreso** | Estado en tiempo real del agent_run durante ejecución |
| **Vista de lote generado** | Resumen del lote: candidatos por estado, costo total, distribución por fuente |
| **Tabla de revisión** | Lista de candidatos con filtros (por estado, confianza, fuente), acciones por fila y masivas |
| **Detalle de candidato** | Datos completos, fuentes consultadas, posibles duplicados, acción a tomar |
| **Resumen de costos del lote** | Desglose de costo por fuente, métricas de efectividad |
| **Historial de lotes** | Lista de todas las ejecuciones pasadas con resumen de resultados |

### 19.2 Patrones de diseño

- Seguir el Design System SellUp (tokens CSS, componentes compartidos, modos light/dark)
- La tabla de revisión es el elemento crítico — debe soportar revisión eficiente de hasta 25 candidatos por lote (máximo MVP)
- Los estados de candidato deben ser visualmente distinguibles con badges/chips de color
- La pantalla de progreso debe actualizarse sin recargar (polling o websocket)

---

## 20. Decisiones pendientes

Estas decisiones quedan documentadas como abiertas y deben resolverse antes o durante la construcción:

| # | Decisión pendiente | Impacto | Prioridad |
|---|---|---|---|
| 1 | **Campos exactos para crear empresa en HubSpot** — qué propiedades se mapean y cuáles son obligatorias | Alto — bloquea integración HubSpot | Alta |
| 2 | **Umbral mínimo de confianza** — qué score separa "aprobar automático" de "necesita revisión" de "descartar" | Alto — define calidad del lote | Alta |
| 3 | **Umbral de costo por ejecución** — cuándo pausar y pedir confirmación antes de continuar | Alto — controla gasto en créditos | Alta |
| 4 | **Taxonomía de sectores/industrias** — lista oficial de industrias en SellUp para normalizar | Alto — afecta búsqueda y deduplicación | Alta |
| 5 | **Fuentes precargadas disponibles** — qué listas o directorios hay disponibles en el equipo | Medio — afecta efectividad de cascada | Media |
| 6 | **Uso exacto de Lusha en primera versión** — ¿solo manual en detalle de candidato, o semiautomático? | Medio — Lusha aún no validado funcionalmente | Media |
| 7 | **Web/IA en MVP o fase posterior** — ¿se implementa el fallback web/IA en la primera versión del agente? | Medio — complejidad adicional | Media |
| 8 | **Canal Slack por defecto** — canal destino de notificaciones si el usuario no especifica | Bajo | Baja |
| 9 | **Tamaño máximo de lote** — **Resuelto para MVP: default 25, máximo 25 empresas candidatas por lote.** El límite podrá revisarse después cuando existan métricas reales de costo, calidad y tasa de aprobación. | Medio — afecta costo y UX de revisión | Resuelta |
| 10 | **Modelo de IA para normalización** — Haiku vs Sonnet para tareas de normalización y clasificación | Bajo — afecta costo por ejecución | Baja |

---

## 21. Recomendación final

### Antes de construir el Agente 1, construir primero:

#### Foundation de cuentas (`accounts`)

SellUp necesita un modelo de datos claro para cuentas antes de crear prospectos que se conviertan en cuentas. Sin esta foundation, el agente no tiene dónde depositar los candidatos aprobados de forma estructurada.

#### Foundation de lotes de prospectos candidatos

Las tablas `prospect_batches` y `prospect_candidates` deben existir antes de que el agente pueda depositar resultados. Esta migración es el primer paso de construcción.

---

### Primera versión del agente (MVP)

La primera versión del agente debe usar una **cascada limitada y controlada**:

1. Base interna de SellUp
2. HubSpot (consulta de duplicados y contexto)
3. Apollo (fuente principal cuando los anteriores no alcanzan)

**Fuera del MVP:**
- Lusha automático (pendiente validación funcional, usar solo manualmente)
- Web/IA como fallback (complejidad adicional, reservar para v2)
- Fuentes precargadas (depende de que el equipo tenga listas disponibles)

### Criterio de éxito del MVP

El Agente 1 v1 es exitoso si:

1. El usuario puede generar un lote de hasta 25 empresas candidatas para un país e industria en menos de 2 minutos (máximo MVP)
2. El lote tiene una tasa de duplicados exactos detectados superior al 90%
3. El usuario puede revisar y aprobar candidatos desde una sola pantalla
4. Cada candidato aprobado se convierte en cuenta con un click
5. El costo total del lote queda registrado y es visible en `/ai-usage`
6. Ningún registro se crea en HubSpot sin aprobación explícita

---

*Documento creado el 2026-05-21 como fuente oficial de diseño funcional del Agente 1.*  
*Próximo paso: revisión con el equipo, resolución de decisiones pendientes en §20, y construcción de la foundation de datos.*
