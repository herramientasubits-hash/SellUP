# Uso, Costos y Efectividad de Agentes y Proveedores

**Tipo:** Documento de Diseño Funcional / Técnico  
**Estado:** Borrador para revisión  
**Fecha:** 2026-05-21  
**Alcance:** Foundation transversal de medición — previa a la construcción del Agente 1

---

## 1. Resumen Ejecutivo

Antes de construir cualquier agente operativo en SellUp, la plataforma necesita una **capa transversal de observabilidad** que mida de forma sistemática:

- **Costo:** cuánto cuesta cada ejecución, cada paso, cada llamada a proveedor externo.
- **Consumo:** qué recursos se consumen (tokens de IA, créditos de Apollo, créditos de Lusha, llamadas a HubSpot, eventos en Samu IA).
- **Efectividad:** qué proporción de resultados devueltos son realmente útiles, aprobados o convertidos.
- **Calidad de resultados:** duplicados, datos faltantes, tasa de descarte, precisión percibida.
- **Trazabilidad:** cada acción del agente debe poder vincularse a un usuario, a una ejecución, a un paso y a un proveedor.

Esta capa **no es un dashboard**. Es una infraestructura de registro que hace posible tomar decisiones informadas: qué proveedor usar primero, cuándo detener la cascada, cuánto cuesta un prospecto aprobado.

Construir el **Agente 1 — Generación y enriquecimiento de prospectos** sin esta foundation sería construir un agente caro, opaco y difícil de optimizar. Esta capa evita ese problema desde el principio.

---

## 2. Principio Central

> **Toda ejecución de agente y toda llamada a proveedor externo debe dejar rastro medible.**

No basta con saber que una acción "funcionó". Para cada operación se debe poder responder:

| Pregunta | Dato que la responde |
|----------|----------------------|
| ¿Cuánto costó? | Costo real o estimado por proveedor/operación |
| ¿Qué fuente se usó? | Proveedor, modelo, endpoint lógico |
| ¿Qué devolvió? | Cantidad de resultados crudos |
| ¿Cuántos fueron útiles? | Resultados normalizados y no duplicados |
| ¿Cuántos fueron descartados? | Por duplicado, por calidad insuficiente, por criterio del usuario |
| ¿Cuántos fueron aprobados? | Por revisión humana o por regla de negocio |
| ¿Qué tan eficiente fue frente a otras fuentes? | Tasa de aprobación por fuente, costo por aprobado |

Este principio aplica a todas las fuentes: base interna, HubSpot, Apollo, Lusha, Samu IA, modelos de IA, fuentes precargadas.

---

## 3. Alcance Inicial

### Dentro del alcance

| Entidad | Qué se mide |
|---------|-------------|
| Ejecuciones de agentes | Inicio, fin, estado, costo total, resultados |
| Pasos internos de agentes | Fuente consultada, resultados por paso, costo por paso |
| Llamadas a proveedores externos | Proveedor, operación, resultados, errores, costo estimado |
| Consumo de modelos IA | Proveedor, modelo, tokens entrada/salida, costo |
| Apollo | Búsquedas de empresas, enriquecimiento, créditos si disponibles |
| Lusha | Enriquecimiento de personas/empresas, contactos devueltos, créditos si disponibles |
| HubSpot | Consultas de contactos/empresas, sincronizaciones, operaciones de escritura |
| Samu IA | Llamadas al webhook, eventos procesados, estado de procesamiento |
| Resultados de prospectos | Estado del ciclo: generado → candidato → aprobado → convertido |
| Métricas de calidad | Duplicados, emails inválidos, datos faltantes, descartados |

### Fuera del alcance por ahora

| Excluido | Razón |
|----------|-------|
| Dashboards avanzados de BI | Se construirán en una fase posterior |
| ROI hasta cierre de venta | Requiere integración con pipeline comercial completo |
| Atribución comercial completa | Complejidad alta, depende de datos de ventas maduros |
| Predicción automática de performance | Requiere historial de datos acumulado |
| Optimización automática de cascadas | Requiere análisis de datos y definición de reglas de negocio |
| Slack/Drive como fuente de efectividad | Se usan como operación, no como fuente de prospectos evaluable |

---

## 4. Entidades Conceptuales Necesarias

Las siguientes entidades no son tablas definitivas. Son contratos conceptuales que el diseño técnico debe respetar. Las migraciones se crearán en la siguiente fase.

---

### 4.1 `agent_runs`

Registra **cada ejecución completa de un agente**.

| Campo conceptual | Descripción |
|-----------------|-------------|
| id | Identificador único de la ejecución |
| agent_type | Tipo de agente (`prospect_generation`, `enrichment`, etc.) |
| user_id | Usuario que disparó la ejecución |
| organization_id | Organización a la que pertenece |
| status | `pending`, `running`, `completed`, `failed`, `cancelled` |
| started_at | Timestamp de inicio |
| finished_at | Timestamp de fin (o null si en curso) |
| input_params | Parámetros del input: país, industria, cantidad, criterios |
| results_requested | Cantidad solicitada |
| results_generated | Cantidad generada (bruta) |
| results_unique | Cantidad de resultados únicos (post-deduplicación) |
| results_approved | Cantidad aprobada tras revisión |
| results_discarded | Cantidad descartada |
| estimated_cost_usd | Costo estimado total de la ejecución en USD |
| notes | Notas operativas opcionales |

**Ejemplo de uso:** el Agente 1 crea un `agent_run` al inicio, lo actualiza al final con totales y costos.

---

### 4.2 `agent_run_steps`

Registra **cada paso individual dentro de una ejecución**.

| Campo conceptual | Descripción |
|-----------------|-------------|
| id | Identificador único del paso |
| agent_run_id | FK a `agent_runs` |
| step_name | Nombre del paso (`query_internal_db`, `query_hubspot`, `query_apollo`, etc.) |
| provider | Proveedor consultado en este paso |
| status | `skipped`, `attempted`, `success`, `error` |
| results_returned | Cantidad de resultados devueltos por este paso |
| results_useful | Cantidad considerada útil tras filtros |
| estimated_cost_usd | Costo estimado de este paso |
| duration_ms | Duración del paso en milisegundos |
| error_message | Mensaje de error si aplica |
| metadata | JSON libre para datos adicionales del paso |

**Ejemplo de uso:** en la cascada del Agente 1, cada fuente (interna, HubSpot, Apollo, Lusha) genera un `agent_run_step`. Permite ver qué paso aportó más valor y cuánto costó.

---

### 4.3 `provider_usage_logs`

Registra **cada llamada a cualquier proveedor externo**. Es la tabla de mayor granularidad.

| Campo conceptual | Descripción |
|-----------------|-------------|
| id | Identificador único del log |
| agent_run_id | FK opcional a `agent_runs` |
| agent_run_step_id | FK opcional a `agent_run_steps` |
| provider | `apollo`, `lusha`, `hubspot`, `samu_ia`, `openai`, `anthropic`, `google`, etc. |
| operation | Operación lógica ejecutada (`company_search`, `person_enrich`, `contact_sync`, etc.) |
| model | Modelo de IA si aplica (ej: `claude-sonnet-4-6`) |
| input_tokens | Tokens de entrada si aplica |
| output_tokens | Tokens de salida si aplica |
| credits_used | Créditos consumidos si el proveedor los entrega |
| results_returned | Resultados brutos devueltos |
| estimated_cost_usd | Costo estimado calculado según `provider_pricing_config` |
| real_cost_usd | Costo real si el proveedor lo entrega en respuesta |
| status | `success`, `error`, `rate_limited`, `quota_exceeded` |
| error_code | Código de error si aplica |
| duration_ms | Duración de la llamada |
| user_id | Usuario que originó la operación |
| organization_id | Organización |
| created_at | Timestamp |

**Propósito:** permite sumar costos por proveedor, detectar errores recurrentes, calcular costo real vs. estimado, y auditar consumo.

---

### 4.4 `provider_pricing_config`

Permite **configurar costos estimados por proveedor y operación** cuando el proveedor no entrega el costo exactamente en su respuesta.

| Campo conceptual | Descripción |
|-----------------|-------------|
| id | Identificador |
| provider | `apollo`, `lusha`, `hubspot`, `openai`, etc. |
| operation | `company_search`, `person_enrich`, `company_enrich`, `input_token`, `output_token`, etc. |
| unit | Unidad de medición: `per_request`, `per_result`, `per_1k_tokens`, `per_credit` |
| unit_cost_usd | Costo estimado por unidad en USD |
| notes | Explicación de la fuente del precio estimado |
| effective_from | Fecha de vigencia |
| is_active | Si está activo actualmente |

**Nota:** Los precios de Apollo y Lusha varían según el plan y el contrato. Esta tabla permite registrar los valores configurables por el administrador de SellUp, sin depender de que el proveedor los entregue en la API. Cuando el proveedor sí entregue costos reales, se preferirá ese valor sobre el estimado.

**Ejemplo de registros de referencia (no definitivos, deben configurarse según contrato):**

| Proveedor | Operación | Unidad | Descripción |
|-----------|-----------|--------|-------------|
| apollo | company_search | per_result | Búsqueda de empresas |
| apollo | person_enrich | per_result | Enriquecimiento de persona |
| lusha | person_enrich | per_result | Enriquecimiento de persona |
| lusha | company_enrich | per_result | Enriquecimiento de empresa |
| anthropic | input_token | per_1k_tokens | Tokens de entrada |
| anthropic | output_token | per_1k_tokens | Tokens de salida |
| hubspot | api_call | per_request | Llamada a API de HubSpot |

---

### 4.5 `result_quality_events`

Registra **eventos de ciclo de vida de cada resultado generado** (prospecto, contacto, empresa).

| Campo conceptual | Descripción |
|-----------------|-------------|
| id | Identificador del evento |
| agent_run_id | FK a `agent_runs` |
| result_type | `prospect`, `contact`, `company` |
| result_id | ID del prospecto/contacto/empresa en la plataforma |
| event_type | `generated`, `normalized`, `duplicate_detected`, `discarded`, `approved`, `converted_to_account`, `sent_to_hubspot`, `contact_useful`, `contact_invalid` |
| source | Fuente que originó el resultado (`internal_db`, `hubspot`, `apollo`, `lusha`, `web_ai`, `preloaded`) |
| user_id | Usuario que realizó la acción (si fue manual) |
| notes | Razón del evento (ej: "email duplicado", "sin contacto disponible") |
| created_at | Timestamp |

**Propósito:** permite trazar el ciclo completo de cada resultado y calcular métricas de efectividad por fuente, por agente, por usuario.

---

## 5. Métricas de Costo

Las siguientes métricas deben poder calcularse a partir de las entidades definidas.

### Por ejecución

| Métrica | Cálculo conceptual |
|---------|-------------------|
| Costo total por ejecución | Suma de `estimated_cost_usd` de todos los `provider_usage_logs` del `agent_run` |
| Costo por proveedor | Agrupado por `provider` dentro del `agent_run` |
| Costo por paso | Agrupado por `agent_run_step_id` |
| Costo por prospecto generado | `costo_total / results_generated` |
| Costo por prospecto único | `costo_total / results_unique` |
| Costo por prospecto aprobado | `costo_total / results_approved` |
| Costo por contacto útil | Suma de costos de pasos de enriquecimiento / contactos_útiles |

### Por dimensión de análisis

| Métrica | Dimensión |
|---------|-----------|
| Costo por agente | `agent_type` en `agent_runs` |
| Costo por usuario | `user_id` en `agent_runs` |
| Costo por país | Extraído de `input_params` |
| Costo por industria | Extraído de `input_params` |
| Costo por proveedor (global) | `provider` en `provider_usage_logs` |

### Nota sobre costos estimados vs. reales

Algunos proveedores entregan el costo en su respuesta de API (`real_cost_usd`). Cuando esto ocurra, ese valor prevalece. Cuando no, se aplica la configuración de `provider_pricing_config` para obtener el `estimated_cost_usd`. Los reportes deben distinguir ambos casos para que el administrador sepa cuánto es certero y cuánto es aproximación.

---

## 6. Métricas de Efectividad

### Métricas de volumen

| Métrica | Descripción |
|---------|-------------|
| Resultados solicitados | Input del usuario al agente |
| Resultados devueltos | Suma de todos los pasos antes de filtros |
| Resultados normalizados | Tras estandarizar formato y datos |
| Resultados únicos | Tras deduplicación |
| Duplicados detectados | Resultados que ya existían en la plataforma |
| Resultados descartados | Por calidad, criterio o decisión manual |
| Resultados aprobados | Aprobados explícitamente para continuar en el pipeline |
| Resultados convertidos a cuenta | Finalmente creados como cuenta/empresa en SellUp |

### Métricas de tasa

| Métrica | Cálculo |
|---------|---------|
| Tasa de aprobación | `aprobados / únicos` |
| Tasa de duplicados | `duplicados / devueltos` |
| Tasa de descarte | `descartados / únicos` |
| Tasa de conversión a cuenta | `convertidos / aprobados` |

### Métricas de fuente

| Métrica | Descripción |
|---------|-------------|
| Fuente más efectiva | Fuente con mayor `(aprobados / devueltos)` |
| Fuente menos efectiva | Fuente con menor tasa de aprobación |
| Fuente más costosa por aprobado | Fuente con mayor `(costo / aprobados)` |
| Costo por aprobado por fuente | Desglose por `source` en `result_quality_events` |

### Métricas de calidad

| Métrica | Descripción |
|---------|-------------|
| Precisión percibida | Tasa de aprobación humana sobre candidatos presentados |
| Completitud de datos | % de prospectos con email, teléfono, nombre completo |
| Validez de contactos | % de emails/teléfonos que no rebotaron o fueron marcados como inválidos |

---

## 7. Medición de Apollo

Apollo es el proveedor recomendado para **búsqueda de empresas y prospectos** a escala. No debe usarse necesariamente como primer paso de enriquecimiento profundo de contactos.

### Qué registrar por cada llamada a Apollo

| Dato | Campo en `provider_usage_logs` |
|------|-------------------------------|
| Operación ejecutada | `operation`: `company_search`, `person_search`, `person_enrich` |
| Endpoint lógico | Indicado en `metadata` |
| Cantidad solicitada | `metadata.requested` |
| Cantidad devuelta | `results_returned` |
| Resultados útiles (no duplicados) | Calculado por el agente al procesar respuesta |
| Resultados aprobados | Registrado en `result_quality_events` |
| Errores | `status`, `error_code` |
| Costo estimado | `estimated_cost_usd` via `provider_pricing_config` |
| Créditos si disponibles | `credits_used` si Apollo los entrega en respuesta |
| País/industria asociados | `metadata.country`, `metadata.industry` |

### Cuándo usar Apollo

- Después de agotar base interna, HubSpot y fuentes precargadas.
- Antes de Lusha, porque el costo de búsqueda de empresas suele ser menor que el enriquecimiento de contactos individuales.
- Para búsqueda masiva de empresas por criterios (país, industria, tamaño).

### Cuándo no usar Apollo

- No como primer paso (desperdiciaría el valor de la base interna).
- No para enriquecimiento profundo de contactos individuales si Lusha tiene mejor precisión en ese dominio.

---

## 8. Medición de Lusha

Lusha es el proveedor recomendado para **enriquecimiento de personas y empresas**, con foco en emails y teléfonos directos. Es más costoso en créditos por resultado, por lo que debe usarse con criterio.

### Qué registrar por cada llamada a Lusha

| Dato | Campo en `provider_usage_logs` |
|------|-------------------------------|
| Operación ejecutada | `operation`: `person_enrich`, `company_enrich` |
| Empresa o contacto enriquecido | `metadata.entity_id`, `metadata.entity_name` |
| Contactos devueltos | `results_returned` |
| Emails disponibles | `metadata.emails_found` |
| Teléfonos disponibles | `metadata.phones_found` |
| Contactos útiles | `metadata.contacts_useful` |
| Contactos descartados | Calculado por el agente |
| Costo estimado / créditos | `estimated_cost_usd`, `credits_used` si disponible |
| Tasa de utilidad | `credits_used / contacts_useful` (calculado posterior) |
| Errores | `status`, `error_code` |

### Cuándo usar Lusha

- **Después de tener empresas candidatas o aprobadas**, no en la búsqueda inicial.
- Como paso de enriquecimiento de contactos para empresas que ya superaron un umbral de relevancia.
- En modo conservador: enriquecer solo las empresas con mayor probabilidad de conversión.

### Por qué no usar Lusha primero

- El costo por crédito es significativo si se enriquecen contactos de empresas que luego serán descartadas.
- La cascada debe garantizar que Lusha solo se invoque cuando ya hay suficiente confianza en el candidato.

---

## 9. Medición de IA

La medición de consumo de IA es una **decisión fundacional de SellUp** que ya existe y debe extenderse a todos los agentes sin excepción.

### Qué registrar por cada llamada a un modelo de IA

| Dato | Campo en `provider_usage_logs` |
|------|-------------------------------|
| Proveedor | `provider`: `anthropic`, `openai`, `google`, etc. |
| Modelo | `model`: `claude-sonnet-4-6`, `gpt-4o`, etc. |
| Tokens de entrada | `input_tokens` |
| Tokens de salida | `output_tokens` |
| Costo estimado | `estimated_cost_usd` via `provider_pricing_config` |
| Agente | `agent_run_id` |
| Paso | `agent_run_step_id` |
| Usuario | `user_id` |
| Cuenta / prospecto | `metadata.account_id`, `metadata.prospect_id` |
| Resultado generado | `metadata.result_summary` |
| Estado de ejecución | `status` |

### Casos de uso de IA en el Agente 1

| Caso de uso | Cuándo ocurre |
|-------------|---------------|
| Normalización de datos | Al procesar resultados de Apollo/Lusha para estandarizar formato |
| Deduplicación inteligente | Cuando reglas básicas no son suficientes |
| Generación de descripciones | Síntesis de información de la empresa |
| Evaluación de relevancia | Clasificar si un resultado cumple los criterios del usuario |
| Web scraping asistido | Como último recurso en la cascada |

---

## 10. Medición del Agente 1 — Generación de Prospectos

El Agente 1 es el primer agente operativo de SellUp. Su propósito es generar lotes de empresas/prospectos candidatos según criterios del usuario.

### Input del agente

| Parámetro | Descripción |
|-----------|-------------|
| País | País objetivo (uno o varios) |
| Industria | Sector/industria objetivo |
| Cantidad objetivo | Número de prospectos solicitados |
| Criterios adicionales | Tamaño de empresa, segmento, keywords |
| Configuración de cascada | Qué fuentes están habilitadas |

### Output del agente

| Output | Descripción |
|--------|-------------|
| Lote generado | Conjunto de prospectos candidatos |
| Candidatos nuevos | No existentes en la plataforma |
| Posibles duplicados | Existentes, presentados para revisión |
| Empresas relacionadas | Sugerencias secundarias |
| Descartados automáticamente | Por reglas de calidad |
| Aprobados | Tras revisión inicial o reglas automáticas |

### Métricas clave del Agente 1

| Métrica | Cómo se calcula |
|---------|----------------|
| Costo total del lote | Suma de `estimated_cost_usd` del `agent_run` completo |
| Costo por candidato | `costo_total / results_generated` |
| Costo por aprobado | `costo_total / results_approved` |
| Tasa de duplicados | `duplicados / devueltos_totales` |
| Tasa de aprobación | `aprobados / únicos` |
| Fuente dominante | Fuente con más resultados en el lote |
| Fuente más efectiva | Fuente con mayor tasa de aprobación |
| Fuente más costosa | Fuente con mayor `costo / aprobados` |
| Tiempo de ejecución | `finished_at - started_at` |

---

## 11. Cascada de Fuentes y Medición

El Agente 1 opera en cascada: consulta fuentes de menor a mayor costo, deteniéndose cuando tiene suficientes candidatos de calidad.

### Orden de la cascada

| Paso | Fuente | Cuándo se usa | Qué se mide | Cuándo se detiene |
|------|--------|--------------|-------------|-------------------|
| 1 | Base interna de SellUp | Siempre como primer paso | Resultados encontrados, tasa de coincidencia | Si se alcanza el objetivo |
| 2 | HubSpot | Si está integrado y hay datos sincronizados | Contactos y empresas obtenidos, operaciones ejecutadas | Si se alcanza el objetivo |
| 3 | Fuentes precargadas | Si existen listas precargadas por el admin | Resultados en lista, coincidencias con criterio | Si se alcanza el objetivo |
| 4 | Proveedor configurado | Si el admin configuró un proveedor personalizado | Igual que cualquier proveedor externo | Si se alcanza el objetivo |
| 5 | Apollo | Si faltan candidatos tras pasos anteriores | Búsquedas, resultados, créditos, costo | Si se alcanza el objetivo |
| 6 | Lusha | Solo para empresas candidatas que necesitan enriquecimiento de contactos | Contactos enriquecidos, emails/teléfonos, créditos | Si los contactos requeridos están completos |
| 7 | Web / IA | Como último recurso | Tokens, costo, resultado generado | Siempre al final si no se alcanzó el objetivo |

### Cómo evitar gasto innecesario

- **Verificar siempre la base interna primero** — costo cero.
- **Usar Apollo para volumen**, no para contactos individuales.
- **No llamar a Lusha** hasta tener empresas candidatas con suficiente confianza.
- **No activar Web/IA** hasta agotar las fuentes estructuradas.
- **Detener la cascada** en cuanto se alcance la cantidad objetivo con calidad mínima aceptable.
- **Registrar cada paso** como `skipped` si no se ejecutó, para auditar por qué se saltó.

---

## 12. Relación con Lotes de Prospectos

El Agente 1 **no debe crear cuentas definitivas directamente**. El flujo correcto es:

```
Input del usuario
     ↓
Agent Run (Agente 1)
     ↓
Lote de prospectos candidatos (revisión)
     ↓
Aprobación (manual o automática)
     ↓
Conversión a cuenta / empresa en SellUp
     ↓
(Opcional) Sincronización con HubSpot
```

### Estados de ciclo de vida que la medición debe distinguir

| Estado | Descripción | Tabla que lo registra |
|--------|-------------|----------------------|
| `generated` | Resultado devuelto por cualquier fuente | `result_quality_events` |
| `normalized` | Tras estandarizar formato y campos | `result_quality_events` |
| `duplicate_detected` | Ya existe en la plataforma | `result_quality_events` |
| `discarded` | Descartado por calidad, criterio o usuario | `result_quality_events` |
| `approved` | Aceptado para continuar en el pipeline | `result_quality_events` |
| `converted_to_account` | Creado definitivamente como cuenta | `result_quality_events` |
| `sent_to_hubspot` | Sincronizado en HubSpot | `result_quality_events` |
| `contact_useful` | Contacto con datos válidos y relevantes | `result_quality_events` |
| `contact_invalid` | Email o teléfono inválido, incompleto o rebotado | `result_quality_events` |

Esta distinción es fundamental: medir efectividad solo por "resultados devueltos" sobreestima el valor de un proveedor. La métrica real es **resultados aprobados**.

---

## 13. Dashboards Futuros

Los siguientes dashboards se definen conceptualmente para una fase posterior. **No se construyen en esta fase.**

| Dashboard | Qué muestra |
|-----------|-------------|
| Costo por agente | Evolución del costo de cada agente a lo largo del tiempo |
| Costo por proveedor | Desglose de gasto por Apollo, Lusha, IA, HubSpot |
| Efectividad por fuente | Tasa de aprobación y costo por aprobado por fuente |
| Calidad de prospectos | Tasa de duplicados, descartados, aprobados por lote |
| Costo por país / industria | Mapa de costos por segmento objetivo |
| Ranking de proveedores | Ordenados por efectividad y costo |
| Evolución mensual de consumo | Tendencias de tokens, créditos, USD por mes |
| Alertas por gasto excesivo | Notificación cuando un agente supera umbral de costo |
| Comparativa de cascadas | Qué configuración de cascada genera mejor ratio calidad/costo |

Para construir estos dashboards, la foundation de logging definida en este documento es condición necesaria. Sin datos históricos confiables, cualquier dashboard será especulativo.

---

## 14. Decisiones Recomendadas

Las siguientes decisiones quedan documentadas como parte del diseño de esta foundation:

| Decisión | Justificación |
|----------|---------------|
| Construir la foundation de medición **antes** del Agente 1 | Sin logging previo, el agente será opaco e imposible de optimizar |
| Registrar **cada llamada a proveedor** en `provider_usage_logs` | Granularidad necesaria para auditoría y optimización |
| Tratar costos de Apollo y Lusha como **configurables** si no vienen de la API | Los contratos varían; no hardcodear precios |
| Usar Lusha **con criterio**, nunca como primer paso | Su costo por crédito es alto; debe activarse solo sobre candidatos con confianza |
| Medir efectividad por **resultados aprobados**, no solo devueltos | Los resultados devueltos sobreestiman el valor de un proveedor |
| **No construir dashboard avanzado** en esta fase | Prioridad es el logging confiable; los dashboards vienen después |
| Registrar pasos `skipped` en `agent_run_steps` | Permite auditar por qué la cascada se detuvo antes de ciertos pasos |
| Distinguir costo **real vs. estimado** en los logs | Transparencia para el administrador sobre la precisión del dato |

---

## 15. Próximo Paso Técnico Recomendado

> **Construir la foundation mínima de tracking de uso, costos y efectividad antes de implementar el Agente 1.**

### Componentes mínimos de la foundation

| Componente | Qué incluye |
|------------|-------------|
| **Tablas base** | `agent_runs`, `agent_run_steps`, `provider_usage_logs`, `provider_pricing_config`, `result_quality_events` |
| **Migraciones Supabase** | Una migración por tabla, con RLS básico y índices por `organization_id`, `user_id`, `created_at` |
| **Server actions / helpers de logging** | Funciones auxiliares para registrar fácilmente cada evento desde cualquier agente |
| **Vista administrativa simple** | Una página en Settings que muestre logs de uso recientes, sin dashboards complejos |
| **Integración con sistema existente de tokens IA** | Extender el tracking existente para alimentar `provider_usage_logs` |

### Qué no incluye esta foundation

- Dashboards avanzados.
- Gráficas de evolución.
- Alertas automáticas.
- Cálculos de ROI.
- Optimización automática de cascadas.

Una vez que la foundation esté construida y el Agente 1 esté operativo con sus primeras ejecuciones reales, los datos comenzarán a acumularse y será posible iterar sobre los dashboards con información confiable.

---

## Apéndice: Glosario

| Término | Definición en el contexto de SellUp |
|---------|--------------------------------------|
| Agent Run | Ejecución completa de un agente, de inicio a fin |
| Cascada de fuentes | Secuencia ordenada de fuentes consultadas, de menor a mayor costo |
| Candidato | Prospecto devuelto por cualquier fuente, antes de revisión |
| Costo estimado | Costo calculado mediante `provider_pricing_config` cuando el proveedor no lo entrega |
| Costo real | Costo entregado directamente por el proveedor en su respuesta |
| Crédito | Unidad de consumo interna de Apollo o Lusha |
| Deduplicación | Proceso de detectar resultados que ya existen en la plataforma |
| Efectividad | Ratio entre resultados aprobados y resultados generados o invertidos |
| Enriquecimiento | Proceso de agregar datos adicionales a un prospecto ya identificado |
| Foundation | Capa transversal de logging, costos y efectividad |
| Lote de prospectos | Conjunto de candidatos generados en una ejecución del Agente 1 |
| Normalización | Proceso de estandarizar formato y campos de los resultados crudos |
| Prospecto | Empresa o persona identificada como potencial cliente |
| Tasa de aprobación | `aprobados / únicos` — métrica principal de efectividad |

---

**Documento preparado por:** Claude (Tech Lead / Product Architect)  
**Revisión requerida:** Product Owner, Tech Lead SellUp  
**Estado:** Borrador — pendiente de revisión y aprobación antes de iniciar construcción técnica
