# System architecture

Turn Rotation keeps business rules in PostgreSQL transactions and uses the
Next.js application as a secure presentation and orchestration layer. Realtime
messages trigger refreshes; they never calculate or mutate rotation order.

```mermaid
flowchart LR
  Manager["Manager browser/PWA"] --> Amplify["AWS Amplify Hosting\nNext.js App Router"]
  Staff["Staff browser/PWA"] --> Amplify
  Amplify --> Auth["Supabase Auth"]
  Amplify --> API["Supabase Data API"]
  API --> RLS["PostgreSQL + RLS"]
  RLS --> Commands["Transactional command functions"]
  Commands --> Projections["Rotation projections"]
  Commands --> Events["Append-only events and ledgers"]
  Events --> Realtime["Supabase Realtime"]
  Realtime --> Manager
  Realtime --> Staff
  Manager --> Storage["Private Supabase Storage"]
  Storage --> Edge["Supabase Edge Function"]
  Edge --> Textract["Amazon Textract"]
  Textract --> Edge
  Edge --> Drafts["Manager-reviewed import drafts"]
  Drafts --> RLS
```

## Trust boundaries

- The browser receives only the Supabase project URL and publishable key.
- Supabase RLS enforces role and location boundaries even if a client bypasses
  the user interface.
- Rotation-changing commands validate the expected state version and commit the
  projection, business events, and audit evidence atomically.
- AWS credentials and the Supabase secret key exist only in the Edge Function
  secret environment.
- Textract results remain inactive drafts until a manager confirms them.
- The service worker caches no authenticated HTML. Its offline snapshot contains
  aggregate counts only.

## Core entity relationships

The production schema contains additional command, audit, correction, and
integration tables. This diagram focuses on the relationships needed to explain
the central workflow.

```mermaid
erDiagram
  SALON_LOCATIONS ||--o{ EMPLOYEES : employs
  SALON_LOCATIONS ||--o{ WORKDAYS : opens
  USER_PROFILES ||--o| EMPLOYEES : may_link_to
  EMPLOYEES ||--o{ EMPLOYEE_QUALIFICATIONS : has
  SERVICES ||--o{ EMPLOYEE_QUALIFICATIONS : qualifies_for
  SERVICE_CATEGORIES ||--o{ SERVICES : groups
  SERVICES ||--o{ SERVICE_PRICE_VERSIONS : prices
  WORKDAYS ||--o{ ROTATION_ENTRIES : projects
  EMPLOYEES ||--o{ ROTATION_ENTRIES : occupies
  WORKDAYS ||--o{ CUSTOMER_VISITS : receives
  CUSTOMER_VISITS ||--o{ VISIT_SERVICES : requests
  SERVICES ||--o{ VISIT_SERVICES : selected_as
  CUSTOMER_VISITS ||--o{ ASSIGNMENT_DECISIONS : evaluated_by
  EMPLOYEES ||--o{ ASSIGNMENT_DECISIONS : assigned_to
  ASSIGNMENT_DECISIONS ||--o{ SERVICE_ASSIGNMENTS : starts
  SERVICE_ASSIGNMENTS ||--o{ TURN_CREDIT_EVENTS : credits
  EMPLOYEES ||--o{ COMPLETED_TURNS : earns
  SERVICE_MENU_IMPORTS ||--o{ SERVICE_MENU_LINES : extracts
  SERVICE_MENU_IMPORTS ||--o{ SERVICE_IMPORT_DRAFTS : proposes
  SERVICES ||--o{ SERVICE_IMPORT_DRAFTS : may_update
```

## Command lifecycle

```mermaid
sequenceDiagram
  participant UI as Manager UI
  participant DB as PostgreSQL command
  participant Log as Event/audit tables
  participant RT as Realtime
  UI->>DB: Command + expected state version
  DB->>DB: Authorize role/location
  DB->>DB: Validate eligibility and version
  alt valid
    DB->>DB: Update projection
    DB->>Log: Append business and audit events
    DB-->>UI: Committed result + new version
    DB-->>RT: Committed row changes
    RT-->>UI: Refresh notification
  else stale or invalid
    DB-->>UI: Explicit conflict/error
  end
```
