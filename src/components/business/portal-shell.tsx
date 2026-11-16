"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  AlertCircle,
  BarChart3,
  Building2,
  Contact,
  CreditCard,
  FileSignature,
  FileText,
  Handshake,
  LayoutDashboard,
  LogOut,
  Menu,
  PlusCircle,
  ReceiptText,
  Settings,
  ShieldCheck,
  Tag,
  UserCircle,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const ICONS = {
  dashboard: LayoutDashboard,
  schools: Building2,
  team: Users,
  leads: Contact,
  plans: Tag,
  initialMou: FileSignature,
  finalMou: Handshake,
  invoices: ReceiptText,
  payments: Wallet,
  outstanding: AlertCircle,
  settings: Settings,
  privacy: ShieldCheck,
  terms: FileText,
  reports: BarChart3,
  addSchool: PlusCircle,
  collections: CreditCard,
  profile: UserCircle,
} as const;

export type NavIcon = keyof typeof ICONS;

export type NavItem = {
  label: string;
  href: string;
  icon: NavIcon;
  exact?: boolean;
};

type Props = {
  brand: string;
  tagline: string;
  nav: readonly NavItem[];
  userName: string;
  userEmail: string;
  signOutRedirect: string;
  children: ReactNode;
};

export function PortalShell({ brand, tagline, nav, userName, userEmail, signOutRedirect, children }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    setSigningOut(true);
    await createClient().auth.signOut();
    router.replace(signOutRedirect);
    router.refresh();
  }

  const isActive = (item: NavItem) =>
    item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);

  const sidebar = (
    <aside className="flex h-full w-64 flex-col border-r border-slate-200 bg-white">
      <div className="flex items-center gap-3 border-b border-slate-200 p-5">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 font-bold text-white">{brand.charAt(0)}</div>
        <div className="min-w-0">
          <div className="truncate font-bold text-slate-900">{brand}</div>
          <div className="truncate text-xs text-slate-500">{tagline}</div>
        </div>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto p-3" aria-label="Main navigation">
        {nav.map((item) => {
          const Icon = ICONS[item.icon];
          const active = isActive(item);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                active ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-slate-200 p-4">
        <div className="truncate text-sm font-semibold text-slate-900">{userName}</div>
        <div className="truncate text-xs text-slate-500">{userEmail}</div>
        <button
          type="button"
          onClick={signOut}
          disabled={signingOut}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          <LogOut className="h-4 w-4" />
          {signingOut ? "Signing out..." : "Sign out"}
        </button>
      </div>
    </aside>
  );

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="fixed inset-y-0 left-0 z-30 hidden lg:block">{sidebar}</div>

      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="absolute inset-y-0 left-0 shadow-xl">{sidebar}</div>
        </div>
      ) : null}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur lg:hidden">
          <button type="button" onClick={() => setOpen(true)} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100" aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
          <span className="font-semibold text-slate-900">{brand}</span>
          {open ? (
            <button type="button" onClick={() => setOpen(false)} className="ml-auto rounded-lg p-2 text-slate-600" aria-label="Close menu">
              <X className="h-5 w-5" />
            </button>
          ) : null}
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
