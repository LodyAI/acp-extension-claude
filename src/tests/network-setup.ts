import { vi } from "vitest";

// Catalog tests supply responses explicitly; never contact a developer's gateway.
vi.mock("undici", async (importOriginal) => ({
  ...(await importOriginal<typeof import("undici")>()),
  fetch: vi.fn().mockRejectedValue(new Error("Network disabled in tests")),
}));
