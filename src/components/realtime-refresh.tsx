"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { createClient } from "@/lib/supabase/client";

export function RealtimeRefresh({ workdayId }: { workdayId: string }) {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`workday:${workdayId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "app",
          table: "rotation_entries",
          filter: `workday_id=eq.${workdayId}`,
        },
        () => router.refresh(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "app",
          table: "employee_status_events",
          filter: `workday_id=eq.${workdayId}`,
        },
        () => router.refresh(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "app",
          table: "customer_visits",
          filter: `workday_id=eq.${workdayId}`,
        },
        () => router.refresh(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "app",
          table: "assignment_decisions",
          filter: `workday_id=eq.${workdayId}`,
        },
        () => router.refresh(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "app",
          table: "busy_mode_periods",
          filter: `workday_id=eq.${workdayId}`,
        },
        () => router.refresh(),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [router, workdayId]);

  return null;
}
