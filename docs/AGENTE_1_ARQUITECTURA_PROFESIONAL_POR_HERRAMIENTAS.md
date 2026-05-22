# Agente 1 — Arquitectura profesional por herramientas

**Versión:** 1.0  
**Fecha:** 2026-05-22  
**Estado:** Documento de arquitectura — sin código, sin migraciones, sin APIs reales  
**Autor:** SellUp Principal AI Architect · HubSpot Integration Architect · Product Architect  
**Documentos relacionados:**
- [`docs/AGENTE_1_GENERACION_ENRIQUECIMIENTO_PROSPECTOS.md`](./AGENTE_1_GENERACION_ENRIQUECIMIENTO_PROSPECTOS.md)
- [`docs/HUBSPOT_ACCOUNT_FIELD_MAPPING.md`](./HUBSPOT_ACCOUNT_FIELD_MAPPING.md)
- [`docs/prompts/AGENTE_1_GENERACION_EMPRESAS_CANDIDATAS_PROMPT_V2.md`](./prompts/AGENTE_1_GENERACION_EMPRESAS_CANDIDATAS_PROMPT_V2.md)
- [`docs/CATALOGO_FUENTES_PROSPECCION_POR_PAIS_SECTOR.md`](./CATALOGO_FUENTES_PROSPECCION_POR_PAIS_SECTOR.md)

---

## Contexto y motivación

Este documento surge de una observación crítica detectada durante la validación manual del Prompt Lab V2:

> El usuario revisó manualmente las empresas candidatas generadas por el Agente 1 y encontró que varias de ellas ya existían como empresas en HubSpot.

Esta situación revela un defecto de diseño: el Prompt V2 dejaba la verificación de HubSpot como una tarea en `manual_verification.must_verify`, delegando al usuario la responsabilidad de detectar duplicados. Eso es incorrecto.

**Regla fundamental que gobierna este documento:**

```
Primero deduplicar automáticamente.
Después mostrar candidatos como nuevos.
```

---

## Tabla de contenidos

1. [Herramientas del Agente 1](#1-herramientas-del-agente-1)
2. [Deduplicación obligatoria contra SellUp y HubSpot](#2-deduplicación-obligatoria-contra-sellup-y-hubspot)
3. [Flujo actualizado del sistema](#3-flujo-actualizado-del-sistema)
4. [Cascada de deduplicación por etapa](#4-cascada-de-deduplicación-por-etapa)
5. [Clasificación de candidatos post-deduplicación](#5-clasificación-de-candidatos-post-deduplicación)
6. [Comportamiento ante lote insuficiente de nuevos](#6-comportamiento-ante-lote-insuficiente-de-nuevos)
7. [UI recomendada para el lote](#7-ui-recomendada-para-el-lote)
8. [Criterios de éxito del Agente 1](#8-criterios-de-éxito-del-agente-1)
9. [Separación de responsabilidades: sistema vs humano](#9-separación-de-responsabilidades-sistema-vs-humano)
10. [Estado Git](#10-estado-git)

---

## 1. Herramientas del Agente 1

El Agente 1 opera con las siguientes herramientas en la arquitectura productiva:

| Herramienta | Capa | Propósito | Costo | Cuándo se activa |
|-------------|------|-----------|-------|------------------|
| **Base interna SellUp** | 1 | Candidatos y cuentas ya conocidas | Cero | Siempre — primer paso |
| **HubSpot API** | 2 | Deduplicación obligatoria, contexto de cuentas existentes | Cero (API incluida) | Siempre — **etapa obligatoria de sistema** |
| **Fuentes públicas precargadas** | 3 | Registros fiscales, directorios sectoriales, SECOP II | Cero o costo fijo | Siempre en discovery |
| **Prompt IA (Claude)** | 4 | Generación de hipótesis, normalización, scoring, clasificación | Tokens (Sonnet/Haiku) | Por cada ejecución |
| **Apollo** | 5 | Fallback estructurado cuando capas 1–4 no alcanzan objetivo | Créditos por resultado | Solo si `use_apollo_fallback: true` |
| **Web/IA general** | 6 | Fallback no estructurado (`search_depth: deep`) | Alto — latencia + tokens | Solo como último recurso |
| **Lusha** | Enriquecimiento | Datos de contacto de personas en candidatos ya aprobados | Créditos por contacto | Fuera del discovery; nunca en Agente 1 discovery |

### Principios de uso de herramientas

- **Cascada de costo ascendente:** nunca escalar a una herramienta más cara si la anterior satisface el objetivo.
- **HubSpot no es opcional:** la verificación contra HubSpot no puede estar en `manual_verification`. Es responsabilidad del sistema antes de presentar candidatos.
- **Lusha separado del discovery:** Lusha nunca se usa para encontrar empresas. Solo para enriquecer contactos post-aprobación.
- **Honestidad sobre `unchecked`:** en laboratorio sin acceso real a HubSpot, el `duplicate_status` queda como `unchecked`, y ese candidato no se considera apto para creación automática.

---

## 2. Deduplicación obligatoria contra SellUp y HubSpot

### 2.1 Principio rector

> **El Agente 1 no puede entregar como "prospecto nuevo" una empresa que ya existe en HubSpot o en SellUp.**

La deduplicación contra HubSpot y SellUp es **responsabilidad del sistema**, no del usuario. El usuario nunca debe perder tiempo buscando manualmente si una empresa candidata ya está en el CRM.

### 2.2 Por qué es obligatoria

1. **Contamina el CRM:** crear duplicados en HubSpot rompe el historial de cuenta, duplica tareas y confunde al equipo comercial.
2. **Desperdicia tiempo de revisión:** si el usuario debe verificar HubSpot para cada candidato, el valor del agente se reduce a un buscador, no a un sistema inteligente.
3. **Invalida las métricas:** una empresa "ya existente" aprobada como "nueva" infla falsamente las métricas de efectividad del agente.
4. **La revisión humana debe centrarse en calidad comercial** — ¿es un buen fit para Ubits?, ¿cuál es el ángulo de venta? — no en detectar duplicados manualmente.

### 2.3 Responsabilidad del sistema vs del humano

| Tarea | Responsable | Justificación |
|-------|-------------|---------------|
| Verificar si la empresa ya existe en HubSpot | **Sistema (automático)** | Consulta programática; no requiere criterio humano |
| Verificar si la empresa ya existe en SellUp | **Sistema (automático)** | Comparación contra base interna; determinística |
| Normalizar nombre y dominio antes de comparar | **Sistema (automático)** | Algoritmo estandarizable |
| Clasificar el resultado (nuevo/duplicado/posible) | **Sistema (automático)** | Resultado determinístico con reglas definidas |
| Decidir si un "posible duplicado" es la misma empresa | **Humano** | Requiere criterio sobre contexto (subsidiaria, fusión, cambio de nombre) |
| Evaluar fit comercial del candidato nuevo | **Humano** | Requiere conocimiento del mercado y del cliente |
| Aprobar o descartar candidatos nuevos | **Humano** | Decisión de negocio irreversible |

### 2.4 Reglas de clasificación obligatoria

| Resultado de deduplicación | `duplicate_status` asignado | Se muestra como "nuevo" | Acción recomendada |
|----------------------------|----------------------------|-------------------------|--------------------|
| Sin coincidencia en SellUp ni HubSpot | `none` | ✅ Sí | Presentar como candidato nuevo |
| Match parcial (nombre similar, sin dominio confirmado) | `possible` | ⚠️ Revisión | Marcar para decisión humana |
| Match exacto en SellUp (mismo dominio o ID) | `existing_in_sellup` | ❌ No | Mover a grupo "Ya existente en SellUp" |
| Match exacto en HubSpot (mismo dominio o `hubspot_company_id`) | `existing_in_hubspot` | ❌ No | Mover a grupo "Ya existente en HubSpot" |
| Sin datos suficientes para verificar | `insufficient_data` | ❌ No | Marcar como incompleto; requiere enriquecimiento antes de presentar |

### 2.5 Criterios de match por prioridad

Siguiendo `HUBSPOT_ACCOUNT_FIELD_MAPPING.md §Reglas de deduplicación recomendadas`:

| Prioridad | Campo | Confianza | Notas |
|-----------|-------|-----------|-------|
| 1 | `hubspot_company_id` almacenado en SellUp | Alta | Si ya fue sincronizado previamente |
| 2 | `domain` normalizado (sin www, sin protocolo, lowercase) | Alta | Clave nativa de HubSpot; más confiable que el nombre |
| 3 | `tax_identifier` (`nit` en UBITS / `sellup_tax_identifier`) | Alta | Cuando disponible y formato compatible |
| 4 | `normalized_name` + `country` (fuzzy ≥ 85%) | Media | Fallback; resultado `possible` — requiere revisión humana |

### 2.6 Comportamiento cuando HubSpot no responde

Si la API de HubSpot falla durante la ejecución:
- Registrar error en `agent_run_steps`
- Crear lote con advertencia visible: `"HubSpot check failed — all candidates marked unchecked"`
- No presentar ningún candidato como "nuevo confirmado"
- Notificar al usuario con instrucción de re-ejecutar o verificar manualmente

---

## 3. Flujo actualizado del sistema

El flujo correcto del Agente 1, con deduplicación como etapa obligatoria, es:

```
[Usuario] → define criterios (país, industria, target_count, search_depth)
     ↓
[Paso 1] — Generar hipótesis de empresas candidatas
           Fuentes: base interna + fuentes públicas + prompt IA
           Resultado: lista de candidatos sin clasificar
     ↓
[Paso 2] — Verificar website y LinkedIn (cuando exista en fuente)
           Solo para candidatos con website o domain disponible
           Resultado: datos enriquecidos; dominios inferidos marcados
     ↓
[Paso 3] — Normalizar nombre y dominio
           Reglas: minúsculas, sin tildes, sin sufijos legales (SAS, SA, LTDA...)
           Dominio: sin protocolo, sin www, lowercase
           Resultado: normalized_name + domain normalizados
     ↓
[Paso 4] — Buscar duplicados en SellUp (base interna)
           Criterio: domain exacto o normalized_name fuzzy ≥ 85%
           Resultado: candidatos marcados existing_in_sellup o posibles
     ↓
[Paso 5] — Buscar duplicados en HubSpot
           Criterio: domain → tax_identifier → normalized_name+country
           Resultado: candidatos marcados existing_in_hubspot o posibles
     ↓
[Paso 6] — Clasificar cada candidato
           Valores posibles:
             none              → nuevo candidato aprobable
             possible          → posible duplicado, requiere decisión humana
             existing_in_sellup → ya existe en SellUp
             existing_in_hubspot → ya existe en HubSpot
             insufficient_data → datos insuficientes para verificar
     ↓
[Paso 7] — ¿Hay suficientes candidatos nuevos (status: none)?
           ├── SÍ (≥ target_count) → continuar
           └── NO → intentar generar más candidatos (hasta límite de búsqueda/costo)
                     Si no alcanza target_count: reportar menor cantidad con explicación
     ↓
[Paso 8] — Crear lote (prospect_batch)
           Incluye TODOS los candidatos clasificados
           Destaca candidatos nuevos como sección principal
           Agrupa existentes/duplicados en secciones colapsables
     ↓
[Paso 9] — No crear cuentas automáticamente
           Solo presentar para revisión humana
           Candidatos con status: none son los únicos que el humano puede aprobar para conversión
```

---

## 4. Cascada de deduplicación por etapa

### Etapa 4A — Deduplicación interna SellUp

Comparar contra tabla `accounts` y `prospect_candidates` existentes:

| Caso | Resultado |
|------|-----------|
| Mismo `domain` exacto en `accounts` | `existing_in_sellup` |
| Mismo `domain` exacto en `prospect_candidates` aprobados | `existing_in_sellup` |
| `normalized_name` + `country` coinciden ≥ 85% | `possible` |
| Sin coincidencia | Avanzar a Etapa 4B |

### Etapa 4B — Deduplicación HubSpot

Secuencia de búsqueda (orden de prioridad):

```
1. Buscar por domain en HubSpot
   GET /crm/v3/objects/companies/search
   filter: domain = {candidate.domain}
   
2. Si domain no disponible o no hay match:
   Buscar por tax_identifier (nit / sellup_tax_identifier)
   
3. Si aún sin match:
   Buscar por normalized_name + country (fuzzy, threshold 85%)
```

| Resultado de búsqueda | `duplicate_status` | `hubspot_match_id` |
|-----------------------|--------------------|--------------------|
| Match exacto por domain | `existing_in_hubspot` | ID de la empresa HubSpot |
| Match exacto por tax_identifier | `existing_in_hubspot` | ID de la empresa HubSpot |
| Match fuzzy por nombre | `possible` | ID tentativo (requiere confirmación humana) |
| Sin match | `none` | null |
| API falló | `unchecked` | null — con advertencia |

---

## 5. Clasificación de candidatos post-deduplicación

Cada candidato del lote tiene un `post_check_status` definitivo antes de ser presentado al usuario:

| `post_check_status` | Significado para el sistema | Se muestra como nuevo | Acción del sistema | Acción del usuario |
|---------------------|-----------------------------|----------------------|--------------------|--------------------|
| `new_candidate` | Sin match en SellUp ni HubSpot | ✅ Sí | Presentar en sección principal | Aprobar, descartar, pedir más info |
| `possible_duplicate` | Match fuzzy; no determinístico | ⚠️ No automáticamente | Marcar con badge "Revisar" | Confirmar si es duplicado o candidato nuevo |
| `existing_in_hubspot` | Match exacto en HubSpot | ❌ No | Mover a sección "Ya en HubSpot" | Vincular, ignorar, o actualizar datos |
| `existing_in_sellup` | Match exacto en SellUp | ❌ No | Mover a sección "Ya en SellUp" | Ver cuenta existente |
| `insufficient_data` | Sin domain ni tax_id verificados para comparar | ❌ No | Mover a sección "Incompletos" | Enriquecer o descartar |
| `unchecked` | Verificación no ejecutada (laboratorio / fallo) | ❌ No | Warning visible; bloquear conversión | No puede aprobarse hasta verificar |

### Nota sobre laboratorio y prompt en modo simulado

Cuando el agente se ejecuta en modo laboratorio (sin acceso real a HubSpot/SellUp), todos los candidatos tendrán `duplicate_status: "unchecked"`. Esto indica explícitamente que:

1. El candidato **no es apto para conversión automática** hasta que se ejecute la deduplicación real.
2. El lote de laboratorio debe interpretarse como **"hipótesis generadas"**, no como "prospectos nuevos confirmados".
3. El orquestador en producción es el responsable de resolver `duplicate_status` antes de presentar candidatos al usuario.

---

## 6. Comportamiento ante lote insuficiente de nuevos

Si después de deduplicación el número de candidatos con `post_check_status: new_candidate` es menor que `target_count`:

```
1. Intentar generar candidatos adicionales
   └── Solo si hay fuentes no exhaustas y costo dentro del límite

2. Si se alcanzan más candidatos nuevos → completar hasta target_count

3. Si no se puede completar:
   └── Reportar el lote con lo disponible
       batch_summary.generated_new_count < target_count
       batch_summary.limitations: ["Solo X candidatos nuevos encontrados. Y ya existían en HubSpot, Z ya existían en SellUp."]
       apollo_needed: true  (si aplica)

4. NUNCA inflar el número de "nuevos" moviendo existing_in_hubspot
   al grupo de nuevos para cumplir el target_count
```

---

## 7. UI recomendada para el lote

### 7.1 Contadores en cabecera del lote

La vista del lote debe mostrar contadores claros antes de la tabla de candidatos:

```
┌─────────────────────────────────────────────────────────────┐
│  Lote: Colombia / Tecnología · 15 candidatos solicitados    │
│                                                              │
│  ✅ Nuevas          9    (candidatos aprobables)            │
│  ⚠️  Posibles dup.  2    (requieren revisión)               │
│  🏢 Ya en HubSpot  3    (empresas existentes en CRM)        │
│  📋 Ya en SellUp   1    (cuentas ya registradas)            │
│  ❓ Incompletas     0    (datos insuficientes)              │
│                                                              │
│  Costo estimado: $0.07 USD                                  │
└─────────────────────────────────────────────────────────────┘
```

### 7.2 Filtros rápidos (chips/tabs)

La tabla de revisión debe incluir filtros rápidos:

| Filtro | Muestra |
|--------|---------|
| **Ver nuevas** | Solo candidatos con `post_check_status: new_candidate` |
| **Ver posibles duplicados** | Solo `possible_duplicate` |
| **Ver en HubSpot** | Solo `existing_in_hubspot` — con link a la empresa en HubSpot |
| **Ver en SellUp** | Solo `existing_in_sellup` — con link a la cuenta en SellUp |
| **Ver incompletas** | Solo `insufficient_data` |

### 7.3 Comportamiento por categoría en UI

| Categoría | Badge | Acciones disponibles | Link externo |
|-----------|-------|---------------------|--------------|
| Nuevas | `NUEVA` (verde) | Aprobar · Descartar · Pedir más info | — |
| Posibles duplicados | `REVISAR` (amarillo) | Confirmar duplicado · Marcar como nueva · Descartar | HubSpot company si hay match_id |
| Ya en HubSpot | `EN HUBSPOT` (gris) | Ver en HubSpot · Ignorar · Actualizar datos | Link a HubSpot company |
| Ya en SellUp | `EN SELLUP` (gris) | Ver cuenta · Ignorar | Link a cuenta SellUp |
| Incompletas | `INCOMPLETA` (rojo) | Enriquecer · Descartar | — |

### 7.4 Sección colapsable para existentes

Las secciones "Ya en HubSpot" y "Ya en SellUp" deben estar colapsadas por defecto, para que el usuario vea primero los candidatos nuevos. Un badge numérico en el encabezado colapsado indica cuántas hay.

---

## 8. Criterios de éxito del Agente 1

### 8.1 Criterio central (revisado)

> **El Agente 1 no se mide por empresas encontradas. Se mide por empresas nuevas útiles.**

Las empresas que ya existen en HubSpot no son un éxito del agente — son un costo desperdiciado.

### 8.2 Métricas de éxito (producción)

| Métrica | Descripción | Meta inicial (MVP) |
|---------|-------------|-------------------|
| `new_candidates_rate` | Candidatos con `post_check_status: new_candidate` / total generados | ≥ 60% |
| `hubspot_dedup_rate` | Duplicados HubSpot detectados automáticamente / total candidatos | ≥ 95% de detección |
| `cost_per_new_candidate` | Costo total del lote / candidatos nuevos | < $0.015 USD |
| `human_approval_rate` | Candidatos nuevos aprobados por el usuario / candidatos nuevos presentados | ≥ 50% |
| `false_positive_rate` | Candidatos marcados como "nuevos" que el usuario marcó como duplicados | < 5% |
| `auto_dedup_precision` | Candidatos marcados `existing_in_hubspot` que realmente eran existentes | ≥ 98% |

### 8.3 Métricas secundarias (contexto)

| Métrica | Descripción |
|---------|-------------|
| `total_candidates_generated` | Cantidad bruta de hipótesis generadas antes de deduplicación |
| `existing_in_hubspot_count` | Cuántas empresas del lote ya estaban en HubSpot |
| `possible_duplicate_count` | Cuántas requirieron revisión humana por ambigüedad |
| `cost_per_approved_candidate` | Costo del lote / candidatos aprobados por el humano |
| `execution_time_seconds` | Tiempo de generación + deduplicación completa |

### 8.4 Criterio de éxito del MVP (versión actualizada)

El Agente 1 v1 es exitoso si:

1. El sistema verifica automáticamente contra HubSpot y SellUp **antes** de presentar candidatos al usuario.
2. El usuario recibe la vista del lote con candidatos ya clasificados — sin necesidad de buscar HubSpot manualmente.
3. Los candidatos con `post_check_status: new_candidate` tienen una tasa de aprobación ≥ 50%.
4. La tasa de duplicados HubSpot detectados automáticamente es ≥ 95%.
5. El costo por candidato nuevo aprobable es < $0.015 USD.
6. El usuario puede revisar, aprobar y convertir candidatos desde una sola pantalla.
7. Ningún registro se crea en HubSpot sin aprobación explícita.

---

## 9. Separación de responsabilidades: sistema vs humano

### Lo que el sistema hace automáticamente (sin intervención humana)

- Generar hipótesis de empresas candidatas
- Normalizar nombres y dominios
- Verificar websites cuando la fuente lo permite
- Buscar duplicados en SellUp (base interna)
- Buscar duplicados en HubSpot (API)
- Clasificar cada candidato con `post_check_status`
- Calcular scores de confianza, fit y completeness
- Crear el lote con candidatos clasificados
- Notificar al usuario vía Slack (si configurado)

### Lo que el humano decide (revisión humana obligatoria)

- Confirmar o rechazar "posibles duplicados" (casos ambiguos)
- Evaluar si un candidato nuevo tiene fit comercial real con Ubits
- Aprobar o descartar candidatos nuevos
- Solicitar enriquecimiento de candidatos específicos
- Convertir candidatos aprobados en cuentas
- Autorizar sincronización con HubSpot

### Lo que nunca debe ocurrir

- ❌ Que el usuario busque manualmente en HubSpot si una empresa ya existe
- ❌ Que un candidato con `existing_in_hubspot` se muestre como "nuevo"
- ❌ Que `duplicate_status: unchecked` sea tratado como `none` (nuevo)
- ❌ Que se creen cuentas o se sincronice HubSpot sin aprobación explícita
- ❌ Que se usen créditos de Apollo o Lusha antes de agotar fuentes gratuitas

---

## 10. Estado Git

```
On branch main

Archivos modificados en esta sesión:
  docs/AGENTE_1_ARQUITECTURA_PROFESIONAL_POR_HERRAMIENTAS.md  ← NUEVO (este documento)
  docs/prompts/AGENTE_1_GENERACION_EMPRESAS_CANDIDATAS_PROMPT_V2.md  ← ACTUALIZADO
  docs/prompts/AGENTE_1_PROMPT_LAB_RESULTADOS_V2.md           ← ACTUALIZADO

Sin commits realizados.
Sin código modificado (.ts / .tsx / .js).
Sin migraciones creadas.
Sin APIs reales llamadas.
Sin empresas creadas en HubSpot ni SellUp.
```

---

*Documento creado: 2026-05-22*  
*Roles activos: Principal AI Architect · HubSpot Integration Architect · Product Architect*  
*No se llamaron APIs reales. No se modificó código. No se hicieron commits.*  
*Motivación: validación manual reveló que el Prompt Lab V2 generó candidatos que ya existían en HubSpot.*
