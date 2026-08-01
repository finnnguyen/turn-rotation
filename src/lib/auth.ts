import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";

import { createClient } from "@/lib/supabase/server";

export type AppRole = "manager" | "staff";

export type UserContext = {
  userId: string;
  displayName: string;
  role: AppRole;
  locationId: string;
};

type ProfileRow = {
  display_name: string;
  role: AppRole;
  active: boolean;
  primary_location_id: string | null;
};

type MembershipRow = {
  location_id: string;
};

export const requireUserContext = cache(async (): Promise<UserContext> => {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;

  if (!userId) {
    redirect("/login");
  }

  const { data: profileData } = await supabase
    .schema("app")
    .from("user_profiles")
    .select("display_name, role, active, primary_location_id")
    .eq("id", userId)
    .maybeSingle();

  const profile = profileData as ProfileRow | null;

  if (!profile?.active) {
    redirect("/login?error=Your account is inactive or incomplete.");
  }

  let locationId = profile.primary_location_id;

  if (!locationId) {
    const { data: membershipData } = await supabase
      .schema("app")
      .from("employee_location_memberships")
      .select("location_id")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();

    locationId = (membershipData as MembershipRow | null)?.location_id ?? null;
  }

  if (!locationId) {
    redirect("/setup-required");
  }

  return {
    userId,
    displayName: profile.display_name,
    role: profile.role,
    locationId,
  };
});

export async function requireManagerContext(): Promise<UserContext> {
  const context = await requireUserContext();

  if (context.role !== "manager") {
    redirect("/dashboard?error=Manager access is required.");
  }

  return context;
}
