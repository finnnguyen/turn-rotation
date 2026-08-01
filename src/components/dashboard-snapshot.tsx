"use client";

import { useEffect } from "react";

export type DashboardSnapshotData = {
  businessDate: string;
  stateVersion: number;
  masterCount: number;
  haircutCount: number;
  waitingCount: number;
  availableCount: number;
  servingCount: number;
};

const SNAPSHOT_KEY = "turn-rotation-dashboard-snapshot-v1";

export function DashboardSnapshot({ data }: { data: DashboardSnapshotData }) {
  useEffect(() => {
    try {
      localStorage.setItem(
        SNAPSHOT_KEY,
        JSON.stringify({ ...data, synchronizedAt: new Date().toISOString() }),
      );
    } catch {
      // Private browsing or managed devices may disable local storage.
    }
  }, [data]);

  return null;
}
