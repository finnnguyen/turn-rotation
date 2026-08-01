import { z } from "zod";

// PostgreSQL accepts every 8-4-4-4-12 hexadecimal UUID representation.
// Zod's z.uuid() additionally enforces RFC version/variant bits, which rejects
// deterministic all-zero development IDs used by our seed data.
export const postgresUuidSchema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    "Invalid database ID",
  );
