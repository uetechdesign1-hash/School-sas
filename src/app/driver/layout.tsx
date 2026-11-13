import type { ReactNode } from "react";
import { PortalGuard } from "@/lib/transport/portal-guard";

export default function DriverLayout({ children }: { children: ReactNode }) {
  return <PortalGuard role="driver">{children}</PortalGuard>;
}
