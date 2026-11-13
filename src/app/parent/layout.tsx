import type { ReactNode } from "react";
import { PortalGuard } from "@/lib/transport/portal-guard";

export default function ParentLayout({ children }: { children: ReactNode }) {
  return <PortalGuard role="parent">{children}</PortalGuard>;
}
