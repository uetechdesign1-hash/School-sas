import type { ReactNode } from "react";
import { getPortalAccess } from "@/lib/transport/portal-access";
import type { TransportRole } from "@/lib/transport/roles";

export async function PortalGuard({ role, children }: { role: TransportRole; children: ReactNode }) {
  const access = await getPortalAccess(role);
  if (access === "allowed") return children;
  const message = access === "not-available"
    ? "Not available"
    : access === "school-unavailable"
      ? "Your school subscription is suspended or expired."
      : "This module is not included in your plan";
  return <main className="p-6">{message}</main>;
}
