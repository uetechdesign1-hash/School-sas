"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getCurrentSchoolId } from "@/lib/supabase/current-school";
import { AcademicYearSelector } from "@/components/academic-year-selector";
import {
  ACADEMIC_YEAR_QUERY_PARAM,
  type AcademicYear,
  getAcademicYearStorageKey,
  withAcademicYearParam,
} from "@/lib/accounting/academic-year";

type AcademicYearContextValue = {
  academicYear: AcademicYear | null;
  academicYears: AcademicYear[];
  loading: boolean;
  selectAcademicYear: (id: string) => void;
};

const AcademicYearContext =
  createContext<AcademicYearContextValue | null>(null);

function updateAcademicYearUrl(
  pathname: string,
  currentQuery: string,
  academicYearId: string,
) {
  return withAcademicYearParam(
    `${pathname}${currentQuery ? `?${currentQuery}` : ""}`,
    academicYearId,
  );
}

export function AccountingAcademicYearProvider({
  children,
}: {
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryString = searchParams.toString();
  const requestedId = searchParams.get(ACADEMIC_YEAR_QUERY_PARAM);
  const [academicYears, setAcademicYears] = useState<AcademicYear[]>([]);
  const [academicYear, setAcademicYear] = useState<AcademicYear | null>(null);
  const [schoolId, setSchoolId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const initialized = useRef(false);
  const previousRequestedId = useRef(requestedId);

  useEffect(() => {
    let cancelled = false;

    async function loadAcademicYears() {
      try {
        setLoading(true);
        const schoolId = await getCurrentSchoolId();
        const { data, error } = await createClient()
          .from("academic_years")
          .select("id, school_id, name, start_date, end_date, is_current")
          .eq("school_id", schoolId)
          .order("start_date", { ascending: false });

        if (error) throw error;
        if (cancelled) return;

        const years = (data || []) as AcademicYear[];
        setSchoolId(schoolId);
        setAcademicYears(years);
        const storageKey = getAcademicYearStorageKey(schoolId);
        let savedId: string | null = null;
        try {
          savedId = window.localStorage.getItem(storageKey);
        } catch {
          // Continue using the scoped URL/current-year fallback when storage is unavailable.
        }
        const requested = years.find((year) => year.id === requestedId);
        const saved = years.find((year) => year.id === savedId);
        const currentYear = years.find((year) => year.is_current);
        const next = requested || saved || currentYear || years[0] || null;
        initialized.current = true;
        setAcademicYear(next);
        if (next) {
          try {
            window.localStorage.setItem(storageKey, next.id);
          } catch {
            // URL persistence remains available when storage is unavailable.
          }
        }
      } catch (error) {
        console.error("Unable to load academic years for accounting:", error);
        if (!cancelled) {
          setAcademicYears([]);
          setAcademicYear(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadAcademicYears();
    return () => {
      cancelled = true;
    };
  }, [requestedId]);

  useEffect(() => {
    if (!initialized.current || !academicYear) return;

    if (previousRequestedId.current !== requestedId) {
      previousRequestedId.current = requestedId;
      return;
    }

    if (requestedId) {
      const requested = academicYears.find((year) => year.id === requestedId);
      if (requested) {
        if (requested.id !== academicYear.id) {
          setAcademicYear(requested);
        }
        if (schoolId) {
          try {
            window.localStorage.setItem(
              getAcademicYearStorageKey(schoolId),
              requested.id,
            );
          } catch {
            // The selected year remains in the URL if storage is unavailable.
          }
        }
        return;
      }
      if (loading) return;
    }

    if (!requestedId || requestedId !== academicYear.id) {
      router.replace(
        updateAcademicYearUrl(pathname, queryString, academicYear.id),
        { scroll: false },
      );
    }
  }, [
    academicYear,
    academicYears,
    loading,
    pathname,
    queryString,
    requestedId,
    router,
    schoolId,
  ]);

  const selectAcademicYear = useCallback(
    (id: string) => {
      const next = academicYears.find((year) => year.id === id);
      if (!next) return;
      setAcademicYear(next);
      if (schoolId) {
        try {
          window.localStorage.setItem(
            getAcademicYearStorageKey(schoolId),
            next.id,
          );
        } catch {
          // Keep the selected year in the URL if storage is unavailable.
        }
      }
      router.replace(
        updateAcademicYearUrl(pathname, queryString, next.id),
        { scroll: false },
      );
    },
    [academicYears, pathname, queryString, router, schoolId],
  );

  const value = useMemo(
    () => ({ academicYear, academicYears, loading, selectAcademicYear }),
    [academicYear, academicYears, loading, selectAcademicYear],
  );

  return (
    <AcademicYearContext.Provider value={value}>
      <div className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 px-4 py-2 backdrop-blur sm:px-6">
        <AcademicYearSelector
          years={academicYears}
          value={academicYear?.id || ""}
          onChange={selectAcademicYear}
          disabled={loading || !academicYears.length}
          label="Academic year"
          labelClassName="flex max-w-sm items-center gap-3 text-sm"
          labelTextClassName="shrink-0 font-medium text-slate-700"
          selectClassName="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900"
        />
      </div>
      {children}
    </AcademicYearContext.Provider>
  );
}

export function useAccountingAcademicYear() {
  const context = useContext(AcademicYearContext);
  if (!context) {
    throw new Error(
      "useAccountingAcademicYear must be used within AccountingAcademicYearProvider.",
    );
  }
  return context;
}

export function useAcademicYearRange(
  setStartDate: (value: string) => void,
  setEndDate: (value: string) => void,
) {
  const { academicYear } = useAccountingAcademicYear();
  const selectedId = academicYear?.id;
  const startDate = academicYear?.start_date;
  const endDate = academicYear?.end_date;

  const applyRange = useCallback(() => {
    if (startDate && endDate) {
      setStartDate(startDate);
      setEndDate(endDate);
    }
  }, [endDate, setEndDate, setStartDate, startDate]);

  useEffect(() => {
    applyRange();
  }, [applyRange, selectedId]);

  return academicYear;
}
