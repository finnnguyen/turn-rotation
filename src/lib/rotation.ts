export type RotationEntry = {
  employee_id: string;
  master_position: number | null;
  haircut_position: number | null;
};

export function orderedRotation<T extends RotationEntry>(
  entries: T[],
  rotation: "master" | "haircut",
): T[] {
  const key =
    rotation === "master" ? "master_position" : "haircut_position";

  return entries
    .filter((entry) => entry[key] !== null)
    .toSorted((left, right) => (left[key] ?? 0) - (right[key] ?? 0));
}
