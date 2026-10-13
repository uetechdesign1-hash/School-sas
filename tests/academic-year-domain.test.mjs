import assert from "node:assert/strict";
import test from "node:test";
import {
  dateIsWithinAcademicYear,
  monthIsWithinAcademicYear,
  resolveEnrollmentPlacement,
  selectSchoolAcademicYear,
  separateCarryForwardAmounts,
  sumDatedAmounts,
  summarizeInventoryPeriod,
} from "../src/lib/academic-year-domain.mjs";

const currentYear = {
  id: "ay-2026",
  school_id: "school-a",
  name: "2026-2027",
  start_date: "2026-04-01",
  end_date: "2027-03-31",
  is_current: true,
};
const priorYear = {
  id: "ay-2025",
  school_id: "school-a",
  name: "2025-2026",
  start_date: "2025-04-01",
  end_date: "2026-03-31",
  is_current: false,
};

test("selects the configured current year and rejects another school's year", () => {
  const foreignYear = { ...currentYear, id: "ay-foreign", school_id: "school-b" };
  assert.equal(
    selectSchoolAcademicYear(
      [priorYear, currentYear, foreignYear],
      "school-a",
    ),
    currentYear,
  );
  assert.equal(
    selectSchoolAcademicYear(
      [priorYear, currentYear, foreignYear],
      "school-a",
      "ay-foreign",
    ),
    currentYear,
  );
});

test("allows a valid historical year selection for the same school", () => {
  assert.equal(
    selectSchoolAcademicYear(
      [priorYear, currentYear],
      "school-a",
      priorYear.id,
    ),
    priorYear,
  );
});

test("uses configured inclusive academic-year boundaries", () => {
  assert.equal(dateIsWithinAcademicYear("2026-04-01", currentYear), true);
  assert.equal(dateIsWithinAcademicYear("2027-03-31", currentYear), true);
  assert.equal(dateIsWithinAcademicYear("2026-03-31", currentYear), false);
});

test("does not let promotion replace the historical enrollment placement", () => {
  const oldPlacement = {
    student_id: "student-1",
    academic_year_id: priorYear.id,
    class_id: "class-1",
    section_id: "section-a",
  };
  const previous = resolveEnrollmentPlacement(oldPlacement, priorYear.id, {
    id: "student-1",
    academic_year_id: currentYear.id,
    class_id: "class-2",
    section_id: "section-b",
  });
  assert.deepEqual(previous, {
    classId: "class-1",
    sectionId: "section-a",
    source: "enrollment",
  });
});

test("separates ₹1,000 carried arrears from new-year mandatory fees", () => {
  const totals = separateCarryForwardAmounts({
    currentBilled: 13_000,
    currentPending: 13_000,
    carriedOriginal: 1_000,
    carriedRemaining: 1_000,
    previousArrears: 0,
  });
  assert.deepEqual(totals, {
    currentYearBilled: 12_000,
    currentYearPending: 12_000,
    priorYearArrears: 1_000,
    totalPayable: 13_000,
  });
});

test("attributes current-year cash by receipt date even when allocated to old debt", () => {
  const payments = [
    { payment_date: "2025-12-15", amount: 9_000, bill_id: "old-bill" },
    { payment_date: "2026-05-10", amount: 1_000, bill_id: "old-bill" },
  ];
  assert.equal(
    sumDatedAmounts(payments, "payment_date", "amount", "2026-04-01", "2027-03-31"),
    1_000,
  );
  assert.equal(payments[1].bill_id, "old-bill");
});

test("filters expense and vendor activity by academic-year transaction date", () => {
  const rows = [
    { date: "2026-03-31", amount: 400 },
    { date: "2026-04-01", amount: 250 },
    { date: "2027-03-31", amount: 100 },
    { date: "2027-04-01", amount: 50 },
  ];
  assert.equal(
    sumDatedAmounts(rows, "date", "amount", currentYear.start_date, currentYear.end_date),
    350,
  );
});

test("accepts only complete payroll months within configured year dates", () => {
  assert.equal(monthIsWithinAcademicYear("2026-04", currentYear), true);
  assert.equal(monthIsWithinAcademicYear("2027-03", currentYear), true);
  assert.equal(monthIsWithinAcademicYear("2026-03", currentYear), false);
  assert.equal(
    monthIsWithinAcademicYear("2026-04", {
      ...currentYear,
      start_date: "2026-04-15",
    }),
    false,
  );
});

test("carries pre-period stock into opening and computes in-period closing", () => {
  const stock = summarizeInventoryPeriod(
    10,
    5,
    [
      {
        movement_date: "2026-03-20",
        movement_type: "purchase",
        quantity: 5,
        balance_quantity: 15,
        balance_unit_cost: 6,
      },
      {
        movement_date: "2026-04-01",
        movement_type: "adjustment",
        quantity: 10,
        balance_quantity: 10,
        balance_unit_cost: 5,
        ref_table: "inventory_items",
        notes: "Opening balance",
      },
      {
        movement_date: "2026-05-01",
        movement_type: "purchase",
        quantity: 4,
        balance_quantity: 19,
        balance_unit_cost: 6,
      },
      {
        movement_date: "2026-06-01",
        movement_type: "sale",
        quantity: -3,
        balance_quantity: 16,
        balance_unit_cost: 6,
      },
    ],
    currentYear.start_date,
    currentYear.end_date,
  );
  assert.equal(stock.openingQuantity, 15);
  assert.equal(stock.purchases, 4);
  assert.equal(stock.sales, 3);
  assert.equal(stock.closingQuantity, 16);
});
