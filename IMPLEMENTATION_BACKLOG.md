# Turn Rotation — Implementation Backlog

## 1. Product objective

Build a mobile- and tablet-friendly salon rotation application that assigns customers transparently using arrival order, employee qualifications, availability, service value, and a shared haircut rotation.

The MVP must:

- Produce deterministic employee recommendations.
- Explain every assignment and skip.
- Track dollar-based and haircut-based turn progress separately.
- Prevent conflicting assignments across devices.
- Preserve original records when managers make corrections.
- Separate walk-ins, appointments, and requested customers in history.
- Run as a Next.js PWA hosted by AWS Amplify.
- Use Supabase for PostgreSQL, authentication, storage, real-time updates, and backend functions.
- Use Amazon Textract for a manager-reviewed service-menu import demonstration.

## 2. Approved technology

### Application

- Next.js with TypeScript
- React
- Tailwind CSS
- Installable Progressive Web App
- Vitest for unit and integration tests
- Playwright for end-to-end tests

### Backend

- Supabase PostgreSQL
- Supabase Auth
- PostgreSQL Row-Level Security
- PostgreSQL transactional functions for rotation-changing commands
- Supabase Realtime for committed-state notifications
- Supabase Edge Functions for external integrations
- Supabase Storage for private service-menu images

### AWS

- AWS Amplify Hosting for frontend deployment
- Amazon Textract `DetectDocumentText` for service-menu OCR

### Repository and delivery

- GitHub
- GitHub Actions
- SQL migrations committed to the repository
- Seed data for the seven approved employees and realistic test scenarios

## 3. Delivery principles

1. The database is the source of truth.
2. Rotation-changing operations execute as atomic server-side transactions.
3. Realtime announces committed changes; it does not calculate rotation.
4. Historical business events are append-only.
5. Corrections create compensating records rather than overwriting history.
6. The browser never receives Supabase secret keys or AWS credentials.
7. Manager authorization is enforced server-side and through Row-Level Security.
8. Every backlog story includes automated acceptance tests where practical.
9. Accessibility and phone/tablet usability are part of completion, not later polish.

## 4. Ordered development milestones

| Milestone | Outcome | Included epics |
|---|---|---|
| M0 — Project foundation | Repeatable local environment, CI, deployment skeleton | E0 |
| M1 — Identity and catalog | Secure users, employees, qualifications, services, and historical prices | E1–E3 |
| M2 — Workday and rotations | Clock-in, statuses, master rotation, and shared haircut rotation | E4–E5 |
| M3 — Assignment engine | Customer intake, eligibility, explanations, and concurrency-safe assignments | E6–E7 |
| M4 — Turn accounting | Service lifecycle, dollar credits, haircut fractions, and end-of-day reset | E8 |
| M5 — Operational fairness | Breaks, refusals, busy mode, requested customers, and corrections | E9–E11 |
| M6 — Transparency | Daily history, fairness summary, audit log, and staff views | E12 |
| M7 — AWS portfolio feature | Textract-assisted, manager-reviewed service import | E13 |
| M8 — Production readiness | PWA, responsive polish, security review, E2E tests, documentation, and launch | E14–E15 |

## 5. Database migration plan

Migration filenames should use timestamps or ordered numeric prefixes. Each migration must be forward-only in production, tested against an empty database, and tested as an upgrade from the preceding migration.

### Migration 0001 — Extensions, schemas, and shared types

Create:

- `app` schema for business tables
- `private` schema for privileged helper functions
- `audit` schema for append-only audit data
- UUID and timestamp conventions
- Updated-at trigger helper

Enumerations:

- `app_role`: `manager`, `staff`
- `qualification_level`: `primary`, `general`, `busy_only`, `cannot_perform`
- `workday_status`: `preparing`, `open`, `closing`, `closed`
- `employee_status`: `available`, `busy`, `break`, `unavailable`, `not_accepting_walk_ins`, `finished`, `clocked_out`
- `visit_type`: `walk_in`, `appointment`, `requested_walk_in`, `requested_appointment`
- `visit_status`: `waiting`, `assigned`, `in_service`, `completed`, `cancelled`, `no_show`
- `assignment_status`: `recommended`, `assigned`, `started`, `completed`, `cancelled`, `corrected`
- `turn_calculation_type`: `dollar`, `mens_haircut`, `womens_haircut`, `excluded`
- `rotation_type`: `master`, `haircut`
- `credit_type`: `dollar_partial`, `mens_haircut`, `womens_haircut`, `full_turn`, `reset`, `expiration`, `reversal`, `correction`
- `skip_type`: `unqualified`, `customer_declined`, `approved_break`, `approved_restriction`, `busy_over_limit`, `employee_refusal`, `busy_only_inactive`, `manager_override`, `other`

Acceptance criteria:

- Types can be created repeatedly in a clean test environment without migration-order ambiguity.
- All timestamps use `timestamptz`.
- All business records use UUID primary keys.

### Migration 0002 — Locations, profiles, and roles

Create:

- `app.salon_locations`
- `app.user_profiles`
- `app.employees`
- `app.employee_location_memberships`

Important fields:

- Every location includes timezone and active status.
- `user_profiles.id` references `auth.users.id`.
- Employees can exist without login accounts.
- Deactivation preserves historical relationships.

Constraints:

- A user has one active profile.
- An employee number or display name is unique per location when active.
- Role changes are auditable.

### Migration 0003 — Services, categories, and historical prices

Create:

- `app.service_categories`
- `app.services`
- `app.service_price_versions`

Important rules:

- Price versions use effective start/end timestamps.
- Historical prices are never updated by a later price change.
- A service has one turn-calculation type.
- Haircuts cannot also use dollar-based credit.
- Tips, taxes, and product sales are excluded by default.

Constraints:

- Price must be non-negative.
- Effective price ranges for one service/location cannot overlap.
- Inactive services remain queryable historically.

### Migration 0004 — Qualifications and rule versions

Create:

- `app.employee_qualifications`
- `app.daily_qualification_overrides`
- `app.rule_set_versions`

Initial rule values:

- Dollar threshold: `$30`
- Exact threshold qualifies: `true`
- Carry excess value: `false`
- Men’s haircut fraction: `1/3`
- Women’s haircut fraction: `1/2`
- Partial carryover to next day: `false`
- Customer wait limit: `15 minutes`
- Requested services affect rotation: `true`
- Requested haircuts advance haircut rotation: `true`

Constraints:

- Qualification history uses effective dates.
- Busy-only qualifications are excluded unless busy mode is active.
- A used rule version cannot be edited; changes create a new version.

### Migration 0005 — Workdays, clock events, and statuses

Create:

- `app.workdays`
- `app.clock_events`
- `app.employee_status_events`
- `app.break_periods`

Constraints:

- Only one open workday per location.
- Employees cannot be actively clocked into two workdays at the same location.
- Break end cannot precede break start.
- Closing a workday requires a manager command.

### Migration 0006 — Rotation state and event history

Create:

- `app.rotation_entries`
- `app.rotation_events`
- `app.rotation_state_versions`

`rotation_entries` contains the fast current projection:

- Master position
- Haircut position
- Dollar balance
- Haircut numerator/denominator or exact numeric fraction
- Current status
- State version

`rotation_events` records:

- Rotation type
- Event type
- Position before/after
- Triggering visit or assignment
- Applied rule
- Structured explanation details
- Actor and timestamp

Constraints:

- One active rotation entry per employee/workday.
- Active positions are unique within a workday and rotation.
- Balances cannot be negative.
- Current projections may be rebuilt from source events.

### Migration 0007 — Customers, visits, and appointments

Create:

- `app.customers`
- `app.customer_visits`
- `app.appointments`
- `app.appointment_services`

Important behavior:

- Anonymous walk-ins use a ticket number without requiring personal information.
- Requested employee is stored independently from assigned employee.
- Appointments have no rotation effect until a service starts.
- Cancellation and no-show reasons are retained.

### Migration 0008 — Recommendations, assignments, and participants

Create:

- `app.assignment_decisions`
- `app.assignment_candidates`
- `app.service_assignments`
- `app.service_participants`
- `app.service_transfers`

Store an immutable decision snapshot:

- Requested services
- Candidate order
- Qualification level
- Availability
- Estimated wait
- Skip reason
- Recommended employee
- Manager selection
- Override reason
- Rule version

Constraints:

- One service line cannot have two primary assignees.
- Shared allocations cannot exceed 100%.
- Captured listed price and price-version ID are required when service starts.
- Assignment idempotency keys are unique per location.

### Migration 0009 — Turn-credit ledger

Create:

- `app.turn_credit_events`
- `app.completed_turns`

Rules:

- Ledger entries are append-only.
- Dollar and haircut balances remain separate.
- A customer produces at most one dollar-based full turn per employee.
- Excess dollar or haircut progress is discarded after completion.
- Expiration events preserve end-of-day unfinished progress.
- Reversals reference the original ledger event.

### Migration 0010 — Busy mode, skips, refusals, and corrections

Create:

- `app.busy_mode_periods`
- `app.skip_events`
- `app.refusal_events`
- `app.correction_requests`
- `app.corrections`
- `audit.audit_events`

Constraints:

- Busy mode start/end requires a manager.
- Employee refusal moves the employee to the master rotation’s end.
- Approved breaks and haircut availability skips do not change position.
- Corrections require original value, corrected value, reason, manager, and affected record.
- Audit rows cannot be updated or deleted by application roles.

### Migration 0011 — OCR imports

Create:

- `app.service_imports`
- `app.service_import_lines`

Store:

- Private source-image path
- Import status
- Raw Textract response reference
- Extracted text
- Confidence
- Proposed service and price
- Manager-confirmed values
- Reviewer and review timestamp

No OCR result may create an active service or price without manager confirmation.

### Migration 0012 — Reporting projections

Create:

- `app.daily_employee_summaries`
- Reporting views for daily customer, revenue, turn, haircut, skip, refusal, status-time, correction, and requested-versus-walk-in totals

Summary rows must be rebuildable from business events.

### Migration 0013 — Row-Level Security

Enable RLS on all exposed tables.

Policies:

- Staff can read the live rotation for their location.
- Staff can read their own detailed history.
- Staff can create their own clock, status, and correction-request actions through approved functions.
- Managers can read location-wide operational and reporting data.
- Direct client writes to rotation, credit, correction, and audit tables are denied.
- Privileged changes occur only through security-definer functions with explicit authorization checks.
- Cross-location access is denied.

RLS tests must verify allowed and forbidden behavior for manager, staff, anonymous, inactive, and cross-location users.

### Migration 0014 — Transactional command functions

Create versioned PostgreSQL functions:

- `open_workday`
- `close_workday`
- `clock_in_employee`
- `clock_out_employee`
- `set_employee_status`
- `start_break`
- `end_break`
- `recommend_assignment`
- `confirm_assignment`
- `start_service`
- `add_service`
- `complete_service`
- `cancel_unstarted_service`
- `record_refusal`
- `activate_busy_mode`
- `deactivate_busy_mode`
- `apply_manager_correction`

All rotation-changing functions must:

1. Authenticate and authorize the caller.
2. Lock the workday/rotation version.
3. Validate an expected state version.
4. Detect a repeated idempotency key.
5. Write business and audit events.
6. Update current projections.
7. Increment the state version.
8. Return the committed rotation and explanation.

### Migration 0015 — Seed and demonstration data

Seed:

- One salon location
- Sheila, Tim, Finn, Tina, Liz, Christine, and Mary
- Approved qualifications
- Initial rule version
- Confirmed service catalog after manager review
- Optional deterministic Stage 9 demonstration workday

Production seed scripts must not create shared development passwords.

## 6. Product backlog

Priority definitions:

- P0: required to produce a trustworthy usable rotation
- P1: required for MVP completion
- P2: portfolio enhancement or post-MVP improvement

## E0 — Project foundation

### TR-001 — Initialize the application

Priority: P0

User story:

> As a developer, I need a reproducible project structure so that local, test, preview, and production environments behave consistently.

Tasks:

- Create Next.js TypeScript project.
- Configure formatting, linting, strict TypeScript, and import conventions.
- Configure Tailwind and base accessibility styles.
- Configure Vitest and Playwright.
- Add environment-variable validation.
- Add Supabase CLI configuration.
- Add `.env.example` without secrets.

Acceptance criteria:

- A new developer can start the app from documented commands.
- Lint, typecheck, unit tests, and production build run in CI.
- Missing required environment variables fail with a clear message.
- No service-role or AWS credential can be bundled into client code.

### TR-002 — Configure CI and Amplify preview deployment

Priority: P1

Acceptance criteria:

- Pull requests run lint, typecheck, unit tests, and migration tests.
- Main-branch builds deploy through Amplify.
- Preview and production environments use separate Supabase projects or clearly isolated schemas.
- Build failures do not replace the last successful production deployment.

## E1 — Authentication and authorization

### TR-010 — Manager and staff authentication

Priority: P0

Acceptance criteria:

- A manager can sign in and sign out.
- A staff member can sign in and sign out.
- Public registration is unavailable.
- Disabled accounts cannot access protected screens.
- Session expiration returns the user to login without losing an unsaved intake draft.

### TR-011 — Role-aware navigation

Priority: P0

Acceptance criteria:

- Staff do not see manager-only navigation.
- Directly opening a manager URL as staff returns an authorization screen.
- Server/database authorization blocks the action even if the client is modified.

### TR-012 — RLS verification suite

Priority: P0

Acceptance criteria:

- Automated tests cover manager, staff, anonymous, inactive, and cross-location access.
- Rotation and audit tables reject direct browser writes.

## E2 — Employee profiles and qualifications

### TR-020 — Manage employee profiles

Priority: P0

Acceptance criteria:

- Managers can add, edit, deactivate, and reactivate employees.
- Deactivation preserves historical records.
- Staff cannot modify profiles.

### TR-021 — Manage qualifications

Priority: P0

Acceptance criteria:

- Managers can assign primary, general, busy-only, or cannot-perform status.
- Qualifications may apply to a category or individual service.
- Historical qualification records remain available after changes.
- Sheila’s acrylic qualification can be represented as busy-only.

### TR-022 — Apply daily restrictions

Priority: P1

Acceptance criteria:

- Manager can add a temporary service restriction with a reason and effective time.
- Recommendation explanations show when a restriction caused a skip.
- The permanent employee profile remains unchanged.

## E3 — Services and price versions

### TR-030 — Manage service catalog

Priority: P0

Acceptance criteria:

- Manager can create, edit, deactivate, and categorize services.
- Each service has exactly one turn-calculation type.
- Haircut services cannot generate dollar turn credit.

### TR-031 — Manage historical prices

Priority: P0

Acceptance criteria:

- Manager can schedule a new listed price.
- Existing assignments retain their captured price.
- Overlapping effective price ranges are rejected.

### TR-032 — Record discounts and payment details separately

Priority: P1

Acceptance criteria:

- Listed value drives turn credit.
- Discounts, tips, and taxes are stored separately.
- A discounted $40 service still generates $40 qualifying value.

## E4 — Workday and attendance

### TR-040 — Open and close a workday

Priority: P0

Acceptance criteria:

- Only a manager can open or close a workday.
- Only one workday can be open per location.
- Closing is blocked while services remain active unless a manager resolves them.
- Partial dollar and haircut balances expire through ledger events.

### TR-041 — Clock in by actual arrival time

Priority: P0

Acceptance criteria:

- Clock-in time determines initial master position.
- Haircut-qualified employees join the haircut rotation.
- Identical timestamps trigger a manager-confirmed tie order.

### TR-042 — Clock out and return

Priority: P1

Acceptance criteria:

- Clock-out removes the employee from active rotations.
- Same-day return joins the end.
- Same-day partial balances remain intact.

## E5 — Rotation dashboard and status

### TR-050 — Display the live master rotation

Priority: P0

Acceptance criteria:

- Cards show position, name, status, dollar balance, haircut balance, and current customer.
- Changes committed on one device appear on another without manual refresh.
- Stale or disconnected state is visibly identified.

### TR-051 — Display the shared haircut rotation

Priority: P0

Acceptance criteria:

- One shared order covers men’s and women’s haircuts.
- Service eligibility can skip unqualified employees without moving them.
- Each employee’s haircut progress is visible independently from position.

### TR-052 — Manage availability and breaks

Priority: P0

Acceptance criteria:

- Staff can start/end approved status types.
- Breaks include an expected return.
- A break over the 15-minute limit permits no-penalty skipping.
- An employee cannot start a service while marked on break.

## E6 — Customer intake

### TR-060 — Add a customer visit

Priority: P0

Acceptance criteria:

- Manager can create walk-in, appointment, requested walk-in, and requested appointment visits.
- Anonymous walk-ins do not require personal data.
- Arrival time and ticket number are recorded.

### TR-061 — Select one or more services

Priority: P0

Acceptance criteria:

- Services are searchable and grouped by category.
- Current listed price and duration are visible.
- The app warns when no employee is qualified.

### TR-062 — Waiting-customer view

Priority: P1

Acceptance criteria:

- Shows arrival time, wait duration, requested services, and recommended/assigned employee.
- Waits approaching or exceeding 15 minutes are highlighted with text and iconography.

## E7 — Recommendation and assignment engine

### TR-070 — Produce a deterministic recommendation

Priority: P0

Acceptance criteria:

- Filters clocked-out, finished, restricted, unqualified, and unavailable employees.
- Busy-only qualifications remain excluded outside busy mode.
- Master or haircut order selects the next candidate as appropriate.
- Repeating the request against unchanged state returns the same result.

### TR-071 — Explain candidates and skips

Priority: P0

Acceptance criteria:

- Recommendation shows ordered eligible candidates.
- Every skipped employee has a rule-coded reason.
- Explanation includes qualification, availability, wait, customer request, and predicted turn effect.
- The saved explanation does not change when later statuses change.

### TR-072 — Confirm an assignment atomically

Priority: P0

Acceptance criteria:

- Confirmation checks expected rotation version.
- Two devices cannot assign the same service line twice.
- Repeated idempotency key returns the original result.
- A stale request fails with the current rotation and a clear recovery message.

### TR-073 — Manager override

Priority: P1

Acceptance criteria:

- Manager may select another eligible employee.
- Override reason is required.
- Original recommendation and final selection are both preserved.

## E8 — Service lifecycle and turn accounting

### TR-080 — Start a dollar-based service

Priority: P0

Acceptance criteria:

- Listed price is captured at start.
- Under-$30 value accumulates across eligible categories.
- Employee remains in position below $30.
- At $30 or greater, exactly one turn completes and employee moves to the master end.
- Excess value is discarded.

### TR-081 — Start a haircut

Priority: P0

Acceptance criteria:

- Men’s haircut adds `1/3`.
- Women’s haircut adds `1/2`.
- Performer moves to the haircut rotation’s end after every haircut.
- At one full haircut turn, progress resets and performer also moves to the master end.
- Requested haircuts advance the same haircut rotation.

### TR-082 — Preserve separate partial balances

Priority: P0

Acceptance criteria:

- Haircuts never change dollar balance.
- Dollar services never change haircut balance.
- Completing one balance does not erase the other.

### TR-083 — Add and complete services

Priority: P1

Acceptance criteria:

- Added service earns credit when it starts.
- Completion records actual service details without reapplying start credit.
- Removing an unstarted service earns no credit.
- Changes to started services require manager action.

### TR-084 — End-of-day expiration

Priority: P0

Acceptance criteria:

- Incomplete balances reset to zero at closing.
- Expired amounts remain in history and reports.
- Completed turns are never reset.

## E9 — Requests, skips, refusals, and busy mode

### TR-090 — Requested-customer handling

Priority: P0

Acceptance criteria:

- Requested service uses normal turn calculations.
- Requested work is reported separately.
- Customer rejection does not penalize the rejected employee.

### TR-091 — Record skips

Priority: P0

Acceptance criteria:

- Skip reason determines whether position changes.
- Unqualified, customer-declined, restriction, and approved-break skips have no penalty.
- Haircut employee occupied beyond 15 minutes retains both positions.

### TR-092 — Record employee refusal

Priority: P0

Acceptance criteria:

- Unapproved qualified refusal moves the employee to the master end.
- Manager-approved inability produces a no-penalty skip.
- Actor, reason, and explanation are auditable.

### TR-093 — Activate busy mode

Priority: P0

Acceptance criteria:

- Manager and reason are required.
- Busy-only qualifications become eligible.
- Dashboard displays a persistent busy-mode banner.
- Sheila can receive acrylic only while busy mode is active.
- Assignments started during busy mode retain their recorded eligibility context.

## E10 — Multi-employee visits

### TR-100 — Assign different services to different employees

Priority: P1

Acceptance criteria:

- One visit can contain multiple service assignments.
- Each employee receives credit only for their service lines.
- Visit total and employee qualifying values remain distinguishable.

### TR-101 — Shared-service allocation

Priority: P2

Acceptance criteria:

- Manager can allocate a shared service by percentage.
- Total allocation cannot exceed 100%.
- Each employee receives only allocated qualifying value.

## E11 — Corrections and immutable audit

### TR-110 — Request a correction

Priority: P1

Acceptance criteria:

- Staff can identify a record and describe the problem.
- Requesting a correction does not change business data.
- Manager can approve, reject, or ask for more information.

### TR-111 — Preview and apply a correction

Priority: P0

Acceptance criteria:

- Preview shows original and corrected credit and positions.
- Manager selects balance-only or balance-and-current-position correction.
- Correction writes reversal/compensating events.
- Original records remain visible.

### TR-112 — Audit log

Priority: P0

Acceptance criteria:

- Managers can filter by actor, employee, customer, event type, and date.
- Staff can view corrections affecting them.
- Application roles cannot edit or delete audit events.

## E12 — Daily history and fairness reporting

### TR-120 — Employee daily history

Priority: P1

Acceptance criteria:

- Staff can view their assignments, services, credits, skips, refusals, position changes, and corrections.
- Staff cannot view restricted details belonging to other employees.

### TR-121 — Manager daily summary

Priority: P1

Acceptance criteria:

- Shows walk-ins, requested customers, appointments, revenue, turns, partials, haircuts, available time, busy time, break time, skips, refusals, overrides, and corrections.
- Requested and walk-in statistics remain separate.
- Language reports patterns without declaring misconduct.

## E13 — Amazon Textract service import

### TR-130 — Upload a private service-menu image

Priority: P1

Acceptance criteria:

- Only managers can upload.
- JPEG and PNG are accepted within documented size limits.
- Original image is stored privately.
- Staff cannot retrieve the source image directly.

### TR-131 — Extract text through Textract

Priority: P1

Acceptance criteria:

- Authenticated Edge Function calls Textract.
- AWS credentials exist only in Edge Function secrets.
- Raw response, lines, bounding positions, and confidence are retained.
- Retries do not create duplicate imports.

### TR-132 — Review and confirm service drafts

Priority: P1

Acceptance criteria:

- Manager sees image and extracted lines together.
- Low-confidence values are highlighted.
- Manager can edit service name, category, price, and calculation type.
- No service becomes active without explicit confirmation.

## E14 — PWA, responsive UX, and accessibility

### TR-140 — Tablet dashboard layout

Priority: P1

Acceptance criteria:

- Waiting customers and rotations are simultaneously visible at common tablet widths.
- Primary assignment workflow requires minimal navigation.
- Touch targets meet accessibility size guidance.

### TR-141 — Phone navigation

Priority: P1

Acceptance criteria:

- Rotation, customers, personal day, history, and more/settings are reachable through phone navigation.
- No required control depends on hover.

### TR-142 — Installable PWA

Priority: P1

Acceptance criteria:

- Valid manifest and icons exist.
- Application is installable on supported phone/tablet browsers.
- Last synchronized dashboard can be displayed offline.
- Offline mode clearly blocks conflict-prone commands.

### TR-143 — Accessibility review

Priority: P1

Acceptance criteria:

- Keyboard navigation works for manager workflows.
- Focus state is visible.
- Labels and error messages are programmatically associated.
- Status never relies on color alone.
- Automated accessibility checks run in CI.

## E15 — Verification and portfolio delivery

### TR-150 — Stage 9 unit and integration suite

Priority: P0

Acceptance criteria:

- Automated tests reproduce the approved event-by-event day.
- Tests assert both master and haircut rotations after every event.
- Tests assert balances, full turns, explanations, and correction outcomes.

### TR-151 — Multi-device concurrency test

Priority: P0

Acceptance criteria:

- Parallel assignment attempts produce one committed assignment.
- Losing client receives a stale-version response.
- No duplicate turn credit is written.

### TR-152 — End-to-end manager journey

Priority: P1

Acceptance criteria:

- Manager opens day, clocks in staff, adds customers, starts/completes services, activates busy mode, corrects a mistake, reviews history, and closes the day.

### TR-153 — End-to-end staff journey

Priority: P1

Acceptance criteria:

- Staff clocks in, views position, begins/ends break, views assignment explanation, completes work, requests correction, and views personal history.

### TR-154 — Portfolio documentation

Priority: P1

Acceptance criteria:

- README includes problem, users, fairness rules, architecture, setup, tests, security, offline policy, and deployment.
- Repository includes architecture and entity-relationship diagrams.
- Architecture decision records explain hybrid rotation, PostgreSQL, Supabase, Amplify, and Textract.
- Screenshots and a short demonstration video are linked.
- CV-ready project description is included.

## 7. Release gates

### Gate A — Data foundation

Required before rotation UI:

- Migrations 0001–0005 pass.
- RLS foundation is tested.
- Employee and service seed data is reviewed.

### Gate B — Rotation correctness

Required before customer-facing workflows:

- Master and haircut projection logic passes unit tests.
- Clock-in, clock-out, break, return, and tie-order rules pass.
- Rotation events can rebuild current projections.

### Gate C — Assignment safety

Required before multi-device testing:

- Recommendations are deterministic.
- Confirm assignment is transactional and idempotent.
- Expected-version conflict behavior passes.

### Gate D — Audit integrity

Required before production deployment:

- Direct edits to ledger and audit tables are blocked.
- Corrections generate reversal and compensating events.
- Staff/manager access boundaries pass RLS tests.

### Gate E — MVP release

Required for completion:

- Approved Stage 9 scenario passes end to end.
- Phone and tablet workflows pass.
- Amplify production deployment succeeds.
- Textract review flow works without automatic publishing.
- Backup/export procedure is documented.
- No P0 or release-blocking P1 defects remain.

## 8. Definition of done

A story is complete only when:

- Acceptance criteria pass.
- Relevant unit, database, RLS, or E2E tests are included.
- Loading, empty, success, and error states are handled.
- Manager/staff permissions are verified.
- User-facing explanations use plain language.
- Audit behavior is verified for sensitive actions.
- Phone and tablet behavior is checked when UI is affected.
- Documentation and migrations are updated.
- No secret is committed or exposed to the browser.

## 9. Recommended first development sprint

The first sprint should establish foundations without attempting rotation logic prematurely.

1. TR-001 — Initialize application
2. TR-002 — CI and Amplify preview
3. Migrations 0001–0004
4. TR-010 — Authentication
5. TR-011 — Role-aware navigation
6. TR-012 — Initial RLS suite
7. TR-020 — Employee profiles
8. TR-021 — Qualifications
9. TR-030 — Service catalog
10. TR-031 — Historical prices

Sprint exit:

- Manager can sign in.
- Manager can review seeded employees and qualifications.
- Manager can create a service and a new price version.
- Staff cannot access manager mutations.
- CI, migration tests, and an Amplify preview deployment are working.

