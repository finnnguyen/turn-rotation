import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(name: string) {
  return readFileSync(resolve(migrationDirectory, name), "utf8");
}

describe("Milestone 1 migrations", () => {
  it("defines the four ordered foundation migrations", () => {
    const files = [
      "20260730000100_foundation.sql",
      "20260730000200_identity_and_employees.sql",
      "20260730000300_service_catalog.sql",
      "20260730000400_qualifications_and_rules.sql",
    ];

    files.forEach((file) => {
      expect(() => migration(file)).not.toThrow();
    });
  });

  it("enables RLS for identity and catalog tables", () => {
    const sql = [
      migration("20260730000200_identity_and_employees.sql"),
      migration("20260730000300_service_catalog.sql"),
      migration("20260730000400_qualifications_and_rules.sql"),
    ].join("\n");

    [
      "salon_locations",
      "user_profiles",
      "employees",
      "employee_location_memberships",
      "service_categories",
      "services",
      "service_price_versions",
      "employee_qualifications",
      "daily_qualification_overrides",
      "rule_set_versions",
    ].forEach((table) => {
      expect(sql).toContain(`alter table app.${table} enable row level security`);
    });
  });

  it("keeps privileged history changes behind manager-checked functions", () => {
    const catalogSql = migration("20260730000300_service_catalog.sql");
    const qualificationSql = migration(
      "20260730000400_qualifications_and_rules.sql",
    );

    expect(catalogSql).toContain("private.is_manager_at(target_location_id)");
    expect(catalogSql).toContain("revoke all on function app.create_service_price_version");
    expect(qualificationSql).toContain(
      "revoke all on function app.set_employee_category_qualification",
    );
  });

  it("encodes the approved threshold and haircut rules in seed data", () => {
    const seed = readFileSync(
      resolve(process.cwd(), "supabase/seed.sql"),
      "utf8",
    );

    expect(seed).toContain("'mens_haircut'");
    expect(seed).toContain("'womens_haircut'");
    expect(seed).toContain("0.333333");
    expect(seed).toContain("false,\n  15,\n  true,\n  true");
    ["Sheila", "Tim", "Finn", "Tina", "Liz", "Christine", "Mary"].forEach(
      (employee) => expect(seed).toContain(`'${employee}'`),
    );
  });
});

describe("Milestone 2 migrations", () => {
  const workdaySql = migration("20260730000500_workdays_and_status.sql");
  const rotationSql = migration("20260730000600_rotation_state.sql");

  it("creates append-only workday and rotation history", () => {
    ["workdays", "clock_events", "employee_status_events", "break_periods"].forEach(
      (table) => expect(workdaySql).toContain(`create table app.${table}`),
    );
    ["rotation_entries", "rotation_events", "rotation_state_versions"].forEach(
      (table) => expect(rotationSql).toContain(`create table app.${table}`),
    );
  });

  it("protects projections with RLS and transactional commands", () => {
    ["rotation_entries", "rotation_events", "rotation_state_versions"].forEach(
      (table) =>
        expect(rotationSql).toContain(
          `alter table app.${table} enable row level security`,
        ),
    );
    [
      "open_workday",
      "clock_in_employee",
      "clock_out_employee",
      "set_employee_status",
      "start_employee_break",
      "end_employee_break",
      "close_workday",
    ].forEach((command) => {
      expect(rotationSql).toContain(`function app.${command}`);
    });
  });

  it("records clock-in order, shared haircut order, and daily reset rules", () => {
    expect(rotationSql).toContain(
      "Joined the master rotation in actual clock-in order",
    );
    expect(rotationSql).toContain("Joined the shared haircut rotation");
    expect(rotationSql).toContain(
      "dollar_balance = 0, haircut_balance = 0",
    );
  });

  it("reopens an existing closed business date without creating a duplicate", () => {
    const reopenSql = migration(
      "20260730000610_reopen_closed_workday.sql",
    );

    expect(reopenSql).toContain("select id into existing_workday_id");
    expect(reopenSql).toContain("closed_at = null");
    expect(reopenSql).toContain("return existing_workday_id");
  });
});

describe("Milestone 3 migrations", () => {
  const visitSql = migration("20260730000700_customer_visits.sql");
  const assignmentSql = migration("20260730000800_assignment_engine.sql");

  it("stores anonymous visits with one or more service lines", () => {
    expect(visitSql).toContain("create table app.customer_visits");
    expect(visitSql).toContain("create table app.visit_services");
    expect(visitSql).toContain("ticket_number integer not null");
    expect(visitSql).toContain("customer_name_snapshot text");
  });

  it("stores immutable recommendation candidates and assignments", () => {
    [
      "assignment_decisions",
      "assignment_candidates",
      "service_assignments",
      "assignment_commands",
    ].forEach((table) => {
      expect(assignmentSql).toContain(`create table app.${table}`);
      expect(assignmentSql).toContain(
        `alter table app.${table} enable row level security`,
      );
    });
  });

  it("uses qualification, rotation, wait, version, and idempotency rules", () => {
    expect(assignmentSql).toContain("private.effective_qualification");
    expect(assignmentSql).toContain("selected_rotation = 'haircut'");
    expect(assignmentSql).toContain("target_rule.wait_limit_minutes");
    expect(assignmentSql).toContain(
      "current_version <> expected_state_version",
    );
    expect(assignmentSql).toContain(
      "unique (location_id, idempotency_key)",
    );
  });

  it("prevents concurrent active reservations for one employee", () => {
    const reservationSql = migration(
      "20260730000810_assignment_reservations.sql",
    );

    expect(reservationSql).toContain(
      "assignment_reservations_one_active_per_employee",
    );
    expect(reservationSql).toContain(
      "This employee was assigned on another device",
    );
  });

  it("casts recommendation outcomes to their database enums", () => {
    const castSql = migration(
      "20260730000820_fix_recommendation_enum_casts.sql",
    );

    expect(castSql).toContain("app.assignment_decision_status");
    expect(castSql).toContain("app.visit_status");
  });

  it("skips employees already reserved for another customer", () => {
    const reservationSkipSql = migration(
      "20260730000840_skip_reserved_employees.sql",
    );

    expect(reservationSkipSql).toContain("has_active_reservation");
    expect(reservationSkipSql).toContain("assigned_to_customer");
  });

  it("supersedes rather than overwrites an old recommendation", () => {
    const refreshSql = migration(
      "20260730000850_refresh_recommendation.sql",
    );

    expect(refreshSql).toContain("refresh_visit_recommendation");
    expect(refreshSql).toContain("set status = 'superseded'");
    expect(refreshSql).toContain("refreshed_decision_id");
  });
});

describe("Milestone 4 migration", () => {
  const accountingSql = migration("20260730000900_turn_accounting.sql");

  it("captures historical service values and stores append-only credit events", () => {
    expect(accountingSql).toContain("captured_price_version_id");
    expect(accountingSql).toContain("captured_listed_price");
    expect(accountingSql).toContain("create table app.turn_credit_events");
    expect(accountingSql).toContain("create table app.completed_turns");
  });

  it("implements dollar and haircut turn movement separately", () => {
    expect(accountingSql).toContain("private.move_master_to_end");
    expect(accountingSql).toContain("private.move_haircut_to_end");
    expect(accountingSql).toContain("target_rule.dollar_threshold");
    expect(accountingSql).toContain("target_rule.mens_haircut_fraction");
    expect(accountingSql).toContain("target_rule.womens_haircut_fraction");
  });

  it("provides idempotent start, complete, and end-of-day expiration", () => {
    expect(accountingSql).toContain("app.start_visit_services");
    expect(accountingSql).toContain("app.complete_visit_services");
    expect(accountingSql).toContain("unique (location_id, idempotency_key)");
    expect(accountingSql).toContain("private.record_balance_expiration");
  });

  it("recommends the oldest waiting visit when an employee is released", () => {
    const waitingSql = migration(
      "20260730000910_refresh_oldest_waiting_visit.sql",
    );

    expect(waitingSql).toContain("refresh_oldest_waiting_visit");
    expect(waitingSql).toContain("order by visit.arrived_at");
    expect(waitingSql).toContain(
      "perform app.refresh_visit_recommendation(waiting_visit_id)",
    );
  });
});

describe("Milestone 5 migrations", () => {
  const fairnessSql = migration("20260730001000_operational_fairness.sql");
  const busySql = migration(
    "20260730001010_busy_mode_recommendations.sql",
  );

  it("stores busy mode, skips, refusals, corrections, and immutable audit", () => {
    [
      "busy_mode_periods",
      "skip_events",
      "refusal_events",
      "correction_requests",
      "corrections",
    ].forEach((table) =>
      expect(fairnessSql).toContain(`create table app.${table}`),
    );
    expect(fairnessSql).toContain("create table audit.audit_events");
  });

  it("implements refusal penalties and no-penalty customer declines", () => {
    expect(fairnessSql).toContain("app.record_employee_refusal");
    expect(fairnessSql).toContain("private.move_master_to_end");
    expect(fairnessSql).toContain("app.convert_customer_decline");
    expect(fairnessSql).toContain("'customer_declined', false");
  });

  it("enables busy-only qualifications only during active busy mode", () => {
    expect(fairnessSql).toContain("app.set_busy_mode");
    expect(busySql).toContain("busy_mode_active");
    expect(busySql).toContain("busy_only_found and not busy_mode_active");
  });

  it("records corrections as compensating ledger and audit events", () => {
    expect(fairnessSql).toContain("app.apply_balance_correction");
    expect(fairnessSql).toContain("'correction'");
    expect(fairnessSql).toContain("insert into audit.audit_events");
  });

  it("exposes audit history through an RLS-protected read-only app view", () => {
    const feedSql = migration(
      "20260730001030_manager_audit_feed.sql",
    );

    expect(feedSql).toContain("with (security_invoker = true)");
    expect(feedSql).toContain("from audit.audit_events");
  });

  it("does not recommend an employee skipped for the same customer again", () => {
    const skipSql = migration(
      "20260730001050_exclude_visit_skips.sql",
    );

    expect(skipSql).toContain("app.refresh_source_visit_id");
    expect(skipSql).toContain("'employee_refusal'");
    expect(skipSql).toContain("'approved_restriction'");
  });
});

describe("Milestone 6 reporting migration", () => {
  const reportingSql = migration(
    "20260730001100_transparency_reporting.sql",
  );

  it("creates rebuildable employee and location summaries", () => {
    expect(reportingSql).toContain("create view app.daily_employee_summaries");
    expect(reportingSql).toContain("create view app.daily_location_summaries");
    expect(reportingSql).toContain("with (security_invoker = true)");
  });

  it("reports visits, value, turns, haircuts, events, and status time", () => {
    [
      "customers_served",
      "listed_service_value",
      "mens_haircuts",
      "womens_haircuts",
      "dollar_turns",
      "haircut_turns",
      "available_seconds",
      "busy_seconds",
      "break_seconds",
    ].forEach((metric) => expect(reportingSql).toContain(metric));
  });

  it("limits detailed staff history to the linked employee", () => {
    expect(reportingSql).toContain("assignments_select_manager_or_self");
    expect(reportingSql).toContain("credit_events_select_manager_or_self");
    expect(reportingSql).toContain(
      "employee.user_id = (select auth.uid())",
    );
  });
});

describe("Milestone 7 Textract import migration", () => {
  const importSql = migration("20260730001200_textract_imports.sql");
  const serviceRoleSql = migration(
    "20260730001210_textract_service_role_access.sql",
  );
  const existingServiceSql = migration(
    "20260730001220_confirm_existing_imported_service.sql",
  );

  it("keeps source images private and OCR output reviewable", () => {
    expect(importSql).toContain("'service-menu-imports', false");
    expect(importSql).toContain("create table app.service_menu_lines");
    expect(importSql).toContain("bounding_box jsonb");
    expect(importSql).toContain("create table app.service_import_drafts");
  });

  it("requires a manager-confirmed database function before publishing", () => {
    expect(importSql).toContain("private.is_manager_at(draft_record.location_id)");
    expect(importSql).toContain("app.confirm_service_import_draft");
    expect(importSql).toContain("app.create_service_with_price");
  });

  it("grants the Edge Function narrow custom-schema access", () => {
    expect(serviceRoleSql).toContain("grant usage on schema app to service_role");
    expect(serviceRoleSql).toContain(
      "grant select, insert, update on app.service_menu_imports to service_role",
    );
    expect(serviceRoleSql).not.toContain("grant all");
  });

  it("links duplicate service drafts and preserves historical prices", () => {
    expect(existingServiceSql).toContain("lower(trim(service.name))");
    expect(existingServiceSql).toContain("app.create_service_price_version");
    expect(existingServiceSql).toContain(
      "current_listed_price is distinct from listed_price",
    );
  });
});
