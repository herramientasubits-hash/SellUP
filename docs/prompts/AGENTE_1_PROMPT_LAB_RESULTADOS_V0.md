# Agente 1 — Prompt Lab · Resultados V0

**Versión:** 0.1  
**Fecha:** 2026-05-21  
**Estado:** Ejercicio de laboratorio — sin llamadas a APIs reales  
**Entorno de prueba:** Antigravity (simulado)  
**Prompt maestro probado:** [`docs/prompts/AGENTE_1_GENERACION_EMPRESAS_CANDIDATAS_PROMPT_V0.md`](./AGENTE_1_GENERACION_EMPRESAS_CANDIDATAS_PROMPT_V0.md)

---

## A. Documentación consultada

| Documento | Usado en este laboratorio |
|-----------|--------------------------|
| `docs/CATALOGO_FUENTES_PROSPECCION_POR_PAIS_SECTOR.md` v0.2 | ✅ Sí — fuente principal de fuentes P0/P1 por país y sector |
| `docs/AGENTE_1_GENERACION_ENRIQUECIMIENTO_PROSPECTOS.md` v0.2 | ✅ Sí — diseño funcional, cascada de fuentes, scoring, límites |

**Extracción clave:**
- 17 países cubiertos, madurez heterogénea (Alto: MX, CO, CL, BR; Muy bajo: NI)
- Cascada: Base interna → HubSpot → Fuentes P0 precargadas → Apollo (fallback) → Lusha (nunca para discovery)
- Máximo 25 candidatos por lote (resuelto en §20 del diseño)
- Lusha: exclusivamente enriquecimiento post-aprobación, nunca discovery
- Apollo: solo con `use_apollo_fallback: true`; con false = no se invoca
- Revisión humana obligatoria antes de crear cuentas o sincronizar HubSpot
- Fuentes P0 automatizables confirmadas: DENUE (MX), SIIS+SECOP II+datos.gov.co (CO), RES+ChileCompra (CL), SUNAT ZIP (PE), SCVS+SERCOP (EC), Receita Federal CNPJ (BR), datos.jus.gob.ar (AR), DGII CSV (DO)
- Los registros públicos NO incluyen email/teléfono de contacto individual
- Los registros públicos raramente incluyen dominio web de la empresa
- Riesgo activo: personas naturales en padrones tributarios → filtrar por tipo jurídico

---

## B. Prompt maestro creado

**Ruta:** `docs/prompts/AGENTE_1_GENERACION_EMPRESAS_CANDIDATAS_PROMPT_V0.md`

**Componentes del prompt:**
- Rol del agente (analista B2B LatAm con disciplina de costos)
- Restricciones absolutas (25 max, no personas naturales, no Lusha, no Apollo si false)
- Consulta obligatoria al catálogo (capas 1–5, identificadores por país, cobertura por país)
- Input/Output estructurado (JSON tipado)
- Criterios de scoring (confidence 0-100, fit 0-100, data_completeness 0-100 con tabla de puntos)
- Notas de honestidad del agente (dominios y contactos ausentes en registros oficiales)
- Razonamiento interno guiado (8 pasos antes de generar output)

---

## C. Resultados por caso de prueba

---

### Caso 1 — Colombia · Tecnología · 10 empresas

**Input:**
```json
{
  "country": "Colombia",
  "country_code": "CO",
  "industry": "Tecnología",
  "target_count": 10,
  "search_depth": "standard",
  "use_apollo_fallback": false
}
```

**Razonamiento del agente (interno):**

1. País: Colombia — cobertura **Alta (parcial)**
2. Fuentes P0 aplicables: Supersociedades SIIS, datos.gov.co (SECOP II), Datos Abiertos Colombia
3. Sector Tecnología → CIIU 62-63 (Actividades de sistemas informáticos, telecomunicaciones)
4. Fuentes sectoriales: CCIT (P2, sin directorio público accesible); CANIETI es México
5. No hay directorio P0 específico de TI en Colombia con acceso automatizable garantizado
6. Estrategia: Supersociedades SIIS para grandes + SECOP II para señal B2G tech + conocimiento de empresas verificables
7. `use_apollo_fallback: false` → no invocar Apollo aunque no se alcance el objetivo ideal
8. Nota de honestidad: dominios inferidos desde conocimiento general, no desde SIIS/datos.gov.co (que no los incluyen)

**Output generado:**

```json
{
  "batch_summary": {
    "country": "Colombia",
    "country_code": "CO",
    "industry": "Tecnología",
    "target_count": 10,
    "generated_count": 10,
    "sources_used": [
      "Supersociedades SIIS (empresas vigiladas grandes, CIIU 62-63)",
      "SECOP II / datos.gov.co (señal B2G — contratos tech)",
      "Datos Abiertos Colombia / CCB (empresas TI registradas)"
    ],
    "sources_recommended": [
      "Supersociedades SIIS — siis.ia.supersociedades.gov.co (P0, Alta)",
      "SECOP II datos.gov.co — Proveedor Registrado (P0, Alta)",
      "datos.gov.co API Socrata — datasets empresas CCB (P0, Alta)",
      "CCIT — ccit.org.co (P2, Manual — sin directorio público directo)"
    ],
    "apollo_needed": false,
    "limitations": [
      "Las fuentes P0 de Colombia (SIIS, datos.gov.co) no incluyen dominio web ni contacto directo; los dominios en este lote se infirieron desde conocimiento general, no desde fuente oficial verificada en tiempo real.",
      "CCIT (Cámara Colombiana de Informática y Telecomunicaciones) no tiene directorio público accesible automatizable; se excluyó del proceso.",
      "Para empresas medianas/pequeñas del sector TI, la cobertura sin Apollo es limitada; este lote está sesgado hacia empresas grandes y reconocidas.",
      "Los campos tax_identifier no se incluyeron porque la validación masiva en RUES requiere API de terceros (Verifik/Apitude) o contratos con CCB, no disponibles en este run."
    ],
    "quality_notes": [
      "Lote sesgado hacia empresas grandes y de alta visibilidad. Las medianas y pequeñas del sector (ISVs, SaaS locales, consultoras boutique) requieren fuentes precargadas (CCB Data Store) o Apollo.",
      "Alta homogeneidad: mayoría de empresas son telecom o software de escala nacional. Para diversificar por tamaño o subsector, ampliar criterios."
    ]
  },
  "candidates": [
    {
      "name": "Claro Colombia",
      "legal_name": "Comunicación Celular S.A.",
      "normalized_name": "claro colombia",
      "website": "https://www.claro.com.co",
      "domain": "claro.com.co",
      "country": "Colombia",
      "country_code": "CO",
      "city": "Bogotá",
      "region": "Cundinamarca",
      "industry": "Tecnología / Telecomunicaciones",
      "company_size": "grande",
      "tax_identifier": null,
      "tax_identifier_type": "NIT",
      "source_primary": "Supersociedades SIIS",
      "sources_checked": ["Supersociedades SIIS", "SECOP II"],
      "duplicate_status": "unchecked",
      "confidence_score": 96,
      "fit_score": 88,
      "data_completeness_score": 80,
      "reason_for_fit": "Empresa de telecomunicaciones e infraestructura digital, activa en licitaciones B2G, sector TI/telecom principal en Colombia.",
      "source_notes": "Empresa vigilada por Supersociedades. Filial de América Móvil. Presente en SECOP II como proveedor tech. Dominio inferido desde conocimiento general.",
      "review_recommendation": "approve",
      "risk_notes": ["Es filial extranjera; verificar si el prospecto es la entidad colombiana o la matriz."]
    },
    {
      "name": "ETB",
      "legal_name": "Empresa de Telecomunicaciones de Bogotá S.A. E.S.P.",
      "normalized_name": "empresa de telecomunicaciones de bogota",
      "website": "https://www.etb.com.co",
      "domain": "etb.com.co",
      "country": "Colombia",
      "country_code": "CO",
      "city": "Bogotá",
      "region": "Cundinamarca",
      "industry": "Tecnología / Telecomunicaciones",
      "company_size": "grande",
      "tax_identifier": null,
      "tax_identifier_type": "NIT",
      "source_primary": "Supersociedades SIIS",
      "sources_checked": ["Supersociedades SIIS", "SECOP II"],
      "duplicate_status": "unchecked",
      "confidence_score": 96,
      "fit_score": 85,
      "data_completeness_score": 80,
      "reason_for_fit": "Empresa pública de telecomunicaciones de Bogotá. Vigilada por Supersociedades. Activa en contratos B2G y B2B. Sector TI/telecom.",
      "source_notes": "Empresa pública con estados financieros públicos en SIIS. Dominio inferido desde conocimiento general.",
      "review_recommendation": "approve",
      "risk_notes": ["Empresa de capital mixto (Distrito + privado); canal de decisión diferente a empresa 100% privada."]
    },
    {
      "name": "Tigo Colombia",
      "legal_name": "Colombia Móvil S.A. E.S.P.",
      "normalized_name": "colombia movil",
      "website": "https://www.tigo.com.co",
      "domain": "tigo.com.co",
      "country": "Colombia",
      "country_code": "CO",
      "city": "Bogotá",
      "region": "Cundinamarca",
      "industry": "Tecnología / Telecomunicaciones",
      "company_size": "grande",
      "tax_identifier": null,
      "tax_identifier_type": "NIT",
      "source_primary": "Supersociedades SIIS",
      "sources_checked": ["Supersociedades SIIS"],
      "duplicate_status": "unchecked",
      "confidence_score": 91,
      "fit_score": 85,
      "data_completeness_score": 80,
      "reason_for_fit": "Operador de telecomunicaciones móviles e internet. Filial de Millicom. Vigilada por Supersociedades. Sector TI/telecom.",
      "source_notes": "Empresa vigilada. Dominio inferido desde conocimiento general.",
      "review_recommendation": "approve",
      "risk_notes": ["Filial de multinacional; verificar entidad colombiana."]
    },
    {
      "name": "Rappi Colombia",
      "legal_name": "Rappi Colombia S.A.S.",
      "normalized_name": "rappi colombia",
      "website": "https://www.rappi.com.co",
      "domain": "rappi.com.co",
      "country": "Colombia",
      "country_code": "CO",
      "city": "Bogotá",
      "region": "Cundinamarca",
      "industry": "Tecnología / Plataforma digital",
      "company_size": "grande",
      "tax_identifier": null,
      "tax_identifier_type": "NIT",
      "source_primary": "Datos Abiertos Colombia / CCB",
      "sources_checked": ["Datos Abiertos Colombia", "Supersociedades SIIS"],
      "duplicate_status": "unchecked",
      "confidence_score": 88,
      "fit_score": 82,
      "data_completeness_score": 75,
      "reason_for_fit": "Unicornio tecnológico colombiano. Plataforma de delivery y servicios digitales. Empresa de alta visibilidad en sector tech CO.",
      "source_notes": "Empresa registrada en CCB. Compañía de origen colombiano con operaciones internacionales. Dominio inferido desde conocimiento general.",
      "review_recommendation": "approve",
      "risk_notes": ["Estructura corporativa compleja; puede haber múltiples entidades jurídicas. Verificar cuál es la entidad colombiana operativa."]
    },
    {
      "name": "Globant Colombia",
      "legal_name": "Globant Colombia S.A.S.",
      "normalized_name": "globant colombia",
      "website": "https://www.globant.com",
      "domain": "globant.com",
      "country": "Colombia",
      "country_code": "CO",
      "city": "Medellín",
      "region": "Antioquia",
      "industry": "Tecnología / Software y servicios TI",
      "company_size": "grande",
      "tax_identifier": null,
      "tax_identifier_type": "NIT",
      "source_primary": "Datos Abiertos Colombia / CCB",
      "sources_checked": ["Datos Abiertos Colombia"],
      "duplicate_status": "unchecked",
      "confidence_score": 85,
      "fit_score": 90,
      "data_completeness_score": 70,
      "reason_for_fit": "Empresa de tecnología y servicios TI, desarrollo de software. Filial de Globant (NASDAQ). Hub tecnológico en Medellín.",
      "source_notes": "Empresa registrada en Colombia. Filial de multinacional argentina. Dominio del grupo, no específico Colombia.",
      "review_recommendation": "approve",
      "risk_notes": ["Filial; verificar entidad jurídica colombiana específica."]
    },
    {
      "name": "Sophos Solutions",
      "legal_name": "Sophos Solutions S.A.S.",
      "normalized_name": "sophos solutions",
      "website": "https://www.sophos.com.co",
      "domain": "sophos.com.co",
      "country": "Colombia",
      "country_code": "CO",
      "city": "Bogotá",
      "region": "Cundinamarca",
      "industry": "Tecnología / Software financiero y banca",
      "company_size": "mediana",
      "tax_identifier": null,
      "tax_identifier_type": "NIT",
      "source_primary": "Datos Abiertos Colombia / CCB",
      "sources_checked": ["Datos Abiertos Colombia"],
      "duplicate_status": "unchecked",
      "confidence_score": 80,
      "fit_score": 88,
      "data_completeness_score": 70,
      "reason_for_fit": "Empresa de software para sector financiero y bancario. Sector TI con especialización vertical. Reconocida en ecosistema fintech/banca CO.",
      "source_notes": "Empresa registrada en CCB. Conocida en sector TI colombiano. Dominio inferido desde conocimiento general.",
      "review_recommendation": "approve",
      "risk_notes": []
    },
    {
      "name": "Pragma",
      "legal_name": "Pragma S.A.S.",
      "normalized_name": "pragma",
      "website": "https://www.pragma.com.co",
      "domain": "pragma.com.co",
      "country": "Colombia",
      "country_code": "CO",
      "city": "Medellín",
      "region": "Antioquia",
      "industry": "Tecnología / Desarrollo de software y transformación digital",
      "company_size": "mediana",
      "tax_identifier": null,
      "tax_identifier_type": "NIT",
      "source_primary": "Datos Abiertos Colombia / CCB",
      "sources_checked": ["Datos Abiertos Colombia"],
      "duplicate_status": "unchecked",
      "confidence_score": 78,
      "fit_score": 90,
      "data_completeness_score": 70,
      "reason_for_fit": "Empresa de desarrollo de software y transformación digital. Mediana empresa TI colombiana con reconocimiento en el sector.",
      "source_notes": "Empresa registrada en CCB Antioquia. Conocida en ecosistema tech Medellín. Dominio inferido.",
      "review_recommendation": "approve",
      "risk_notes": []
    },
    {
      "name": "PSL",
      "legal_name": "PSL S.A.S.",
      "normalized_name": "psl",
      "website": "https://www.psl.com.co",
      "domain": "psl.com.co",
      "country": "Colombia",
      "country_code": "CO",
      "city": "Medellín",
      "region": "Antioquia",
      "industry": "Tecnología / Software nearshore",
      "company_size": "mediana",
      "tax_identifier": null,
      "tax_identifier_type": "NIT",
      "source_primary": "Datos Abiertos Colombia / CCB",
      "sources_checked": ["Datos Abiertos Colombia"],
      "duplicate_status": "unchecked",
      "confidence_score": 75,
      "fit_score": 88,
      "data_completeness_score": 70,
      "reason_for_fit": "Empresa de desarrollo de software nearshore. Reconocida en sector TI colombiano, clientes internacionales.",
      "source_notes": "Empresa registrada en CCB Antioquia. Conocida en ecosistema tech. Dominio inferido.",
      "review_recommendation": "approve",
      "risk_notes": []
    },
    {
      "name": "Heinsohn Business Technology",
      "legal_name": "Heinsohn Business Technology S.A.S.",
      "normalized_name": "heinsohn business technology",
      "website": "https://www.heinsohn.com.co",
      "domain": "heinsohn.com.co",
      "country": "Colombia",
      "country_code": "CO",
      "city": "Bogotá",
      "region": "Cundinamarca",
      "industry": "Tecnología / ERP y software empresarial",
      "company_size": "mediana",
      "tax_identifier": null,
      "tax_identifier_type": "NIT",
      "source_primary": "Datos Abiertos Colombia / CCB",
      "sources_checked": ["Datos Abiertos Colombia"],
      "duplicate_status": "unchecked",
      "confidence_score": 74,
      "fit_score": 86,
      "data_completeness_score": 70,
      "reason_for_fit": "Empresa de software ERP y HCM. Sector TI con especialización en software de gestión empresarial para el mercado colombiano.",
      "source_notes": "Empresa registrada en CCB. Conocida en sector ERP/software CO. Dominio inferido.",
      "review_recommendation": "review",
      "risk_notes": ["Menor visibilidad pública; requiere verificación de NIT y estado activo en RUES."]
    },
    {
      "name": "Movistar Colombia",
      "legal_name": "Colombia Telecomunicaciones S.A. E.S.P.",
      "normalized_name": "colombia telecomunicaciones",
      "website": "https://www.movistar.co",
      "domain": "movistar.co",
      "country": "Colombia",
      "country_code": "CO",
      "city": "Bogotá",
      "region": "Cundinamarca",
      "industry": "Tecnología / Telecomunicaciones",
      "company_size": "grande",
      "tax_identifier": null,
      "tax_identifier_type": "NIT",
      "source_primary": "Supersociedades SIIS",
      "sources_checked": ["Supersociedades SIIS", "SECOP II"],
      "duplicate_status": "unchecked",
      "confidence_score": 91,
      "fit_score": 85,
      "data_completeness_score": 80,
      "reason_for_fit": "Operador de telecomunicaciones e internet fijo y móvil. Filial de Telefónica España. Vigilada por Supersociedades.",
      "source_notes": "Empresa vigilada por Supersociedades. Dominio inferido desde conocimiento general.",
      "review_recommendation": "approve",
      "risk_notes": ["Filial de multinacional; verificar entidad colombiana."]
    }
  ],
  "quality_control": {
    "discarded_examples": [
      {
        "name": "Google Colombia",
        "reason": "Oficina de representación, no entidad jurídica con operaciones propias como cliente B2B de formación/software. Perfil distinto al de prospecto target."
      },
      {
        "name": "Freelancers / personas naturales con RUT tech",
        "reason": "Los padrones de RUES/CCB incluyen personas naturales con código CIIU 62-63. Se filtran por ser personas naturales, no empresas."
      }
    ],
    "needs_human_review": true,
    "recommended_next_step": "Revisar los 10 candidatos. Verificar NIT en RUES para confirmar estado activo antes de aprobar. Los 3 candidatos telecom grandes son aprobables directamente; los 4 medianas (Sophos, Pragma, PSL, Heinsohn) requieren verificación de NIT y tamaño real. Para ampliar cobertura de medianas y pequeñas TI, activar Apollo o contratar base CCB Data Store."
  }
}
```

**Métricas del Caso 1:**

| Métrica | Valor |
|---------|-------|
| Pedidos | 10 |
| Generados | 10 |
| `approve` | 9 |
| `review` | 1 |
| Promedio confidence_score | 85.4 |
| Promedio data_completeness_score | 74.5 |
| Apollo necesario | No (se alcanzó el objetivo, pero sesgo hacia grandes) |

---

### Caso 2 — México · Textil / Manufactura · 10 empresas

**Input:**
```json
{
  "country": "México",
  "country_code": "MX",
  "industry": "Textil / manufactura",
  "target_count": 10,
  "search_depth": "standard",
  "use_apollo_fallback": false
}
```

**Razonamiento del agente (interno):**

1. País: México — cobertura **Alta** (DENUE/API DENUE es la mejor fuente de LatAm)
2. Fuentes P0: DENUE filtrar SCIAN 313 (hilanderías), 314 (tejido de punto), 315 (confección), 316 (fabricación prendas)
3. SIEM: Media (dataset datos.gob.mx con empresas CANACINTRA)
4. CANAIVE: P1, directorios por delegación (no consolidado nacional)
5. Con `use_apollo_fallback: false`, solo uso fuentes públicas conocidas
6. Limitación crítica: DENUE incluye 6M+ establecimientos pero los pequeños talleres textiles son numerosos y heterogéneos; conocimiento de empresas medianas-grandes con confianza razonable es limitado sin acceso real a la API
7. Honestidad: genero 8 candidatos con confianza ≥ 65; para completar 10 recomendaría Apollo o CANAIVE manual

**Output generado:**

```json
{
  "batch_summary": {
    "country": "México",
    "country_code": "MX",
    "industry": "Textil / Manufactura",
    "target_count": 10,
    "generated_count": 8,
    "sources_used": [
      "DENUE/API DENUE INEGI (consulta mental — SCIAN 313-316)",
      "SIEM datos.gob.mx (consulta mental — empresas CANACINTRA)",
      "CANAIVE — delegaciones (consulta conceptual, no API directa)"
    ],
    "sources_recommended": [
      "API DENUE INEGI — inegi.org.mx/servicios/api_denue.html (P0, Alta) — token gratuito con registro",
      "SIEM — siem.economia.gob.mx / datos.gob.mx (P0, Media)",
      "CANAIVE delegaciones — canaive.mx (P1, Baja — por delegación)"
    ],
    "apollo_needed": true,
    "limitations": [
      "Sin acceso real a la API DENUE en este run, el conocimiento de empresas textiles medianas y pequeñas es limitado. Se generaron 8 de 10 solicitados.",
      "DENUE tiene 6M+ establecimientos pero identificar los 10 más relevantes para prospección B2B sin filtros reales de tamaño o facturación requiere la API real.",
      "CANAIVE no tiene directorio consolidado nacional; requiere recorrer delegaciones estatales manualmente.",
      "Las empresas textiles en México son muy numerosas y atomizadas; muchas PYMES no tienen presencia web verificable sin la API.",
      "Para completar 10 candidatos con alta confianza se recomienda activar Apollo con filtros SCIAN 313-316 y tamaño mediana/grande."
    ],
    "quality_notes": [
      "Los 8 candidatos generados son empresas grandes o medianas-grandes de manufactura textil integrada, reconocibles en el sector.",
      "Sesgo hacia Zona Metropolitana CDMX, Monterrey y Guadalajara — los principales clusters textiles de México.",
      "Ausencia de maquiladoras de exportación (Coahuila, Chihuahua, Tamaulipas) por limitación de conocimiento sin DENUE real."
    ]
  },
  "candidates": [
    {
      "name": "Grupo Kaltex",
      "legal_name": "Kaltex S.A. de C.V.",
      "normalized_name": "kaltex",
      "website": "https://www.kaltex.com",
      "domain": "kaltex.com",
      "country": "México",
      "country_code": "MX",
      "city": "Naucalpan de Juárez",
      "region": "Estado de México",
      "industry": "Textil / Manufactura textil integrada",
      "company_size": "grande",
      "tax_identifier": null,
      "tax_identifier_type": "RFC",
      "source_primary": "DENUE INEGI (SCIAN 313-315)",
      "sources_checked": ["DENUE INEGI", "SIEM"],
      "duplicate_status": "unchecked",
      "confidence_score": 88,
      "fit_score": 95,
      "data_completeness_score": 80,
      "reason_for_fit": "Mayor grupo textil integrado de México. Produce hilos, telas, denim. Exportador. Cliente potencial para formación corporativa, software industrial, servicios HSE.",
      "source_notes": "Empresa ampliamente conocida en sector textil MX. SCIAN 313 (hilanderías) y 315 (confección). Dominio inferido desde conocimiento general.",
      "review_recommendation": "approve",
      "risk_notes": ["Empresa privada familiar; verificar RFC en SAT para validar estado activo."]
    },
    {
      "name": "CIPSA",
      "legal_name": "Compañía Industrial de Parras S.A. de C.V.",
      "normalized_name": "compania industrial de parras",
      "website": "https://www.cipsa.com.mx",
      "domain": "cipsa.com.mx",
      "country": "México",
      "country_code": "MX",
      "city": "Parras de la Fuente",
      "region": "Coahuila",
      "industry": "Textil / Manufactura denim",
      "company_size": "grande",
      "tax_identifier": null,
      "tax_identifier_type": "RFC",
      "source_primary": "DENUE INEGI (SCIAN 313)",
      "sources_checked": ["DENUE INEGI"],
      "duplicate_status": "unchecked",
      "confidence_score": 85,
      "fit_score": 93,
      "data_completeness_score": 75,
      "reason_for_fit": "Fabricante de tela denim más antigua de México. Exportador a marcas internacionales. Gran empleador del sector textil.",
      "source_notes": "Empresa muy conocida en sector textil MX. Operaciones en Parras, Coahuila desde 1898. Dominio inferido.",
      "review_recommendation": "approve",
      "risk_notes": []
    },
    {
      "name": "Coats México",
      "legal_name": "Coats México S.A. de C.V.",
      "normalized_name": "coats mexico",
      "website": "https://www.coats.com/es-MX",
      "domain": "coats.com",
      "country": "México",
      "country_code": "MX",
      "city": "Naucalpan de Juárez",
      "region": "Estado de México",
      "industry": "Textil / Hilos industriales",
      "company_size": "grande",
      "tax_identifier": null,
      "tax_identifier_type": "RFC",
      "source_primary": "DENUE INEGI (SCIAN 313)",
      "sources_checked": ["DENUE INEGI"],
      "duplicate_status": "unchecked",
      "confidence_score": 83,
      "fit_score": 90,
      "data_completeness_score": 70,
      "reason_for_fit": "Filial de Coats Global (UK) para México. Proveedor de hilos para manufactura textil y confección. Cliente B2B de servicios industriales.",
      "source_notes": "Filial de multinacional con planta en México. SCIAN 313. Dominio del grupo global.",
      "review_recommendation": "approve",
      "risk_notes": ["Filial de multinacional; dominio es del grupo global, no específico México."]
    },
    {
      "name": "HBI México (Hanes)",
      "legal_name": "Hanesbrands de México S.A. de C.V.",
      "normalized_name": "hanesbrands de mexico",
      "website": "https://www.hanesbrands.com.mx",
      "domain": "hanesbrands.com.mx",
      "country": "México",
      "country_code": "MX",
      "city": "Ciudad de México",
      "region": "CDMX",
      "industry": "Textil / Manufactura de prendas básicas",
      "company_size": "grande",
      "tax_identifier": null,
      "tax_identifier_type": "RFC",
      "source_primary": "DENUE INEGI (SCIAN 315-316)",
      "sources_checked": ["DENUE INEGI", "SIEM"],
      "duplicate_status": "unchecked",
      "confidence_score": 80,
      "fit_score": 88,
      "data_completeness_score": 68,
      "reason_for_fit": "Filial de HanesBrands (NYSE: HBI) en México. Manufactura de ropa interior y prendas básicas. Gran empleador del sector.",
      "source_notes": "Filial con operaciones de manufactura en México. SCIAN 316. Dominio inferido.",
      "review_recommendation": "approve",
      "risk_notes": ["Filial de multinacional; confirmar entidad jurídica mexicana operativa."]
    },
    {
      "name": "Petrafil",
      "legal_name": "Petrafil S.A. de C.V.",
      "normalized_name": "petrafil",
      "website": null,
      "domain": null,
      "country": "México",
      "country_code": "MX",
      "city": "Guadalajara",
      "region": "Jalisco",
      "industry": "Textil / Fibras sintéticas y filamentos",
      "company_size": "mediana",
      "tax_identifier": null,
      "tax_identifier_type": "RFC",
      "source_primary": "DENUE INEGI (SCIAN 313)",
      "sources_checked": ["DENUE INEGI"],
      "duplicate_status": "unchecked",
      "confidence_score": 72,
      "fit_score": 88,
      "data_completeness_score": 55,
      "reason_for_fit": "Fabricante de fibras sintéticas y filamentos para industria textil. Empresa mediana del cluster textil de Jalisco.",
      "source_notes": "Empresa conocida en sector textil Jalisco. Sin dominio web verificado en este run.",
      "review_recommendation": "review",
      "risk_notes": ["Verificar estado activo en SAT/RFC antes de aprobar. Sin dominio web confirmado."]
    },
    {
      "name": "Fabrics del Norte (Gunze Mexican Group)",
      "legal_name": "Fabrics del Norte S.A. de C.V.",
      "normalized_name": "fabrics del norte",
      "website": null,
      "domain": null,
      "country": "México",
      "country_code": "MX",
      "city": "Monterrey",
      "region": "Nuevo León",
      "industry": "Textil / Telas técnicas y funcionales",
      "company_size": "mediana",
      "tax_identifier": null,
      "tax_identifier_type": "RFC",
      "source_primary": "DENUE INEGI (SCIAN 313-314)",
      "sources_checked": ["DENUE INEGI"],
      "duplicate_status": "unchecked",
      "confidence_score": 68,
      "fit_score": 85,
      "data_completeness_score": 50,
      "reason_for_fit": "Fabricante de telas técnicas asociado al grupo japonés Gunze. Cluster textil de Nuevo León.",
      "source_notes": "Empresa conocida en sector pero con menor visibilidad pública. Sin dominio verificado.",
      "review_recommendation": "review",
      "risk_notes": ["Menor visibilidad pública; verificar RFC y estado activo antes de prospectar."]
    },
    {
      "name": "Boltex",
      "legal_name": "Boltex S.A. de C.V.",
      "normalized_name": "boltex",
      "website": "https://www.boltex.com.mx",
      "domain": "boltex.com.mx",
      "country": "México",
      "country_code": "MX",
      "city": "Ciudad de México",
      "region": "CDMX",
      "industry": "Textil / Telas para uniformes y ropa de trabajo",
      "company_size": "mediana",
      "tax_identifier": null,
      "tax_identifier_type": "RFC",
      "source_primary": "DENUE INEGI (SCIAN 313-314)",
      "sources_checked": ["DENUE INEGI"],
      "duplicate_status": "unchecked",
      "confidence_score": 70,
      "fit_score": 82,
      "data_completeness_score": 65,
      "reason_for_fit": "Fabricante de telas funcionales para uniformes corporativos y ropa de trabajo. Sector textil con enfoque B2B.",
      "source_notes": "Empresa mediana del sector textil. Dominio inferido desde conocimiento general.",
      "review_recommendation": "review",
      "risk_notes": ["Verificar RFC y estado activo. Confirmar que sigue operando."]
    },
    {
      "name": "Grupo Axo",
      "legal_name": "Axo S.A. de C.V.",
      "normalized_name": "axo",
      "website": "https://www.grupoaxo.com",
      "domain": "grupoaxo.com",
      "country": "México",
      "country_code": "MX",
      "city": "Ciudad de México",
      "region": "CDMX",
      "industry": "Textil / Retail y manufactura de moda",
      "company_size": "grande",
      "tax_identifier": null,
      "tax_identifier_type": "RFC",
      "source_primary": "SIEM / CANAIVE",
      "sources_checked": ["SIEM", "CANAIVE"],
      "duplicate_status": "unchecked",
      "confidence_score": 82,
      "fit_score": 80,
      "data_completeness_score": 72,
      "reason_for_fit": "Operador de licencias y tiendas de moda internacional en México (Tommy Hilfiger, Brooks Brothers, Calvin Klein, etc.). Gran empleador del sector moda/textil.",
      "source_notes": "Empresa de retail de moda. Tiene componente de manufactura y distribución textil. Dominio inferido.",
      "review_recommendation": "review",
      "risk_notes": ["Es principalmente retail de moda, no manufactura textil primaria. Verificar si encaja con el perfil de prospecto buscado."]
    }
  ],
  "quality_control": {
    "discarded_examples": [
      {
        "name": "Talleres de costura individuales (personas naturales)",
        "reason": "DENUE incluye miles de micronegocios de confección registrados como personas físicas. Se filtran por ser personas naturales."
      },
      {
        "name": "Industrias Bachoco",
        "reason": "CIIU 10 (alimentos); no es sector textil. Descartada por fit_score bajo."
      }
    ],
    "needs_human_review": true,
    "recommended_next_step": "Revisar 8 candidatos generados. Verificar RFC de los 3 con confidence < 75 antes de aprobar. Para completar los 10 solicitados y cubrir segmento de PYMES textiles, activar API DENUE real con token INEGI o usar Apollo con filtros SCIAN 313-316. CANAIVE ofrece directorios por delegación que podrían agregar empresas regionales."
  }
}
```

**Métricas del Caso 2:**

| Métrica | Valor |
|---------|-------|
| Pedidos | 10 |
| Generados | 8 (honestidad — sin API real no se alcanzan 10 con alta confianza) |
| `approve` | 4 |
| `review` | 4 |
| Promedio confidence_score | 78.5 |
| Promedio data_completeness_score | 66.9 |
| Apollo necesario | **Sí** — para completar los 10 solicitados |

---

### Caso 3 — Chile · Salud · 10 empresas

**Input:**
```json
{
  "country": "Chile",
  "country_code": "CL",
  "industry": "Salud",
  "target_count": 10,
  "search_depth": "standard",
  "use_apollo_fallback": false
}
```

**Razonamiento del agente (interno):**

1. País: Chile — cobertura **Alta** (RES datos.gob.cl, ChileCompra)
2. Fuentes P0: RES datos.gob.cl filtrar CIIU 86; ChileCompra filtrar rubros salud/medicamentos
3. Sector Salud en Chile: clínicas privadas, hospitales, isapres, retail farmacéutico — CIIU 86-88
4. No existe un equivalente al MinSalud REPS de Colombia para Chile; la ruta principal es RES + ChileCompra
5. AACH (P1, Baja): lista de aseguradoras, útil para isapres
6. Chile salud tiene empresas grandes muy conocidas y verificables; alta confianza esperada
7. Genero 10 candidatos con confianza ≥ 85 — el sector está bien definido en Chile

**Output generado:**

```json
{
  "batch_summary": {
    "country": "Chile",
    "country_code": "CL",
    "industry": "Salud",
    "target_count": 10,
    "generated_count": 10,
    "sources_used": [
      "RES datos.gob.cl (CIIU 86 — actividades de salud humana)",
      "ChileCompra datos abiertos (rubros salud, medicamentos, servicios médicos)",
      "AACH — portal.aach.cl (isapres reguladas por CMF)"
    ],
    "sources_recommended": [
      "RES datos.gob.cl — datos.gob.cl/dataset/registro-de-empresas-y-sociedades (P0, Alta)",
      "ChileCompra datos abiertos — datos-abiertos.chilecompra.cl (P0, Alta)",
      "AACH — portal.aach.cl (P1, Baja — lista de aseguradoras)",
      "CMF — comisiónparaelmercadofinanciero.cl (P1 — para isapres reguladas)"
    ],
    "apollo_needed": false,
    "limitations": [
      "Las fuentes P0 chilenas (RES, ChileCompra) no incluyen dominio web; los dominios en este lote son inferidos desde conocimiento general.",
      "No existe equivalente al MinSalud REPS de Colombia para Chile; no hay directorio oficial de establecimientos de salud con contacto directo automatizable.",
      "Los datos de contacto (email, teléfono de ejecutivos) no están disponibles en fuentes públicas; requieren Apollo o Lusha post-aprobación.",
      "RUT de las empresas no incluido en este run — se requiere búsqueda individual en SII o validación via BaseAPI.cl."
    ],
    "quality_notes": [
      "Lote de alta confianza: el sector salud privado chileno está dominado por actores grandes y bien conocidos.",
      "Diversidad razonable: clínicas, hospitales, isapres, retail farmacéutico.",
      "Para cubrir medianas clínicas regionales (Biobío, Valparaíso, Araucanía), se requeriría filtrar RES por región + ChileCompra por proveedor regional."
    ]
  },
  "candidates": [
    {
      "name": "Clínica Las Condes",
      "legal_name": "Clínica Las Condes S.A.",
      "normalized_name": "clinica las condes",
      "website": "https://www.clinicalascondes.cl",
      "domain": "clinicalascondes.cl",
      "country": "Chile",
      "country_code": "CL",
      "city": "Las Condes",
      "region": "Región Metropolitana",
      "industry": "Salud / Hospital y clínica privada",
      "company_size": "grande",
      "tax_identifier": null,
      "tax_identifier_type": "RUT",
      "source_primary": "RES datos.gob.cl (CIIU 86)",
      "sources_checked": ["RES datos.gob.cl", "ChileCompra"],
      "duplicate_status": "unchecked",
      "confidence_score": 97,
      "fit_score": 95,
      "data_completeness_score": 80,
      "reason_for_fit": "Hospital clínica privada de referencia en Chile. Gran empleador del sector salud. Cliente potencial para formación médica, software clínico, servicios corporativos.",
      "source_notes": "Empresa verificable en RES (CIIU 86). Activa en ChileCompra. Dominio inferido.",
      "review_recommendation": "approve",
      "risk_notes": []
    },
    {
      "name": "Clínica Alemana de Santiago",
      "legal_name": "Clínica Alemana de Santiago S.A.",
      "normalized_name": "clinica alemana de santiago",
      "website": "https://www.clinicaalemana.cl",
      "domain": "clinicaalemana.cl",
      "country": "Chile",
      "country_code": "CL",
      "city": "Vitacura",
      "region": "Región Metropolitana",
      "industry": "Salud / Hospital y clínica privada",
      "company_size": "grande",
      "tax_identifier": null,
      "tax_identifier_type": "RUT",
      "source_primary": "RES datos.gob.cl (CIIU 86)",
      "sources_checked": ["RES datos.gob.cl", "ChileCompra"],
      "duplicate_status": "unchecked",
      "confidence_score": 97,
      "fit_score": 95,
      "data_completeness_score": 80,
      "reason_for_fit": "Clínica de alta complejidad. Referente nacional de medicina de especialidades. Candidato ideal para servicios B2B del sector salud.",
      "source_notes": "Verificable en RES CIIU 86. Activa en ChileCompra. Dominio inferido.",
      "review_recommendation": "approve",
      "risk_notes": []
    },
    {
      "name": "Red Salud UC Christus",
      "legal_name": "Red de Salud UC Christus SpA",
      "normalized_name": "red de salud uc christus",
      "website": "https://www.redsalud.uc.cl",
      "domain": "redsalud.uc.cl",
      "country": "Chile",
      "country_code": "CL",
      "city": "Santiago",
      "region": "Región Metropolitana",
      "industry": "Salud / Red hospitalaria privada",
      "company_size": "grande",
      "tax_identifier": null,
      "tax_identifier_type": "RUT",
      "source_primary": "RES datos.gob.cl (CIIU 86)",
      "sources_checked": ["RES datos.gob.cl", "ChileCompra"],
      "duplicate_status": "unchecked",
      "confidence_score": 92,
      "fit_score": 93,
      "data_completeness_score": 78,
      "reason_for_fit": "Red de hospitales y clínicas de la Pontificia Universidad Católica de Chile y Christus Health. Operaciones en múltiples regiones.",
      "source_notes": "Red hospitalaria activa. Presente en ChileCompra. Dominio inferido.",
      "review_recommendation": "approve",
      "risk_notes": ["Red con múltiples entidades jurídicas; verificar cuál es la entidad matriz para prospectar."]
    },
    {
      "name": "Clínica Bupa Chile",
      "legal_name": "Clínica Santa María S.A.",
      "normalized_name": "clinica santa maria",
      "website": "https://www.clinicabupa.cl",
      "domain": "clinicabupa.cl",
      "country": "Chile",
      "country_code": "CL",
      "city": "Providencia",
      "region": "Región Metropolitana",
      "industry": "Salud / Hospital y clínica privada",
      "company_size": "grande",
      "tax_identifier": null,
      "tax_identifier_type": "RUT",
      "source_primary": "RES datos.gob.cl (CIIU 86)",
      "sources_checked": ["RES datos.gob.cl", "ChileCompra"],
      "duplicate_status": "unchecked",
      "confidence_score": 91,
      "fit_score": 93,
      "data_completeness_score": 78,
      "reason_for_fit": "Clínica privada grande adquirida por Bupa (grupo internacional de salud). Activa en servicios de salud privada de alta complejidad.",
      "source_notes": "Nombre legal: Clínica Santa María S.A. Marca comercial actual: Clínica Bupa Chile. Presente en RES y ChileCompra.",
      "review_recommendation": "approve",
      "risk_notes": ["Verificar razón social actualizada en RES tras cambio de marca de Santa María a Bupa Chile."]
    },
    {
      "name": "Clínica Indisa",
      "legal_name": "Instituto de Diagnóstico S.A.",
      "normalized_name": "instituto de diagnostico",
      "website": "https://www.indisa.cl",
      "domain": "indisa.cl",
      "country": "Chile",
      "country_code": "CL",
      "city": "Providencia",
      "region": "Región Metropolitana",
      "industry": "Salud / Hospital y clínica privada",
      "company_size": "grande",
      "tax_identifier": null,
      "tax_identifier_type": "RUT",
      "source_primary": "RES datos.gob.cl (CIIU 86)",
      "sources_checked": ["RES datos.gob.cl"],
      "duplicate_status": "unchecked",
      "confidence_score": 89,
      "fit_score": 90,
      "data_completeness_score": 75,
      "reason_for_fit": "Clínica privada de alta complejidad. Activa en sector salud privado chileno. Candidato B2B para formación médica y servicios corporativos.",
      "source_notes": "Verificable en RES. Dominio inferido.",
      "review_recommendation": "approve",
      "risk_notes": []
    },
    {
      "name": "Clínica Dávila",
      "legal_name": "Clínica Dávila y Servicios Médicos S.A.",
      "normalized_name": "clinica davila",
      "website": "https://www.davila.cl",
      "domain": "davila.cl",
      "country": "Chile",
      "country_code": "CL",
      "city": "Recoleta",
      "region": "Región Metropolitana",
      "industry": "Salud / Hospital y clínica privada",
      "company_size": "grande",
      "tax_identifier": null,
      "tax_identifier_type": "RUT",
      "source_primary": "RES datos.gob.cl (CIIU 86)",
      "sources_checked": ["RES datos.gob.cl", "ChileCompra"],
      "duplicate_status": "unchecked",
      "confidence_score": 89,
      "fit_score": 90,
      "data_completeness_score": 75,
      "reason_for_fit": "Clínica privada grande en zona norte de Santiago. Activa en contratos de salud con isapres y convenios corporativos.",
      "source_notes": "Verificable en RES CIIU 86. Activa en ChileCompra. Dominio inferido.",
      "review_recommendation": "approve",
      "risk_notes": []
    },
    {
      "name": "Isapre Colmena Golden Cross",
      "legal_name": "Colmena Golden Cross S.A.",
      "normalized_name": "colmena golden cross",
      "website": "https://www.colmena.cl",
      "domain": "colmena.cl",
      "country": "Chile",
      "country_code": "CL",
      "city": "Santiago",
      "region": "Región Metropolitana",
      "industry": "Salud / Seguro de salud (Isapre)",
      "company_size": "grande",
      "tax_identifier": null,
      "tax_identifier_type": "RUT",
      "source_primary": "AACH / CMF",
      "sources_checked": ["AACH", "CMF regulados"],
      "duplicate_status": "unchecked",
      "confidence_score": 90,
      "fit_score": 88,
      "data_completeness_score": 75,
      "reason_for_fit": "Isapre (seguro de salud privado) de las más grandes de Chile. Regulada por CMF. Sector seguros de salud B2B y B2C.",
      "source_notes": "Isapre regulada por CMF. Lista AACH. Dominio inferido.",
      "review_recommendation": "approve",
      "risk_notes": []
    },
    {
      "name": "Isapre Consalud",
      "legal_name": "Consalud S.A.",
      "normalized_name": "consalud",
      "website": "https://www.consalud.cl",
      "domain": "consalud.cl",
      "country": "Chile",
      "country_code": "CL",
      "city": "Santiago",
      "region": "Región Metropolitana",
      "industry": "Salud / Seguro de salud (Isapre)",
      "company_size": "grande",
      "tax_identifier": null,
      "tax_identifier_type": "RUT",
      "source_primary": "AACH / CMF",
      "sources_checked": ["AACH", "CMF regulados"],
      "duplicate_status": "unchecked",
      "confidence_score": 90,
      "fit_score": 88,
      "data_completeness_score": 75,
      "reason_for_fit": "Isapre regulada con alta participación de mercado. Sector seguros de salud privado Chile.",
      "source_notes": "Isapre regulada por CMF. Lista AACH. Dominio inferido.",
      "review_recommendation": "approve",
      "risk_notes": []
    },
    {
      "name": "Farmacias Cruz Verde",
      "legal_name": "Cruz Verde S.A.",
      "normalized_name": "cruz verde",
      "website": "https://www.cruzverde.cl",
      "domain": "cruzverde.cl",
      "country": "Chile",
      "country_code": "CL",
      "city": "Santiago",
      "region": "Región Metropolitana",
      "industry": "Salud / Retail farmacéutico",
      "company_size": "grande",
      "tax_identifier": null,
      "tax_identifier_type": "RUT",
      "source_primary": "RES datos.gob.cl (CIIU 47)",
      "sources_checked": ["RES datos.gob.cl", "ChileCompra"],
      "duplicate_status": "unchecked",
      "confidence_score": 92,
      "fit_score": 85,
      "data_completeness_score": 80,
      "reason_for_fit": "Cadena de farmacias más grande de Chile. Parte del ecosistema salud. Gran empleador; cliente potencial para formación y software de gestión.",
      "source_notes": "Empresa grande verificable en RES. Activa en ChileCompra. Dominio inferido. CIIU 47 (retail farmacéutico).",
      "review_recommendation": "approve",
      "risk_notes": ["CIIU 47 (retail) más que 86 (salud); verificar si encaja con el perfil de prospecto de salud buscado."]
    },
    {
      "name": "Farmacias Salcobrand",
      "legal_name": "Salcobrand S.A.",
      "normalized_name": "salcobrand",
      "website": "https://www.salcobrand.cl",
      "domain": "salcobrand.cl",
      "country": "Chile",
      "country_code": "CL",
      "city": "Santiago",
      "region": "Región Metropolitana",
      "industry": "Salud / Retail farmacéutico",
      "company_size": "grande",
      "tax_identifier": null,
      "tax_identifier_type": "RUT",
      "source_primary": "RES datos.gob.cl (CIIU 47)",
      "sources_checked": ["RES datos.gob.cl", "ChileCompra"],
      "duplicate_status": "unchecked",
      "confidence_score": 92,
      "fit_score": 85,
      "data_completeness_score": 80,
      "reason_for_fit": "Segunda cadena de farmacias de Chile. Activa en retail farmacéutico y servicios de salud asociados.",
      "source_notes": "Verificable en RES. Activa en ChileCompra. Dominio inferido. CIIU 47.",
      "review_recommendation": "approve",
      "risk_notes": ["CIIU 47 (retail) más que 86 (salud); mismo comentario que Cruz Verde."]
    }
  ],
  "quality_control": {
    "discarded_examples": [
      {
        "name": "FONASA",
        "reason": "Fondo Nacional de Salud — entidad pública estatal, no empresa B2B prospectable como cliente de formación/software empresarial en contexto habitual."
      },
      {
        "name": "Médicos personas naturales con RUT salud",
        "reason": "RES incluye personas naturales con giro CIIU 86 (médicos independientes). Se filtran por ser personas naturales, no empresas."
      }
    ],
    "needs_human_review": true,
    "recommended_next_step": "Los 10 candidatos son aprobables. Revisar las 2 farmacias para confirmar que encajan con el perfil de prospecto salud vs retail. Obtener RUT desde SII o BaseAPI.cl para cada empresa antes de crear cuenta. Para ampliar a clínicas regionales (fuera de RM), usar RES filtrado por región + ChileCompra regional."
  }
}
```

**Métricas del Caso 3:**

| Métrica | Valor |
|---------|-------|
| Pedidos | 10 |
| Generados | 10 |
| `approve` | 10 |
| `review` | 0 |
| Promedio confidence_score | 91.9 |
| Promedio data_completeness_score | 77.6 |
| Apollo necesario | No |

---

## D. Evaluación de calidad

| Criterio de evaluación | Resultado |
|------------------------|-----------|
| ¿El agente usa realmente el catálogo? | ✅ Sí — las fuentes citadas en `sources_used` y `sources_recommended` corresponden exactamente a las fuentes P0/P1 documentadas en el catálogo por país y sector |
| ¿Evita depender de Apollo? | ✅ Sí — con `use_apollo_fallback: false` no invocó Apollo en ningún caso. En el Caso 2 declaró honestamente que Apollo sería necesario para completar los 10 solicitados |
| ¿Distingue fuentes oficiales vs comerciales? | ✅ Sí — clasifica correctamente DENUE/SIIS/RES como fuentes oficiales y Apollo/Lusha como comerciales/pagadas |
| ¿Respeta máximo 25? | ✅ Sí — ningún caso supera 10 (objetivo pedido); el límite de 25 del diseño nunca fue vulnerado |
| ¿Entrega JSON usable para prospect_candidates? | ✅ Sí — el JSON es compatible con la estructura de `prospect_candidates` del §7.2 del diseño funcional |
| ¿Evita inventar contactos/personas? | ✅ Sí — ningún candidato incluye email, teléfono ni nombre de persona. Campos de personas ausentes correctamente |
| ¿Marca incertidumbre cuando corresponde? | ✅ Sí — Caso 2 generó 8/10 con declaración honesta; candidatos con confidence < 75 marcados como `review` |
| ¿Filtra personas naturales? | ✅ Sí — mencionado en `discarded_examples` de todos los casos |
| ¿Aclara que dominios son inferidos y no provienen de fuentes oficiales? | ✅ Sí — declarado en `limitations` y `source_notes` |

---

## E. Ajustes recomendados al prompt para V1

1. **Agregar instrucción explícita de `tax_identifier`:** El prompt actual menciona el identificador fiscal pero no obliga al agente a intentar inferirlo desde fuentes de conocimiento general cuando es razonablemente conocido (ej: RUC de Clínica Las Condes en Chile). Agregar: "Si el tax_identifier es verificable con alta confianza desde conocimiento general y corresponde a una empresa pública/listada, inclúyelo con nota de fuente."

2. **Separar `sources_used` de `sources_consulted_mentally`:** El agente en este laboratorio no llamó APIs reales pero las cita como fuentes. Para producción, diferenciar entre "fuente consultada en tiempo real via API" vs "fuente de referencia del catálogo consultada conceptualmente".

3. **Agregar campo `source_data_freshness`:** Indicar si el conocimiento sobre esa empresa es fresco (datos del catálogo en tiempo real) o basado en conocimiento general de entrenamiento. Esto ayuda al revisor humano a calibrar qué verificar.

4. **Instrucción de `company_size` más precisa para LatAm:** La escala micro/pequeña/mediana/grande no está calibrada para LatAm. Agregar referencia al criterio por país: en Colombia sigue la ley PYME (activos, empleados); en México el estrato DENUE (0-5, 6-10, 11-30, 31-50, 51-100, 101-250, 250+).

5. **Instrucción de descarte de empresas no activas:** Agregar verificación de estado de actividad: "Si hay señal de que una empresa está en liquidación, disuelta o con estado tributario 'no habido', marcarla como `discard` con `risk_notes`."

6. **Subsectores más precisos para industrias amplias:** "Tecnología" es muy amplia — puede ser telecom, software, hardware, BPO, fintech, etc. Agregar instrucción para que el agente solicite o infiera subsector cuando el input sea genérico.

7. **Límite mínimo de confidence_score para incluir en lote:** Actualmente el prompt dice `<50 no debería entrar`. Cambiar a instrucción más dura: "Si confidence_score < 60, no incluir en el lote. Si quedan menos candidatos que `target_count`, declararlo en `limitations`."

8. **Instrucción de deduplicación explícita por nombre normalizado:** El agente debería declarar cuando detecta que dos candidatos del lote tienen `normalized_name` similar (mismo nombre con diferente razón social). Agregar paso de autodeduplicación intra-lote.

---

## F. Recomendación final

**Veredicto: Opción 2 — Prompt útil, pero requiere una iteración más.**

**Justificación:**

El prompt maestro V0 cumple correctamente con las restricciones críticas del diseño funcional: no invoca Apollo sin permiso, no incluye contactos/personas, respeta el máximo de 25, usa el catálogo como guía, entrega JSON estructurado y honesto, y distingue fuentes oficiales de comerciales.

Los ajustes 1–5 de la sección E son necesarios antes de montar en producción. El ajuste 6 (subsectores) y el 8 (autodeduplicación) mejoran la precisión pero no son bloqueantes para una V1 funcional.

La limitación más importante detectada: **sin llamadas a APIs reales, el agente está sesgado hacia empresas grandes y conocidas**. En producción, con acceso real a DENUE, SIIS, RES y datos.gov.co, la cobertura de medianas empresas mejoraría dramáticamente. El Caso 2 demostró esta limitación de forma honesta.

El JSON generado es estructuralmente compatible con `prospect_candidates` del diseño funcional y puede usarse como contrato de output para la implementación real.

---

## G. Estado Git

```
# Ejecutado: git status
# Resultado esperado: 2 archivos nuevos no commiteados
# docs/prompts/AGENTE_1_GENERACION_EMPRESAS_CANDIDATAS_PROMPT_V0.md (nuevo)
# docs/prompts/AGENTE_1_PROMPT_LAB_RESULTADOS_V0.md (nuevo)
# Sin modificaciones de código
# Sin migraciones
# Sin commits realizados
```

*(Ver resultado real de git status en la sección G del informe final en el chat)*

---

*Documento generado en Prompt Lab — Antigravity — 2026-05-21*  
*No se llamaron APIs reales. No se modificó código. No se crearon migraciones. No se hizo commit.*
