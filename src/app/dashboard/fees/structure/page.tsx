"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type AcademicYear = {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  is_current: boolean;
};

type SchoolClass = {
  id: string;
  name: string;
  display_order: number;
};

type FeeCategory = {
  id: string;
  name: string;
  description: string | null;
  default_frequency:
    | "one_time"
    | "annual"
    | "monthly"
    | "quarterly"
    | "half_yearly";
  is_active: boolean;
};

type FeeItem = {
  id?: string;
  fee_category_id: string;
  amount: string;
  frequency:
    | "one_time"
    | "annual"
    | "monthly"
    | "quarterly"
    | "half_yearly";
  mandatory: boolean;
};

type FeeStructure = {
  id: string;
  academic_year_id: string;
  class_id: string | null;
  name: string;
  active: boolean;
  academic_year?: AcademicYear | null;
  school_class?: SchoolClass | null;
  items?: Array<
    FeeItem & {
      id: string;
      category?: FeeCategory | null;
    }
  >;
};

const FREQUENCIES = [
  { value: "one_time", label: "One Time" },
  { value: "annual", label: "Annual" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "half_yearly", label: "Half Yearly" },
] as const;

function supabaseErrorMessage(
  error: unknown,
  fallback: string,
) {
  if (!error) {
    return fallback;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  const value = error as {
    message?: string;
    details?: string;
    hint?: string;
    code?: string;
  };

  const parts = [
    value.message,
    value.details,
    value.hint,
    value.code ? `Code: ${value.code}` : "",
  ].filter(Boolean);

  return parts.length
    ? parts.join(" â€” ")
    : fallback;
}

const emptyItem = (): FeeItem => ({
  fee_category_id: "",
  amount: "",
  frequency: "annual",
  mandatory: true,
});

export default function FeeStructurePage() {
  const supabase = useMemo(() => createClient(), []);

  const [schoolId, setSchoolId] = useState("");
  const [academicYears, setAcademicYears] = useState<AcademicYear[]>([]);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [categories, setCategories] = useState<FeeCategory[]>([]);
  const [structures, setStructures] = useState<FeeStructure[]>([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [showCategoryForm, setShowCategoryForm] = useState(false);
  const [showAcademicYearForm, setShowAcademicYearForm] =
    useState(false);

  const [newAcademicYearName, setNewAcademicYearName] =
    useState("");
  const [newAcademicYearStartDate, setNewAcademicYearStartDate] =
    useState("");
  const [newAcademicYearEndDate, setNewAcademicYearEndDate] =
    useState("");
  const [newAcademicYearCurrent, setNewAcademicYearCurrent] =
    useState(true);
  const [creatingAcademicYear, setCreatingAcademicYear] =
    useState(false);

  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryDescription, setNewCategoryDescription] =
    useState("");
  const [newCategoryFrequency, setNewCategoryFrequency] =
    useState<FeeCategory["default_frequency"]>("annual");
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [academicYearId, setAcademicYearId] = useState("");
  const [classId, setClassId] = useState("");
  const [structureName, setStructureName] = useState("");
  const [active, setActive] = useState(true);
  const [items, setItems] = useState<FeeItem[]>([emptyItem()]);

  useEffect(() => {
    loadPage();
  }, []);

  async function loadPage() {
    try {
      setLoading(true);
      setErrorMessage("");

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        window.location.href = "/login";
        return;
      }

      const { data: membership, error: membershipError } =
        await supabase
          .from("school_users")
          .select("school_id, role, is_active")
          .eq("user_id", user.id)
          .eq("is_active", true)
          .limit(1)
          .maybeSingle();

      if (membershipError) {
        throw membershipError;
      }

      if (!membership) {
        window.location.href = "/login";
        return;
      }

      setSchoolId(membership.school_id);

      const [
        academicYearResult,
        classResult,
        categoryResult,
        structureResult,
      ] = await Promise.all([
        supabase
          .from("academic_years")
          .select(
            "id, name, start_date, end_date, is_current",
          )
          .eq("school_id", membership.school_id)
          .order("start_date", { ascending: false }),

        supabase
          .from("classes")
          .select("id, name, display_order")
          .eq("school_id", membership.school_id)
          .order("display_order", { ascending: true })
          .order("name", { ascending: true }),

        supabase
          .from("fee_categories")
          .select(
            "id, name, description, default_frequency, is_active",
          )
          .eq("school_id", membership.school_id)
          .eq("is_active", true)
          .order("name", { ascending: true }),

        supabase
          .from("fee_structures")
          .select(
            `
              id,
              academic_year_id,
              class_id,
              name,
              active,
              academic_year:academic_years(
                id,
                name,
                start_date,
                end_date,
                is_current
              ),
              school_class:classes(
                id,
                name,
                display_order
              ),
              items:fee_structure_items(
                id,
                fee_category_id,
                amount,
                frequency,
                mandatory,
                category:fee_categories(
                  id,
                  name,
                  description,
                  default_frequency,
                  is_active
                )
              )
            `,
          )
          .eq("school_id", membership.school_id)
          .order("created_at", { ascending: false }),
      ]);

      if (academicYearResult.error) {
        throw academicYearResult.error;
      }

      if (classResult.error) {
        throw classResult.error;
      }

      if (categoryResult.error) {
        throw categoryResult.error;
      }

      if (structureResult.error) {
        throw structureResult.error;
      }

      setAcademicYears(
        (academicYearResult.data || []) as AcademicYear[],
      );

      setClasses(
        (classResult.data || []) as SchoolClass[],
      );

      setCategories(
        (categoryResult.data || []) as FeeCategory[],
      );

      const normalizedStructures = (
        structureResult.data || []
      ).map((structure) => ({
        ...structure,
        academic_year: Array.isArray(structure.academic_year)
          ? structure.academic_year[0] ?? null
          : structure.academic_year ?? null,
        school_class: Array.isArray(structure.school_class)
          ? structure.school_class[0] ?? null
          : structure.school_class ?? null,
        items: (structure.items || []).map((item) => ({
          ...item,
          category: Array.isArray(item.category)
            ? item.category[0] ?? null
            : item.category ?? null,
        })),
      })) as unknown as FeeStructure[];

      setStructures(normalizedStructures);
    } catch (error) {
      console.error("FEE STRUCTURE LOAD ERROR:", error);

      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to load fee structures.",
      );
    } finally {
      setLoading(false);
    }
  }

  function resetForm() {
    const currentYear =
      academicYears.find((year) => year.is_current);

    setEditingId(null);
    setAcademicYearId(currentYear?.id || "");
    setClassId("");
    setStructureName("");
    setActive(true);
    setItems([emptyItem()]);
  }

  function openCreateForm() {
    resetForm();
    setErrorMessage("");
    setSuccessMessage("");
    setShowForm(true);
  }

  function closeForm() {
    if (saving) return;

    setShowForm(false);
    resetForm();
  }

  function addItem() {
    setItems((current) => [...current, emptyItem()]);
  }

  function removeItem(index: number) {
    setItems((current) => {
      if (current.length === 1) {
        return [emptyItem()];
      }

      return current.filter((_, itemIndex) => itemIndex !== index);
    });
  }

  function updateItem(
    index: number,
    field: keyof FeeItem,
    value: string | boolean,
  ) {
    setItems((current) =>
      current.map((item, itemIndex) => {
        if (itemIndex !== index) {
          return item;
        }

        return {
          ...item,
          [field]: value,
        };
      }),
    );
  }

  function handleCategoryChange(
    index: number,
    categoryId: string,
  ) {
    const category = categories.find(
      (item) => item.id === categoryId,
    );

    setItems((current) =>
      current.map((item, itemIndex) => {
        if (itemIndex !== index) {
          return item;
        }

        return {
          ...item,
          fee_category_id: categoryId,
          frequency:
            category?.default_frequency || item.frequency,
        };
      }),
    );
  }

  function startEdit(structure: FeeStructure) {
    setEditingId(structure.id);
    setAcademicYearId(structure.academic_year_id);
    setClassId(structure.class_id || "");
    setStructureName(structure.name);
    setActive(structure.active);

    const existingItems = (structure.items || []).map(
      (item) => ({
        id: item.id,
        fee_category_id: item.fee_category_id,
        amount: String(item.amount ?? ""),
        frequency: item.frequency,
        mandatory: item.mandatory,
      }),
    );

    setItems(
      existingItems.length
        ? existingItems
        : [emptyItem()],
    );

    setErrorMessage("");
    setSuccessMessage("");
    setShowForm(true);

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  async function handleCreateAcademicYear() {
    setErrorMessage("");
    setSuccessMessage("");

    const name = newAcademicYearName.trim();

    if (!schoolId) {
      setErrorMessage("School information is missing.");
      return;
    }

    if (!name) {
      setErrorMessage("Please enter an academic year name.");
      return;
    }

    if (!newAcademicYearStartDate || !newAcademicYearEndDate) {
      setErrorMessage(
        "Please select both the start date and end date.",
      );
      return;
    }

    if (newAcademicYearEndDate < newAcademicYearStartDate) {
      setErrorMessage(
        "Academic year end date cannot be before the start date.",
      );
      return;
    }

    try {
      setCreatingAcademicYear(true);

      // If this is the current year, clear the previous current flag
      // first. This keeps the data consistent with the table design.
      if (newAcademicYearCurrent) {
        const { error: clearCurrentError } = await supabase
          .from("academic_years")
          .update({ is_current: false })
          .eq("school_id", schoolId)
          .eq("is_current", true);

        if (clearCurrentError) {
          throw clearCurrentError;
        }
      }

      const { data, error } = await supabase
        .from("academic_years")
        .insert({
          school_id: schoolId,
          name,
          start_date: newAcademicYearStartDate,
          end_date: newAcademicYearEndDate,
          is_current: newAcademicYearCurrent,
        })
        .select(
          "id, name, start_date, end_date, is_current",
        )
        .single();

      if (error) {
        throw error;
      }

      const created = data as AcademicYear;

      setAcademicYears((current) =>
        [...current.filter((year) => !(
          newAcademicYearCurrent && year.is_current
        )), created].sort((a, b) =>
          b.start_date.localeCompare(a.start_date),
        ),
      );

      setAcademicYearId(created.id);

      setNewAcademicYearName("");
      setNewAcademicYearStartDate("");
      setNewAcademicYearEndDate("");
      setNewAcademicYearCurrent(true);
      setShowAcademicYearForm(false);

      setSuccessMessage(
        `Academic year "${created.name}" created successfully.`,
      );
    } catch (error) {
      console.error(
        "ACADEMIC YEAR CREATE ERROR:",
        error,
      );

      setErrorMessage(
        supabaseErrorMessage(
          error,
          "Unable to create academic year.",
        ),
      );
    } finally {
      setCreatingAcademicYear(false);
    }
  }

  async function handleCreateCategory() {
    setErrorMessage("");
    setSuccessMessage("");

    const name = newCategoryName.trim();

    if (!schoolId) {
      setErrorMessage("School information is missing.");
      return;
    }

    if (!name) {
      setErrorMessage("Please enter a fee category name.");
      return;
    }

    try {
      setCreatingCategory(true);

      const { data, error } = await supabase
        .from("fee_categories")
        .insert({
          school_id: schoolId,
          name,
          description:
            newCategoryDescription.trim() || null,
          default_frequency: newCategoryFrequency,
          is_active: true,
        })
        .select(
          "id, name, description, default_frequency, is_active",
        )
        .single();

      if (error) {
        throw error;
      }

      setCategories((current) =>
        [...current, data as FeeCategory].sort((a, b) =>
          a.name.localeCompare(b.name),
        ),
      );

      // Automatically select the new category in the first
      // available fee item.
      setItems((current) =>
        current.map((item, index) =>
          index === 0 && !item.fee_category_id
            ? {
                ...item,
                fee_category_id: data.id,
                frequency:
                  data.default_frequency,
              }
            : item,
        ),
      );

      setNewCategoryName("");
      setNewCategoryDescription("");
      setNewCategoryFrequency("annual");
      setShowCategoryForm(false);
      setSuccessMessage(
        `Fee category "${data.name}" created successfully.`,
      );
    } catch (error) {
      console.error("FEE CATEGORY CREATE ERROR:", error);

      setErrorMessage(
        supabaseErrorMessage(
          error,
          "Unable to create fee category.",
        ),
      );
    } finally {
      setCreatingCategory(false);
    }
  }

  async function handleSave(
    event: React.FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    setErrorMessage("");
    setSuccessMessage("");

    if (!schoolId) {
      setErrorMessage("School information is missing.");
      return;
    }

    if (!academicYearId) {
      setErrorMessage("Please select an academic year.");
      return;
    }

    if (!structureName.trim()) {
      setErrorMessage("Please enter a fee structure name.");
      return;
    }

    if (!academicYears.some((year) => year.id === academicYearId)) {
      setErrorMessage(
        "The selected academic year is not available for this school. Please select it again.",
      );
      return;
    }

    if (classId && !classes.some((item) => item.id === classId)) {
      setErrorMessage(
        "The selected class is not available for this school.",
      );
      return;
    }

    const validItems = items.filter(
      (item) =>
        item.fee_category_id &&
        Number.isFinite(Number(item.amount)) &&
        Number(item.amount) > 0,
    );

    if (!validItems.length) {
      setErrorMessage(
        "Add at least one fee item with a category and amount greater than zero.",
      );
      return;
    }

    if (validItems.length !== items.length) {
      setErrorMessage(
        "Every fee item needs a category and an amount greater than zero.",
      );
      return;
    }

    const duplicateCategories = new Set<string>();

    for (const item of validItems) {
      if (duplicateCategories.has(item.fee_category_id)) {
        setErrorMessage(
          "The same fee category cannot be added twice to one structure.",
        );
        return;
      }

      duplicateCategories.add(item.fee_category_id);
    }

    const invalidCategory = validItems.find(
      (item) =>
        !categories.some(
          (category) => category.id === item.fee_category_id,
        ),
    );

    if (invalidCategory) {
      setErrorMessage(
        "One selected fee category is no longer available. Please select the category again.",
      );
      return;
    }

    try {
      setSaving(true);

      let structureId = editingId;

      if (editingId) {
        const { error: updateError } = await supabase
          .from("fee_structures")
          .update({
            academic_year_id: academicYearId,
            class_id: classId || null,
            name: structureName.trim(),
            active,
          })
          .eq("id", editingId)
          .eq("school_id", schoolId);

        if (updateError) {
          throw new Error(
            `Unable to update fee structure: ${supabaseErrorMessage(
              updateError,
              "Database update failed.",
            )}`,
          );
        }

        const { error: deleteItemsError } = await supabase
          .from("fee_structure_items")
          .delete()
          .eq("fee_structure_id", editingId)
          .eq("school_id", schoolId);

        if (deleteItemsError) {
          throw new Error(
            `Unable to replace fee items: ${supabaseErrorMessage(
              deleteItemsError,
              "Database delete failed.",
            )}`,
          );
        }
      } else {
        const { data: structure, error: insertError } =
          await supabase
            .from("fee_structures")
            .insert({
              school_id: schoolId,
              academic_year_id: academicYearId,
              class_id: classId || null,
              name: structureName.trim(),
              active,
            })
            .select("id")
            .single();

        if (insertError) {
          throw new Error(
            `Unable to create fee structure: ${supabaseErrorMessage(
              insertError,
              "Database insert failed.",
            )}`,
          );
        }

        if (!structure?.id) {
          throw new Error(
            "Fee structure was not returned by the database after insert.",
          );
        }

        structureId = structure.id;
      }

      if (!structureId) {
        throw new Error(
          "Fee structure could not be created.",
        );
      }

      const itemRows = validItems.map((item) => ({
        school_id: schoolId,
        fee_structure_id: structureId,
        fee_category_id: item.fee_category_id,
        amount: Number(item.amount),
        frequency: item.frequency,
        mandatory: Boolean(item.mandatory),
      }));

      const { error: itemInsertError } = await supabase
        .from("fee_structure_items")
        .insert(itemRows);

      if (itemInsertError) {
        if (!editingId) {
          await supabase
            .from("fee_structures")
            .delete()
            .eq("id", structureId)
            .eq("school_id", schoolId);
        }

        throw new Error(
          `Unable to save fee items: ${supabaseErrorMessage(
            itemInsertError,
            "Fee item database insert failed.",
          )}`,
        );
      }

      setSuccessMessage(
        editingId
          ? "Fee structure updated successfully."
          : "Fee structure created successfully.",
      );

      setShowForm(false);
      resetForm();

      await loadPage();
    } catch (error) {
      console.error(
        "FEE STRUCTURE SAVE ERROR:",
        error,
      );

      setErrorMessage(
        supabaseErrorMessage(
          error,
          "Unable to save fee structure.",
        ),
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(
    structure: FeeStructure,
  ) {
    const confirmed = window.confirm(
      `Delete "${structure.name}"? This will also delete its fee structure items.`,
    );

    if (!confirmed) {
      return;
    }

    setErrorMessage("");
    setSuccessMessage("");

    try {
      const { error: itemError } = await supabase
        .from("fee_structure_items")
        .delete()
        .eq("fee_structure_id", structure.id)
        .eq("school_id", schoolId);

      if (itemError) {
        throw itemError;
      }

      const { error: structureError } = await supabase
        .from("fee_structures")
        .delete()
        .eq("id", structure.id)
        .eq("school_id", schoolId);

      if (structureError) {
        throw structureError;
      }

      setSuccessMessage(
        "Fee structure deleted successfully.",
      );

      await loadPage();
    } catch (error) {
      console.error("FEE STRUCTURE DELETE ERROR:", error);

      setErrorMessage(
        supabaseErrorMessage(
          error,
          "Unable to delete fee structure.",
        ),
      );
    }
  }

  function totalAmount(structure: FeeStructure) {
    return (structure.items || []).reduce(
      (total, item) => total + Number(item.amount || 0),
      0,
    );
  }

  function formatMoney(value: number) {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 2,
    }).format(value || 0);
  }

  function formatFrequency(
    frequency: FeeItem["frequency"],
  ) {
    return (
      FREQUENCIES.find(
        (item) => item.value === frequency,
      )?.label || frequency
    );
  }

  if (loading) {
    return (
      <main className="min-h-[calc(100vh-4rem)] bg-slate-50 p-6">
        <div className="mx-auto flex max-w-7xl items-center justify-center py-24">
          <div className="rounded-2xl border border-slate-200 bg-white px-8 py-7 text-center shadow-sm">
            <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600" />

            <p className="text-sm font-medium text-slate-600">
              Loading fee structures...
            </p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-50 p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl">
        {/* HEADER */}
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-sm text-slate-500">
              <Link
                href="/dashboard"
                className="hover:text-blue-600"
              >
                Dashboard
              </Link>

              <span>/</span>

              <span className="font-medium text-slate-700">
                Fee Structure
              </span>
            </div>

            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Fee Structure
            </h1>

            <p className="mt-1 text-sm text-slate-500">
              Create and manage class-wise fee structures.
            </p>
          </div>

          <button
            type="button"
            onClick={openCreateForm}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
          >
            <span className="text-lg leading-none">
              +
            </span>
            Add Fee Structure
          </button>
        </div>

        {/* MESSAGES */}
        {errorMessage && (
          <div className="mb-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
            {errorMessage}
          </div>
        )}

        {successMessage && (
          <div className="mb-5 rounded-2xl border border-green-200 bg-green-50 px-4 py-3 text-sm font-medium text-green-700">
            {successMessage}
          </div>
        )}

        {/* FORM */}
        {showForm && (
          <section className="mb-8 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  {editingId
                    ? "Edit Fee Structure"
                    : "Add Fee Structure"}
                </h2>

                <p className="mt-1 text-sm text-slate-500">
                  Define the fees applicable to a class for an academic year.
                </p>
              </div>

              <button
                type="button"
                onClick={closeForm}
                className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>

            <form onSubmit={handleSave}>
              <div className="grid gap-5 md:grid-cols-3">
                <div>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <label className="block text-sm font-semibold text-slate-700">
                      Academic Year
                    </label>

                    <button
                      type="button"
                      onClick={() => setShowAcademicYearForm(true)}
                      className="text-xs font-semibold text-blue-600 hover:text-blue-700"
                    >
                      + New Year
                    </button>
                  </div>

                  <select
                    value={academicYearId}
                    onChange={(event) =>
                      setAcademicYearId(event.target.value)
                    }
                    className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                    required
                  >
                    <option value="">
                      {academicYears.length
                        ? "Select academic year"
                        : "No academic years yet"}
                    </option>

                    {academicYears.map((year) => (
                      <option
                        key={year.id}
                        value={year.id}
                      >
                        {year.name}
                        {year.is_current
                          ? " (Current)"
                          : ""}
                      </option>
                    ))}
                  </select>

                  {!academicYears.length && (
                    <p className="mt-1.5 text-xs text-amber-600">
                      Create an academic year first.
                    </p>
                  )}
                </div>

                <div>
                  <label className="mb-2 block text-sm font-semibold text-slate-700">
                    Class
                  </label>

                  <select
                    value={classId}
                    onChange={(event) =>
                      setClassId(event.target.value)
                    }
                    className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  >
                    <option value="">
                      All Classes
                    </option>

                    {classes.map((schoolClass) => (
                      <option
                        key={schoolClass.id}
                        value={schoolClass.id}
                      >
                        {schoolClass.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-semibold text-slate-700">
                    Structure Name
                  </label>

                  <input
                    type="text"
                    value={structureName}
                    onChange={(event) =>
                      setStructureName(event.target.value)
                    }
                    placeholder={
                      classId
                        ? `${classes.find((item) => item.id === classId)?.name || "Class"} Fee Structure`
                        : "Example: School Fee Structure"
                    }
                    className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                    required
                  />

                  <p className="mt-1.5 text-xs text-slate-400">
                    Example: Class 1 Fee Structure. You can name it anything
                    that clearly identifies the fee plan.
                  </p>
                </div>
              </div>

              <div className="mt-5 flex items-center gap-3 rounded-xl bg-slate-50 px-4 py-3">
                <input
                  id="structure-active"
                  type="checkbox"
                  checked={active}
                  onChange={(event) =>
                    setActive(event.target.checked)
                  }
                  className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />

                <label
                  htmlFor="structure-active"
                  className="cursor-pointer text-sm font-semibold text-slate-700"
                >
                  Active fee structure
                </label>
              </div>

              {/* ACADEMIC YEAR FORM */}
              {showAcademicYearForm && (
                <div className="mb-6 rounded-2xl border border-blue-100 bg-blue-50 p-4">
                  <div className="mb-4 flex items-start justify-between gap-4">
                    <div>
                      <h3 className="font-bold text-slate-900">
                        Create Academic Year
                      </h3>
                      <p className="mt-1 text-xs text-slate-500">
                        Example: 2026-2027 with its start and end dates.
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => setShowAcademicYearForm(false)}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                    >
                      Close
                    </button>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                    <div>
                      <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-500">
                        Year Name
                      </label>

                      <input
                        type="text"
                        value={newAcademicYearName}
                        onChange={(event) =>
                          setNewAcademicYearName(event.target.value)
                        }
                        placeholder="2026-2027"
                        className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                      />
                    </div>

                    <div>
                      <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-500">
                        Start Date
                      </label>

                      <input
                        type="date"
                        value={newAcademicYearStartDate}
                        onChange={(event) =>
                          setNewAcademicYearStartDate(event.target.value)
                        }
                        className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                      />
                    </div>

                    <div>
                      <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-500">
                        End Date
                      </label>

                      <input
                        type="date"
                        value={newAcademicYearEndDate}
                        onChange={(event) =>
                          setNewAcademicYearEndDate(event.target.value)
                        }
                        className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                      />
                    </div>

                    <div className="flex flex-col justify-end gap-3">
                      <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-700">
                        <input
                          type="checkbox"
                          checked={newAcademicYearCurrent}
                          onChange={(event) =>
                            setNewAcademicYearCurrent(
                              event.target.checked,
                            )
                          }
                          className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                        />

                        Current academic year
                      </label>

                      <button
                        type="button"
                        onClick={handleCreateAcademicYear}
                        disabled={creatingAcademicYear}
                        className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                      >
                        {creatingAcademicYear
                          ? "Creating..."
                          : "Create Academic Year"}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* CATEGORY FORM */}
              {showCategoryForm && (
                <div className="mb-6 rounded-2xl border border-blue-100 bg-blue-50 p-4">
                  <div className="mb-4 flex items-start justify-between gap-4">
                    <div>
                      <h3 className="font-bold text-slate-900">
                        Create Fee Category
                      </h3>
                      <p className="mt-1 text-xs text-slate-500">
                        Examples: Tuition Fee, Transport Fee, Exam Fee,
                        Admission Fee.
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => setShowCategoryForm(false)}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                    >
                      Close
                    </button>
                  </div>

                  <div className="grid gap-4 md:grid-cols-[1.2fr_1.5fr_1fr_auto]">
                    <div>
                      <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-500">
                        Category Name
                      </label>
                      <input
                        type="text"
                        value={newCategoryName}
                        onChange={(event) =>
                          setNewCategoryName(event.target.value)
                        }
                        placeholder="Tuition Fee"
                        className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                        required
                      />
                    </div>

                    <div>
                      <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-500">
                        Description
                      </label>
                      <input
                        type="text"
                        value={newCategoryDescription}
                        onChange={(event) =>
                          setNewCategoryDescription(event.target.value)
                        }
                        placeholder="Monthly tuition charge"
                        className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                      />
                    </div>

                    <div>
                      <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-500">
                        Default Frequency
                      </label>
                      <select
                        value={newCategoryFrequency}
                        onChange={(event) =>
                          setNewCategoryFrequency(
                            event.target.value as FeeCategory["default_frequency"],
                          )
                        }
                        className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                      >
                        {FREQUENCIES.map((frequency) => (
                          <option
                            key={frequency.value}
                            value={frequency.value}
                          >
                            {frequency.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <button
                      type="button"
                      onClick={handleCreateCategory}
                      disabled={creatingCategory}
                      className="self-end rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                    >
                      {creatingCategory
                        ? "Creating..."
                        : "Create Category"}
                    </button>
                  </div>
                </div>
              )}

              {/* ITEMS */}
              <div className="mt-8">
                <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <h3 className="font-bold text-slate-900">
                      Fee Items
                    </h3>

                    <p className="mt-1 text-sm text-slate-500">
                      Add each fee category and its amount.
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setShowCategoryForm(true)}
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      + New Fee Category
                    </button>

                    <button
                      type="button"
                      onClick={addItem}
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-semibold text-blue-700 hover:bg-blue-100"
                    >
                      + Add Fee Item
                    </button>
                  </div>
                </div>

                <div className="space-y-4">
                  {items.map((item, index) => (
                    <div
                      key={index}
                      className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                    >
                      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr_1fr_auto_auto] lg:items-end">
                        <div>
                          <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-500">
                            Fee Category
                          </label>

                          <select
                            value={item.fee_category_id}
                            onChange={(event) =>
                              handleCategoryChange(
                                index,
                                event.target.value,
                              )
                            }
                            className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                            required
                          >
                            <option value="">
                              {categories.length
                                ? "Select category"
                                : "No categories yet"}
                            </option>

                            {categories.map(
                              (category) => (
                                <option
                                  key={category.id}
                                  value={category.id}
                                >
                                  {category.name}
                                </option>
                              ),
                            )}
                          </select>

                          {!categories.length && (
                            <button
                              type="button"
                              onClick={() =>
                                setShowCategoryForm(true)
                              }
                              className="mt-1.5 text-xs font-semibold text-blue-600 hover:text-blue-700"
                            >
                              Create your first fee category
                            </button>
                          )}
                        </div>

                        <div>
                          <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-500">
                            Amount
                          </label>

                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.amount}
                            onChange={(event) =>
                              updateItem(
                                index,
                                "amount",
                                event.target.value,
                              )
                            }
                            placeholder="0.00"
                            className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                            required
                          />
                        </div>

                        <div>
                          <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-500">
                            Frequency
                          </label>

                          <select
                            value={item.frequency}
                            onChange={(event) =>
                              updateItem(
                                index,
                                "frequency",
                                event.target.value,
                              )
                            }
                            className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                          >
                            {FREQUENCIES.map(
                              (frequency) => (
                                <option
                                  key={frequency.value}
                                  value={frequency.value}
                                >
                                  {frequency.label}
                                </option>
                              ),
                            )}
                          </select>
                        </div>

                        <label className="flex h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700">
                          <input
                            type="checkbox"
                            checked={item.mandatory}
                            onChange={(event) =>
                              updateItem(
                                index,
                                "mandatory",
                                event.target.checked,
                              )
                            }
                            className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                          />

                          Mandatory
                        </label>

                        <button
                          type="button"
                          onClick={() =>
                            removeItem(index)
                          }
                          className="h-11 rounded-xl border border-red-200 bg-white px-4 text-sm font-semibold text-red-600 hover:bg-red-50"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {(academicYears.length === 0 ||
                categories.length === 0) && (
                <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  {academicYears.length === 0
                    ? "Create an academic year before saving this fee structure."
                    : "Create at least one fee category before saving this fee structure."}
                </div>
              )}

              <div className="mt-7 flex flex-col gap-3 border-t border-slate-200 pt-5 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-slate-500">
                  Items:{" "}
                  <span className="font-semibold text-slate-800">
                    {items.length}
                  </span>
                </p>

                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={closeForm}
                    disabled={saving}
                    className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Cancel
                  </button>

                  <button
                    type="submit"
                    disabled={saving}
                    className="rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {saving
                      ? "Saving..."
                      : editingId
                        ? "Update Fee Structure"
                        : "Save Fee Structure"}
                  </button>
                </div>
              </div>
            </form>
          </section>
        )}

        {/* STRUCTURES */}
        <section>
          <div className="mb-4 flex items-end justify-between">
            <div>
              <h2 className="text-xl font-bold text-slate-900">
                Existing Fee Structures
              </h2>

              <p className="mt-1 text-sm text-slate-500">
                {structures.length} structure
                {structures.length === 1 ? "" : "s"} configured.
              </p>
            </div>
          </div>

          {/* ACADEMIC YEARS */}
          <div className="mb-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="font-bold text-slate-900">
                  Academic Years
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  The academic year is required before creating a fee structure.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setShowAcademicYearForm(true)}
                className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-semibold text-blue-700 hover:bg-blue-100"
              >
                + Add Academic Year
              </button>
            </div>

            {academicYears.length === 0 ? (
              <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5 text-center">
                <p className="text-sm font-semibold text-slate-700">
                  No academic years created yet.
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Create 2026-2027 or your school's current academic year.
                </p>
              </div>
            ) : (
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {academicYears.map((year) => (
                  <div
                    key={year.id}
                    className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-bold text-slate-800">
                        {year.name}
                      </p>

                      {year.is_current && (
                        <span className="rounded-full bg-green-50 px-2 py-1 text-[11px] font-bold text-green-700">
                          Current
                        </span>
                      )}
                    </div>

                    <p className="mt-1 text-xs text-slate-500">
                      {year.start_date} â†’ {year.end_date}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* FEE CATEGORIES */}
          <div className="mb-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="font-bold text-slate-900">
                  Fee Categories
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  Categories are reused inside fee structures.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setShowCategoryForm(true)}
                className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-semibold text-blue-700 hover:bg-blue-100"
              >
                + Add Category
              </button>
            </div>

            {categories.length === 0 ? (
              <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5 text-center">
                <p className="text-sm font-semibold text-slate-700">
                  No fee categories created yet.
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Create categories such as Tuition Fee, Transport Fee,
                  Exam Fee, or Admission Fee.
                </p>
              </div>
            ) : (
              <div className="mt-4 flex flex-wrap gap-2">
                {categories.map((category) => (
                  <span
                    key={category.id}
                    className="rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700"
                  >
                    {category.name}
                  </span>
                ))}
              </div>
            )}
          </div>

          {structures.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-2xl text-blue-600">
                â‚¹
              </div>

              <h3 className="mt-4 font-bold text-slate-900">
                No fee structures yet
              </h3>

              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">
                Create your first fee structure to define the fees
                applicable to a class.
              </p>

              <button
                type="button"
                onClick={openCreateForm}
                className="mt-5 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
              >
                Add Fee Structure
              </button>
            </div>
          ) : (
            <div className="grid gap-5 lg:grid-cols-2">
              {structures.map((structure) => {
                const className =
                  structure.school_class?.name ||
                  "All Classes";

                const yearName =
                  structure.academic_year?.name ||
                  "Academic Year";

                const total = totalAmount(structure);

                return (
                  <article
                    key={structure.id}
                    className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm"
                  >
                    <div className="border-b border-slate-100 p-5 sm:p-6">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                                structure.active
                                  ? "bg-green-50 text-green-700"
                                  : "bg-slate-100 text-slate-500"
                              }`}
                            >
                              {structure.active
                                ? "Active"
                                : "Inactive"}
                            </span>

                            <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700">
                              {yearName}
                            </span>
                          </div>

                          <h3 className="mt-3 truncate text-lg font-bold text-slate-900">
                            {structure.name}
                          </h3>

                          <p className="mt-1 text-sm text-slate-500">
                            {className}
                          </p>
                        </div>

                        <div className="shrink-0 text-right">
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                            Total
                          </p>

                          <p className="mt-1 text-lg font-bold text-slate-900">
                            {formatMoney(total)}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="p-5 sm:p-6">
                      {(structure.items || []).length ===
                      0 ? (
                        <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">
                          No fee items configured.
                        </p>
                      ) : (
                        <div className="space-y-3">
                          {(structure.items || []).map(
                            (item) => (
                              <div
                                key={item.id}
                                className="flex items-center justify-between gap-4 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3"
                              >
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-semibold text-slate-800">
                                    {item.category?.name ||
                                      "Fee Category"}
                                  </p>

                                  <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-500">
                                    <span>
                                      {formatFrequency(
                                        item.frequency,
                                      )}
                                    </span>

                                    <span>
                                      â€¢
                                    </span>

                                    <span>
                                      {item.mandatory
                                        ? "Mandatory"
                                        : "Optional"}
                                    </span>
                                  </div>
                                </div>

                                <p className="shrink-0 text-sm font-bold text-slate-900">
                                  {formatMoney(
                                    Number(
                                      item.amount || 0,
                                    ),
                                  )}
                                </p>
                              </div>
                            ),
                          )}
                        </div>
                      )}

                      <div className="mt-5 flex gap-3">
                        <button
                          type="button"
                          onClick={() =>
                            startEdit(structure)
                          }
                          className="flex-1 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          Edit
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            handleDelete(structure)
                          }
                          className="flex-1 rounded-xl border border-red-200 bg-white px-4 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}