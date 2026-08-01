# ADR 0004: Amazon Textract with mandatory manager review

Status: accepted

## Context

Service menus often begin as photographs, but OCR can misread prices or associate
text with the wrong category. Automatically publishing OCR output would create
operational and pricing risk.

## Decision

Store menu images privately, call Amazon Textract `DetectDocumentText` from an
authenticated manager-only Edge Function, retain line/confidence evidence, and
create editable drafts. No service becomes active until explicit confirmation.

## Consequences

The integration demonstrates an external AWS ML service while keeping a human in
the loop. Managers do more review work, but incorrect OCR cannot silently alter
the live catalog.
