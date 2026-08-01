import { describe, expect, it } from "vitest";

import { orderedRotation, type RotationEntry } from "@/lib/rotation";

const entries: RotationEntry[] = [
  { employee_id: "finn", master_position: 1, haircut_position: 2 },
  { employee_id: "tim", master_position: 2, haircut_position: null },
  { employee_id: "mary", master_position: 3, haircut_position: 1 },
  { employee_id: "liz", master_position: null, haircut_position: null },
];

describe("orderedRotation", () => {
  it("orders active employees by actual master position", () => {
    expect(orderedRotation(entries, "master").map((entry) => entry.employee_id))
      .toEqual(["finn", "tim", "mary"]);
  });

  it("uses one shared haircut rotation and excludes non-haircut staff", () => {
    expect(orderedRotation(entries, "haircut").map((entry) => entry.employee_id))
      .toEqual(["mary", "finn"]);
  });

  it("does not mutate the realtime projection", () => {
    const original = structuredClone(entries);
    orderedRotation(entries, "haircut");
    expect(entries).toEqual(original);
  });
});
