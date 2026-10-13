export type SchoolAcademicYear = {
  id: string;
  school_id: string;
  name: string;
  start_date: string;
  end_date: string;
  is_current: boolean;
};

export function selectSchoolAcademicYear(
  years: SchoolAcademicYear[],
  schoolId: string,
  requestedId?: string | null,
  persistedId?: string | null,
): SchoolAcademicYear | null;

export function resolveEnrollmentPlacement(
  enrollment: {
    student_id: string;
    academic_year_id: string;
    class_id: string | null;
    section_id: string | null;
  } | undefined,
  requestedYearId: string | null | undefined,
  currentStudent: {
    id: string;
    academic_year_id?: string | null;
    class_id?: string | null;
    section_id?: string | null;
  },
): {
  classId: string | null;
  sectionId: string | null;
  source: "enrollment" | "current" | "none";
};

export function dateIsWithinAcademicYear(
  date: string | null | undefined,
  year: Pick<SchoolAcademicYear, "start_date" | "end_date"> | null | undefined,
): boolean;

export function monthIsWithinAcademicYear(
  month: string,
  year: Pick<SchoolAcademicYear, "start_date" | "end_date"> | null | undefined,
): boolean;

export function separateCarryForwardAmounts(input: {
  currentBilled: number;
  currentPending: number;
  carriedOriginal: number;
  carriedRemaining: number;
  previousArrears: number;
}): {
  currentYearBilled: number;
  currentYearPending: number;
  priorYearArrears: number;
  totalPayable: number;
};

export function sumDatedAmounts(
  records: Record<string, unknown>[],
  dateKey: string,
  amountKey: string,
  startDate: string,
  endDate: string,
): number;

export function summarizeInventoryPeriod(
  openingQuantity: number,
  openingUnitCost: number,
  rows: Array<Record<string, unknown> & {
    movement_date: string;
    movement_type: string;
    quantity: number;
    balance_quantity: number;
    balance_unit_cost: number;
    ref_table?: string | null;
    notes?: string | null;
  }>,
  startDate: string,
  endDate: string,
): {
  openingQuantity: number;
  purchases: number;
  purchaseReturns: number;
  sales: number;
  saleReturns: number;
  closingQuantity: number;
  avgCost: number;
};
