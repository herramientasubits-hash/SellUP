# Portafolio UBITS — inventario para Rumbo (Agente 3)

Leído en el Confluence de UBITS (espacio Tecnología y los demás espacios) el 18-10-2026, sólo lectura.
Sirve para que Rumbo ofrezca contenidos y productos que **existen**, ligados a lo que la empresa necesita.

> 🔴 **No usar en mensajes:** métricas internas (ARR, adopción, tickets, cuántas veces se terminó un curso,
> número de empresas activas), nombres de clientes que aparecen como ejemplo en la documentación
> (Avianca, Terpel, Sodimac, Ecopetrol, Alsea…), ni funciones marcadas «en desarrollo» o «en planeación»
> como si ya estuvieran disponibles.

---

## 0. Lo que NO está en Confluence

**El catálogo completo de cursos no está en Confluence.** Vive en la plataforma. Confluence sólo documenta cómo se consulta:

- `GET https://api.ubitslearning.com/v2/learn/contents`: contenidos del catálogo UBITS, filtrables por competencia, habilidad, experto y aliado.
- `GET /api/v1/contents/export/competences.csv` (Creator): todos los contenidos con sus competencias, en CSV.
- `GET /api/v1/competences/export.csv` y `GET api/v1/skills`: competencias y habilidades.

Para que Rumbo cite cursos por su nombre hace falta ese export (alguien del equipo Learn con acceso a Creator) o una llave de la API.
Los nombres de cursos de la sección 5 salen de ejemplos de la documentación, no del catálogo vigente.

---

## 1. Planes de licencia (página «Licencias»)

| Standard | Max | Executive |
|---|---|---|
| +2.000 cursos y programas online | Todo lo de Standard | Todo lo de Max |
| Administración masiva de usuarios | +6.500 contenidos en tecnología, bienestar, negocios y compliance | Harvard Business Publishing y Stanford University |
| | UBITS PLUG (clases en vivo) | Asesoría en el diagnóstico y el diseño de la estrategia de entrenamiento |
| | Analítica por competencias: métricas de aprendizaje y reportes | Centro de recursos para la gestión de proyectos |
| | Formatos nuevos: charlas, podcasts, libros, resúmenes de libros y casos de estudio | Inglés: academia digital de inglés |
| | | Integración con el catálogo de APIs |

**UBITS MAX** tiene secciones propias:
- TED;
- WOBI, con certificado;
- Podcast;
- Ideas de libros;
- PLUG, clases en vivo.

La variante «Max + LMS» suma los cursos propios.

**Oferta de valor:** 30+ competencias y 150 habilidades en 5 academias (tecnología, negocios, habilidades blandas, inglés y compliance).
Aliados: Harvard, Stanford, WOBI, TED, AWS, Microsoft y Bureau Veritas.

---

## 2. Cómo está organizado el contenido

**Academia → Competencia → Habilidad → Contenido.** Cada contenido tiene una habilidad principal y dos secundarias, y su competencia sale de la principal.

- **Tipos de contenido:**
  - curso;
  - short (micro-cápsula, antes «nanobit»);
  - charla (TED, WOBI, PLUG grabado);
  - artículo;
  - podcast;
  - libro;
  - ideas de libro;
  - caso de estudio;
  - documento técnico;
  - juego;
  - práctica;
  - ruta de aprendizaje: varios contenidos en orden, con certificado final.
- **Nivel:** básico, intermedio o avanzado.
- **Idiomas:** español, inglés y portugués.
- **Inglés:** nivel CEFR de A1 a C2.
- **Otros datos de cada contenido:** expertos, aliado (proveedor), duración y si da certificado.
- **Filtros del catálogo:**
  - tipo de contenido;
  - competencia;
  - habilidad;
  - aliado;
  - nivel;
  - nivel de inglés;
  - si da certificado.

---

## 3. Las competencias y sus habilidades (35, sacadas de la API de Learn)

| Competencia | Habilidades |
|---|---|
| Accountability | Autogestión, integridad, proactividad, orientación a resultados, ownership |
| Administración de negocios | Análisis económico, control de gestión, estrategia, sostenibilidad y RSE, gestión legal |
| Agilidad | Metodologías ágiles |
| Comunicación | Comunicación efectiva, gestión de stakeholders, hablar en público, marca personal, protocolo y etiqueta empresarial, redacción y ortografía |
| Data skills | Analítica de personas, analítica en marketing, análisis de datos, big data, cómputo en la nube, gestión de calidad, IA, BI, probabilidad y estadística, visualización de datos, NoSQL |
| Desarrollo de software | DevOps, herramientas no code, herramientas de desarrollo, pensamiento computacional, software testing |
| Desarrollo web | Backend, frontend, diseño de APIs |
| Desarrollo mobile | React Native |
| Digital skills | Contenido digital, diseño gráfico digital, tendencias digitales, transformación digital |
| Emprendimiento | Intraemprendimiento, modelos de negocio, propuesta de valor |
| Experiencia del cliente | CRM, diseño de CX, manejo de objeciones, servicio al cliente |
| Gestión de procesos y operaciones | Automatización de procesos, servicios financieros, cadena de suministro, gestión de procesos, hospitality, retail, sistemas de gestión, e-operations, cumplimiento |
| Gestión de proyectos | Control y planeación de proyectos |
| Gestión de recursos tecnológicos | Arquitectura TI, ciberseguridad, derecho digital, gestión documental, infraestructura tecnológica |
| Gestión del cambio | Adaptabilidad, aprendizaje continuo, mejora continua, pensamiento sistémico |
| Gestión del riesgo | Continuidad del negocio, riesgo financiero y LAFT, riesgo operativo, seguridad de la información |
| Gestión financiera | Estados financieros, control financiero, gestión contable, planeación financiera |
| Herramientas tecnológicas | Bases de datos, Amazon, Google, Microsoft, herramientas colaborativas, de diseño, de ventas y de proyectos, Linux |
| Inglés | Grammar, listening, reading, speaking, writing, vocabulary |
| Innovación | Creatividad, ideación, pensamiento disruptivo, pensamiento exponencial |
| Inteligencia artificial | Machine learning |
| Inteligencia emocional | Autocompasión, autorregulación, empatía, resiliencia, automotivación |
| Lenguajes de programación | Java, JavaScript, Python, SQL, PHP, Ruby, C#, R |
| Liderazgo | Asertividad, autoconocimiento, coaching de equipos, empoderamiento, motivación, pensamiento estratégico, desarrollo personal del líder |
| Marketing | Branding, social media, storytelling |
| Marketing digital | Google Ads, Google Analytics, growth, inbound, product marketing |
| Negociación | Generación de acuerdos, persuasión |
| People management | Adquisición del talento, cultura organizacional, desarrollo del talento, diversidad, equidad e inclusión, experiencia del empleado, gestión del desempeño, relaciones laborales, seguridad y salud en el trabajo, teletrabajo |
| Product design | Design thinking, UI, UX, prototipado, UX research |
| Productividad | Gestión del tiempo, organización, planificación |
| Resolución de problemas | Análisis de escenarios, pensamiento crítico, toma de decisiones |
| Trabajo en equipo | Gestión del conflicto, relacionamiento, trabajo colaborativo |
| Ventas | Cierre, ciclo de ventas, gestión del equipo comercial, prospección, venta consultiva |
| Wellness | Alimentación saludable, balance de vida, salud financiera, salud física, salud mental y emocional |
| e-Commerce | Estrategia digital, plataformas de e-commerce, funnel de conversión |
| Cumplimiento (Compliance) | Data & IT, cumplimiento financiero, gobierno corporativo, HSEQ y riesgos laborales, legislación laboral, cumplimiento operativo y de calidad |

La lista viene de un ejemplo de respuesta de la API, y le quité las entradas de prueba. La lista vigente se saca con `competences/export.csv`.

---

## 4. Catálogos

- **Catálogos UBITS (comerciales):**
  - Standard;
  - Max;
  - Executive;
  - UBITS College.

  Al crear una empresa se le comparten según lo que contrató.
- **Universidad corporativa (contenido propio):**
  - el catálogo propio de cada empresa, con su logo, imagen y eslogan;
  - categorías;
  - un buscador de sus propios contenidos.
- **Sence (Chile):**
  - **Catálogo Sence:** se comparte con empresas y los usuarios se matriculan.
  - **Catálogo Sence e-learning:** se opera con órdenes de compra; UBITS actúa como OTEC ante Sence.
  - **Requisitos de Sence:** el usuario entra con su RUN y Clave Única, y se reporta el avance y la nota final.
  - ⚠️ La documentación dice que hoy hay un solo curso e-learning certificado. No prometer catálogo Sence amplio sin confirmar.

---

## 5. Ejemplos de cursos que aparecen en la documentación

Sirven de referencia del estilo y los temas. **Confirmar que sigan vigentes antes de citarlos por nombre.**

- **Compliance y riesgo** (los más terminados del catálogo Max en 2024):
  - ¿Gestión del riesgo operacional es administración de calidad total?
  - Riesgo reputacional: ¿qué es y cómo prevenirlo?
  - 3 razones por las que tu organización debe gestionar riesgos ASG
  - 5 etapas clave de una auditoría interna
  - ¿Cómo gestionar la ciberseguridad y protección de datos en tu organización?
  - Conoce las actividades vulnerables en México y obligaciones de quienes las realizan
  - Cumplimiento financiero
  - Conoce el caso Petrobras y el lavado de dinero
  - Gestión de la continuidad del negocio con BIA
  - 9 mejores prácticas para la prevención de intrusiones en Chile
- **Liderazgo y negocio:**
  - Siete habilidades de un buen líder
  - 4C para líderes de equipo
  - Autoconocimiento y liderazgo
  - Prácticas y técnicas de coaching ejecutivo (ruta)
  - Lecciones de la historia para un management efectivo
  - Planeación estratégica para unidades de negocio
  - Transfórmate en un consultor de negocios increíble
  - Generación de modelos de negocio innovadores
  - Cambia tu misión y visión a un propósito inspirador
  - Estrategia personal: la gestión de nuestro «felizómetro»
  - Neuroproductividad
- **Ventas:**
  - Venta inteligente
- **Tecnología y datos:**
  - Pon en práctica la filosofía del Scrum Master
  - Vuélvete un maestro en Scrum
  - Excel básico para principiantes
  - Aplica herramientas de análisis estadístico en Excel
  - Automatiza la gestión de datos con macros en Excel
  - Introducción a Excel (ruta)
  - ITIL 4: gestión de servicios de TI
  - Microsoft Azure: aspectos básicos
  - Introduction to Amazon Kinesis Streams (ruta)
  - Introducción a GNU Linux con Código Facilito (ruta de 17 contenidos)
  - Ética en la inteligencia artificial
  - ¿Qué es la IA realmente? (charla)
  - Legal tech: introducción a blockchain (ruta)
- **Inglés:**
  - English language learning: B2+ tips and strategies (ruta)

---

## 6. Productos

### Aprendizaje (Learn)
- **Learner (la experiencia del colaborador):**
  - **Home**;
  - **Modo Estudio AI:** tutor por chat de 2 a 5 minutos que sólo recomienda contenidos que existen y prioriza el plan de la empresa;
  - **Catálogo**;
  - **Universidad corporativa**;
  - **Zona de estudio:** plan de contenidos, plan de competencias, historial y certificados;
  - **Progreso:** el líder ve el de su equipo y tiene un agente para crear planes;
  - **Rutas.**
- **Creator / LMS:**
  - contenidos con secciones;
  - páginas de video, PDF protegido, texto, embebidos, SCORM, evaluación y encuesta;
  - rutas, categorías, certificados y reportes por estudiante;
  - migración desde Moodle.
- **Planes de formación:**
  - por contenidos o por competencias;
  - para una persona, un grupo, un CSV o toda la empresa;
  - con agente de plan de formación y Assessments psicométricos.
- **LMS AI / AI Studio:**
  - agentes que convierten PDFs y manuales en cursos;
  - generan la estructura, las imágenes y la portada, las evaluaciones, el SCORM, la narración y el video;
  - tienen un evaluador por roleplay;
  - funcionan con créditos.
- **Colecciones:**
  - RAG sobre manuales y procedimientos de la empresa;
  - el colaborador pregunta por chat en medio de la operación, sobre todo desde el móvil;
  - se vende con bolsa de créditos.
- **App UBITS:** el canal para llegar a la población operativa.
- **Learn API:** competencias, habilidades, contenidos, historial y planes.

### Desempeño y talento (Talent)
- **Evaluaciones 360:**
  - jefes, pares, clientes internos y reportes;
  - un agente que arma la evaluación;
  - generación del PDI y de planes desde los resultados;
  - resumen con IA y recomendación de cursos.
- **Objetivos v2:**
  - objetivos SMART;
  - mínimos y máximos;
  - niveles de desempeño;
  - evidencias y comentarios;
  - reportes en tiempo real.
- **9 Box.**
- **Encuestas:**
  - eNPS, trimestral o semestral;
  - Clima, anual o semestral, con umbral de anonimato;
  - encuestas libres con banco de preguntas.
- **Tareas / planes de desarrollo:** con el modelo 70-20-10.

### Reclutamiento (Hiring)
- **En producción:**
  - evaluación de CV con IA;
  - etapa Serena AI;
  - **Agente Roleplay:** una llamada simulada que mide manejo de objeciones, persuasión, escucha y adaptabilidad.
- **En desarrollo (no ofrecer como disponible):**
  - Agente de Idiomas (evalúa el idioma en una conversación);
  - Agente Hunter;
  - bolsa de candidatos;
  - compartir la vacante con el hiring manager.
- **Integración con el ATS** del cliente vía Kombo.

### Core / HRIS
- Portal del empleado, ficha del empleado, directorio, organigrama y comunicaciones corporativas.
- Roles y permisos, SSO y API de altas y bajas.
- Integraciones con BUK, Novasoft y Kombo (HRIS, nómina y ATS).
- SAP SuccessFactors: **en planeación**.

### Transversal
- Implementación con consultores de CS expertos en RR. HH.
- Analítica de aprendizaje por competencias, antes y después.

---

## 7. De la señal al producto (para Rumbo)

| Señal de la empresa | Qué ofrecer |
|---|---|
| Contrata mucho o abre vacantes masivas | Reclutamiento (CV con IA, Roleplay) + onboarding en la universidad corporativa (Creator) |
| Abre sedes o sucursales, o se expande a otro país | App + onboarding estandarizado + Colecciones (manuales consultables) + Comunicaciones corporativas |
| Mucha población operativa o de primera línea | App, shorts, Colecciones |
| Sector regulado (banca, seguros, minería, energía, salud) | Competencias Compliance y Gestión del riesgo (LAFT, riesgo operativo, auditoría, HSEQ, seguridad de la información) |
| Empresa en Chile | Catálogo Sence (confirmar la disponibilidad del e-learning) |
| Transformación digital, IA, datos | Data skills, inteligencia artificial, digital skills, herramientas tecnológicas (aliados AWS y Microsoft) |
| Fusión, reestructuración o cambio de líder | Gestión del cambio, liderazgo, comunicaciones corporativas, organigrama |
| Nuevo líder de RR. HH. o de talento | Diagnóstico: encuesta de clima, eNPS, 360 → plan de formación por competencias |
| Equipo comercial o retail grande | Ventas (venta consultiva, prospección, cierre), experiencia del cliente, negociación |
| Inglés como requisito o empresa multinacional | Academia de inglés (CEFR A1–C2) |
| Usa Moodle u otro LMS | Migración a Creator + catálogo UBITS encima |
| Tiene muchos manuales y procedimientos | AI Studio (manual → curso) y Colecciones |
| Rotación o bienestar en las noticias | Wellness, eNPS, clima, experiencia del empleado |
| Líderes nuevos o promociones | Liderazgo, coaching de equipos, 360, 9 Box |

---

## Fuentes (IDs de páginas de Confluence)

| Tema | Páginas |
|---|---|
| Oferta de valor | 2846949378 |
| Licencias | 2565570577 |
| UBITS MAX | 2451177623 |
| Catálogo | 2547417162 |
| Contenido | 2547417124 |
| Rutas | 2894856193 |
| Academia | 2878144513 |
| Competencias recomendadas (lista completa) | 3458170882 |
| Exports CSV | 4056416272, 4056416258 |
| Cursos más vistos | 2934145025 |
| Estructura de producto y de navegación | 4124278785, 4123852801 |
| Sence | 4227792974, 4030824449 |
| Modo Estudio AI | 4218880010 |
| Colecciones | 4218847233 |
| Hiring | 4074045445, 4080041986, 4080042017, 4098064391, 4149936130 |
| Encuestas | 2948825095, 2948431878 |
| Objetivos v2 | 3425402887 |
| Core | 3014328321, 2587426828, 3245768720, 3548839937, 3245867012, 3245801475, 4081319937, 4178477057 |
