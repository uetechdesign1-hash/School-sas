"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { validateModules, type ModuleCode } from "@/lib/modules";
import { moduleForRoute } from "./module-routes";

type SchoolContextValue = {
  schoolId: string | null;
  modules: ModuleCode[];
  loading: boolean;
  error: string | null;
};

const SchoolContext = createContext<SchoolContextValue | null>(null);

export function SchoolProvider({ children }: { children: ReactNode }) {
  const supabase = useMemo(() => createClient(), []);
  const [state, setState] = useState<SchoolContextValue>({
    schoolId: null,
    modules: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    async function loadSchool() {
      try {
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (userError) throw new Error(userError.message);
        if (!user) throw new Error("Please sign in to load school modules.");

        const { data: memberships, error: membershipError } = await supabase
          .from("school_users")
          .select("school_id")
          .eq("user_id", user.id)
          .eq("is_active", true);
        if (membershipError) throw new Error(membershipError.message);
        const schoolIds = [...new Set((memberships || []).map(({ school_id }) => school_id).filter(Boolean))];
        if (schoolIds.length !== 1) {
          throw new Error("Unable to determine a single active school for module access.");
        }

        const { data: school, error: schoolError } = await supabase
          .from("schools")
          .select("enabled_modules")
          .eq("id", schoolIds[0])
          .maybeSingle();
        if (schoolError) throw new Error(schoolError.message);
        if (!school) throw new Error("Unable to load your school.");
        const modules = validateModules(school.enabled_modules);
        if (!cancelled) setState({ schoolId: schoolIds[0], modules, loading: false, error: null });
      } catch (error) {
        console.error("SCHOOL MODULES ERROR:", error);
        if (!cancelled) {
          setState({
            schoolId: null,
            modules: [],
            loading: false,
            error: error instanceof Error ? error.message : "Unable to load school modules.",
          });
        }
      }
    }

    void loadSchool();
    return () => { cancelled = true; };
  }, [supabase]);

  return <SchoolContext.Provider value={state}>{children}</SchoolContext.Provider>;
}

export function useSchoolContext() {
  const context = useContext(SchoolContext);
  if (!context) throw new Error("useSchoolContext requires SchoolProvider.");
  return context;
}

export function ModuleGuard({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const school = useSchoolContext();
  return <ModuleGate pathname={pathname} school={school}>{children}</ModuleGate>;
}

export function ModuleGate({
  pathname,
  school: { modules, loading, error },
  children,
}: {
  pathname: string;
  school: SchoolContextValue;
  children: ReactNode;
}) {
  const required = moduleForRoute(pathname);

  if (!required) return children;
  if (loading) return <p className="p-6 text-sm text-slate-500">Checking module access...</p>;
  if (error) return <p role="alert" className="p-6 text-sm text-red-700">{error}</p>;
  if (!modules.includes(required)) {
    return <p role="alert" className="p-6">This module is not included in your plan</p>;
  }
  return children;
}
