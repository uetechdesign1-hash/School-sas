import { PortalShell, type NavItem } from "@/components/business/portal-shell";
import { requirePortalRole } from "@/lib/auth/portal-access";

const NAV: readonly NavItem[] = [
  { label: "Dashboard", href: "/super-admin", icon: "dashboard", exact: true },
  { label: "Schools", href: "/super-admin/schools", icon: "schools" },
  { label: "Sales Team", href: "/super-admin/sales-team", icon: "team" },
  { label: "Leads / Prospects", href: "/super-admin/leads", icon: "leads" },
  { label: "Subscription Plans", href: "/super-admin/plans", icon: "plans" },
  { label: "Initial MOUs", href: "/super-admin/mous/initial", icon: "initialMou" },
  { label: "Final MOUs", href: "/super-admin/mous/final", icon: "finalMou" },
  { label: "Invoices", href: "/super-admin/invoices", icon: "invoices" },
  { label: "Payments & Collections", href: "/super-admin/payments", icon: "payments" },
  { label: "Outstanding Payments", href: "/super-admin/outstanding", icon: "outstanding" },
  { label: "Company Settings", href: "/super-admin/company-settings", icon: "settings" },
  { label: "Privacy Policy", href: "/super-admin/policies/privacy", icon: "privacy" },
  { label: "Terms & Conditions", href: "/super-admin/policies/terms", icon: "terms" },
  { label: "Reports", href: "/super-admin/reports", icon: "reports" },
];

export default async function SuperAdminPortalLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePortalRole("super_admin", "/super-admin/login");

  return (
    <PortalShell
      brand="Super Admin"
      tagline="Business management"
      nav={NAV}
      userName={user.name}
      userEmail={user.email}
      signOutRedirect="/super-admin/login"
    >
      {children}
    </PortalShell>
  );
}
