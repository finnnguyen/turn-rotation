import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import LoginPage from "@/app/login/page";

describe("LoginPage", () => {
  it("explains that access is manager-controlled", async () => {
    const page = await LoginPage({
      searchParams: Promise.resolve({}),
    });

    render(page);

    expect(
      screen.getByRole("heading", { name: "Sign in to the salon" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Public registration is disabled/),
    ).toBeInTheDocument();
  });
});
