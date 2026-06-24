# Perú.3K — Investigación Técnica: Fuentes CIIU / Actividad Económica para RUC 20

**Hito:** Perú.3K  
**Fecha:** 2026-06-24  
**HEAD al inicio:** `31c1829` — chore(agent1): align rich profile dry run and write smoke diagnostics  
**Tipo:** Research-only — sin código productivo, sin Supabase, sin candidatos  
**Depende de:** Perú.3J (snapshot local RUC 20 — 851,883 empresas activas habidas)

---

## 1. Problema

El **Padrón Reducido RUC** de SUNAT (descargado en Perú.3J) contiene exactamente **15 columnas**:

```
RUC | NOMBRE O RAZÓN SOCIAL | ESTADO DEL CONTRIBUYENTE | CONDICIÓN DE DOMICILIO |
UBIGEO | TIPO DE VÍA | NOMBRE DE VÍA | CÓDIGO DE ZONA | TIPO DE ZONA |
NÚMERO | INTERIOR | LOTE | DEPARTAMENTO | MANZANA | KILÓMETRO
```

**NO incluye CIIU ni actividad económica.**

SellUp necesita generar prospectos filtrados por país + sector. Sin CIIU o actividad económica, no es posible segmentar el universo de 851,883 empresas activas habidas por industria (tecnología, retail, salud, educación, financiero, manufactura, etc.).

Este hito investiga fuentes viables para obtener CIIU / actividad económica asociada a RUC Perú.

---

## 2. Corrección de documentación previa

**IMPORTANTE:** Documentación previa en `CATALOGO_FUENTES_PROSPECCION_POR_PAIS_SECTOR.md` afirmaba incorrectamente que el Padrón RUC SUNAT incluye CIIU. Esta investigación confirma que:

- El **Padrón Reducido RUC** (archivo descargable) tiene 15 columnas y **NO incluye CIIU**.
- SUNAT mantiene CIIU en su sistema interno y lo muestra en la consulta web individual (`e-consultaruc.sunat.gob.pe`) pero **no lo exporta en el archivo de descarga masiva pública**.
- No existe un "Padrón Completo" diferenciado descargable públicamente que incluya CIIU.

Esta corrección está aplicada en la sección Perú del CATALOGO (ver §8 más abajo).

---

## 3. Fuentes investigadas

### 3.1 SUNAT — Padrón Reducido RUC (descarga directa o vía datosabiertos.gob.pe)

```
name: SUNAT Padrón Reducido RUC
owner: SUNAT
url: http://www.sunat.gob.pe/descargaPRR/mrc137_padron_reducido.html
     https://datosabiertos.gob.pe/dataset/padrón-ruc-sunat
accessMode: public_download
requiresCredentials: false
format: ZIP/TXT (pipe-separated)
estimatedSize: ~388 MB comprimido / ~1.8 GB descomprimido
containsRuc: true
containsCiiu: false — CONFIRMADO (Perú.3J + verificación directa de columnas)
containsActivityDescription: false
containsCompanyStatus: true
containsAddressOrUbigeo: true (ubigeo, pero mayoría de filas en blanco)
updateFrequency: daily (aprox.)
technicalViability: high
legalOperationalRisk: low
recommendedUse: discovery / validation de existencia
limitations: Sin CIIU. Sin actividad económica. Sin contacto. Columnas de dirección mayormente vacías.
verdict: USE_AS_REFERENCE_ONLY (para CIIU — sigue siendo la BASE para RUC + razón social + estado)
```

**Nota sobre datosabiertos.gob.pe:** La descripción del dataset en el portal dice "datos de identificación de actividades económicas", pero el archivo físico publicado es el mismo Padrón Reducido re-publicado mensualmente. Hay evidencia fuerte de que NO agrega columnas CIIU. Se recomienda spike de verificación si se duda.

---

### 3.2 SUNAT — Consulta Web Individual (e-consultaruc)

```
name: SUNAT e-consultaruc — consulta individual web
owner: SUNAT
url: https://e-consultaruc.sunat.gob.pe/cl-ti-itmrconsruc/frameCriterioBusqueda.jsp
accessMode: web_manual (con captcha reCAPTCHA)
requiresCredentials: false
format: HTML (sin API JSON oficial)
estimatedSize: N/A — consulta individual
containsRuc: true
containsCiiu: true (CIIU Rev 3 y Rev 4 — código + descripción principal y secundaria)
containsActivityDescription: true
containsCompanyStatus: true
containsAddressOrUbigeo: true
updateFrequency: real-time
technicalViability: low (captcha bloquea automatización)
legalOperationalRisk: high (scraping bloqueado por captcha, riesgo de ToS)
recommendedUse: reference / validación manual puntual
limitations: Captcha visual impide automatización masiva. No hay API JSON oficial. No sirve para discovery ni enriquecimiento masivo.
verdict: REJECT (como fuente masiva) / USE_AS_REFERENCE_ONLY (validación individual manual)
```

**Hallazgo:** SUNAT sí tiene CIIU en su sistema interno y lo muestra en la consulta web, pero deliberadamente lo excluye del Padrón Reducido descargable. No existe ninguna vía oficial gratuita de acceso masivo al CIIU de SUNAT.

---

### 3.3 INEI — Catálogo CIIU Revisión 4

```
name: INEI CIIU Rev4 — Catálogo oficial de actividades económicas
owner: INEI
url: https://proyectos.inei.gob.pe/CIIU/
    PDF notas explicativas: MEF
    Excel SUNAT: orientacion.sunat.gob.pe/sites/default/files/inline-files/TablaOficialCIIURev4.xls
accessMode: public_download
requiresCredentials: false
format: Web / PDF / Excel (.xls)
estimatedSize: pequeño (~700 códigos)
containsRuc: false
containsCiiu: true (catálogo completo: código, descripción, sección, división, grupo, clase)
containsActivityDescription: true
containsCompanyStatus: false
containsAddressOrUbigeo: false
updateFrequency: static
technicalViability: high
legalOperationalRisk: low
recommendedUse: reference — tabla de decodificación para usar junto a otras fuentes
limitations: No relaciona CIIU con RUC. Solo es el catálogo de códigos.
verdict: USE_AS_REFERENCE_ONLY
```

---

### 3.4 PRODUCE — Directorio de Grandes Empresas del Sector Manufactura

```
name: PRODUCE — Directorio Grandes Empresas Manufactura
owner: Ministerio de la Producción (PRODUCE)
url: https://www.datosabiertos.gob.pe/dataset/directorio-de-grandes-empresas-del-sector-manufactura-ministerio-de-la-producción-produce
accessMode: public_download
requiresCredentials: false
format: Excel / CSV
estimatedSize: pequeño (solo grandes empresas)
containsRuc: true
containsCiiu: true (CONFIRMADO — código + descripción CIIU)
containsActivityDescription: true
containsCompanyStatus: unknown (probable)
containsAddressOrUbigeo: true (departamento/provincia/distrito)
updateFrequency: annual
technicalViability: high
legalOperationalRisk: low
recommendedUse: enrichment sectorial (manufactura, grandes empresas)
limitations: Solo "grandes empresas" manufactureras. Excluye MiPymes, servicios, comercio, agro, etc. Cobertura muy parcial.
verdict: USE_AS_REFERENCE_ONLY (cobertura insuficiente como fuente principal de CIIU)
```

---

### 3.5 PRODUCE — Directorio de Empresas MiPyme por Sector Productivo ⭐ NUEVO

```
name: PRODUCE — Directorio MiPyme por Sector Productivo
owner: Ministerio de la Producción (PRODUCE)
url: https://www.datosabiertos.gob.pe/dataset/directorio-de-empresas-mipyme-por-sector-productivo-ministerio-de-la-producción-produce
accessMode: public_download
requiresCredentials: false
format: Excel / CSV
estimatedSize: mediano (MiPymes formales acreditadas con RUC)
containsRuc: true (confirmado — empresas acreditadas por SUNAT con RUC)
containsCiiu: true (CONFIRMADO — campo CIIU incluido)
containsActivityDescription: true
containsCompanyStatus: unknown
containsAddressOrUbigeo: true (ubigeo)
updateFrequency: annual
technicalViability: high
legalOperationalRisk: low
recommendedUse: enrichment sectorial — fuente oficial más prometedora para CIIU masivo
limitations: Solo MiPymes formales (no grandes empresas). Sectores: Manufactura, Comercio, Servicios (no agro/minería directamente). Datos anuales — posible desfase. Cobertura no verificada aún.
verdict: SPIKE_LOCAL_FIRST — la fuente oficial más prometedora para CIIU masivo + RUC
```

**Por qué es la fuente más prometedora:**
- Fuente oficial gratuita (gob.pe / PRODUCE)
- Relaciona RUC + CIIU en un archivo descargable
- Cubre MiPymes en múltiples sectores (Manufactura, Comercio, Servicios)
- Sin credenciales
- Cruzable con el snapshot Perú.3J por RUC
- Cobertura potencialmente alta: las MiPymes formales son la mayoría del universo B2B de SellUp

**Pendiente de verificar:** Número exacto de registros, columnas exactas, actualización más reciente, y % de match con las 851,883 empresas activas habidas del Padrón RUC.

---

### 3.6 PRODUCE — Dataset "Número de Trabajadores por CIIU"

```
name: Dataset trabajadores sector privado por CIIU (PRODUCE / MTPE)
owner: PRODUCE / MTPE
url: datosabiertos.gob.pe (disponible en portal)
accessMode: public_download
requiresCredentials: false
format: Excel / CSV
containsRuc: false (datos agregados por sector, no por empresa individual)
containsCiiu: true (CIIU como eje de clasificación)
containsActivityDescription: true
containsCompanyStatus: false
technicalViability: low (no sirve para lookup por RUC)
legalOperationalRisk: low
recommendedUse: reference — catálogo CIIU y jerarquía de sectores
verdict: USE_AS_REFERENCE_ONLY
```

---

### 3.7 Migo API (api.migo.pe) — Evaluado en Perú.3M

```
name: Migo API — Actividades Económicas RUC
owner: Migo S.A.C. (privado peruano)
url: https://api.migo.pe / https://docs.migo.pe/ruc/actividades-economicas
accessMode: private_api
requiresCredentials: true (Bearer token — MIGO_API_KEY, solo variable de entorno)
format: JSON
containsRuc: true
containsCiiu: true ✅ CONFIRMADO — CIIU Rev 3 y Rev 4, descripción principal y secundaria
containsActivityDescription: true
containsCompanyStatus: true (estado tributario + condición domicilio)
containsAddressOrUbigeo: true
containsRepresentantesLegales: true (⚠️ NO persistir — datos personales / Ley 29733)
updateFrequency: real-time (sincronización con SUNAT)
technicalViability: high
legalOperationalRisk: medium (ToS no revisados formalmente para IA/agentes)
endpointIndividual: GET /api/v1/ruc/{ruc}
endpointBatch: sí — confirmado; tamaño máximo pendiente de spike
recommendedUse: enrichment_provider — enriquece RUCs conocidos con CIIU. NO discovery.
limitations:
  - Requiere pago (Demo gratis: 700q/7d)
  - Planes: Básico S/15/mes (40K) → Empresa S/25/mes (80K) → Premium S/25/mes (150K)
  - Rate limit no documentado públicamente — confirmar con trial
  - ToS para uso en agentes automáticos no revisados — revisar antes de integración productiva
  - NO genera empresas nuevas: solo enriquece RUCs ya identificados
verdict: SPIKE_WITH_TEST_KEY — mejor candidato privado para CIIU masivo Perú.
         PRODUCE bloqueado por WAF → Migo es la única fuente CIIU operable confirmada.
         Pendiente: trial key + spike técnico + revisión ToS.
arquitectura: enrichment_provider (worker/job, NO Vercel serverless)
datosAGuardar: ciiu_codigo, ciiu_descripcion, sector_sellup, estado, condicion, ubigeo, migo_enriched_at
datosNOGuardar: representantes_legales, DNI, datos personales (Ley N° 29733 Perú)
estrategiaMVP: Opción A — SUNAT Padrón RUC (base legal) + Migo API (CIIU bajo demanda)
```

---

### 3.8 ApiDni.com

```
name: ApiDni.com — Consulta RUC con CIIU
owner: ApiDni (privado)
url: https://apidni.com / https://apidni.com/docs/
accessMode: private_api
requiresCredentials: true (token Bearer)
format: JSON (campo "ciiu" como array: "Principal - [desc]", "Secundaria N - [desc]")
containsRuc: true
containsCiiu: true ✅ CONFIRMADO
containsActivityDescription: true
containsCompanyStatus: true
containsAddressOrUbigeo: true
updateFrequency: real-time
technicalViability: high
legalOperationalRisk: low
recommendedUse: enrichment
limitations: Precio no publicado (requiere registro/contacto). Datos adicionales ricos: representantes legales, número de trabajadores, deuda coactiva.
verdict: PRIVATE_PROVIDER_ONLY — segunda opción privada confirmada, pero precio opaco
```

---

### 3.9 ApiPeru.dev (apiperu.dev)

```
name: ApiPeru.dev — Consulta RUC
owner: ApiPeru.dev (privado)
url: https://apiperu.dev / https://docs.apiperu.dev/enpoints/consulta-ruc
containsRuc: true
containsCiiu: false ❌ CONFIRMADO — 14 campos documentados, ninguno es CIIU
containsActivityDescription: false
technicalViability: medium
recommendedUse: validation básica (estado tributario)
verdict: REJECT para caso de uso CIIU
```

---

### 3.10 PeruAPI.com (peruapi.com)

```
name: PeruAPI.com — Consulta RUC
owner: PeruAPI (privado)
url: https://peruapi.com
containsRuc: true
containsCiiu: false ❌ CONFIRMADO — no menciona CIIU en campos documentados
containsActivityDescription: false
technicalViability: medium
recommendedUse: validation básica
verdict: REJECT para caso de uso CIIU
```

---

### 3.11 JSON.pe

```
name: JSON.pe — Consulta RUC
owner: JSON.pe (privado)
url: https://json.pe / https://docs.json.pe/api-consulta/endpoint/ruc
containsRuc: true
containsCiiu: false ❌ CONFIRMADO — 14 campos exactos documentados, sin CIIU
containsActivityDescription: false
technicalViability: medium
recommendedUse: validation básica
verdict: REJECT para caso de uso CIIU
```

---

### 3.12 Latinfo (latinfo.dev)

```
name: Latinfo — Tax Registry & KYB API Latin America
owner: Latinfo (privado, internacional)
url: https://latinfo.dev
accessMode: private_api
requiresCredentials: true (plan gratuito permanente disponible: 1,000 créditos/mes)
format: JSON / REST
containsRuc: true
containsCiiu: unknown — no confirmado si incluye CIIU específicamente
containsActivityDescription: unknown
containsCompanyStatus: true (estado SUNAT, sanciones OSCE, procesos coactivos, SEACE)
containsAddressOrUbigeo: true
updateFrequency: unknown
technicalViability: medium
legalOperationalRisk: low
recommendedUse: enrichment (sanciones, OSCE, compras públicas — más que CIIU)
limitations: No se confirmó CIIU. Es un proveedor multi-país lo que puede implicar menor profundidad en campos SUNAT específicos. Tier gratuito generoso.
verdict: UNKNOWN_NEEDS_MANUAL_REVIEW (para CIIU) / USE_AS_REFERENCE_ONLY (para señales KYB)
```

---

### 3.13 OpenRUC (openruc.com)

```
name: OpenRUC
owner: Latinfo (proyecto open source)
url: https://openruc.com (no verificado)
accessMode: unknown
containsRuc: unknown
containsCiiu: unknown
technicalViability: unknown
verdict: UNKNOWN_NEEDS_MANUAL_REVIEW
```

**Nota:** OpenRUC es un proyecto open source de Latinfo. No se encontró información suficiente sobre si incluye CIIU.

---

### 3.14 Apis.net.pe / DeColecta

```
name: Apis.net.pe — DeColecta
owner: DeColecta (privado individual)
url: https://apis.net.pe / https://api.decolecta.com/v1/sunat/ruc
containsRuc: true
containsCiiu: unknown (documentación pública no detalla campos de respuesta)
technicalViability: medium
legalOperationalRisk: medium-high (proveedor individual, descontinuó servicio DNI por normativa)
verdict: UNKNOWN_NEEDS_MANUAL_REVIEW / REJECT (proveedor individual sin garantías)
```

---

## 4. Tabla comparativa completa

| # | Fuente | RUC | CIIU | Acceso | Cred. | Viabilidad | Riesgo | Verdict |
|---|--------|-----|------|--------|-------|-----------|--------|---------|
| 1 | SUNAT Padrón Reducido | ✅ | ❌ | Descarga pública | No | Alta | Bajo | USE_AS_REFERENCE_ONLY |
| 2 | SUNAT datosabiertos.gob.pe (Padrón) | ✅ | ❓ | Descarga pública | No | Media | Bajo | SPIKE_LOCAL_FIRST |
| 3 | SUNAT e-consultaruc web | ✅ | ✅ | Web manual + captcha | No | Baja | Alto | REJECT (masivo) |
| 4 | INEI Catálogo CIIU Rev4 | ❌ | ✅ | Descarga pública | No | Alta | Bajo | USE_AS_REFERENCE_ONLY |
| 5 | PRODUCE Grandes Empresas Manufactura | ✅ | ✅ | Descarga pública | No | Alta | Bajo | USE_AS_REFERENCE_ONLY |
| **6** | **PRODUCE MiPyme por Sector** ⭐ | **✅** | **✅** | **Descarga pública** | **No** | **Alta** | **Bajo** | **SPIKE_LOCAL_FIRST** |
| 7 | Dataset Trabajadores por CIIU | ❌ | ✅ | Descarga pública | No | Baja | Bajo | USE_AS_REFERENCE_ONLY |
| **8** | **Migo API** ⭐ | **✅** | **✅ conf.** | **API privada** | **Sí (pago)** | **Alta** | **Bajo** | **PRIVATE_PROVIDER_ONLY** |
| 9 | ApiDni.com | ✅ | ✅ conf. | API privada | Sí | Alta | Bajo | PRIVATE_PROVIDER_ONLY |
| 10 | Apis.net.pe / DeColecta | ✅ | ❓ | API privada | Sí | Media | Medio-Alto | UNKNOWN |
| 11 | ApiPeru.dev | ✅ | ❌ conf. | API privada | Sí | Media | Bajo | REJECT |
| 12 | PeruAPI.com | ✅ | ❌ conf. | API privada | Sí | Media | Bajo | REJECT |
| 13 | JSON.pe | ✅ | ❌ conf. | API privada | Sí | Media | Bajo | REJECT |
| 14 | Latinfo | ✅ | ❓ | API privada (free tier) | Sí | Media | Bajo | UNKNOWN |
| 15 | OpenRUC | ❓ | ❓ | Desconocido | ? | Desconocido | ? | UNKNOWN |

---

## 5. Respuestas a las preguntas del hito

**1. ¿Existe una fuente oficial SUNAT descargable que relacione RUC con actividad económica / CIIU?**
No en el Padrón Reducido. SUNAT tiene CIIU internamente pero no lo exporta en el archivo masivo público. No se encontró evidencia de un "Padrón Completo" diferente descargable con CIIU. La fuente oficial más prometedora es PRODUCE MiPyme por Sector Productivo (§3.5), no SUNAT directamente.

**2. ¿Está disponible vía ZIP, TXT, CSV, Excel, API, portal o dataset?**
PRODUCE MiPyme: sí, CSV/Excel descargable en datosabiertos.gob.pe. SUNAT Padrón Reducido: ZIP/TXT sin CIIU. Migo API: API REST con token.

**3. ¿Es pública y usable sin credenciales?**
PRODUCE MiPyme: sí, descarga gratuita sin credenciales. SUNAT: sí pero sin CIIU. APIs privadas: no, requieren credenciales (y pago).

**4. ¿Tiene RUC como llave cruzable con el snapshot RUC 20?**
PRODUCE MiPyme: sí (RUC de empresas acreditadas por SUNAT). Migo API: sí (consulta individual/batch por RUC). El cruce es posible usando RUC como llave.

**5. ¿Incluye actividad económica principal?**
PRODUCE MiPyme: sí (confirmado). Migo API: sí (CIIU principal y secundarias). SUNAT Padrón Reducido: no.

**6. ¿Incluye CIIU código y/o descripción?**
PRODUCE MiPyme: confirmado con campo CIIU. Migo API: CIIU Rev 3 y Rev 4 con descripción principal y secundaria. SUNAT Padrón Reducido: no.

**7. ¿Cuál es su tamaño aproximado?**
PRODUCE MiPyme: tamaño no verificado aún (requiere spike). SUNAT Padrón Reducido: ~388 MB comprimido / ~1.8 GB descomprimido (ya tenemos el archivo). Migo API: no aplica (consulta por demanda).

**8. ¿Se puede procesar local/offline como el padrón reducido?**
PRODUCE MiPyme: sí, es un archivo descargable. SUNAT Padrón Reducido: ya procesado. Migo API: no, requiere conexión.

**9. ¿Tiene restricciones técnicas, legales o de acceso?**
PRODUCE MiPyme: datos abiertos, sin restricciones legales conocidas. SUNAT Padrón Reducido: datos públicos tributarios, sin restricciones. Migo API: proveedor privado, términos no revisados para uso en IA/agentes.

**10. ¿Es viable para el MVP de SellUp o debe quedar como post-MVP?**
PRODUCE MiPyme: viable para MVP si el spike confirma cobertura suficiente. Migo API: viable como fallback (post-MVP o MVP si cobertura PRODUCE es insuficiente). Estrategia híbrida recomendada.

**11. ¿Permite filtrar sectores como tecnología, retail, salud, educación, financiero, manufactura, etc.?**
CIIU Rev 4 (que PRODUCE y Migo API usan) permite filtrar por: manufactura (sección C), comercio/retail (sección G), información/TIC (sección J), servicios financieros (sección K), educación (sección P), salud (sección Q), etc. Con el catálogo INEI CIIU Rev 4 (§3.3) se puede construir un mapa CIIU → sector SellUp.

**12. Estrategia recomendada:**
Ver §6.

---

## 6. Estrategia recomendada para SellUp

### Decisión: Híbrida — SPIKE primero, luego complementar con API privada

#### Paso 1 — Spike PRODUCE MiPyme (prioridad urgente, ~30-60 min de ejecución)

**Alcance del spike:**
- Descargar el archivo "Directorio de Empresas MiPyme por Sector Productivo" desde datosabiertos.gob.pe
- Verificar columnas exactas (¿incluye RUC, CIIU código, CIIU descripción, sector?)
- Contar registros totales
- Cruzar RUC vs snapshot Perú.3J (851,883 empresas activas habidas)
- Calcular % de match y distribución por CIIU

**Este spike se ejecutará en hito Perú.3L (o nombre que se asigne).**

#### Paso 2 — Decisión basada en spike

**Si cobertura ≥ 60% del snapshot Perú.3J:**
→ PRODUCE MiPyme como fuente principal CIIU (gratuita, oficial)  
→ Migo API o ApiDni.com como fallback para RUCs sin match en PRODUCE  
→ Costo estimado: S/15-25/mes (Migo API, solo para el gap)

**Si cobertura < 60%:**
→ Migo API como fuente principal de CIIU (consulta batch masiva)  
→ PRODUCE MiPyme como referencia complementaria  
→ Costo estimado: S/25/mes (80K consultas = suficiente para primer lote)

#### Paso 3 — Mapa CIIU → Sector SellUp

Independientemente de la fuente, construir tabla de mapeo:

| CIIU Sección | Nombre estándar | Sector SellUp |
|---|---|---|
| J (6100-6399) | Información y Comunicación | Tecnología / TIC |
| G (4511-4799) | Comercio al por menor | Retail |
| Q (8600-8899) | Salud humana | Salud |
| P (8500-8599) | Educación | Educación |
| K (6400-6630) | Servicios financieros | Financiero |
| C (1000-3399) | Manufactura | Manufactura |
| F (4100-4399) | Construcción | Construcción |
| H (4900-5399) | Transporte y almacenamiento | Logística |
| I (5500-5699) | Alojamiento y comidas | Hospitality |
| M (6900-7599) | Actividades profesionales | Servicios profesionales |

---

## 7. Tabla de decisión por fuente

| Fuente | Decisión MVP | Justificación |
|--------|-------------|---------------|
| SUNAT Padrón Reducido | Base de RUC + estado (sin CIIU) | Sigue siendo el backbone del MVP |
| PRODUCE MiPyme por Sector | **SPIKE_LOCAL_FIRST** → MVP si cobertura OK | Fuente oficial gratuita con CIIU + RUC |
| PRODUCE Grandes Empresas Manufactura | USE_AS_REFERENCE_ONLY | Cobertura demasiado parcial |
| INEI Catálogo CIIU Rev4 | USE_AS_REFERENCE_ONLY | Solo tabla de decodificación |
| Migo API | **PRIVATE_PROVIDER_ONLY** — fallback o secundario | Mejor API privada confirmada con CIIU |
| ApiDni.com | POST_MVP — evaluar si precio es competitivo | Segunda opción privada confirmada |
| SUNAT e-consultaruc | REJECT (masivo) | Captcha, no automatizable |
| ApiPeru.dev, PeruAPI.com, JSON.pe | REJECT | No incluyen CIIU (confirmado) |
| Latinfo | UNKNOWN — evaluar para KYB/sanciones, no CIIU | CIIU no confirmado |
| OpenRUC | UNKNOWN | Información insuficiente |

---

## 8. Archivos modificados en Perú.3K

| Archivo | Cambio |
|---|---|
| `docs/PERU_SUNAT_CIIU_SOURCE_RESEARCH.md` | **Creado** — este documento |
| `AUDITORIA-FUENTES-IA.md` | **Actualizado** — sección Perú.3K agregada |
| `docs/CATALOGO_FUENTES_PROSPECCION_POR_PAIS_SECTOR.md` | **Corregido** — eliminada afirmación incorrecta de CIIU en Padrón Reducido; agregado PRODUCE MiPyme |

---

## 9. Confirmaciones de seguridad operativa

| Confirmación | Estado |
|---|---|
| PE sigue `SAFE_CONNECTOR_ONLY` | ✅ |
| `pe_sunat_bulk` sigue `not_connected` | ✅ |
| PE sigue fuera de `source-discovery-preflight` | ✅ |
| `pe_sunat_bulk` sigue fuera de `SOURCE_DISCOVERY_REGISTRY` | ✅ |
| No se descargó archivo grande nuevo | ✅ |
| No se creó snapshot CIIU | ✅ |
| No se escribió Supabase | ✅ |
| No se crearon candidatos | ✅ |
| No se creó batch | ✅ |
| No se tocó INAPI | ✅ |
| No se tocó Chile / México / Colombia | ✅ |
| No se hizo force push | ✅ |
| No se creó código productivo | ✅ |
| No se instalaron dependencias | ✅ |

---

## 10. Siguiente hito recomendado

**Perú.3L — Spike local: PRODUCE MiPyme por Sector Productivo**

Alcance:
1. Descargar "Directorio de Empresas MiPyme por Sector Productivo" desde datosabiertos.gob.pe
2. Verificar columnas exactas (especialmente: RUC, CIIU código, CIIU descripción)
3. Contar registros totales
4. Cruzar por RUC con snapshot `.tmp/sunat-peru/ruc20-filtered-snapshot.txt` (Perú.3J)
5. Calcular % de match, distribución por CIIU / sector
6. Generar reporte de calidad en `.tmp/sunat-peru/produce-mipyme-ciiu-report.json`
7. **NO escribir Supabase. NO crear candidatos. NO activar preflight/registry/wizard.**

Autorizar explícitamente este spike antes de ejecutar.
