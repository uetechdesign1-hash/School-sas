import { PortalShell, type NavItem } from "@/components/business/portal-shell";
import { requirePortalRole } from "@/lib/auth/portal-access";

const NAV: readonly NavItem[] = [
  { label: "Dashboard", href: "/sales", icon: "dashboard", exact: true },
  { label: "My Schools", href: "/sales/schools", icon: "schools", exact: true },
  { label: "Add New School", href: "/sales/schools/new", icon: "addSchool" },
  { label: "Leads", href: "/sales/leads", icon: "leads" },
  { label: "Initial MOUs", href: "/sales/mous/initial", icon: "initialMou" },
  { label: "Final MOUs", href: "/sales/mous/final", icon: "finalMou" },
  { label: "Payment Collection", href: "/sales/collections", icon: "collections" },
  { label: "My Reports", href: "/sales/reports", icon: "reports" },
  { label: "My Profile", href: "/sales/profile", icon: "profile" },
];

export default async function SalesLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePortalRole("sales_rep", "/super-admin/login");

  return (
    <PortalShell
      brand="Sales"
      tagline="Representative workspace"
      nav={NAV}
      userName={user.name}
      userEmail={user.email}
      signOutRedirect="/super-admin/login"
    >
      {children}
    </PortalShell>
  );
}
