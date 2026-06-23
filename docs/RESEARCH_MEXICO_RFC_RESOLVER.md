# México RFC Resolver — Investigación Técnica

**Fecha:** 2026-06-22
**Autor:** Investigación técnica para Agente 1 SellUp
**Propósito:** Validar si existe fuente pública, legalmente usable o técnicamente viable para resolver RFC de empresas mexicanas a partir de nombre, razón social, dominio o indicios.

---

## Resumen Ejecutivo

**No existe fuente pública oficial ni gratuita que permita resolver nombre/razón social → RFC de forma automática en México.** El SAT solo ofrece validación RFC→datos (no inversa). DENUE no contiene RFC. datos.gob.mx no publica el padrón de contribuyentes. Las APIs comerciales de terceros requieren el RFC como entrada.

**Decisión final: México debe operar con revisión humana obligatoria de RFC en MVP.** El flujo propuesto es:

1. DENUE como identity resolver (nombre → datos de establecimiento)
2. Señal de enrichment con datos DENUE (ubicación, giro, tamaño)
3. Flag `human_review_required` para RFC
4. Una vez que humano provee RFC, validación contra SAT para confirmar y hacer enrichment fiscal

**Camino recomendado: B — `resolveCandidateTaxIdentifierForMexico` debe retornar `not_resolvable_automatically` + `human_review_required`.**

> **Excepción:** Si se integra un proveedor comercial como Infodata Mexico, el escenario cambia a semiautomático (Camino B+). Esto debe evaluarse para post-MVP.

---

## Fuentes Investigadas

### 1. SAT (Servicio de Administración Tributaria)

**Clasificación: D — No viable para name→RFC**

| Atributo | Valor |
|----------|-------|
| API pública name→RFC | **NO existe** |
| API pública RFC→datos | Sí, pero requiere RFC como entrada y resuelve captcha |
| Búsqueda por razón social | **NO disponible** |
| Búsqueda por CURP | Solo para personas físicas |
| Validación masiva | Hasta 5,000 registros, pero requiere RFC + nombre + CP (no descubre RFC) |
| Restricciones | Captcha por consulta, rate limiting, ToS probablemente prohíbe scraping |

**Herramientas del SAT:**
- **Validador RFC** (`agsc.siat.sat.gob.mx/PTSC/ValidaRFC`): Requiere RFC, solo confirma si existe y está activo
- **Verifica si estás registrado en el RFC** (`sat.mx/aplicacion/29073`): Requiere RFC o CURP
- **Validación avanzada CFDI 4.0**: Requiere RFC + nombre + CP, confirma match (no descubre)
- **Portal Ciudadano**: Requiere autenticación (contraseña o e.firma) del contribuyente

**Comerciales que usan SAT:**
- **Syntage/Satws**: API que requiere credenciales CIEC/e.firma del contribuyente (no sirve para discovery)
- **Satpi.mx**: RFC → datos fiscales ($1.30-$1.70/consulta), no resuelve name→RFC
- **Círculo de Crédito**: API SAT Personas Morales (comercial, RFC→datos)
- **CRiskCo**: Validación RFC + análisis fiscal (RFC→datos)
- **Box Factura SAT+**: Extensión navegador, buscador de razón social por RFC (no por nombre)

**Evidencia:** La interfaz del SAT siempre requiere RFC o CURP como entrada. No existe endpoint público que acepte nombre o razón social y devuelva RFC.

---

### 2. DENUE / INEGI

**Clasificación: C — Útil como señal, no como resolver RFC**

| Atributo | Valor |
|----------|-------|
| Entrega RFC | **NO** |
| Datos disponibles | Nombre establecimiento, razón social, actividad SCIAN, empleados, ubicación, teléfono, email, sitio web |
| Búsqueda por nombre | Sí |
| API pública | Sí (`inegi.org.mx/servicios/api_denue.html`) |
| Descarga masiva | Sí (CSV, ~6 millones de establecimientos) |
| Actualización | Anual (datos más recientes: Censos Económicos 2024) |
| Licencia | CC-BY-4.0, uso público permitido |
| Costo | Gratuito |

**Campos del DENUE (confirmados del esquema):**
```
Id, Nom_Estab, Raz_Social, Codigo_Act, Nombre_Act, Per_Ocu,
Tipo_Vial, Nom_Vial, Numero_Ext, Letra_Ext, Edificio,
Tipo_Asent, Nomb_Asent, CP, Email, Telefono, Website
```

**NO incluye:** RFC, CURP, régimen fiscal, situación fiscal.

**Utilidad para SellUp:**
- Identity resolver potente: nombre + razón social + dirección + actividad económica
- Puede servir para pre-enrichment antes de revisión humana
- Permite confirmar que la empresa existe y está activa
- No resuelve RFC, pero reduce fricción en revisión humana (muestra datos de contexto)

---

### 3. SIEM (Sistema de Información Empresarial Mexicano)

**Clasificación: C-D — Información limitada, acceso no automatizable**

| Atributo | Valor |
|----------|-------|
| Contiene RFC | Sí (es requisito obligatorio para registro) |
| Búsqueda por nombre | Probablemente sí (directorio empresarial) |
| API pública | **No detectada** |
| Descarga masiva | No |
| Acceso | Web pública (`siem.gob.mx`), pero limitada |
| Costo | Registro pagado (~$2,500 MXN vía cámaras) |
| Cobertura | ~700,000+ empresas registradas |

**Hallazgos:**
- El SIEM es obligatorio para empresas de comercio, servicios, turismo e industria
- La inscripción requiere RFC como dato obligatorio
- La plataforma SIEM Digital permite consulta de empresas
- **No se encontró evidencia de API pública o bulk data access**
- Las cámaras empresariales (CANACO, CANACINTRA) gestionan el registro
- Es un directorio promocional, no un servicio de verificación fiscal

**No recomendado** como fuente para resolver automático. Demasiada fricción y sin API.

---

### 4. CompraNet / Compras MX

**Clasificación: C — Útil como señal B2G, no como resolver general**

| Atributo | Valor |
|----------|-------|
| Contiene RFC | Sí (es identificador principal de proveedores) |
| Búsqueda por nombre | Sí (proveedores, contratos) |
| API/datos abiertos | Sí (`comprasmx.buengobierno.gob.mx/datos-abiertos`) |
| Cobertura | Solo proveedores del gobierno federal (~230,000+ procedimientos desde 2023) |
| Actualización | Continua |
| Costo | Gratuito |

**Hallazgos:**
- El Registro Único de Proveedores y Contratistas (RUPC) incluye RFC + razón social
- Datos abiertos disponibles desde 2013
- Compras MX reemplazó a CompraNet en 2023
- **Limitación crítica:** Solo empresas que contratan con el gobierno federal. No cubre el universo empresarial mexicano completo

**Utilidad limitada** como resolver de RFC universal. Puede servir para enrichment cuando el candidato es proveedor gubernamental.

---

### 5. datos.gob.mx

**Clasificación: D — No hay dataset útil para RFC empresarial**

| Dataset | Utilidad |
|---------|----------|
| Padrón de contribuyentes | Solo estadísticas agregadas (conteos por régimen/estado). **NO** incluye datos individuales |
| Padrón donatarias autorizadas | Solo organizaciones autorizadas para donativos deducibles. Incluye RFC pero es un subconjunto mínimo |
| Padrón de importadores/exportadores | Listados de contribuyentes activos/suspendidos. Nicho específico |
| Padrón de proveedores (CDMX) | Incluye RFC + razón social, pero es una dependencia específica |

**El SAT no publica el padrón completo de contribuyentes como datos abiertos.** Esto está protegido por secreto fiscal (Artículo 69 del CFF).

---

### 6. Cámaras / Asociaciones Empresariales

**Clasificación: D — No viables como fuente**

| Entidad | Utilidad |
|---------|----------|
| CANACO | Gestiona SIEM, no publica RFC directamente |
| CANACINTRA | Similar, no expone RFC públicamente |
| AMITI (Tecnología) | Asociación sectorial, no publica RFC |
| Cámaras de Comercio | Directorios públicos con datos comerciales, no fiscales |

Sin utilidad directa para resolver RFC.

---

### 7. Proveedores Comerciales

**Clasificación: E — Opción post-MVP si se evalúa ROI**

| Proveedor | RFC en datos | Name→RFC | Cobertura MX | Costo |
|-----------|-------------|----------|-------------|-------|
| **Infodata Mexico** | Sí (RFC-sourced) | Sí | 2M+ empresas | Comercial |
| **D&B Mexico** | Probable | Sí (DUNS) | Global con foco MX | $$$ |
| **Kompass Mexico** | No confirmado | Sí | 300K+ empresas | Comercial |
| **Apollo.io** | No confirmado para MX | Limitado | Global, MX débil | $$$ |
| **Lusha** | No confirmado | Limitado | Global, MX débil | $$ |
| **Clearbit** | No confirmado | Limitado | Global, MX débil | $$$ |
| **Bureau van Dijk (Orbis)** | No confirmado | Sí | 800K+ MX (financial depth) | $$$$ |
| **Signzy** | Solo validación RFC→datos | No | MX (conexión SAT) | Comercial |

**Recomendación:** Infodata Mexico es el candidato más prometedor por ser un proveedor doméstico con 2M+ registros y mencionar explícitamente "RFC-based company identification". Evaluar para post-MVP.

---

## Restricciones Legales

- **RFC de personas morales**: Es información fiscal/comercial, no dato personal protegido por LFPDPPP. Su uso para verificación comercial es legal.
- **RFC de personas físicas**: Es dato personal protegido por la nueva LFPDPPP 2025. Requiere consentimiento del titular.
- **Secreto fiscal (CFF Artículo 69)**: El SAT no puede divulgar información individual de contribuyentes. Por eso no existe padrón público.
- **Lo que SAT sí publica**: Listas de contribuyentes incumplidos (Art. 69-B), donatarias autorizadas, importadores/exportadores, EFOS.
- **Scraping del SAT**: Violaría términos de servicio. Además hay captchas y rate limiting.

**Conclusión legal:** Usar DENUE (open data) y validación SAT de un RFC ya conocido es legal. Intentar descubrir RFC de un nombre mediante scraping del SAT no lo es.

---

## Tabla de Clasificación Final

| Fuente | Tipo | Entrega RFC | Búsqueda por nombre | Acceso/API | Restricciones | Clasif. | Recomendación |
|--------|------|-------------|---------------------|-----------|--------------|---------|---------------|
| SAT | Gobierno | Sí (RFC→datos) | **No** | Web con captcha | ToS, captcha, secreto fiscal | **D** | No viable para name→RFC |
| DENUE/INEGI | Gobierno | **No** | Sí | API pública + bulk | CC-BY-4.0 | **C** | Identity resolver + enrichment |
| SIEM | Gobierno | Sí (interno) | No verificable | Web sin API | Pago, sin bulk | **C-D** | No recomendado |
| CompraNet | Gobierno | Sí | Sí | Open data | Solo B2G | **C** | Señal complementaria |
| datos.gob.mx | Gobierno | **No** | N/A | Open data | Sin dataset útil | **D** | No usable |
| Cámaras | Privado | No público | Parcial | Directorios web | Datos comerciales | **D** | No viable |
| Infodata MX | Comercial | Sí | Sí | API privada | Pago | **E** | Evaluar post-MVP |
| D&B | Comercial | Probable | Sí | API privada | $$$ | **E** | Opción post-MVP |
| Apollo/Lusha | Comercial | No confirmado | Limitado | API privada | MX coverage débil | **D-E** | Descartar |

---

## Decisión Final

### México No Puede Tener Resolver Automático de RFC en MVP

**No existe fuente pública que permita resolver nombre/razón social → RFC.** Todas las fuentes oficiales requieren el RFC como entrada o no lo contienen. Las comerciales con capacidad name→RFC (Infodata, D&B) requieren integración pagada.

### Flujo Propuesto para México

```
candidato (nombre, dominio, linkedin)
  ↓
DENUE API → identity resolver (nombre→establecimiento)
  ↓
¿Match en DENUE?
  ├── Sí → enrichment con datos DENUE (ubicación, giro, empleados)
  │         → flag human_review_required para RFC
  │         → humano provee RFC → validación contra SAT
  │         → enrichment fiscal completo → HubSpot
  └── No → señal débil
            → flag human_review_required
            → revisión manual profunda
```

### Implementación

**`resolveCandidateTaxIdentifierForMexico` debe retornar:**

```typescript
{
  status: 'not_resolvable_automatically',
  humanReviewRequired: true,
  confidence: 'low',  // o 'medium' si DENUE dio match fuerte
  signals: {
    denueMatch: { /* datos del establecimiento si hay match */ },
    compranetMatch: { /* datos de compras públicas si aplica */ }
  },
  suggestedFlow: 'human_review_required'
}
```

### Próximos Pasos Recomendados

1. **Implementar Camino B ahora** — `not_resolvable_automatically` + `human_review_required`
2. **Integrar DENUE como identity resolver** para reducir fricción en revisión humana (pre-enrichment)
3. **Evaluar Infodata Mexico** para post-MVP si el volumen justifica el costo comercial
4. **No invertir en scraping SAT** — riesgos legales y técnicos superan el beneficio
5. **El patrón Colombia se mantiene como ideal**, México requiere una etapa humana adicional

---

## Cierre México — Agente 1 MVP operativo (Referencia cruzada)

**Fecha:** 2026-06-22

Esta investigación queda **cerrada oficialmente** para el MVP del Agente 1. La decisión funcional está documentada en `AUDITORIA-FUENTES-IA.md` (sección **Cierre México — Agente 1 MVP operativo**).

### Resumen del cierre

- **Fuente conectada al flujo IA:** `mx_denue` (DENUE/INEGI API)
- **Sin resolución automática de RFC:** `tax_identifier = null`, `status = not_resolvable_automatically`, `human_review_required = true`
- **Fuentes manuales:** `mx_siem`, `mx_canaive`, `mx_amia`, `mx_amiti`, `mx_fintech_mx`
- **Contenedor técnico:** `mx_datos_gob`
- **Pausada B2G:** `mx_compranet`
- **No se ejecutó:** Tavily, LLM, HubSpot, wizard
- **No se modificó:** Colombia

Ver `AUDITORIA-FUENTES-IA.md` para tabla completa de clasificación, decisiones clave, flujo MVP y próximos pasos post-MVP.

---

## Referencias

- [SAT Validador RFC](https://portalsat.plataforma.sat.gob.mx/ConsultaRFC/)
- [DENUE INEGI](https://www.inegi.org.mx/temas/directorio)
- [DENUE API](https://www.inegi.org.mx/servicios/api_denue.html)
- [SIEM gob.mx](https://www.gob.mx/tuempresa/documentos/sistema-de-informacion-empresarial-mexicano-siem-149379)
- [Compras MX Datos Abiertos](https://comprasmx.buengobierno.gob.mx/datos-abiertos)
- [datos.gob.mx - Padrón contribuyentes](https://datos.gob.mx/busca/dataset?q=rfc)
- [CFDI 4.0 Validación RFC](https://siemprealdia.co/mexico/fiscal/como-verificar-el-rfc-ante-el-sat)
- [Nueva LFPDPPP 2025](https://www.hoganlovells.com/es/publications/mexicos-new-federal-data-protection-law-what-it-means-for-companies)
- [Infodata Mexico](https://www.infodata.mx)
- [Box Factura Buscador RFC](https://www.boxfactura.com/herramientas/buscador-rfc)
- [B2B Data Providers Mexico](https://www.infobelpro.com/en/blog/b2b-data-providers-mexico)
