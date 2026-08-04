/**
 * Behavioral tests for the rotation/assignment engine — the actual fairness
 * logic, which lives entirely in Postgres functions (supabase/migrations),
 * not in TypeScript. Nothing else in this repo exercises it: the vitest
 * "migration tests" only assert that certain strings appear in the SQL
 * files, and CI's `supabase db reset` only proves the migrations apply
 * without error, not that the business rules produce correct results.
 *
 * These tests call the real RPC functions against a real local Postgres
 * (via the Supabase CLI's local stack: `supabase start`), authenticated as
 * a real manager user, exactly the way the app itself calls them. They are
 * NOT run by `npm run test` (see vitest.config.ts's exclude) because that
 * command runs in CI without Supabase running. Run them with:
 *
 *   supabase start   # once
 *   npm run test:integration
 */
import { randomUUID } from "node:crypto";

import {
  createClient,
  type SupabaseClient,
  type WebSocketLikeConstructor,
} from "@supabase/supabase-js";
import { Client as PgClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import ws from "ws";

const SUPABASE_URL = "http://127.0.0.1:54321";
// Well-known local-dev demo keys/credentials from `supabase status` — not
// secrets, and only ever valid against the local Docker stack.
const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const LOCATION_ID = "00000000-0000-0000-0000-000000000001";
// Seeded employees (supabase/seed.sql) — both qualify for "Regular nails"
// (category 101); Sheila and Finn both qualify for "Men's haircut" (103).
const TIM = "00000000-0000-0000-0000-000000002002";
const LIZ = "00000000-0000-0000-0000-000000002005";
const SHEILA = "00000000-0000-0000-0000-000000002001";
const FINN = "00000000-0000-0000-0000-000000002003";
// Services from seed.sql.
const MANICURE_PEDICURE = "00000000-0000-0000-0000-000000001003"; // $30 dollar — exactly the threshold
const MANICURE = "00000000-0000-0000-0000-000000001001"; // $15 dollar — under threshold
const MENS_HAIRCUT = "00000000-0000-0000-0000-000000001007"; // mens_haircut, 1/3 credit

// Node < 22 has no native WebSocket, which supabase-js's realtime client
// needs even though these tests never use realtime — supply `ws` per
// Supabase's own suggested fix rather than requiring Node 22 just for tests.
const clientOptions = {
  auth: { autoRefreshToken: false, persistSession: false },
  realtime: { transport: ws as unknown as WebSocketLikeConstructor },
};

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, clientOptions);

let manager: SupabaseClient;
let managerId: string;
const testEmail = `rotation-test-${randomUUID()}@example.com`;
const testPassword = `Test-${randomUUID()}!`;

/** Every RPC call in the app requires a real authenticated manager — no
 * service-role bypass — so this mirrors exactly what the UI does.
 *
 * The one-time fixture setup below (granting the test user the manager
 * role and a location membership) can't go through PostgREST: only
 * `authenticated` has USAGE on the app schema (see migration 000100), not
 * `service_role` — by design, even backend/admin tooling here is expected
 * to go through the app's own RPC functions. There's no "become a manager"
 * RPC (managers are provisioned out-of-band per seed.sql's own comment), so
 * this connects directly to Postgres as the superuser for fixture setup
 * only; every actual assertion below still goes through the real RPCs. */
beforeAll(async () => {
  const { data: created, error: createError } =
    await admin.auth.admin.createUser({
      email: testEmail,
      password: testPassword,
      email_confirm: true,
    });
  if (createError || !created.user) {
    throw new Error(`Failed to create test manager: ${createError?.message}`);
  }
  managerId = created.user.id;

  const pg = new PgClient({ connectionString: DB_URL });
  await pg.connect();
  try {
    await pg.query(
      `update app.user_profiles set role = 'manager', active = true where id = $1`,
      [managerId],
    );
    await pg.query(
      `insert into app.employee_location_memberships (user_id, location_id) values ($1, $2)`,
      [managerId, LOCATION_ID],
    );
  } finally {
    await pg.end();
  }

  manager = createClient(SUPABASE_URL, ANON_KEY, clientOptions);
  const { error: signInError } = await manager.auth.signInWithPassword({
    email: testEmail,
    password: testPassword,
  });
  if (signInError) throw signInError;
});

afterAll(async () => {
  if (managerId) await admin.auth.admin.deleteUser(managerId);
});

async function openWorkday(businessDate: string) {
  const { data, error } = await manager.schema("app").rpc("open_workday", {
    target_location_id: LOCATION_ID,
    target_business_date: businessDate,
  });
  if (error) throw error;
  return data as string;
}

async function clockIn(workdayId: string, employeeId: string) {
  const { error } = await manager.schema("app").rpc("clock_in_employee", {
    target_workday_id: workdayId,
    target_employee_id: employeeId,
  });
  if (error) throw error;
}

async function createVisitAndRecommend(
  workdayId: string,
  serviceIds: string[],
) {
  const { data, error } = await manager
    .schema("app")
    .rpc("create_visit_and_recommend", {
      target_workday_id: workdayId,
      selected_service_ids: serviceIds,
    });
  if (error) throw error;
  return data as {
    visit_id: string;
    decision_id: string;
    recommended_employee_id: string | null;
    expected_state_version: number;
  };
}

// confirm_assignment only *checks* the state version (optimistic
// concurrency) — it doesn't advance it, so its result has no state_version
// field. Callers should keep using the same expected_state_version they
// already have for the next command.
async function confirmAssignment(
  decisionId: string,
  employeeId: string,
  expectedStateVersion: number,
) {
  const { error } = await manager.schema("app").rpc("confirm_assignment", {
    target_decision_id: decisionId,
    selected_employee_id: employeeId,
    expected_state_version: expectedStateVersion,
    command_idempotency_key: randomUUID(),
  });
  if (error) throw error;
}

async function startVisitServices(visitId: string, stateVersion: number) {
  const { data, error } = await manager
    .schema("app")
    .rpc("start_visit_services", {
      target_visit_id: visitId,
      expected_state_version: stateVersion,
      command_idempotency_key: randomUUID(),
    });
  if (error) throw error;
  return data as { state_version: number };
}

// Completing a visit is what releases its assignment_reservations row
// (assignment_reservations_one_active_per_employee is keyed by
// (location_id, employee_id), not per-workday) — skipping this call left an
// employee's reservation from an earlier test permanently "active," which
// silently skipped them as a candidate in every later test until this was
// found and fixed.
async function completeVisitServices(visitId: string, stateVersion: number) {
  const { error } = await manager.schema("app").rpc("complete_visit_services", {
    target_visit_id: visitId,
    expected_state_version: stateVersion,
    command_idempotency_key: randomUUID(),
  });
  if (error) throw error;
}

async function rotationState(workdayId: string) {
  // authenticated (not service_role — see the beforeAll comment above) via
  // the members-scoped select policy.
  const { data, error } = await manager
    .schema("app")
    .from("rotation_entries")
    .select("employee_id, master_position, haircut_position, dollar_balance, haircut_balance")
    .eq("workday_id", workdayId);
  if (error) throw error;
  return data;
}

/** Only one workday can be preparing/open/closing per location at a time
 * (workdays_one_active_per_location), so every test must close its own
 * workday before the next test opens one. */
async function closeWorkday(workdayId: string) {
  const { error } = await manager.schema("app").rpc("close_workday", {
    target_workday_id: workdayId,
  });
  if (error) throw error;
}

describe("dollar/master rotation fairness", () => {
  it("recommends by arrival order, and a $30+ service sends the employee to the back", async () => {
    const workdayId = await openWorkday("2026-02-01");
    await clockIn(workdayId, TIM);
    await clockIn(workdayId, LIZ);

    // Tim clocked in first — should be recommended first.
    const first = await createVisitAndRecommend(workdayId, [MANICURE_PEDICURE]);
    expect(first.recommended_employee_id).toBe(TIM);

    await confirmAssignment(first.decision_id, TIM, first.expected_state_version);
    const started = await startVisitServices(first.visit_id, first.expected_state_version);
    await completeVisitServices(first.visit_id, started.state_version);

    // A $30 service exactly meets the threshold — Tim should now be behind Liz.
    const entries = await rotationState(workdayId);
    const tim = entries.find((e) => e.employee_id === TIM)!;
    const liz = entries.find((e) => e.employee_id === LIZ)!;
    expect(tim.dollar_balance).toBe(0); // reset after completing a turn
    expect(tim.master_position).toBeGreaterThan(liz.master_position);

    // Next visit should recommend Liz, not Tim.
    const second = await createVisitAndRecommend(workdayId, [MANICURE]);
    expect(second.recommended_employee_id).toBe(LIZ);

    await closeWorkday(workdayId);
  });

  it("does not send an employee to the back for an under-threshold service", async () => {
    const workdayId = await openWorkday("2026-02-02");
    await clockIn(workdayId, TIM);
    await clockIn(workdayId, LIZ);

    const first = await createVisitAndRecommend(workdayId, [MANICURE]); // $15, under $30
    expect(first.recommended_employee_id).toBe(TIM);

    await confirmAssignment(first.decision_id, TIM, first.expected_state_version);
    const started = await startVisitServices(first.visit_id, first.expected_state_version);
    await completeVisitServices(first.visit_id, started.state_version);

    const entries = await rotationState(workdayId);
    const tim = entries.find((e) => e.employee_id === TIM)!;
    const liz = entries.find((e) => e.employee_id === LIZ)!;
    expect(tim.dollar_balance).toBe(15); // partial credit carried, not reset
    expect(tim.master_position).toBeLessThan(liz.master_position); // still ahead

    // Tim should still be recommended next — the $15 didn't complete a turn.
    const second = await createVisitAndRecommend(workdayId, [MANICURE]);
    expect(second.recommended_employee_id).toBe(TIM);

    await closeWorkday(workdayId);
  });
});

describe("haircut rotation independence", () => {
  it("advances the haircut queue on every haircut without disturbing master position", async () => {
    const workdayId = await openWorkday("2026-02-03");
    await clockIn(workdayId, SHEILA);
    await clockIn(workdayId, FINN);

    const first = await createVisitAndRecommend(workdayId, [MENS_HAIRCUT]);
    expect(first.recommended_employee_id).toBe(SHEILA);

    await confirmAssignment(first.decision_id, SHEILA, first.expected_state_version);
    const started = await startVisitServices(first.visit_id, first.expected_state_version);
    await completeVisitServices(first.visit_id, started.state_version);

    const entries = await rotationState(workdayId);
    const sheila = entries.find((e) => e.employee_id === SHEILA)!;
    const finn = entries.find((e) => e.employee_id === FINN)!;

    // One men's haircut = 1/3 credit — not enough to complete a full turn,
    // so master position must be untouched...
    expect(sheila.haircut_balance).toBeCloseTo(1 / 3, 5);
    expect(sheila.master_position).toBeLessThan(finn.master_position);
    // ...but the haircut *queue* always advances on every haircut,
    // regardless of accumulated credit.
    expect(sheila.haircut_position).toBeGreaterThan(finn.haircut_position);

    // Next haircut should go to Finn (haircut queue advanced)...
    const secondHaircut = await createVisitAndRecommend(workdayId, [MENS_HAIRCUT]);
    expect(secondHaircut.recommended_employee_id).toBe(FINN);

    // ...but Sheila is still first for a master/dollar-rotation service,
    // since haircuts don't move master position until credit reaches 1.0.
    const dollarVisit = await createVisitAndRecommend(workdayId, [MANICURE]);
    expect(dollarVisit.recommended_employee_id).toBe(SHEILA);

    await closeWorkday(workdayId);
  });
});

describe("mixed haircut + dollar visit fairness", () => {
  it("respects the haircut queue for a visit that mixes a haircut with a dollar service", async () => {
    const workdayId = await openWorkday("2026-02-04");
    await clockIn(workdayId, SHEILA);
    await clockIn(workdayId, FINN);

    // Give Sheila a pure haircut first — this advances the haircut queue so
    // Finn is now next in line for haircuts, while Sheila stays ahead in the
    // master (dollar) queue, since 1/3 credit doesn't complete a turn.
    const first = await createVisitAndRecommend(workdayId, [MENS_HAIRCUT]);
    expect(first.recommended_employee_id).toBe(SHEILA);
    await confirmAssignment(first.decision_id, SHEILA, first.expected_state_version);
    const started = await startVisitServices(first.visit_id, first.expected_state_version);
    await completeVisitServices(first.visit_id, started.state_version);

    const entries = await rotationState(workdayId);
    const sheila = entries.find((e) => e.employee_id === SHEILA)!;
    const finn = entries.find((e) => e.employee_id === FINN)!;
    expect(sheila.master_position).toBeLessThan(finn.master_position); // Sheila still ahead in master
    expect(finn.haircut_position).toBeLessThan(sheila.haircut_position); // Finn now ahead in haircut

    // A visit that mixes a haircut with a nail service must still respect
    // the haircut queue — Finn is next for haircuts, so Finn should be
    // recommended, not Sheila (who's only ahead in the unrelated master
    // queue). Before the fix, a mixed visit fell through to master-queue
    // ordering because not every selected service was a haircut, which
    // would have recommended Sheila here instead.
    const mixed = await createVisitAndRecommend(workdayId, [MENS_HAIRCUT, MANICURE]);
    expect(mixed.recommended_employee_id).toBe(FINN);

    await closeWorkday(workdayId);
  });
});
