import { expect, test } from "@playwright/test";

test("shows the Turn Rotation foundation", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Every turn should have a reason." }),
  ).toBeVisible();
  await expect(page.getByText("Milestone 0 checklist")).toBeVisible();
});

test("shows the private salon sign-in", async ({ page }) => {
  await page.goto("/login");

  await expect(
    page.getByRole("heading", { name: "Sign in to the salon" }),
  ).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
  await expect(
    page.getByText("Public registration is disabled."),
  ).toBeVisible();
});

test("protects the workspace from anonymous visitors", async ({ page }) => {
  await page.goto("/dashboard");

  await expect(page).toHaveURL(/\/login$/);
  await expect(
    page.getByRole("heading", { name: "Sign in to the salon" }),
  ).toBeVisible();
});
