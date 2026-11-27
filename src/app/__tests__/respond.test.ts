import { notFound } from "next/navigation";
import { describe, expect, it, vi } from "vitest";
import { answer, ok, CACHE } from "../api/respond";

describe("answering from a route", () => {
  it("lets Next's own signals through instead of turning them into a 500", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(answer("test", "testing", async () => notFound())).rejects.toThrow();
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("answers with what the work returns", async () => {
    const response = await answer("test", "testing", async () => ok({ fine: true }, CACHE.minute));
    expect(await response.json()).toEqual({ fine: true });
  });
});
