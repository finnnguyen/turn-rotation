"use client";

import { useEffect, useState } from "react";

export function PwaRuntime() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const updateConnectivity = () => {
      const isOffline = !navigator.onLine;
      setOffline(isOffline);
      document.documentElement.dataset.connectivity = isOffline
        ? "offline"
        : "online";
    };

    const blockOfflineMutation = (event: SubmitEvent) => {
      if (!navigator.onLine) {
        event.preventDefault();
        setOffline(true);
      }
    };

    updateConnectivity();
    window.addEventListener("online", updateConnectivity);
    window.addEventListener("offline", updateConnectivity);
    document.addEventListener("submit", blockOfflineMutation, true);

    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js");
    }

    return () => {
      window.removeEventListener("online", updateConnectivity);
      window.removeEventListener("offline", updateConnectivity);
      document.removeEventListener("submit", blockOfflineMutation, true);
      delete document.documentElement.dataset.connectivity;
    };
  }, []);

  if (!offline) {
    return null;
  }

  return (
    <div
      aria-live="assertive"
      className="fixed inset-x-0 top-0 z-[100] bg-amber-100 px-4 py-3 text-center text-sm font-semibold text-amber-950 shadow-sm"
      role="alert"
    >
      You are offline. Read-only pages may be available, but changes are blocked
      until the connection returns.
    </div>
  );
}
