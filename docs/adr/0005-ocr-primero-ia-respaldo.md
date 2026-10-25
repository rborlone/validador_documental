# ADR-0005: Tesseract y reglas por template primero, Claude como respaldo

- Estado: propuesto
- Fecha: 2026-10-24

## Contexto y problema
Los documentos llegan como PDF con texto, PDF escaneado o imagen. Hay que identificar el tipo, extraer campos a JSON y validar vigencia, totales y autenticidad. ¿Todo con IA o con OCR y reglas?

## Decisión
Pipeline determinista primero: PyMuPDF lee el texto si existe; si no, OpenCV limpia la imagen y Tesseract (`spa+eng`) hace el OCR. Cada tipo de documento tiene un **template YAML versionado** (palabras clave para clasificar, patrones de extracción y reglas). Claude (Anthropic API) entra solo cuando la clasificación tiene baja confianza, cuando faltan campos, y como una señal visual más en autenticidad (nunca decide solo). Las validaciones de totales, RUT y vigencia son siempre reglas en código, no IA.

## Consecuencias
- Resultados reproducibles y auditables. Cada campo indica su origen (`text`, `ocr`, `llm`) y su confianza.
- Menor costo y latencia: la IA se usa solo cuando hace falta. Sin `ANTHROPIC_API_KEY`, el sistema funciona solo con reglas.
- La detección de falsificación es una **estimación de riesgo** basada en señales (metadatos, ediciones incrementales, inconsistencias texto/OCR, ELA), no una prueba. Los casos de riesgo medio o alto quedan en `REVIEW` para una persona.
- Agregar un tipo de documento = un template YAML + un schema, sin tocar el pipeline.
- La validación de firma (digital y visual) es una funcionalidad futura; hoy se reporta `NOT_IMPLEMENTED`.
