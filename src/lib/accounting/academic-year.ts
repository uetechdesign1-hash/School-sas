export const ACADEMIC_YEAR_QUERY_PARAM = "academic_year_id";

export type AcademicYear = {
  id: string;
  school_id: string;
  name: string;
  start_date: string;
  end_date: string;
  is_current: boolean;
};

export function getAcademicYearStorageKey(schoolId: string) {
  return `schoolflow-academic-year:${schoolId}`;
}

export function getAcademicYearForDate(
  years: AcademicYear[],
  date: string,
) {
  return years.find(
    (year) => year.start_date <= date && year.end_date >= date,
  ) ?? null;
}

export function withAcademicYearParam(
  href: string,
  academicYearId: string | null | undefined,
) {
  if (!academicYearId || !href.startsWith("/")) return href;

  const [path, hash = ""] = href.split("#", 2);
  const [pathname, query = ""] = path.split("?", 2);
  const params = new URLSearchParams(query);
  params.set(ACADEMIC_YEAR_QUERY_PARAM, academicYearId);
  const serialized = params.toString();

  return `${pathname}${serialized ? `?${serialized}` : ""}${hash ? `#${hash}` : ""}`;
}
