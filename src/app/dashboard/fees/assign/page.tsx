"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  BadgeCheck,
  IndianRupee,
  Loader2,
  Users,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";

type SchoolClass = {
  id: string;
  name: string;
  display_order: number;
};

type AcademicYear = {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  is_current: boolean;
};

type FeeStructure = {
  id: string;
  name: string;
  academic_year_id: string;
  class_id: string | null;
  active: boolean;
};

type FeeStructureItem = {
  id: string;
  fee_structure_id: string;
  fee_category_id: string | null;
  amount: number;
  frequency: string;
  mandatory: boolean;
  category_name?: string | null;
};

type StudentRow = {
  id: string;
  admission_no: string;
  first_name: string;
  middle_name: string | null;
  last_name: string | null;
  roll_no: string | null;
  status: string;
};

type StudentBill = {
  id: string;
  bill_number: string;
  status?: string | null;
  total_amount: number | null;
  paid_amount: number | null;
  balance_amount: number | null;
};

type BillItemRow = {
  bill_id: string;
  fee_category_id: string | null;
};

type ClassSummary = {
  classId: string;
  className: string;
  students: number;
  billedStudents: number;
  total: number;
  paid: number;
  outstanding: number;
};

const supabase = createClient();

function money(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number(value) || 0);
}

function getStudentName(student: {
  first_name: string;
  middle_name: string | null;
  last_name: string | null;
}) {
  return [student.first_name, student.middle_name, student.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();
}

/*
 * Identical to the single-student fee assignment flow (Fee Ledger page) so
 * class-wide bills always match what the per-student flow would create.
 */
function getAnnualizedFeeAmount(amount: number, frequency: string) {
  const frequencyMultiplier: Record<string, number> = {
    one_time: 1,
    annual: 1,
    monthly: 12,
    quarterly: 4,
    half_yearly: 2,
  };

  return (
    Math.max(Number(amount) || 0, 0) * (frequencyMultiplier[frequency] || 1)
  );
}

export default function FeeAssignmentPage() {
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [currentYear, setCurrentYear] = useState<AcademicYear | null>(null);

  const [classId, setClassId] = useState("");
  const [structure, setStructure] = useState<FeeStructure | null>(null);
  const [structureItems, setStructureItems] = useState<FeeStructureItem[]>([]);

  const [students, setStudents] = useState<StudentRow[]>([]);
  const [billsByStudent, setBillsByStudent] = useState<
    Record<string, StudentBill>
  >({});
  const [billCategoryIds, setBillCategoryIds] = useState<
    Record<string, string[]>
  >({});

  const [selectedOptionalByStudent, setSelectedOptionalByStudent] = useState<Record<string, string[]>>({});
  const [classSummaries, setClassSummaries] = useState<ClassSummary[]>([]);

  const [loading, setLoading] = useState(true);
  const [assigning, setAssigning] = useState(false);
  const [changingOptional, setChangingOptional] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function loadPage() {
    try {
      setLoading(true);
      setError("");

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        window.location.assign("/login");
        return;
      }

      const { data: membership, error: membershipError } = await supabase
        .from("school_users")
        .select("school_id")
        .eq("user_id", user.id)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();

      if (membershipError) {
        throw membershipError;
      }

      if (!membership?.school_id) {
        throw new Error("No active school membership found.");
      }

      const schoolId = membership.school_id as string;

      const [classesResult, yearsResult] = await Promise.all([
        supabase
          .from("classes")
          .select("id, name, display_order")
          .eq("school_id", schoolId)
          .order("display_order", { ascending: true }),
        supabase
          .from("academic_years")
          .select("id, name, start_date, end_date, is_current")
          .eq("school_id", schoolId)
          .order("start_date", { ascending: false }),
      ]);

      if (classesResult.error) {
        throw classesResult.error;
      }

      if (yearsResult.error) {
        throw yearsResult.error;
      }

      setClasses((classesResult.data || []) as SchoolClass[]);

      const years = (yearsResult.data || []) as AcademicYear[];
      const selectedYear = years.find((year) => year.is_current) || years[0] || null;
      setCurrentYear(selectedYear);
      if (selectedYear) {
        await loadAllClassSummaries(schoolId, selectedYear.id, (classesResult.data || []) as SchoolClass[]);
      }
    } catch (loadError) {
      console.error("FEE ASSIGNMENT LOAD ERROR:", loadError);
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load the fee assignment page.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function loadAllClassSummaries(schoolId: string, academicYearId: string, loadedClasses: SchoolClass[]) {
    try {
      const [studentsResult, billsResult] = await Promise.all([
        supabase.from("students").select("id, class_id, status").eq("school_id", schoolId),
        supabase.from("fee_bills").select("id, student_id, total_amount, paid_amount, balance_amount, status").eq("school_id", schoolId).eq("academic_year_id", academicYearId),
      ]);
      if (studentsResult.error) throw studentsResult.error;
      if (billsResult.error) throw billsResult.error;
      const activeStudents = (studentsResult.data || []) as Array<{id:string; class_id:string|null; status:string}>;
      const bills = (billsResult.data || []) as Array<{student_id:string; total_amount:number|null; paid_amount:number|null; balance_amount:number|null; status?:string|null}>;
      const billMap = new Map<string,{total:number;paid:number;outstanding:number}>();
      for (const b of bills) { if (b.status === "cancelled") continue; billMap.set(b.student_id,{total:Math.max(Number(b.total_amount||0),0),paid:Math.max(Number(b.paid_amount||0),0),outstanding:Math.max(Number(b.balance_amount||0),0)}); }
      setClassSummaries(loadedClasses.map(c=>{
        const cs=activeStudents.filter(s=>s.class_id===c.id && s.status==="active");
        let total=0,paid=0,outstanding=0,billedStudents=0;
        for(const s of cs){const b=billMap.get(s.id); if(!b) continue; billedStudents++; total+=b.total; paid+=b.paid; outstanding+=b.outstanding;}
        return {classId:c.id,className:c.name,students:cs.length,billedStudents,total,paid,outstanding};
      }));
    } catch(e) { console.error("ALL CLASS FEE SUMMARY ERROR:",e); setClassSummaries([]); }
  }

  async function getSchoolId(): Promise<string | null> {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      window.location.assign("/login");
      return null;
    }

    const { data: membership, error: membershipError } = await supabase
      .from("school_users")
      .select("school_id")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (membershipError) {
      throw membershipError;
    }

    return (membership?.school_id as string) || null;
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadPage();
  }, []);

  /*
   * Load the class fee structure for the current academic year plus the
   * per-student outstanding data whenever the selected class changes.
   */
  const loadClassData = useCallback(async () => {
    setError("");
    setSuccess("");
    setStructure(null);
    setStructureItems([]);
    setStudents([]);
    setBillsByStudent({});
    setBillCategoryIds({});
    setSelectedOptionalByStudent({});

    if (!classId || !currentYear) {
      return;
    }

    try {
      const schoolId = await getSchoolId();

      if (!schoolId) {
        return;
      }

      const [structureResult, studentsResult] = await Promise.all([
        supabase
          .from("fee_structures")
          .select("id, name, academic_year_id, class_id, active")
          .eq("school_id", schoolId)
          .eq("class_id", classId)
          .eq("academic_year_id", currentYear.id)
          .eq("active", true)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("students")
          .select(
            "id, admission_no, first_name, middle_name, last_name, roll_no, status",
          )
          .eq("school_id", schoolId)
          .eq("class_id", classId)
          .eq("status", "active")
          .order("roll_no", { ascending: true }),
      ]);

      if (structureResult.error) {
        throw structureResult.error;
      }

      if (studentsResult.error) {
        throw studentsResult.error;
      }

      let loadedStructure = (structureResult.data ||
        null) as FeeStructure | null;

      // Match the single-student fee page:
      // 1. Use the selected class's active structure.
      // 2. If none exists, use an active All Classes structure (class_id IS NULL).
      if (!loadedStructure) {
        const { data: fallbackStructure, error: fallbackError } =
          await supabase
            .from("fee_structures")
            .select("id, name, academic_year_id, class_id, active")
            .eq("school_id", schoolId)
            .eq("academic_year_id", currentYear.id)
            .is("class_id", null)
            .eq("active", true)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

        if (fallbackError) {
          throw fallbackError;
        }

        loadedStructure = (fallbackStructure || null) as FeeStructure | null;
      }

      const loadedStudents = (studentsResult.data || []) as StudentRow[];

      setStructure(loadedStructure);

      if (loadedStructure) {
        const { data: itemsData, error: itemsError } = await supabase
          .from("fee_structure_items")
          .select(
            "id, fee_structure_id, fee_category_id, amount, frequency, mandatory, category:fee_categories(name)",
          )
          .eq("school_id", schoolId)
          .eq("fee_structure_id", loadedStructure.id);

        if (itemsError) {
          throw itemsError;
        }

        const items = ((itemsData || []) as Array<
          FeeStructureItem & { category?: { name?: string } | null }
        >).map((item) => ({
          ...item,
          category_name: item.category?.name || null,
        }));

        setStructureItems(items);
      }

      // Existing bills for these students in the current academic year.
      if (loadedStudents.length > 0) {
        const studentIds = loadedStudents.map((student) => student.id);

        const { data: billsData, error: billsError } = await supabase
          .from("fee_bills")
          .select(
            "id, student_id, bill_number, status, total_amount, paid_amount, balance_amount",
          )
          .eq("school_id", schoolId)
          .eq("academic_year_id", currentYear.id)
          .in("student_id", studentIds);

        if (billsError) {
          throw billsError;
        }

        const billMap: Record<string, StudentBill> = {};

        for (const bill of (billsData || []) as Array<
          StudentBill & { student_id: string }
        >) {
          // Cancelled bills are not considered an active assignment. If a
          // student has only a cancelled bill, the class assignment can
          // create a fresh current-year bill.
          if (bill.status === "cancelled") {
            continue;
          }

          billMap[bill.student_id] = {
            id: bill.id,
            bill_number: bill.bill_number,
            status: bill.status,
            total_amount: bill.total_amount,
            paid_amount: bill.paid_amount,
            balance_amount: bill.balance_amount,
          };
        }

        setBillsByStudent(billMap);

        // Bill line categories per bill. Assigned categories stay locked; a
        // ticked optional category here is genuinely new for every bill, so one
        // outstanding increase covers the whole class consistently.
        const billIds = Object.values(billMap).map((bill) => bill.id);

        if (billIds.length > 0) {
          const { data: billItemData, error: billItemsError } = await supabase
            .from("fee_bill_items")
            .select("bill_id, fee_category_id")
            .eq("school_id", schoolId)
            .in("bill_id", billIds);

          if (billItemsError) {
            throw billItemsError;
          }

          const categoryMap: Record<string, string[]> = {};

          for (const row of (billItemData || []) as BillItemRow[]) {
            if (!row.fee_category_id) {
              continue;
            }

            const existing = categoryMap[row.bill_id] || [];

            if (!existing.includes(row.fee_category_id)) {
              existing.push(row.fee_category_id);
            }

            categoryMap[row.bill_id] = existing;
          }

          setBillCategoryIds(categoryMap);
        }
      }

      setStudents(loadedStudents);
    } catch (loadError) {
      console.error("FEE ASSIGNMENT CLASS LOAD ERROR:", loadError);
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load class fee data.",
      );
    }
  }, [classId, currentYear]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadClassData();
  }, [loadClassData]);

  const mandatoryItems = useMemo(
    () => structureItems.filter((item) => Boolean(item.mandatory)),
    [structureItems],
  );

  const mandatoryTotal = useMemo(
    () =>
      mandatoryItems.reduce(
        (total, item) =>
          total +
          getAnnualizedFeeAmount(
            Number(item.amount || 0),
            item.frequency || "annual",
          ),
        0,
      ),
    [mandatoryItems],
  );

  // Class setup only stores mandatory categories (the per-category Mandatory
  // switches saved by Fee Structure remain exactly what class assignment uses).
  // This explicit override is only for admins who want one class-wide bill to
  // carry every category created for that class.
  const chosenItems = useMemo(() => mandatoryItems, [mandatoryItems]);

  const chosenTotal = useMemo(
    () =>
      chosenItems.reduce(
        (total, item) =>
          total +
          getAnnualizedFeeAmount(
            Number(item.amount || 0),
            item.frequency || "annual",
          ),
        0,
      ),
    [chosenItems],
  );

  const optionalItems = useMemo(
    () => structureItems.filter((item) => !Boolean(item.mandatory)),
    [structureItems],
  );

  function toggleOptionalForStudent(studentId: string, itemId: string) {
    setSelectedOptionalByStudent(prev => {
      const current=prev[studentId] || [];
      return {...prev,[studentId]:current.includes(itemId)?current.filter(id=>id!==itemId):[...current,itemId]};
    });
  }

  async function handleAddOptionalToStudent(student: StudentRow) {
    const bill=billsByStudent[student.id];
    const selectedIds=selectedOptionalByStudent[student.id] || [];
    if(!bill){setError("Assign the mandatory fee bill first.");return;}
    if(bill.status==="cancelled"){setError("Cancelled bills cannot receive optional fees.");return;}
    const assigned=billCategoryIds[bill.id] || [];
    const newItems=optionalItems.filter(item=>selectedIds.includes(item.id) && item.fee_category_id && !assigned.includes(item.fee_category_id));
    if(newItems.length===0){setError(`Select a new optional fee for ${getStudentName(student)}.`);return;}
    setChangingOptional(true); setError(""); setSuccess("");
    try {
      const {data,error}=await supabase.rpc("add_fee_items_to_bill",{p_bill_id:bill.id,p_items:newItems.map(item=>({fee_category_id:item.fee_category_id as string,fee_structure_item_id:item.id,description:item.category_name||"Fee",fee_type:item.frequency||"annual",amount:getAnnualizedFeeAmount(Number(item.amount||0),item.frequency||"annual")}))});
      if(error || !data?.success) throw new Error(error?.message || data?.message || "Unable to add optional fees.");
      const added=newItems.reduce((t,item)=>t+getAnnualizedFeeAmount(Number(item.amount||0),item.frequency||"annual"),0);
      setSuccess(`${money(added)} optional fee(s) added to ${getStudentName(student)}. Outstanding recalculated.`);
      setSelectedOptionalByStudent(prev=>{const next={...prev};delete next[student.id];return next;});
      await loadClassData();
      const schoolId = await getSchoolId();
      if(schoolId && currentYear) await loadAllClassSummaries(schoolId,currentYear.id,classes);
    } catch(e) { console.error("STUDENT OPTIONAL FEE ERROR:",e); setError(e instanceof Error?e.message:"Unable to add optional fee."); }
    finally { setChangingOptional(false); }
  }

  const totals = useMemo(() => {
    let overall = 0;
    let collected = 0;
    let pending = 0;

    for (const student of students) {
      const bill = billsByStudent[student.id];

      if (!bill) {
        continue;
      }

      overall += Math.max(Number(bill.total_amount || 0), 0);
      collected += Math.max(Number(bill.paid_amount || 0), 0);
      pending += Math.max(Number(bill.balance_amount || 0), 0);
    }

    return { overall, collected, pending };
  }, [students, billsByStudent]);

  /*
   * Assign mandatory fees to ALL active students in the selected class.
   *
   * For each active student:
   *   - no current-year bill -> create a bill with all mandatory fees
   *   - existing current-year bill -> add only missing mandatory categories
   *   - existing assigned mandatory categories are never duplicated
   *   - cancelled bills are ignored and a new active bill is created
   *
   * This makes the class-level assignment idempotent and keeps it consistent
   * with the single-student fee assignment flow.
   */
  async function handleAssignToClass() {
    if (!classId || !currentYear || !structure) {
      setError("Select a class with an active fee structure first.");
      return;
    }

    if (mandatoryItems.length === 0) {
      setError(
        "This fee structure has no mandatory fee items. Mark items as mandatory in the fee structure first.",
      );
      return;
    }

    const activeStudents = students.filter(
      (student) => student.status === "active",
    );

    if (activeStudents.length === 0) {
      setError("There are no active students in this class.");
      return;
    }

    const missingCategoryStudents = activeStudents.filter((student) => {
      const bill = billsByStudent[student.id];
      if (!bill || bill.status === "cancelled") {
        return true;
      }

      const assigned = new Set(billCategoryIds[bill.id] || []);
      return mandatoryItems.some(
        (item) =>
          Boolean(item.fee_category_id) &&
          !assigned.has(item.fee_category_id as string),
      );
    });

    const studentsNeedingAction = missingCategoryStudents.length;

    if (studentsNeedingAction === 0) {
      setSuccess(
        `All ${activeStudents.length} active students in ${selectedClassName} already have all mandatory fees assigned. No duplicate fees were created.`,
      );
      setError("");
      return;
    }

    const confirmed = window.confirm(
      `Assign all ${mandatoryItems.length} mandatory fee(s) totaling ${money(
        chosenTotal,
      )} per student to ALL ${activeStudents.length} active student(s) in ${selectedClassName}? ${studentsNeedingAction} student(s) need new or missing mandatory fees. Existing fees will not be duplicated. Optional fees remain unassigned.`,
    );

    if (!confirmed) {
      return;
    }

    setAssigning(true);
    setError("");
    setSuccess("");

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) {
        throw userError;
      }

      if (!user) {
        window.location.assign("/login");
        return;
      }

      const schoolId = await getSchoolId();

      if (!schoolId) {
        return;
      }

      const today = new Date().toISOString().split("T")[0];

      let created = 0;
      let updated = 0;
      let alreadyComplete = 0;
      const failed: string[] = [];

      for (const student of activeStudents) {
        try {
          // Re-read the student's current-year bill immediately before changing
          // it. This prevents stale UI data from creating a duplicate bill.
          const { data: currentBills, error: currentBillsError } =
            await supabase
              .from("fee_bills")
              .select(
                "id, student_id, bill_number, status, total_amount, paid_amount, balance_amount, bill_date",
              )
              .eq("school_id", schoolId)
              .eq("student_id", student.id)
              .eq("academic_year_id", currentYear.id)
              .order("bill_date", { ascending: false });

          if (currentBillsError) {
            throw currentBillsError;
          }

          const existingBill = (
            (currentBills || []) as Array<
              StudentBill & { student_id: string; bill_date?: string }
            >
          ).find((bill) => bill.status !== "cancelled") || null;

          if (existingBill) {
            const { data: itemData, error: itemError } = await supabase
              .from("fee_bill_items")
              .select("fee_category_id")
              .eq("school_id", schoolId)
              .eq("bill_id", existingBill.id);

            if (itemError) {
              throw itemError;
            }

            const assignedCategoryIds = new Set(
              ((itemData || []) as Array<{ fee_category_id: string | null }>)
                .map((row) => row.fee_category_id)
                .filter((id): id is string => Boolean(id)),
            );

            const missingMandatoryItems = mandatoryItems.filter(
              (item) =>
                Boolean(item.fee_category_id) &&
                !assignedCategoryIds.has(item.fee_category_id as string),
            );

            if (missingMandatoryItems.length === 0) {
              alreadyComplete += 1;
              continue;
            }

            const { data: addData, error: addError } = await supabase.rpc(
              "add_fee_items_to_bill",
              {
                p_bill_id: existingBill.id,
                p_items: missingMandatoryItems.map((item) => ({
                  fee_category_id: item.fee_category_id as string,
                  fee_structure_item_id: item.id,
                  description: item.category_name || "Fee",
                  fee_type: item.frequency || "annual",
                  amount: getAnnualizedFeeAmount(
                    Number(item.amount || 0),
                    item.frequency || "annual",
                  ),
                })),
              },
            );

            if (addError) {
              throw addError;
            }

            if (!addData?.success) {
              throw new Error(
                addData?.message ||
                  `Unable to add missing mandatory fees to ${getStudentName(
                    student,
                  )}.`,
              );
            }

            updated += 1;
            continue;
          }

          // No active current-year bill: create one containing every mandatory
          // category from the selected class structure.
          const billNumber =
            "BILL-" +
            today.replace(/-/g, "") +
            "-" +
            crypto.randomUUID().slice(0, 8).toUpperCase();

          const { data: billData, error: billError } = await supabase
            .from("fee_bills")
            .insert({
              school_id: schoolId,
              student_id: student.id,
              academic_year_id: currentYear.id,
              bill_number: billNumber,
              bill_date: today,
              due_date: null,
              status: "unpaid",
              subtotal: chosenTotal,
              discount: 0,
              late_fee: 0,
              total_amount: chosenTotal,
              paid_amount: 0,
              balance_amount: chosenTotal,
              notes: `Class fee assignment from ${structure.name} (mandatory fees)`,
              created_by: user.id,
            })
            .select("id, bill_number")
            .single();

          if (billError || !billData?.id) {
            throw new Error(
              billError?.message || "Fee bill was not created.",
            );
          }

          const items = chosenItems.map((item) => {
            if (!item.fee_category_id) {
              throw new Error(
                `Mandatory fee "${item.category_name || "Fee"}" has no fee category.`,
              );
            }

            const annualAmount = getAnnualizedFeeAmount(
              Number(item.amount || 0),
              item.frequency || "annual",
            );

            return {
              school_id: schoolId,
              bill_id: billData.id,
              fee_structure_id: structure.id,
              fee_category_id: item.fee_category_id,
              description: item.category_name || "Fee",
              fee_type: item.frequency || "annual",
              amount: annualAmount,
              discount: 0,
              net_amount: annualAmount,
            };
          });

          const { error: itemsInsertError } = await supabase
            .from("fee_bill_items")
            .insert(items);

          if (itemsInsertError) {
            await supabase
              .from("fee_bills")
              .delete()
              .eq("id", billData.id)
              .eq("school_id", schoolId);

            throw new Error(
              `Unable to save fee items: ${itemsInsertError.message}`,
            );
          }

          const { data: recalcData, error: recalcError } =
            await supabase.rpc("recalculate_fee_bill", {
              p_bill_id: billData.id,
            });

          if (recalcError) {
            await supabase
              .from("fee_bill_items")
              .delete()
              .eq("school_id", schoolId)
              .eq("bill_id", billData.id);

            await supabase
              .from("fee_bills")
              .delete()
              .eq("id", billData.id)
              .eq("school_id", schoolId);

            throw new Error(
              `Unable to recalculate fee bill: ${recalcError.message}`,
            );
          }

          if (recalcData && recalcData.success === false) {
            await supabase
              .from("fee_bill_items")
              .delete()
              .eq("school_id", schoolId)
              .eq("bill_id", billData.id);

            await supabase
              .from("fee_bills")
              .delete()
              .eq("id", billData.id)
              .eq("school_id", schoolId);

            throw new Error(
              recalcData.message || "Unable to recalculate fee bill.",
            );
          }

          created += 1;
        } catch (studentError) {
          console.error(
            "CLASS FEE ASSIGNMENT STUDENT ERROR:",
            student.id,
            studentError,
          );
          failed.push(
            `${getStudentName(student) || student.admission_no}: ${
              studentError instanceof Error
                ? studentError.message
                : "Unable to assign mandatory fees."
            }`,
          );
        }
      }

      const changed = created + updated;

      if (changed > 0) {
        setSuccess(
          `${changed} active student(s) processed in ${selectedClassName}: ${created} new bill(s) created and ${updated} existing bill(s) updated with missing mandatory fees. ${alreadyComplete} student(s) already had all mandatory fees. No duplicate mandatory fees were created.`,
        );
      } else if (alreadyComplete === activeStudents.length) {
        setSuccess(
          `All ${activeStudents.length} active students in ${selectedClassName} already have all mandatory fees assigned. No duplicate fees were created.`,
        );
      }

      if (failed.length > 0) {
        setError(
          `Failed for ${failed.length} student(s): ${failed.join(" | ")}`,
        );
      }

      await loadClassData();
      await loadAllClassSummaries(
        schoolId,
        currentYear.id,
        classes,
      );
    } catch (assignError) {
      console.error("CLASS FEE ASSIGN ERROR:", assignError);
      setError(
        assignError instanceof Error
          ? assignError.message
          : "Unable to assign class fees.",
      );
    } finally {
      setAssigning(false);
    }
  }

  const selectedClassName =
    classes.find((item) => item.id === classId)?.name || "";

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center gap-3 text-slate-500">
        <Loader2 size={22} className="animate-spin" />
        <p className="text-sm font-medium">Loading fee assignment...</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl p-6">
      <Link
        href="/dashboard/fees/structure"
        className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-700"
      >
        <ArrowLeft size={16} />
        Back to Fee Structure
      </Link>

      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Student Fee Assignment
          </h1>

          <p className="mt-1 text-sm text-slate-500">
            Mandatory fees are assigned automatically to all active students;
            optional fees are selected individually and increase that student's
            outstanding when added.
          </p>
        </div>

        {currentYear && (
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm">
            <span className="font-semibold text-slate-700">
              Academic Year:
            </span>{" "}
            <span className="text-slate-600">{currentYear.name}</span>
          </div>
        )}
      </div>

      {error && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {error}
        </div>
      )}

      {success && (
        <div className="mt-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm font-medium text-green-700">
          {success}
        </div>
      )}

      {classSummaries.length > 0 && (
        <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4"><h2 className="font-bold text-slate-900">All Classes — Fee Outstanding</h2><p className="mt-1 text-xs text-slate-500">Current academic year • actual student fee bills</p></div>
          <div className="overflow-x-auto"><table className="w-full min-w-[800px]"><thead><tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-bold uppercase tracking-wide text-slate-500"><th className="px-5 py-3">Class</th><th className="px-5 py-3 text-right">Students</th><th className="px-5 py-3 text-right">Bills</th><th className="px-5 py-3 text-right">Total Billed</th><th className="px-5 py-3 text-right">Collected</th><th className="px-5 py-3 text-right">Outstanding</th></tr></thead><tbody>{classSummaries.map(s=><tr key={s.classId} className="border-b border-slate-100 last:border-b-0"><td className="px-5 py-3 font-semibold text-slate-900">{s.className}</td><td className="px-5 py-3 text-right text-slate-600">{s.students}</td><td className="px-5 py-3 text-right text-slate-600">{s.billedStudents}</td><td className="px-5 py-3 text-right text-slate-700">{money(s.total)}</td><td className="px-5 py-3 text-right text-green-700">{money(s.paid)}</td><td className="px-5 py-3 text-right font-bold text-red-600">{money(s.outstanding)}</td></tr>)}</tbody></table></div>
        </section>
      )}

      {/* CLASS PICKER + STRUCTURE */}
      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <label className="block text-sm font-bold text-slate-700">
          Select Class
        </label>

        <select
          value={classId}
          onChange={(event) => setClassId(event.target.value)}
          className="mt-2 w-full max-w-md rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none"
        >
          <option value="">— Select a class —</option>
          {classes.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>

        {classId && (
          <div className="mt-4">
            {structure ? (
              <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-bold text-slate-900">
                      {structure.name}
                    </div>

                    <div className="mt-0.5 text-xs text-slate-500">
                      {selectedClassName} • {currentYear?.name}
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="text-xs font-semibold uppercase tracking-wide text-blue-700">
                      Mandatory Total
                    </div>

                    <div className="text-lg font-bold text-slate-900">
                      {money(mandatoryTotal)}
                    </div>
                  </div>
                </div>

                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {structureItems.map((item) => {

                    return (
                      <div
                        key={item.id}
                        className="flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2 text-xs"
                      >
                        <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">

                          <span className="truncate font-medium text-slate-700">
                            {item.category_name || "Fee"}
                          </span>
                        </label>

                        <span className="flex shrink-0 items-center gap-2">
                          <span className="font-semibold text-slate-900">
                            {money(
                              getAnnualizedFeeAmount(
                                Number(item.amount || 0),
                                item.frequency || "annual",
                              ),
                            )}
                          </span>

                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                              item.mandatory
                                ? "bg-blue-100 text-blue-700"
                                : "bg-slate-100 text-slate-500"
                            }`}
                          >
                            {item.mandatory ? "Mandatory" : "Optional"}
                          </span>
                        </span>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void handleAssignToClass()}
                    disabled={
                      assigning ||
                      chosenItems.length === 0 ||
                      students.length === 0
                    }
                    className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {assigning ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <BadgeCheck size={16} />
                    )}
                    Assign Mandatory Fees to All Active Students (
                    {students.filter((student) => student.status === "active").length})
                  </button>

                  <span className="text-xs text-slate-500">
                    All active students in this class are checked. Students
                    without a bill receive a new bill; students with an
                    existing bill receive only missing mandatory fees. Existing
                    fees are never duplicated. Optional fees are selected
                    separately per student below.
                  </span>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                No active fee structure found for{" "}
                <span className="font-semibold">{selectedClassName}</span> in{" "}
                {currentYear?.name}. Create one in{" "}
                <Link
                  href="/dashboard/fees/structure"
                  className="font-semibold underline"
                >
                  Fee Structure
                </Link>{" "}
                first.
              </div>
            )}
          </div>
        )}
      </section>

      {classId && structure && optionalItems.length > 0 && (
        <section className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
          <h2 className="text-base font-bold text-slate-900">Optional Fees — Select Per Student</h2>
          <p className="mt-1 text-xs leading-5 text-slate-600">Select an optional fee in the student row below and click Add Selected. Only that student's outstanding will increase.</p>
        </section>
      )}

      {/* STUDENT OUTSTANDING TABLE */}
      {classId && students.length > 0 && (
        <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
            <div><h2 className="font-bold text-slate-900">{selectedClassName} — Fee Outstanding</h2><p className="text-xs text-slate-500">{students.length} student(s) • Actual fee bills</p></div>
            <div className="flex flex-wrap gap-4 text-right">
              <div><div className="text-xs font-medium text-slate-500">Total Billed</div><div className="text-sm font-bold text-slate-900">{money(totals.overall)}</div></div>
              <div><div className="text-xs font-medium text-slate-500">Collected</div><div className="text-sm font-bold text-green-700">{money(totals.collected)}</div></div>
              <div><div className="text-xs font-medium text-slate-500">Outstanding</div><div className="text-sm font-bold text-red-600">{money(totals.pending)}</div></div>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px]">
              <thead><tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3">Student</th><th className="px-4 py-3">Admission</th><th className="px-4 py-3">Bill</th><th className="px-4 py-3 text-right">Total</th><th className="px-4 py-3 text-right">Paid</th><th className="px-4 py-3 text-right">Outstanding</th>
                {optionalItems.map(item=><th key={item.id} className="px-4 py-3 text-center"><div>{item.category_name || "Optional"}</div><div className="mt-0.5 font-normal normal-case">{money(getAnnualizedFeeAmount(Number(item.amount||0),item.frequency||"annual"))}</div></th>)}
                <th className="px-4 py-3 text-center">Action</th>
              </tr></thead>
              <tbody>
                {students.map(student=>{
                  const bill=billsByStudent[student.id];
                  const balance=Number(bill?.balance_amount||0);
                  const selectedIds=selectedOptionalByStudent[student.id] || [];
                  const assigned=bill ? billCategoryIds[bill.id] || [] : [];
                  return <tr key={student.id} className="border-b border-slate-100 text-sm last:border-b-0">
                    <td className="px-4 py-3 font-medium text-slate-900">{getStudentName(student)}</td>
                    <td className="px-4 py-3 text-slate-600">{student.admission_no}</td>
                    <td className="px-4 py-3 text-slate-600">{bill?.bill_number || "—"}</td>
                    <td className="px-4 py-3 text-right text-slate-700">{bill ? money(Number(bill.total_amount||0)) : "—"}</td>
                    <td className="px-4 py-3 text-right text-green-700">{bill ? money(Number(bill.paid_amount||0)) : "—"}</td>
                    <td className="px-4 py-3 text-right font-semibold text-red-600">{bill ? money(balance) : "—"}</td>
                    {optionalItems.map(item=>{
                      const already=Boolean(item.fee_category_id && assigned.includes(item.fee_category_id));
                      const selected=selectedIds.includes(item.id);
                      return <td key={item.id} className="px-4 py-3 text-center">{!bill ? <span className="text-slate-300">—</span> : already ? <span className="inline-flex rounded-full bg-green-100 px-2 py-1 text-[10px] font-bold text-green-700">Added</span> : <input type="checkbox" checked={selected} disabled={bill.status==="cancelled"} onChange={()=>toggleOptionalForStudent(student.id,item.id)} className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50" />}</td>;
                    })}
                    <td className="px-4 py-3 text-center"><div className="flex items-center justify-center gap-2">
                      {selectedIds.length>0 && <button type="button" onClick={()=>void handleAddOptionalToStudent(student)} disabled={changingOptional || !bill || bill.status==="cancelled"} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50">{changingOptional ? "Saving..." : "Add Selected"}</button>}
                      <Link href={`/dashboard/students/${student.id}/fees`} className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 px-3 py-1.5 text-xs font-semibold text-blue-600 hover:bg-blue-50"><IndianRupee size={13}/>Fees</Link>
                    </div></td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {classId && students.length === 0 && !loading && (
        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm">
          <p className="text-sm font-medium text-slate-500">
            No students found in this class.
          </p>
        </div>
      )}
    </div>
  );
}
