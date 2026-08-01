# Portfolio presentation

## One-line summary

Turn Rotation is a concurrency-safe salon operations PWA that explains and
audits fair customer assignments across shared dollar and haircut rotations.

## CV-ready description

Built a mobile-first salon operations PWA with Next.js, TypeScript, Supabase
PostgreSQL/Auth/Realtime, AWS Amplify, and Amazon Textract. Designed a
transactional rotation engine with optimistic concurrency, qualification-aware
assignment explanations, append-only turn ledgers, RLS authorization, offline
safe mode, manager audit workflows, and automated unit, migration,
accessibility, and browser testing.

## Suggested CV bullets

- Engineered a deterministic PostgreSQL assignment engine for master and shared
  haircut rotations, using atomic commands and state versions to prevent
  conflicting multi-device assignments.
- Implemented role- and location-scoped Supabase RLS, append-only audit/credit
  events, manager corrections, busy-mode qualifications, and explainable skip
  decisions.
- Integrated private menu uploads with Amazon Textract and a mandatory
  human-review workflow; deployed the Next.js PWA through AWS Amplify.
- Added responsive phone/tablet workflows, privacy-safe offline summaries,
  Playwright/axe accessibility scans, and CI verification across TypeScript,
  SQL migrations, and business-rule tests.

## Demonstration script

1. Sign in as manager, open the workday, and clock employees in by arrival time.
2. Show master and haircut queues plus waiting customers on the tablet dashboard.
3. Add a haircut and explain why the recommendation follows the shared haircut
   rotation independently of a prior $30 nail turn.
4. Complete partial and full-turn services and inspect the daily history values.
5. Demonstrate busy mode, a refusal/customer request, and an auditable correction.
6. Upload a service menu, review Textract confidence/evidence, edit a draft, and
   confirm it without duplicating an existing service.
7. Disconnect the network to show read-only aggregate status and blocked writes.

Add final screenshots and the demonstration-video URL here after deployment.
