import assert from "node:assert/strict";
import test from "node:test";
import {
  assertSameSchool,
  buildCarryForwardLines,
  buildEnrollmentLookup,
  enrollmentKey,
  isOutstandingBill,
  isYearEligibleForArchive,
  parseCarryForwardNotes,
  resolveHistoricalPlacement,
  serializeCarryForwardNotes,
  sumStudentOutstanding,
  SchoolScopeError,
} from "../src/lib/students/enrollment-history.ts";

// ---------------------------------------------------------------------------
// Rajesh fixture: the exact scenario from the requirements.
// ---------------------------------------------------------------------------
const SCHOOL = "school-1";
const OTHER_SCHOOL = "school-2";
const YEAR_2526 = "year-2526";
const YEAR_2627 = "year-2627";
const CLASS_1 = "class-1";
const CLASS_2 = "class-2";
const SECTION_A = "section-a";
const TUITION = "category-tuition";
const RAJESH = "student-rajesh";

function makeRajeshWorld() {
  return {
    students: [
      {
        id: RAJESH,
        school_id: SCHOOL,
        academic_year_id: YEAR_2526,
        class_id: CLASS_1,
        section_id: SECTION_A,
        status: "active",
      },
    ],
    enrollments: [
      {
        id: "enr-2526",
        school_id: SCHOOL,
        student_id: RAJESH,
        academic_year_id: YEAR_2526,
        class_id: CLASS_1,
        section_id: SECTION_A,
        enrollment_status: "active",
        source: "students_current",
        updated_at: "2026-01-01T00:00:00Z",
      },
    ],
    bills: [
      {
        id: "bill-2526",
        school_id: SCHOOL,
        student_id: RAJESH,
        academic_year_id: YEAR_2526,
        total_amount: 10000,
        paid_amount: 9000,
        balance_amount: 1000,
        status: "partial",
      },
    ],
    billItems: [
      {
        id: "item-tuition-2526",
        school_id: SCHOOL,
        bill_id: "bill-2526",
        fee_category_id: TUITION,
        description: "Tuition Fee",
        amount: 10000,
        discount: 0,
        net_amount: 10000,
      },
    ],
    allocations: [
      {
        id: "alloc-1",
        school_id: SCHOOL,
        bill_id: "bill-2526",
        payment_id: "payment-1",
        fee_bill_item_id: "item-tuition-2526",
        amount: 9000,
      },
    ],
    payments: [
      {
        id: "payment-1",
        school_id: SCHOOL,
        student_id: RAJESH,
        bill_id: "bill-2526",
        receipt_number: "RCP-0001",
        payment_date: "2026-04-10",
        amount: 9000,
      },
    ],
    carryForwards: [],
    // One income event per payment, created only by payments.
    incomeEvents: [{ source: "payment-1", amount: 9000 }],
  };
}

function paidByItem(world, billId) {
  const map = new Map();
  for (const allocation of world.allocations) {
    if (allocation.bill_id !== billId) continue;
    if (!allocation.fee_bill_item_id) continue;
    map.set(
      allocation.fee_bill_item_id,
      (map.get(allocation.fee_bill_item_id) || 0) + Number(allocation.amount || 0),
    );
  }
  return map;
}

// Mirrors create_fee_carry_forward: one row per (source bill, target year).
function createCarryForward(world, { studentId, sourceBillId, toYear, yearName }) {
  const existing = world.carryForwards.find(
    (row) =>
      row.source_bill_id === sourceBillId &&
      row.to_academic_year_id === toYear &&
      row.status !== "void",
  );
  if (existing) return { created: false, row: existing };

  const bill = world.bills.find((row) => row.id === sourceBillId);
  const lines = buildCarryForwardLines({
    billBalance: bill.balance_amount,
    academicYearName: yearName,
    items: world.billItems.filter((item) => item.bill_id === sourceBillId),
    paidByItemId: paidByItem(world, sourceBillId),
  });
  const amount = Number(lines.reduce((total, line) => total + line.amount, 0).toFixed(2));
  const row = {
    id: `carry-${world.carryForwards.length + 1}`,
    school_id: SCHOOL,
    student_id: studentId,
    source_bill_id: sourceBillId,
    source_academic_year_id: bill.academic_year_id,
    to_academic_year_id: toYear,
    amount,
    status: "pending",
    notes: serializeCarryForwardNotes(lines),
  };
  world.carryForwards.push(row);
  return { created: true, row };
}

// Mirrors promote_students + carry-forward creation (one transaction).
// Like the RPC, the source year is explicit (p_from_academic_year_id).
function promote(world, { fromYear = YEAR_2526, toYear, toClass, toSection, yearName }) {
  const student = world.students.find((row) => row.id === RAJESH);

  // (a) source enrollment -> promoted (history preserved, never overwritten)
  const oldEnrollment = world.enrollments.find(
    (row) => row.student_id === RAJESH && row.academic_year_id === fromYear,
  );
  oldEnrollment.enrollment_status = "promoted";

  // (b) target enrollment, idempotent via unique (student, year)
  let newEnrollment = world.enrollments.find(
    (row) => row.student_id === RAJESH && row.academic_year_id === toYear,
  );
  if (!newEnrollment) {
    newEnrollment = {
      id: `enr-${toYear}`,
      school_id: SCHOOL,
      student_id: RAJESH,
      academic_year_id: toYear,
      class_id: toClass,
      section_id: toSection,
      enrollment_status: "active",
      promotion_from_enrollment_id: oldEnrollment.id,
      source: "promotion",
      updated_at: "2026-04-01T00:00:00Z",
    };
    world.enrollments.push(newEnrollment);
  }

  // (c) current view of the student
  student.academic_year_id = toYear;
  student.class_id = toClass;
  student.section_id = toSection;

  // (d) carry forward (idempotent per source bill + target year)
  const carry = createCarryForward(world, {
    studentId: RAJESH,
    sourceBillId: "bill-2526",
    toYear,
    yearName,
  });

  return { oldEnrollment, newEnrollment, carry };
}

function recalculate(world, billId) {
  const bill = world.bills.find((row) => row.id === billId);
  const items = world.billItems.filter((item) => item.bill_id === billId);
  const total = items.reduce(
    (sum, item) => sum + Number(item.net_amount ?? item.amount ?? 0),
    0,
  );
  const paid = world.allocations
    .filter((allocation) => allocation.bill_id === billId)
    .reduce((sum, allocation) => sum + Number(allocation.amount || 0), 0);
  bill.total_amount = Number(total.toFixed(2));
  bill.paid_amount = Number(paid.toFixed(2));
  bill.balance_amount = Number(Math.max(total - paid, 0).toFixed(2));
  bill.status =
    bill.balance_amount <= 0.005 ? "paid" : paid > 0 ? "partial" : "unpaid";
}

// Applies pending carry-forwards into the target-year bill (the existing
// fee-assignment workflow) and marks the source bill carried_forward.
function applyCarryForwards(world, { toYear, newFeeItems }) {
  let targetBill = world.bills.find(
    (bill) => bill.student_id === RAJESH && bill.academic_year_id === toYear,
  );
  if (!targetBill) {
    targetBill = {
      id: `bill-${toYear}`,
      school_id: SCHOOL,
      student_id: RAJESH,
      academic_year_id: toYear,
      total_amount: 0,
      paid_amount: 0,
      balance_amount: 0,
      status: "unpaid",
    };
    world.bills.push(targetBill);
    for (const fee of newFeeItems) {
      world.billItems.push({
        id: `item-${toYear}-${fee.fee_category_id}`,
        school_id: SCHOOL,
        bill_id: targetBill.id,
        fee_structure_id: `structure-${toYear}`,
        fee_category_id: fee.fee_category_id,
        description: fee.description,
        amount: fee.amount,
        discount: 0,
        net_amount: fee.amount,
      });
    }
  }

  for (const carry of world.carryForwards) {
    if (carry.to_academic_year_id !== toYear) continue;
    if (carry.status !== "pending") continue;
    const lines = parseCarryForwardNotes(carry.notes) || [];
    for (const line of lines) {
      const itemId = `carry-item-${carry.id}-${line.category_name}`;
      if (!world.billItems.some((item) => item.id === itemId)) {
        world.billItems.push({
          id: itemId,
          school_id: SCHOOL,
          bill_id: targetBill.id,
          fee_structure_id: null,
          fee_category_id: line.fee_category_id,
          description: `${line.category_name} - ${line.academic_year_name}`,
          amount: line.amount,
          discount: 0,
          net_amount: line.amount,
        });
      }
    }
    carry.status = "applied";
    carry.target_bill_id = targetBill.id;
    const sourceBill = world.bills.find((bill) => bill.id === carry.source_bill_id);
    if (sourceBill) sourceBill.status = "carried_forward";
  }

  recalculate(world, targetBill.id);
  return targetBill;
}

// Payment allocated to a bill item, like record_fee_payment.
function recordPayment(world, { billId, itemId, amount, receiptNumber }) {
  const payment = {
    id: `payment-${world.payments.length + 1}`,
    school_id: SCHOOL,
    student_id: RAJESH,
    bill_id: billId,
    receipt_number: receiptNumber,
    payment_date: "2026-05-01",
    amount,
  };
  world.payments.push(payment);
  world.allocations.push({
    id: `alloc-${world.allocations.length + 1}`,
    school_id: SCHOOL,
    bill_id: billId,
    payment_id: payment.id,
    fee_bill_item_id: itemId,
    amount,
  });
  world.incomeEvents.push({ source: payment.id, amount });
  recalculate(world, billId);
  return payment;
}

// ===========================================================================
// Required scenarios
// ===========================================================================

const lookup = (world) => buildEnrollmentLookup(world.enrollments);
const rajesh = (world) => world.students[0];

test("1+3: Rs1000 arrear is computed from allocations and carried forward once", () => {
  const world = makeRajeshWorld();
  const lines = buildCarryForwardLines({
    billBalance: 1000,
    academicYearName: "2025-2026",
    items: world.billItems.filter((item) => item.bill_id === "bill-2526"),
    paidByItemId: paidByItem(world, "bill-2526"),
  });
  assert.equal(lines.length, 1);
  assert.equal(lines[0].amount, 1000);
  assert.equal(lines[0].fee_category_id, TUITION);
  assert.equal(lines[0].academic_year_name, "2025-2026");

  const first = createCarryForward(world, {
    studentId: RAJESH,
    sourceBillId: "bill-2526",
    toYear: YEAR_2627,
    yearName: "2025-2026",
  });
  assert.equal(first.created, true);
  assert.equal(first.row.amount, 1000);
  assert.equal(first.row.source_academic_year_id, YEAR_2526);

  // Repeating the operation must not create a second carry-forward.
  const second = createCarryForward(world, {
    studentId: RAJESH,
    sourceBillId: "bill-2526",
    toYear: YEAR_2627,
    yearName: "2025-2026",
  });
  assert.equal(second.created, false);
  assert.equal(second.row.id, first.row.id);
  assert.equal(world.carryForwards.length, 1);
});

test("2: promotion creates the 2026-27 enrollment and preserves 2025-26 history", () => {
  const world = makeRajeshWorld();
  promote(world, { toYear: YEAR_2627, toClass: CLASS_2, toSection: SECTION_A, yearName: "2025-2026" });

  const student = rajesh(world);
  assert.equal(student.academic_year_id, YEAR_2627);
  assert.equal(student.class_id, CLASS_2);

  const lookupMap = lookup(world);
  const in2526 = lookupMap.get(enrollmentKey(RAJESH, YEAR_2526));
  const in2627 = lookupMap.get(enrollmentKey(RAJESH, YEAR_2627));
  assert.equal(in2526.enrollment_status, "promoted");
  assert.equal(in2526.class_id, CLASS_1);
  assert.equal(in2627.enrollment_status, "active");
  assert.equal(in2627.class_id, CLASS_2);
  assert.equal(in2627.promotion_from_enrollment_id, in2526.id);
});

test("4: new-year tuition Rs12000 plus Rs1000 arrear gives Rs13000 total due", () => {
  const world = makeRajeshWorld();
  promote(world, { toYear: YEAR_2627, toClass: CLASS_2, toSection: SECTION_A, yearName: "2025-2026" });
  const targetBill = applyCarryForwards(world, {
    toYear: YEAR_2627,
    newFeeItems: [{ fee_category_id: TUITION, description: "Tuition Fee", amount: 12000 }],
  });
  assert.equal(targetBill.total_amount, 13000);
  assert.equal(targetBill.balance_amount, 13000);

  const descriptions = world.billItems
    .filter((item) => item.bill_id === targetBill.id)
    .map((item) => item.description);
  assert.ok(descriptions.includes("Tuition Fee"));
  assert.ok(descriptions.includes("Tuition Fee - 2025-2026"));
});

test("5: the 2025-26 Class 1 filter still returns Rajesh after promotion", () => {
  const world = makeRajeshWorld();
  promote(world, { toYear: YEAR_2627, toClass: CLASS_2, toSection: SECTION_A, yearName: "2025-2026" });

  const lookupMap = lookup(world);
  const student = rajesh(world);
  const placement = resolveHistoricalPlacement({
    lookup: lookupMap,
    studentId: student.id,
    academicYearId: YEAR_2526,
    currentStudent: student,
  });
  assert.equal(placement.classId, CLASS_1);
  assert.equal(placement.source, "enrollment");

  // Filtering students by (year=2025-26, class=Class 1) keeps him.
  const filtered = world.students.filter((row) => {
    const place = resolveHistoricalPlacement({
      lookup: lookupMap,
      studentId: row.id,
      academicYearId: YEAR_2526,
      currentStudent: row,
    });
    return place.classId === CLASS_1;
  });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].id, RAJESH);
});

test("6: the original receipt keeps its number, date and bill reference", () => {
  const world = makeRajeshWorld();
  promote(world, { toYear: YEAR_2627, toClass: CLASS_2, toSection: SECTION_A, yearName: "2025-2026" });
  applyCarryForwards(world, {
    toYear: YEAR_2627,
    newFeeItems: [{ fee_category_id: TUITION, description: "Tuition Fee", amount: 12000 }],
  });

  const receipt = world.payments.find((row) => row.id === "payment-1");
  assert.equal(receipt.receipt_number, "RCP-0001");
  assert.equal(receipt.payment_date, "2026-04-10");
  assert.equal(receipt.bill_id, "bill-2526");
  // The original bill and its allocations are untouched.
  const sourceBill = world.bills.find((bill) => bill.id === "bill-2526");
  assert.equal(sourceBill.total_amount, 10000);
  assert.equal(sourceBill.paid_amount, 9000);
  assert.equal(world.allocations.filter((a) => a.bill_id === "bill-2526").length, 1);
});

test("7: historical ledger and current-year ledger show the correct records", () => {
  const world = makeRajeshWorld();
  promote(world, { toYear: YEAR_2627, toClass: CLASS_2, toSection: SECTION_A, yearName: "2025-2026" });
  applyCarryForwards(world, {
    toYear: YEAR_2627,
    newFeeItems: [{ fee_category_id: TUITION, description: "Tuition Fee", amount: 12000 }],
  });

  const historical = world.bills.filter((bill) => bill.academic_year_id === YEAR_2526);
  const current = world.bills.filter((bill) => bill.academic_year_id === YEAR_2627);
  assert.equal(historical.length, 1);
  assert.equal(historical[0].total_amount, 10000);
  assert.equal(historical[0].paid_amount, 9000);
  assert.equal(current.length, 1);
  assert.equal(current[0].total_amount, 13000);
});

test("8: repeating promotion does not duplicate enrollment, fees or arrears", () => {
  const world = makeRajeshWorld();
  const options = { toYear: YEAR_2627, toClass: CLASS_2, toSection: SECTION_A, yearName: "2025-2026" };
  promote(world, options);
  applyCarryForwards(world, {
    toYear: YEAR_2627,
    newFeeItems: [{ fee_category_id: TUITION, description: "Tuition Fee", amount: 12000 }],
  });

  // Repeat the whole promotion + fee assignment flow.
  promote(world, options);
  applyCarryForwards(world, {
    toYear: YEAR_2627,
    newFeeItems: [{ fee_category_id: TUITION, description: "Tuition Fee", amount: 12000 }],
  });

  assert.equal(
    world.enrollments.filter((row) => row.academic_year_id === YEAR_2627).length,
    1,
  );
  assert.equal(world.carryForwards.length, 1);
  assert.equal(
    world.bills.filter((bill) => bill.academic_year_id === YEAR_2627).length,
    1,
  );
  const structureItems = world.billItems.filter(
    (item) => item.bill_id === "bill-year-2627" && item.fee_structure_id,
  );
  assert.equal(structureItems.length, 1);
  const carryItems = world.billItems.filter(
    (item) => item.bill_id === "bill-year-2627" && !item.fee_structure_id,
  );
  assert.equal(carryItems.length, 1);
});

test("9: paying the old arrear updates outstanding without duplicate income", () => {
  const world = makeRajeshWorld();
  promote(world, { toYear: YEAR_2627, toClass: CLASS_2, toSection: SECTION_A, yearName: "2025-2026" });
  const targetBill = applyCarryForwards(world, {
    toYear: YEAR_2627,
    newFeeItems: [{ fee_category_id: TUITION, description: "Tuition Fee", amount: 12000 }],
  });
  assert.equal(targetBill.balance_amount, 13000);

  const carryItem = world.billItems.find(
    (item) => item.bill_id === targetBill.id && !item.fee_structure_id,
  );
  recordPayment(world, {
    billId: targetBill.id,
    itemId: carryItem.id,
    amount: 1000,
    receiptNumber: "RCP-0002",
  });

  // Outstanding drops by exactly the arrear amount.
  assert.equal(targetBill.balance_amount, 12000);
  // Income is recognized once per payment: 9000 + 1000, never more.
  const totalIncome = world.incomeEvents.reduce((sum, event) => sum + event.amount, 0);
  assert.equal(totalIncome, 10000);
  assert.equal(world.incomeEvents.length, world.payments.length);
  // Applying the carry-forward itself never created income.
  assert.ok(!world.incomeEvents.some((event) => event.source === "carry-forward"));
});

test("10: outstanding aggregation never double counts carried-forward arrears", () => {
  const world = makeRajeshWorld();
  promote(world, { toYear: YEAR_2627, toClass: CLASS_2, toSection: SECTION_A, yearName: "2025-2026" });
  const targetBill = applyCarryForwards(world, {
    toYear: YEAR_2627,
    newFeeItems: [{ fee_category_id: TUITION, description: "Tuition Fee", amount: 12000 }],
  });

  // Before carry application the source bill still owns the arrear: 1000 + 12000.
  // After application the source bill is carried_forward and excluded: 13000.
  assert.equal(isOutstandingBill(world.bills.find((b) => b.id === "bill-2526")), false);
  assert.equal(sumStudentOutstanding(world.bills, RAJESH), 13000);

  const carryItem = world.billItems.find(
    (item) => item.bill_id === targetBill.id && !item.fee_structure_id,
  );
  recordPayment(world, {
    billId: targetBill.id,
    itemId: carryItem.id,
    amount: 1000,
    receiptNumber: "RCP-0003",
  });
  assert.equal(sumStudentOutstanding(world.bills, RAJESH), 12000);
});

test("11: records from another school are rejected", () => {
  assert.doesNotThrow(() => assertSameSchool(SCHOOL, SCHOOL));
  assert.throws(() => assertSameSchool(OTHER_SCHOOL, SCHOOL), SchoolScopeError);
  assert.throws(() => assertSameSchool(null, SCHOOL), SchoolScopeError);
  assert.throws(() => assertSameSchool(undefined, SCHOOL), SchoolScopeError);
});

test("12: retention archives without deleting protected financial history", () => {
  const today = new Date("2026-10-11T00:00:00");
  // Indefinite retention (0) archives nothing.
  assert.equal(
    isYearEligibleForArchive({ end_date: "2018-03-31", is_current: false }, 0, today),
    false,
  );
  // 2-year retention archives a year that ended > 2 years ago.
  assert.equal(
    isYearEligibleForArchive({ end_date: "2023-03-31", is_current: false }, 2, today),
    true,
  );
  // ... but not one inside the retention window.
  assert.equal(
    isYearEligibleForArchive({ end_date: "2025-03-31", is_current: false }, 2, today),
    false,
  );
  // Current and already-archived years are never archived.
  assert.equal(
    isYearEligibleForArchive({ end_date: "2018-03-31", is_current: true }, 2, today),
    false,
  );
  assert.equal(
    isYearEligibleForArchive(
      { end_date: "2018-03-31", is_current: false, archived_at: "2026-01-01" },
      2,
      today,
    ),
    false,
  );

  // Archiving models a soft flag: students, bills, payments and receipts
  // stay in place untouched.
  const world = makeRajeshWorld();
  const before = {
    students: world.students.length,
    bills: world.bills.length,
    payments: world.payments.length,
    allocations: world.allocations.length,
  };
  const year = { end_date: "2023-03-31", is_current: false, archived_at: null };
  if (isYearEligibleForArchive(year, 2, today)) {
    year.archived_at = today.toISOString();
  }
  assert.ok(year.archived_at);
  assert.deepEqual(
    {
      students: world.students.length,
      bills: world.bills.length,
      payments: world.payments.length,
      allocations: world.allocations.length,
    },
    before,
  );
});


