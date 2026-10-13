export function selectSchoolAcademicYear(
  years,
  schoolId,
  requestedId,
  persistedId,
) {
  const schoolYears = years.filter((year) => year.school_id === schoolId);
  return (
    schoolYears.find((year) => year.id === requestedId) ||
    schoolYears.find((year) => year.id === persistedId) ||
    schoolYears.find((year) => year.is_current) ||
    null
  );
}

export function resolveEnrollmentPlacement(
  enrollment,
  requestedYearId,
  currentStudent,
) {
  if (
    enrollment &&
    enrollment.academic_year_id === requestedYearId &&
    enrollment.student_id === currentStudent.id
  ) {
    return {
      classId: enrollment.class_id ?? null,
      sectionId: enrollment.section_id ?? null,
      source: "enrollment",
    };
  }
  if (
    requestedYearId &&
    requestedYearId === currentStudent.academic_year_id
  ) {
    return {
      classId: currentStudent.class_id ?? null,
      sectionId: currentStudent.section_id ?? null,
      source: "current",
    };
  }
  return { classId: null, sectionId: null, source: "none" };
}

export function dateIsWithinAcademicYear(date, year) {
  return Boolean(
    date &&
      year?.start_date &&
      year?.end_date &&
      date >= year.start_date &&
      date <= year.end_date,
  );
}

export function monthIsWithinAcademicYear(month, year) {
  if (!/^\d{4}-\d{2}$/.test(month) || !year) return false;
  const [yearNumber, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(yearNumber, monthNumber, 0).getDate();
  return dateIsWithinAcademicYear(`${month}-01`, year) &&
    dateIsWithinAcademicYear(`${month}-${String(lastDay).padStart(2, "0")}`, year);
}

export function separateCarryForwardAmounts({
  currentBilled,
  currentPending,
  carriedOriginal,
  carriedRemaining,
  previousArrears,
}) {
  const currentYearBilled = Math.max(Number(currentBilled || 0) - Number(carriedOriginal || 0), 0);
  const currentYearPending = Math.max(Number(currentPending || 0) - Number(carriedRemaining || 0), 0);
  const priorYearArrears = Math.max(Number(previousArrears || 0), 0) +
    Math.max(Number(carriedRemaining || 0), 0);
  return {
    currentYearBilled,
    currentYearPending,
    priorYearArrears,
    totalPayable: currentYearPending + priorYearArrears,
  };
}

export function sumDatedAmounts(records, dateKey, amountKey, startDate, endDate) {
  return records.reduce((total, record) => {
    const date = record[dateKey];
    if (!dateIsWithinAcademicYear(date, { start_date: startDate, end_date: endDate })) {
      return total;
    }
    const amount = Number(record[amountKey] || 0);
    return total + (Number.isFinite(amount) ? amount : 0);
  }, 0);
}

export function summarizeInventoryPeriod(
  openingQuantity,
  openingUnitCost,
  rows,
  startDate,
  endDate,
) {
  const isOpeningSeed = (row) =>
    row.ref_table === "inventory_items" || row.notes === "Opening balance";
  const priorRows = rows.filter((row) => row.movement_date < startDate);
  const throughEnd = rows.filter((row) => row.movement_date <= endDate);
  const periodRows = rows.filter(
    (row) =>
      row.movement_date >= startDate &&
      row.movement_date <= endDate &&
      !isOpeningSeed(row),
  );
  const prior = priorRows[priorRows.length - 1];
  const ending = throughEnd[throughEnd.length - 1];
  const opening = prior
    ? Number(prior.balance_quantity || 0)
    : Number(openingQuantity || 0);
  const avgCost = ending
    ? Number(ending.balance_unit_cost || 0)
    : prior
      ? Number(prior.balance_unit_cost || 0)
      : Number(openingUnitCost || 0);
  const sum = (type) =>
    periodRows
      .filter((row) => row.movement_type === type)
      .reduce((total, row) => total + Number(row.quantity || 0), 0);
  return {
    openingQuantity: opening,
    purchases: sum("purchase"),
    purchaseReturns: Math.abs(sum("purchase_return")),
    sales: Math.abs(sum("sale")),
    saleReturns: sum("sale_return"),
    closingQuantity: ending
      ? Number(ending.balance_quantity || 0)
      : opening,
    avgCost,
  };
}
