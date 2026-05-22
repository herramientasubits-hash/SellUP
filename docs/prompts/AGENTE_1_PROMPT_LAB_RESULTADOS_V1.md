# Agente 1 — Prompt Lab · Resultados V1

**Versión:** 1.0  
**Fecha:** 2026-05-21  
**Estado:** Laboratorio — sin llamadas a APIs reales  
**Entorno de prueba:** Antigravity (simulado)  
**Prompt maestro probado:** [`docs/prompts/AGENTE_1_GENERACION_EMPRESAS_CANDIDATAS_PROMPT_V1.md`](./AGENTE_1_GENERACION_EMPRESAS_CANDIDATAS_PROMPT_V1.md)  
**Resultados V0 (base):** [`docs/prompts/AGENTE_1_PROMPT_LAB_RESULTADOS_V0.md`](./AGENTE_1_PROMPT_LAB_RESULTADOS_V0.md)

> Este documento extiende el Prompt Lab V0. Los resultados cualitativos por caso (outputs JSON,
> métricas de calidad, evaluación por criterio) están documentados en V0 y no se repiten aquí.
> Este reporte agrega: consumo de tokens, costo estimado, análisis de eficiencia y
> recomendaciones de optimización para producción.

---

## Consumo de tokens y costo estimado

> **Token usage: estimated, not provider-reported.**
> Antigravity no reportó conteos exactos de tokens en este laboratorio. Los valores siguientes
> son estimaciones calculadas a partir del volumen real de texto del prompt y los outputs
> generados en V0, usando las tarifas publicadas de Claude Sonnet 4.6.
>
> **Tarifas Claude Sonnet 4.6 (publicadas, USD):**
> - Input: $3.00 / 1M tokens
> - Output: $15.00 / 1M tokens
>
> **Metodología de estimación:**
> - Input tokens = caracteres del prompt maestro V0 + input JSON. Se estima 1 token ≈ 4 caracteres.
> - Output tokens = caracteres del JSON de output generado en V0 para cada caso. Misma proporción.
> - El prompt maestro V0 tiene aproximadamente 5,800 caracteres → ~1,450 tokens de sistema.
> - El input JSON del usuario por caso tiene ~180 caracteres → ~45 tokens.
> - Total input por caso: ~1,495 tokens (redondeado a 1,500).

| Caso | País | Sector | Modelo | Input tokens | Output tokens | Total tokens | Costo estimado (USD) | Candidatos generados | Costo por candidato | Candidatos aprobables | Costo por aprobable |
|------|------|--------|--------|-------------:|-------------:|-------------:|---------------------:|---------------------:|--------------------:|----------------------:|--------------------:|
| 1 | Colombia | Tecnología | Sonnet 4.6 | 1,500 | 3,600 | 5,100 | $0.0585 | 10 | $0.0059 | 9 | $0.0065 |
| 2 | México | Textil/Manufactura | Sonnet 4.6 | 1,500 | 2,900 | 4,400 | $0.0480 | 8 | $0.0060 | 4 | $0.0120 |
| 3 | Chile | Salud | Sonnet 4.6 | 1,500 | 3,300 | 4,800 | $0.0540 | 10 | $0.0054 | 10 | $0.0054 |

**Totales del laboratorio V0 (3 casos):**

| Métrica | Valor |
|---------|-------|
| Total input tokens (3 casos) | ~4,500 |
| Total output tokens (3 casos) | ~9,800 |
| Total tokens consumidos | ~14,300 |
| Costo total estimado (3 casos) | ~$0.1605 |
| Total candidatos generados | 28 |
| Costo promedio por candidato | ~$0.0057 |
| Total candidatos aprobables | 23 |
| Costo promedio por aprobable | ~$0.0070 |

---

## Eficiencia del prompt

### 1. ¿Cuántos tokens consume el prompt maestro antes de generar candidatos?

El prompt maestro V0 completo consume aproximadamente **1,450 tokens de sistema** antes de procesar el input del usuario. Desglose aproximado:

| Sección del prompt | Tokens estimados |
|--------------------|-----------------|
| ROL + OBJETIVO + restricciones absolutas | ~280 |
| Consulta al catálogo (tabla de fuentes, identificadores, cobertura) | ~420 |
| Input schema + Output schema completo | ~350 |
| Criterios de scoring (3 tablas) | ~200 |
| Notas de honestidad + razonamiento interno | ~200 |
| **Total sistema** | **~1,450** |

La sección del catálogo (fuentes P0 por país, identificadores fiscales, cobertura) es la que más consume del prompt base: **~29% del total**. En producción, esta sección debería ser dinámica (solo el país solicitado), reduciendo el input base a ~1,030 tokens.

### 2. ¿Cuánto crece el output cuando se piden 10 empresas?

Output observado en V0:

| Candidatos generados | Output tokens (estimado) | Tokens por candidato |
|---------------------:|-------------------------:|--------------------:|
| 8 (Caso 2) | ~2,900 | ~290 |
| 10 (Casos 1 y 3) | ~3,450 (promedio) | ~345 |

El output crece aproximadamente **lineal** con el número de candidatos. Cada candidato en formato JSON con todos los campos completos consume ~310–350 tokens. El overhead fijo (batch_summary + quality_control) es aproximadamente ~350 tokens independientemente del número de candidatos.

### 3. ¿Cuál sería la proyección aproximada para 25 empresas?

Basado en la relación observada:

| Parámetro | Estimación |
|-----------|-----------|
| Overhead fijo (batch_summary + quality_control) | ~350 tokens |
| Candidatos × 330 tokens/candidato | ~8,250 tokens |
| **Total output 25 empresas** | **~8,600 tokens** |
| Input (prompt base sin optimizar) | ~1,500 tokens |
| **Total tokens por lote de 25** | **~10,100 tokens** |
| **Costo estimado lote de 25 (Sonnet 4.6)** | **~$0.1335** |
| Costo por candidato | ~$0.0053 |

Comparación por tamaño de lote:

| Lote | Output tokens (est.) | Costo estimado | Costo/candidato |
|-----:|--------------------:|---------------:|----------------:|
| 5 empresas | ~2,000 | $0.0345 | $0.0069 |
| 10 empresas | ~3,650 | $0.0623 | $0.0062 |
| 25 empresas | ~8,600 | $0.1335 | $0.0053 |

**Conclusión:** Los lotes de 25 son más eficientes por candidato (~23% más baratos que lotes de 5). Operar siempre al máximo permitido (25) optimiza el costo por prospecto aprobable.

### 4. ¿Qué parte del prompt consume más tokens?

En el prompt V0, por sección:

| Sección | Tokens est. | % del total | ¿Compactable? |
|---------|------------:|------------:|---------------|
| Catálogo de fuentes (todos los países) | ~420 | 29% | ✅ Sí — enviar solo el país solicitado |
| Output schema completo | ~350 | 24% | ⚠️ Parcial — es necesario para el formato |
| Restricciones absolutas | ~280 | 19% | ⚠️ Parcial — reducir redundancias |
| Criterios de scoring (tablas) | ~200 | 14% | ⚠️ Parcial — solo tabla de confidence_score |
| Honestidad + razonamiento interno | ~200 | 14% | ✅ Sí — condensar a 5 reglas |
| **Total** | **~1,450** | 100% | |

En el output, por sección:

| Sección | Tokens est. | % del output | ¿Compactable? |
|---------|------------:|-------------:|---------------|
| Candidatos (10 × ~345 tokens) | ~3,450 | 88% | ⚠️ Reducir source_notes |
| batch_summary (limitaciones, notas) | ~270 | 7% | ✅ Sí — max 4 limitaciones |
| quality_control | ~80 | 2% | ✅ Sí |
| overhead JSON | ~100 | 3% | ✗ No — estructura necesaria |

**La sección de candidatos representa el 88% del output.** El margen de compactación está en source_notes y quality_notes, donde el V0 era repetitivo (promedio 3–4 oraciones por candidato donde V1 pide máximo 2).

### 5. ¿Qué se puede compactar sin perder calidad?

| Elemento compactable | Ahorro estimado | Impacto en calidad |
|---------------------|----------------|-------------------|
| Catálogo: enviar solo país solicitado (no los 17 países) | ~280 tokens input | Ninguno |
| source_notes: máximo 2 oraciones (V1 ya lo especifica) | ~30–50 tokens/candidato | Ninguno si se prioriza bien |
| limitations: máximo 4 items | ~60 tokens por lote | Ninguno |
| quality_notes: máximo 3 items | ~40 tokens por lote | Ninguno |
| Notas de honestidad en sistema: condensar a 5 reglas | ~80 tokens input | Ninguno |
| Razonamiento interno: condensar a 9 pasos de una línea (ya en V1) | ~50 tokens input | Ninguno |
| **Ahorro total estimado (input + output)** | **~460–580 tokens/lote** | **Ninguno** |

Con las mejoras de V1, el costo por lote de 10 empresas debería reducirse de **~$0.0585** a **~$0.048**, un ahorro del ~18% por compactación de texto. En producción, añadiendo separación base/dinámico y prompt caching, el ahorro potencial total es del **50–80%** en input tokens.

---

## Recomendaciones de optimización para producción

### R1 — No enviar el catálogo completo en producción

En producción, el agente **no debe recibir el catálogo completo de 17 países** en cada llamada.

El catálogo completo representa ~420 tokens del prompt base (29% del input). Para una ejecución de Colombia/Tecnología, los datos de Brasil, Nicaragua, Paraguay y los otros 13 países son tokens desperdiciados.

**Implementación recomendada:**

```
País + Sector recibidos en input
        ↓
Lookup estático (JSON indexado por país_code + sector)
        ↓
Retorna: fuentes_p0[], fuentes_p1[], identificador_fiscal, cobertura, señales_b2g[]
        ↓
Se inyecta como contexto dinámico al prompt base
```

Alternativa con más de 50 combinaciones país+sector: RAG sobre el catálogo completo con embedding de `{país} {sector}`.

### R2 — Separar prompt en capas base/dinámico/input

La separación reduce input tokens de ~1,500 a ~1,050 por llamada, y habilita prompt caching de Anthropic en la capa base.

```
Capa 1 — Prompt base (cacheable, ~700 tokens)
  ROL, restricciones absolutas, cascada de fuentes (sin datos país),
  criterios de scoring, honestidad, output schema

Capa 2 — Contexto dinámico por país/sector (~200 tokens, variable)
  Fuentes P0/P1 del país solicitado, identificador fiscal, cobertura,
  señales B2G aplicables al sector

Capa 3 — Input de solicitud (~80 tokens)
  JSON del usuario: country, industry, target_count, flags
```

Con **prompt caching activado en la Capa 1**, el costo de esa sección se reduce hasta un 90% en llamadas repetidas (mismo prompt base). El caching es especialmente efectivo si el agente se invoca frecuentemente — en SellUp, con múltiples usuarios haciendo prospección simultánea, la Capa 1 tendrá alta tasa de cache hit.

### R3 — Proyección de costos a escala

Usando el prompt optimizado V1 con separación base/dinámico:

| Escenario | Lotes/mes | Candidatos/mes | Aprobables (75% tasa) | Costo input | Costo output | Costo total/mes |
|-----------|----------:|---------------:|----------------------:|------------:|-------------:|----------------:|
| Early adopter (1 usuario) | 20 | 200 | 150 | $0.006 | $0.54 | ~$0.55 |
| SMB (10 usuarios) | 200 | 2,000 | 1,500 | $0.06 | $5.40 | ~$5.50 |
| Growth (50 usuarios) | 1,000 | 10,000 | 7,500 | $0.30 | $27.00 | ~$27.30 |
| Scale (200 usuarios) | 4,000 | 40,000 | 30,000 | $1.20 | $108.00 | ~$109.20 |

*Asume lotes de 10 empresas, output ~3,650 tokens/lote, input optimizado ~1,050 tokens/lote, Sonnet 4.6.*

**Veredicto de viabilidad económica:** El costo del modelo es marginal en todos los escenarios. A escala de 200 usuarios activos, el costo de Claude representa **~$109/mes** — menos del 1% del revenue esperado si el producto tiene precio mínimo de $50/usuario/mes ($10,000 MRR). El agente es económicamente viable incluso sin optimización de prompt.

### R4 — Instrucción a agregar en producción

La siguiente instrucción debe estar presente en la Capa 1 del prompt base para producción:

```
EFICIENCIA DE OUTPUT

Debes minimizar salida innecesaria:
- No repitas el catálogo completo. Usa solo las fuentes del contexto dinámico recibido.
- source_notes: máximo 2 oraciones por candidato. Prioriza: fuente de origen + si dominio es inferido.
- limitations: máximo 4 items, una oración cada uno.
- quality_notes: máximo 3 items, una oración cada uno.
- No incluyas razonamiento interno en el output.
- El JSON debe estar completo — no omitas candidatos ni campos obligatorios.
```

---

## Evaluación de viabilidad en costos

| Criterio | Resultado |
|----------|-----------|
| ¿El costo por candidato es aceptable (<$0.02)? | ✅ Sí — ~$0.006/candidato |
| ¿El costo por aprobable es aceptable (<$0.05)? | ✅ Sí — ~$0.007/aprobable promedio |
| ¿El modelo es viable a escala de 200 usuarios? | ✅ Sí — ~$109/mes |
| ¿El prompt actual está optimizado para producción? | ⚠️ No — requiere separación base/dinámico |
| ¿Hay ahorro material posible vs V0? | ✅ Sí — 18% solo por compactación; 50–80% con separación y caching |
| ¿Se puede auditar el costo por lote en runtime? | ⚠️ Pendiente — requiere logging de usage.input_tokens + usage.output_tokens en la API |

**Veredicto final:** El agente es **viable en costos para producción**. El costo del modelo no es el riesgo — el riesgo es la calidad de candidatos en sectores/países con cobertura "Baja", que requiere Apollo y duplica el costo por aprobable (Caso 2: $0.012/aprobable vs $0.006 promedio).

---

## Estado de cambios en V1

| Cambio | Implementado en |
|--------|----------------|
| Instrucción de minimizar output innecesario | Prompt V1 — sección EFICIENCIA DE OUTPUT |
| source_notes máximo 2 oraciones | Prompt V1 — output schema |
| limitations máximo 4 items | Prompt V1 — output schema |
| quality_notes máximo 3 items | Prompt V1 — output schema |
| risk_notes máximo 2 items por candidato | Prompt V1 — output schema |
| recommended_next_step máximo 3 oraciones | Prompt V1 — output schema |
| confidence_score mínimo elevado a 60 (era 50) | Prompt V1 — restricciones absolutas |
| Razonamiento interno condensado a 9 pasos de una línea | Prompt V1 — razonamiento interno |
| Separación base/dinámico documentada | Prompt V1 — §SEPARACIÓN BASE/DINÁMICO |
| Tabla de ahorro con caching documentada | Prompt V1 — §SEPARACIÓN BASE/DINÁMICO |

---

*Documento creado: 2026-05-21*  
*No se llamaron APIs reales. No se modificó código. No se hicieron commits.*  
*Tokens reportados: estimados — no provider-reported.*
