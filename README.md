# Turn Rotation

Turn Rotation is a transparent, auditable employee rotation system for a nail
and hair salon. It is designed around actual arrival order, employee
qualifications, availability, service value, a shared haircut rotation, and
plain-language assignment explanations.

## Users and problem

Salon managers need to assign walk-ins quickly without losing arrival order,
specialty restrictions, partial-credit progress, appointments, breaks, or
customer requests. Employees need to understand why they received—or did not
receive—a customer. Turn Rotation gives managers an operational dashboard while
giving every decision a reconstructable rule and audit trail.

- Managers open/close workdays, clock staff in, intake customers, confirm
  assignments, manage busy mode, correct mistakes, review history, and maintain
  the service catalog.
- Staff see their position and status, manage approved breaks, complete assigned
  work, and view their own history within RLS boundaries.

## Fairness rules represented

- Daily arrival order initializes one master rotation.
- Qualified haircut staff also share one haircut rotation; every haircut advances
  that rotation to prevent the same person taking consecutive haircut walk-ins.
- Dollar services combine across categories until exactly $30 or more completes a
  turn; smaller services preserve the employee's master position.
- Men's haircuts contribute one-third and women's haircuts one-half to haircut
  credit, while the haircut queue still advances after each haircut.
- Qualifications, availability, the 15-minute wait rule, requests, appointments,
  refusals, busy-only specialties, and manager overrides remain explicit and
  auditable.
- Daily partial credits reset rather than carrying into the next workday.

The product and implementation plan is documented in
[`IMPLEMENTATION_BACKLOG.md`](./IMPLEMENTATION_BACKLOG.md).

## Architecture and portfolio

- [System architecture and entity relationships](./docs/architecture.md)
- [Deployment, backup, recovery, and rollback runbook](./docs/deployment.md)
- [Portfolio summary, CV bullets, and demonstration script](./docs/portfolio.md)
- Architecture decisions:
  [transactional PostgreSQL](./docs/decisions/0001-transactional-postgresql-rotation.md),
  [Supabase backend](./docs/decisions/0002-supabase-backend.md),
  [AWS Amplify Hosting](./docs/decisions/0003-amplify-hosting.md), and
  [manager-reviewed Textract](./docs/decisions/0004-textract-reviewed-import.md)

## Implemented milestones

### Milestone 0 — Project foundation

- Next.js App Router with strict TypeScript
- Tailwind CSS
- Vitest and Testing Library
- Playwright browser-test configuration
- Supabase local-project configuration
- Safe public-environment validation
- GitHub Actions quality checks
- AWS Amplify-compatible production build

### Milestone 1 — Identity and catalog

- Cookie-based Supabase SSR authentication
- Verified claims for protected server-rendered routes
- Manager and staff roles enforced through PostgreSQL RLS
- Location-scoped employee profiles
- Effective-dated qualifications
- Service categories and calculation types
- Non-overlapping historical price versions
- Manager interfaces for employees, qualifications, services, and prices
- Seeded salon, employee, specialty, service, and rule data
- Database migration/reset/lint checks in CI

## Local setup

Requirements:

- Node.js 20.9 or newer
- npm
- Docker-compatible runtime when running Supabase locally
- Supabase CLI when running the local backend

Install dependencies:

```bash
npm install
```

Create local environment settings:

```bash
cp .env.example .env.local
```

Start the web application:

```bash
npm run dev
```

Start and rebuild the local Supabase stack:

```bash
supabase start
supabase db reset
```

Local Supabase reports its API URL and publishable key after startup. Copy those
values into `.env.local`.

Run quality checks:

```bash
npm run check
```

Run the behavioral integration tests for the rotation/assignment engine
(requires `supabase start` — see above). These call the real RPC functions
against local Postgres as an authenticated manager, the same way the app
does — the fairness rules live entirely in `supabase/migrations/`, and
nothing else in this repo exercises that logic end-to-end. `npm run check`
does not run these, since it's meant to work without Supabase running:

```bash
npm run test:integration
```

Run browser tests after installing Playwright Chromium:

```bash
npx playwright install chromium
npm run test:e2e
```

## Environment and secrets

Only Supabase URL and publishable-key settings use the `NEXT_PUBLIC_` prefix.
Supabase secret keys and AWS credentials must remain in backend secret stores
and must never be exposed to the browser or committed to Git.

## Supabase project setup

1. Create a new Supabase project for development.
2. Link the repository:

   ```bash
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF
   ```

3. Apply the migrations:

   ```bash
   supabase db push --dry-run
   supabase db push
   ```

4. In the Supabase API settings, add `app` to the exposed schemas alongside
   `public` and `graphql_public`.
5. For a brand-new personal demo project only, load `supabase/seed.sql` after
   reviewing it. Do not seed an existing production database.

The seed contains business demonstration data but no login-capable users or
shared passwords.

## Bootstrap the first manager

Public registration is disabled. Create the first user through Supabase
Dashboard → Authentication → Users. Give the user metadata containing a
`display_name`, then run this once in the SQL editor, replacing the email:

```sql
update app.user_profiles
set
  role = 'manager',
  primary_location_id = '00000000-0000-0000-0000-000000000001'
where id = (
  select id
  from auth.users
  where email = 'manager@example.com'
);

insert into app.employee_location_memberships (user_id, location_id)
select
  id,
  '00000000-0000-0000-0000-000000000001'
from auth.users
where email = 'manager@example.com'
on conflict do nothing;
```

This bootstrap is intentionally an administrative setup step. After the first
manager exists, normal catalog changes are protected by manager-checked RLS and
database functions.

## Migration layout

- `20260730000100_foundation.sql` — schemas, extensions, enums
- `20260730000200_identity_and_employees.sql` — locations, profiles, roles, RLS
- `20260730000300_service_catalog.sql` — categories, services, price history
- `20260730000400_qualifications_and_rules.sql` — specialties and approved rules

Run `supabase db reset` against a local project after every migration change.
The command recreates the local database, applies migrations in order, and then
loads the seed.

## Current status

Milestones 0 and 1 establish the application, identity, authorization, employee
specialty, service-catalog, and historical-pricing foundations. Workday opening,
clock-in order, employee status, and live master/haircut rotations begin in
Milestone 2.
## Milestone status

- M0 — Project foundation: complete
- M1 — Identity and catalog: complete
- M2 — Workday and rotations: complete
- M3 — Customer intake and assignment engine: complete
- M4 — Turn accounting: complete
- M5 — Operational fairness: complete
- M6 — Transparency and daily history: complete
- M7 — AWS Textract-assisted service import: complete
- M8 — Production readiness and portfolio delivery: complete

### Production deployment

- Application: <https://main.d1fp0wl4mlqx0q.amplifyapp.com>
- Hosting: AWS Amplify, connected to the GitHub `main` branch
- Backend: hosted Supabase PostgreSQL, Auth, Realtime, Storage, and Edge Functions
- AWS feature: Amazon Textract service-menu extraction with manager review
- Cost safeguard: account-wide AWS zero-spend budget notification

The production smoke test covered manager authentication, seeded catalog data,
workday and rotation operations, and the complete private menu-upload flow.
Textract detected 51 lines from the sample price list and created 41 editable
drafts; no extracted service was published without manager confirmation.

### Installable app and offline policy

Milestone 8 adds a web-app manifest, maskable icon, phone navigation, visible
keyboard focus, reduced-motion support, and a service-worker-backed offline
fallback. The browser registers the service worker automatically when the app
loads.

For privacy, authenticated dashboard HTML and salon records are **not** written
to the browser cache. The offline page displays only last-synchronized aggregate
counts (queue sizes, waiting count, and available/serving totals), never customer
or employee names. It clearly reports the connection state and blocks form
submissions that could conflict with newer server state.

Playwright and axe-core scan public routes for automatically detectable
accessibility violations in CI. These checks complement keyboard and responsive
manual testing; they do not replace it.

Milestone 2 adds manager-controlled workday opening and closing, arrival-order
clock-in, employee availability and approved breaks, one master rotation, one
shared haircut rotation, append-only event history, optimistic state versions,
and Supabase Realtime dashboard refresh.

### Workday workflow

1. A manager opens the day. The active rule-set version is frozen onto that
   workday.
2. The manager clocks employees in using their actual arrival order. Every
   employee joins the end of the master rotation; qualified haircut staff also
   join the end of the shared haircut rotation.
3. Serving, available, and approved-break changes keep both queue positions.
4. Clocking out removes the employee from active positions. Returning on the
   same day places them at the end while retaining same-day partial balances.
5. Closing the day clears active positions and daily partial balances. Each
   change is retained in append-only clock, status, break, and rotation events.

All state-changing dashboard actions call database functions that authorize the
actor and update the projection, event history, and state version in one
transaction. Staff accounts can only change the employee linked to their own
profile; managers can operate the full team.

Milestone 3 adds anonymous or named customer tickets, walk-in and appointment
visit types, multi-service intake, deterministic master/haircut recommendations,
qualification and availability snapshots, the approved 15-minute wait rule,
candidate skip explanations, manager overrides, state-version checks, and
idempotent assignment confirmation.

Milestone 4 adds an explicit service lifecycle, historical listed-price capture,
separate dollar and haircut ledgers, $30 full-turn completion, men’s 1/3 and
women’s 1/2 haircut credit, haircut advancement after every haircut, master
advancement after a completed turn, idempotent completion, reservation release,
and auditable end-of-day partial-credit expiration.

Milestone 5 adds manager-controlled busy mode, busy-only qualification
eligibility, refusal penalties, approved no-penalty inability, customer-decline
conversion to requested visits, unstarted service-line transfers, compensating
balance corrections, and an immutable manager audit history.

Milestone 6 adds rebuildable daily location and employee summaries, separate
walk-in/requested/appointment statistics, listed service value, turns, partials,
haircuts, skips, refusals, corrections, overrides, status-time totals, and a
chronological event feed. Detailed staff history is restricted to the employee
linked to the signed-in account through database RLS.
