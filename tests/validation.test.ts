import { describe, expect, it } from "vitest";

import { postgresUuidSchema } from "@/lib/validation";

describe("postgresUuidSchema", () => {
  it("accepts deterministic PostgreSQL seed UUIDs", () => {
    expect(
      postgresUuidSchema.safeParse(
        "00000000-0000-0000-0000-000000002003",
      ).success,
    ).toBe(true);
  });

  it("rejects malformed IDs", () => {
    expect(postgresUuidSchema.safeParse("not-an-id").success).toBe(false);
  });
});
