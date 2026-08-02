# Turn Rotation

[![CI](https://github.com/finnnguyen/turn-rotation/actions/workflows/ci.yml/badge.svg)](https://github.com/finnnguyen/turn-rotation/actions/workflows/ci.yml)

**Live:** [main.d1fp0wl4mlqx0q.amplifyapp.com](https://main.d1fp0wl4mlqx0q.amplifyapp.com)

A transparent, auditable employee rotation system for a nail and hair salon —
managers open the day, clock staff in by arrival order, and intake walk-ins;
the app recommends who's next and why, tracks a shared dollar rotation and an
independent haircut rotation, and keeps a full audit trail so every decision
is reconstructable.

Built on Next.js (App Router, Server Actions) and Supabase (Postgres, Row
Level Security, Auth, Realtime), deployed on AWS Amplify with Amazon Textract
for manager-reviewed service-menu import. Error tracking via Sentry.

## Engineering Highlights

The parts of this project built the way a real production system needs to
work, not just the way that ships fastest:

- **Fairness rules enforced in the database, not the app.** Rotation
  advancement, dollar/haircut balances, and position changes all happen
  inside atomic Postgres functions (`lock_and_increment_rotation`,
  `start_visit_services`) — a race between two managers on different devices
  cannot produce an inconsistent queue, regardless of what the request-handling
  code does.
- **Optimistic concurrency with real conflict detection.** Every
  state-changing RPC takes an `expected_state_version` and rejects stale
  writes instead of silently overwriting them, so two people confirming
  assignments at the same moment can't corrupt shared state.
- **Concurrency safety enforced with partial unique indexes**, not
  application checks — `assignment_reservations_one_active_per_employee` and
  `workdays_one_active_per_location` make double-booking an employee or
  opening two concurrent workdays a constraint violation, not a bug to catch
  in code review.
- **Idempotency keys on every command.** Assignment confirmation and service
  completion accept a client-supplied idempotency key, so a retried request
  after a dropped connection replays the same result instead of double-applying.
- **Row Level Security as the actual authorization model.** Manager and staff
  access rules live in Postgres policies (`private.is_manager_at`,
  `private.current_user_role`), not scattered `if` checks in route handlers
  that are easy to miss on the next endpoint.
- **Real behavioral tests, not shallow assertions.** `tests/integration/`
  exercises the actual RPC path against a local Postgres instance to verify
  dollar/master and haircut rotation fairness end-to-end — confirmed by
  mutation testing (deliberately breaking the logic and checking the test
  fails) rather than just checking that migrations apply.
- **CI runs the integration suite against real Postgres**, not mocks — one
  job spins up the local Supabase stack in Docker, applies migrations,
  lints the schema, and runs the behavioral tests before anything merges.
- **Error tracking wired through the real request lifecycle.** Sentry
  captures server, edge, and client errors via Next.js instrumentation hooks,
  with source maps uploaded on every build so production stack traces
  resolve to real source, not minified output.
- **AI-assisted import with a mandatory human gate.** Amazon Textract
  extracts services from an uploaded price list, but nothing is published to
  the catalog without manager review and confirmation.
- **Privacy-aware offline mode.** The service-worker cache never stores
  authenticated dashboard HTML or customer/employee names — the offline
  fallback shows only last-synced aggregate counts and blocks writes that
  could conflict with newer server state.
- **Accessibility checked in CI, not just by hand.** Playwright + axe-core
  scan public routes on every push, alongside lint, typecheck, unit tests,
  and a full production build gate on `main`.

## Fairness rules represented

- Daily arrival order initializes one master rotation.
- Qualified haircut staff also share one haircut rotation; every haircut
  advances that rotation to prevent the same person taking consecutive
  haircut walk-ins.
- Dollar services combine across categories until exactly $30 or more
  completes a turn; smaller services preserve the employee's master position.
- Men's haircuts contribute one-third and women's haircuts one-half to
  haircut credit, while the haircut queue still advances after each haircut.
- Qualifications, availability, the 15-minute wait rule, requests,
  appointments, refusals, busy-only specialties, and manager overrides
  remain explicit and auditable.
- Daily partial credits reset rather than carrying into the next workday.

## Documentation

- [Implementation backlog and milestone plan](./IMPLEMENTATION_BACKLOG.md)
- [System architecture and entity relationships](./docs/architecture.md)
- [Deployment, backup, recovery, and rollback runbook](./docs/deployment.md)
- [Portfolio summary, CV bullets, and demonstration script](./docs/portfolio.md)
- Architecture decisions:
  [transactional PostgreSQL](./docs/decisions/0001-transactional-postgresql-rotation.md),
  [Supabase backend](./docs/decisions/0002-supabase-backend.md),
  [AWS Amplify Hosting](./docs/decisions/0003-amplify-hosting.md), and
  [manager-reviewed Textract](./docs/decisions/0004-textract-reviewed-import.md)

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

Local Supabase reports its API URL and publishable key after startup. Copy
those values into `.env.local`.

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
manager exists, normal catalog changes are protected by manager-checked RLS
and database functions.

## Production deployment

- Application: <https://main.d1fp0wl4mlqx0q.amplifyapp.com>
- Hosting: AWS Amplify, connected to the GitHub `main` branch
- Backend: hosted Supabase PostgreSQL, Auth, Realtime, Storage, and Edge Functions
- AWS feature: Amazon Textract service-menu extraction with manager review
- Cost safeguard: account-wide AWS zero-spend budget notification

The production smoke test covered manager authentication, seeded catalog
data, workday and rotation operations, and the complete private menu-upload
flow. Textract detected 51 lines from the sample price list and created 41
editable drafts; no extracted service was published without manager
confirmation.

## Status

All planned milestones (M0–M8) are complete: project foundation; identity and
catalog; workdays and rotations; customer intake and the assignment engine;
turn accounting; operational fairness (busy mode, refusals, corrections);
transparency and daily history; AWS Textract-assisted service import; and
production readiness. See [`IMPLEMENTATION_BACKLOG.md`](./IMPLEMENTATION_BACKLOG.md)
for the full milestone-by-milestone breakdown.
