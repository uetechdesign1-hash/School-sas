"use client";

import { useEffect } from "react";

export default function OfflineAttendanceServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    void navigator.serviceWorker
      .register("/service-worker.js", { scope: "/" })
      .catch((error: unknown) => {
        console.error("OFFLINE ATTENDANCE SERVICE WORKER ERROR:", error);
      });
  }, []);

  return null;
}
