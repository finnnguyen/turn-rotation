import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Home from "@/app/page";

describe("Home", () => {
  it("introduces the project foundation", () => {
    render(<Home />);

    expect(
      screen.getByRole("heading", {
        name: "Every turn should have a reason.",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Built the way production needs to work")).toBeInTheDocument();
  });
});
