"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  Eye,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Account = {
  id: string;
  school_id: string;
  code: string | null;
  name: string;
  account_type: string;
  opening_balance: number;
  is_system: boolean;
  is_active: boolean;
};

type JournalLine = {
  id?: string;
  account_id: string;
  account_name: string;
  account_code: string | null;
  debit: number;
  credit: number;
  description: string;
};

type JournalEntry = {
  id: string;
  transaction_number: string | null;
  transaction_date: string;
  description: string | null;
  reference_type: string | null;
  reference_id: string | null;
  created_at: string;
  entries: JournalLine[];
};

type FormLine = {
  account_id: string;
  debit: string;
  credit: string;
  description: string;
};

function money(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function today() {
  return new Date().toISOString().split("T")[0];
}

export default function JournalPage() {
  const supabase = createClient();

  const [schoolId, setSchoolId] = useState<string | null>(null);

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [journals, setJournals] = useState<JournalEntry[]>([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null);

  const [journalDate, setJournalDate] = useState(today());
  const [description, setDescription] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [notes, setNotes] = useState("");

  const [lines, setLines] = useState<FormLine[]>([
    {
      account_id: "",
      debit: "",
      credit: "",
      description: "",
    },
    {
      account_id: "",
      debit: "",
      credit: "",
      description: "",
    },
  ]);

  const [viewJournal, setViewJournal] =
    useState<JournalEntry | null>(null);

  const [deleteJournal, setDeleteJournal] =
    useState<JournalEntry | null>(null);

  /*
   * =========================================================
   * CURRENT SCHOOL
   * =========================================================
   */

  async function getCurrentSchoolId() {
    const {
      data: userData,
      error: userError,
    } = await supabase.auth.getUser();

    if (userError) {
      throw new Error(userError.message);
    }

    if (!userData.user) {
      throw new Error(
        "No authenticated user found. Please log in again."
      );
    }

    const {
      data: rpcSchoolId,
      error: rpcError,
    } = await supabase.rpc("get_my_school_id");

    if (!rpcError && rpcSchoolId) {
      return rpcSchoolId as string;
    }

    const {
      data: schoolUser,
      error: schoolUserError,
    } = await supabase
      .from("school_users")
      .select("school_id, is_active, created_at")
      .eq("user_id", userData.user.id)
      .eq("is_active", true)
      .order("created_at", {
        ascending: true,
      })
      .limit(1)
      .maybeSingle();

    if (schoolUserError) {
      throw new Error(schoolUserError.message);
    }

    if (!schoolUser?.school_id) {
      throw new Error(
        "Your user is not linked to an active school."
      );
    }

    return schoolUser.school_id as string;
  }

  /*
   * =========================================================
   * LOAD ACCOUNTS
   * =========================================================
   */

  async function loadAccounts(currentSchoolId: string) {
    const {
      data,
      error: accountError,
    } = await supabase
      .from("accounts")
      .select(
        `
          id,
          school_id,
          code,
          name,
          account_type,
          opening_balance,
          is_system,
          is_active
        `
      )
      .eq("school_id", currentSchoolId)
      .eq("is_active", true)
      .order("account_type")
      .order("name");

    if (accountError) {
      throw new Error(accountError.message);
    }

    setAccounts((data || []) as Account[]);
  }

  /*
   * =========================================================
   * LOAD JOURNALS
   * =========================================================
   */

  async function loadJournals(currentSchoolId: string) {
    const {
      data: transactions,
      error: transactionError,
    } = await supabase
      .from("transactions")
      .select(
        `
          id,
          transaction_number,
          transaction_date,
          description,
          reference_type,
          reference_id,
          created_at
        `
      )
      .eq("school_id", currentSchoolId)
      .eq("transaction_type", "journal")
      .eq("reference_type", "journal")
      .order("transaction_date", {
        ascending: false,
      })
      .order("created_at", {
        ascending: false,
      })
      .limit(100);

    if (transactionError) {
      throw new Error(transactionError.message);
    }

    if (!transactions || transactions.length === 0) {
      setJournals([]);
      return;
    }

    const transactionIds = transactions.map(
      (transaction) => transaction.id
    );

    const {
      data: entries,
      error: entriesError,
    } = await supabase
      .from("transaction_entries")
      .select(
        `
          id,
          transaction_id,
          account_id,
          debit,
          credit,
          description
        `
      )
      .eq("school_id", currentSchoolId)
      .in("transaction_id", transactionIds);

    if (entriesError) {
      throw new Error(entriesError.message);
    }

    const accountIds = Array.from(
      new Set(
        (entries || []).map(
          (entry) => entry.account_id
        )
      )
    );

    const accountMap = new Map<string, Account>();

    if (accountIds.length > 0) {
      const {
        data: entryAccounts,
        error: entryAccountError,
      } = await supabase
        .from("accounts")
        .select(
          `
            id,
            school_id,
            code,
            name,
            account_type,
            opening_balance,
            is_system,
            is_active
          `
        )
        .eq("school_id", currentSchoolId)
        .in("id", accountIds);

      if (entryAccountError) {
        throw new Error(entryAccountError.message);
      }

      for (const account of (entryAccounts || []) as Account[]) {
        accountMap.set(account.id, account);
      }
    }

    const result: JournalEntry[] = transactions.map(
      (transaction) => ({
        id: transaction.id,
        transaction_number:
          transaction.transaction_number,
        transaction_date:
          transaction.transaction_date,
        description:
          transaction.description,
        reference_type:
          transaction.reference_type,
        reference_id:
          transaction.reference_id,
        created_at:
          transaction.created_at,
        entries: (entries || [])
          .filter(
            (entry) =>
              entry.transaction_id === transaction.id
          )
          .map((entry) => {
            const account =
              accountMap.get(entry.account_id);

            return {
              id: entry.id,
              account_id: entry.account_id,
              account_name:
                account?.name || "Unknown Account",
              account_code:
                account?.code || null,
              debit: Number(entry.debit || 0),
              credit: Number(entry.credit || 0),
              description:
                entry.description || "",
            };
          }),
      })
    );

    setJournals(result);
  }

  /*
   * =========================================================
   * LOAD PAGE
   * =========================================================
   */

  async function loadPage() {
    try {
      setLoading(true);
      setError("");

      const currentSchoolId =
        await getCurrentSchoolId();

      setSchoolId(currentSchoolId);

      await loadAccounts(currentSchoolId);
      await loadJournals(currentSchoolId);
    } catch (err: any) {
      console.error("JOURNAL LOAD ERROR:", err);

      setError(
        err?.message ||
          "Unable to load Journal page."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPage();
  }, []);

  /*
   * =========================================================
   * LINE HELPERS
   * =========================================================
   */

  function addLine() {
    setLines((current) => [
      ...current,
      {
        account_id: "",
        debit: "",
        credit: "",
        description: "",
      },
    ]);
  }

  function removeLine(index: number) {
    if (lines.length <= 2) {
      setError(
        "A journal must contain at least two lines."
      );
      return;
    }

    setLines((current) =>
      current.filter(
        (_, lineIndex) => lineIndex !== index
      )
    );
  }

  function updateLine(
    index: number,
    field: keyof FormLine,
    value: string
  ) {
    setLines((current) =>
      current.map((line, lineIndex) => {
        if (lineIndex !== index) {
          return line;
        }

        return {
          ...line,
          [field]: value,
        };
      })
    );
  }

  /*
   * =========================================================
   * TOTALS
   * =========================================================
   */

  const totalDebit = useMemo(() => {
    return lines.reduce(
      (sum, line) =>
        sum + Number(line.debit || 0),
      0
    );
  }, [lines]);

  const totalCredit = useMemo(() => {
    return lines.reduce(
      (sum, line) =>
        sum + Number(line.credit || 0),
      0
    );
  }, [lines]);

  const difference =
    totalDebit - totalCredit;

  const balanced =
    Math.abs(difference) < 0.005 &&
    totalDebit > 0 &&
    totalCredit > 0;

  /*
   * =========================================================
   * DESCRIPTION
   * =========================================================
   */

  function buildDescription() {
    const parts = [description.trim()];

    if (referenceNumber.trim()) {
      parts.push(
        `Reference: ${referenceNumber.trim()}`
      );
    }

    if (notes.trim()) {
      parts.push(
        `Notes: ${notes.trim()}`
      );
    }

    return parts.filter(Boolean).join(" | ");
  }

  /*
   * =========================================================
   * RESET
   * =========================================================
   */

  function resetForm() {
    setEditingId(null);
    setJournalDate(today());
    setDescription("");
    setReferenceNumber("");
    setNotes("");

    setLines([
      {
        account_id: "",
        debit: "",
        credit: "",
        description: "",
      },
      {
        account_id: "",
        debit: "",
        credit: "",
        description: "",
      },
    ]);

    setError("");
    setSuccess("");
  }

  /*
   * =========================================================
   * CREATE / EDIT JOURNAL
   * =========================================================
   */

  async function submitJournal(
    event: FormEvent
  ) {
    event.preventDefault();

    setError("");
    setSuccess("");

    if (!schoolId) {
      setError(
        "Current school could not be determined."
      );
      return;
    }

    if (!journalDate) {
      setError(
        "Select a journal date."
      );
      return;
    }

    if (!description.trim()) {
      setError(
        "Enter journal particulars."
      );
      return;
    }

    const usableLines = lines.filter(
      (line) =>
        line.account_id &&
        (Number(line.debit || 0) > 0 ||
          Number(line.credit || 0) > 0)
    );

    if (usableLines.length < 2) {
      setError(
        "A journal requires at least two accounting lines."
      );
      return;
    }

    for (const line of usableLines) {
      const debit = Number(
        line.debit || 0
      );

      const credit = Number(
        line.credit || 0
      );

      if (debit > 0 && credit > 0) {
        setError(
          "A single journal line cannot contain both Debit and Credit."
        );
        return;
      }

      if (debit <= 0 && credit <= 0) {
        setError(
          "Every journal line must have a Debit or Credit amount."
        );
        return;
      }
    }

    const debitTotal = usableLines.reduce(
      (sum, line) =>
        sum + Number(line.debit || 0),
      0
    );

    const creditTotal = usableLines.reduce(
      (sum, line) =>
        sum + Number(line.credit || 0),
      0
    );

    if (
      Math.abs(
        debitTotal - creditTotal
      ) > 0.005
    ) {
      setError(
        `Journal is not balanced. Debit ${money(
          debitTotal
        )} must equal Credit ${money(
          creditTotal
        )}.`
      );
      return;
    }

    setSaving(true);

    try {
      /*
       * Verify selected accounts belong to school.
       */

      const selectedAccountIds =
        Array.from(
          new Set(
            usableLines.map(
              (line) => line.account_id
            )
          )
        );

      const {
        data: selectedAccounts,
        error:
          selectedAccountError,
      } = await supabase
        .from("accounts")
        .select(
          `
            id,
            school_id,
            code,
            name,
            account_type,
            opening_balance,
            is_system,
            is_active
          `
        )
        .eq("school_id", schoolId)
        .in("id", selectedAccountIds);

      if (selectedAccountError) {
        throw new Error(
          selectedAccountError.message
        );
      }

      if (
        !selectedAccounts ||
        selectedAccounts.length !==
          selectedAccountIds.length
      ) {
        throw new Error(
          "One or more selected accounts do not belong to the current school."
        );
      }

      const transactionDescription =
        buildDescription();

      /*
       * =====================================================
       * EDIT
       * =====================================================
       */

      if (editingId) {
        const {
          data: existingTransaction,
          error:
            existingTransactionError,
        } = await supabase
          .from("transactions")
          .select(
            "id, school_id, transaction_type, reference_type"
          )
          .eq("id", editingId)
          .eq("school_id", schoolId)
          .eq("transaction_type", "journal")
          .eq("reference_type", "journal")
          .maybeSingle();

        if (existingTransactionError) {
          throw new Error(
            existingTransactionError.message
          );
        }

        if (!existingTransaction) {
          throw new Error(
            "Journal entry could not be found."
          );
        }

        /*
         * Update transaction header.
         */

        const {
          error: updateError,
        } = await supabase
          .from("transactions")
          .update({
            transaction_date:
              journalDate,
            description:
              transactionDescription,
          })
          .eq("id", editingId)
          .eq("school_id", schoolId);

        if (updateError) {
          throw new Error(
            updateError.message
          );
        }

        /*
         * Delete existing lines.
         */

        const {
          error:
            deleteLinesError,
        } = await supabase
          .from("transaction_entries")
          .delete()
          .eq("transaction_id", editingId)
          .eq("school_id", schoolId);

        if (deleteLinesError) {
          throw new Error(
            `Existing journal lines could not be replaced: ${deleteLinesError.message}`
          );
        }

        /*
         * Insert updated lines.
         */

        const entriesToInsert =
          usableLines.map(
            (line) => ({
              school_id: schoolId,
              transaction_id:
                editingId,
              account_id:
                line.account_id,
              debit:
                Number(line.debit || 0),
              credit:
                Number(line.credit || 0),
              description:
                line.description.trim() ||
                null,
            })
          );

        const {
          error:
            insertLinesError,
        } = await supabase
          .from("transaction_entries")
          .insert(
            entriesToInsert
          );

        if (insertLinesError) {
          throw new Error(
            `Updated journal lines could not be created: ${insertLinesError.message}`
          );
        }

        setSuccess(
          "Journal updated successfully."
        );

        resetForm();

        await loadJournals(
          schoolId
        );

        return;
      }

      /*
       * =====================================================
       * CREATE
       * =====================================================
       */

      const {
        data: transaction,
        error:
          transactionError,
      } = await supabase
        .from("transactions")
        .insert({
          school_id: schoolId,
          transaction_date:
            journalDate,
          transaction_type:
            "journal",
          description:
            transactionDescription,
          reference_type:
            "journal",
          reference_id:
            null,
        })
        .select(
          `
            id,
            transaction_number,
            transaction_date,
            transaction_type,
            description,
            reference_type,
            reference_id,
            created_at
          `
        )
        .single();

      if (transactionError) {
        throw new Error(
          transactionError.message
        );
      }

      if (!transaction) {
        throw new Error(
          "Journal transaction was not created."
        );
      }

      const entriesToInsert =
        usableLines.map(
          (line) => ({
            school_id: schoolId,
            transaction_id:
              transaction.id,
            account_id:
              line.account_id,
            debit:
              Number(line.debit || 0),
            credit:
              Number(line.credit || 0),
            description:
              line.description.trim() ||
              null,
          })
        );

      const {
        error: insertError,
      } = await supabase
        .from("transaction_entries")
        .insert(
          entriesToInsert
        );

      if (insertError) {
        /*
         * Rollback manually if entry insertion fails.
         */

        await supabase
          .from("transaction_entries")
          .delete()
          .eq(
            "transaction_id",
            transaction.id
          )
          .eq(
            "school_id",
            schoolId
          );

        await supabase
          .from("transactions")
          .delete()
          .eq(
            "id",
            transaction.id
          )
          .eq(
            "school_id",
            schoolId
          );

        throw new Error(
          `Journal lines could not be created: ${insertError.message}`
        );
      }

      setSuccess(
        `Journal saved successfully${
          transaction.transaction_number
            ? ` — ${transaction.transaction_number}`
            : ""
        }.`
      );

      resetForm();

      await loadJournals(
        schoolId
      );
    } catch (err: any) {
      console.error(
        "JOURNAL SAVE ERROR:",
        err
      );

      setError(
        err?.message ||
          "Unable to save journal."
      );
    } finally {
      setSaving(false);
    }
  }

  /*
   * =========================================================
   * EDIT
   * =========================================================
   */

  function startEdit(
    journal: JournalEntry
  ) {
    if (journal.entries.length < 2) {
      setError(
        "This journal does not contain enough accounting lines."
      );
      return;
    }

    setEditingId(
      journal.id
    );

    setJournalDate(
      journal.transaction_date
    );

    setDescription(
      journal.description
        ?.split(" | ")[0] ||
        ""
    );

    const referencePart =
      journal.description
        ?.split(" | ")
        .find((part) =>
          part.startsWith(
            "Reference:"
          )
        );

    const notesPart =
      journal.description
        ?.split(" | ")
        .find((part) =>
          part.startsWith(
            "Notes:"
          )
        );

    setReferenceNumber(
      referencePart
        ? referencePart
            .replace(
              "Reference:",
              ""
            )
            .trim()
        : ""
    );

    setNotes(
      notesPart
        ? notesPart
            .replace(
              "Notes:",
              ""
            )
            .trim()
        : ""
    );

    setLines(
      journal.entries.map(
        (entry) => ({
          account_id:
            entry.account_id,
          debit:
            entry.debit > 0
              ? String(
                  entry.debit
                )
              : "",
          credit:
            entry.credit > 0
              ? String(
                  entry.credit
                )
              : "",
          description:
            entry.description ||
            "",
        })
      )
    );

    setError("");
    setSuccess("");

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  /*
   * =========================================================
   * DELETE
   * =========================================================
   */

  async function confirmDelete() {
    if (
      !deleteJournal ||
      !schoolId
    ) {
      return;
    }

    setDeleting(true);
    setError("");
    setSuccess("");

    try {
      const {
        data: transaction,
        error:
          transactionError,
      } = await supabase
        .from("transactions")
        .select(
          "id, transaction_number"
        )
        .eq("id", deleteJournal.id)
        .eq("school_id", schoolId)
        .eq("transaction_type", "journal")
        .eq("reference_type", "journal")
        .maybeSingle();

      if (transactionError) {
        throw new Error(
          transactionError.message
        );
      }

      if (!transaction) {
        throw new Error(
          "Journal entry could not be found or does not belong to the current school."
        );
      }

      /*
       * Delete lines first.
       */

      const {
        error:
          deleteLinesError,
      } = await supabase
        .from("transaction_entries")
        .delete()
        .eq(
          "transaction_id",
          transaction.id
        )
        .eq(
          "school_id",
          schoolId
        );

      if (deleteLinesError) {
        throw new Error(
          deleteLinesError.message
        );
      }

      /*
       * Delete header.
       */

      const {
        error:
          deleteTransactionError,
      } = await supabase
        .from("transactions")
        .delete()
        .eq(
          "id",
          transaction.id
        )
        .eq(
          "school_id",
          schoolId
        );

      if (deleteTransactionError) {
        throw new Error(
          deleteTransactionError.message
        );
      }

      setDeleteJournal(null);

      setSuccess(
        `Journal${
          transaction.transaction_number
            ? ` ${transaction.transaction_number}`
            : ""
        } deleted successfully.`
      );

      await loadJournals(
        schoolId
      );
    } catch (err: any) {
      console.error(
        "JOURNAL DELETE ERROR:",
        err
      );

      setError(
        err?.message ||
          "Unable to delete journal."
      );
    } finally {
      setDeleting(false);
    }
  }

  /*
   * =========================================================
   * RENDER
   * =========================================================
   */

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="border-b bg-white">
        <div className="mx-auto max-w-7xl px-6 py-6">
          <Link
            href="/dashboard"
            className="mb-3 inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-blue-600"
          >
            <ArrowLeft size={16} />
            Dashboard
          </Link>

          <div className="text-sm font-semibold text-blue-600">
            Accounting
          </div>

          <h1 className="mt-1 text-3xl font-bold text-slate-900">
            Journal
          </h1>

          <p className="mt-1 text-sm text-slate-500">
            Record general journal entries using double-entry accounting.
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-6 py-6">
        {error && (
          <div className="mb-6 flex items-start justify-between rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            <span>{error}</span>

            <button
              type="button"
              onClick={() => setError("")}
            >
              <X size={16} />
            </button>
          </div>
        )}

        {success && (
          <div className="mb-6 flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={18} />
              {success}
            </div>

            <button
              type="button"
              onClick={() => setSuccess("")}
            >
              <X size={16} />
            </button>
          </div>
        )}

        {/* =================================================
            JOURNAL FORM
        ================================================= */}

        <section className="mb-6 rounded-2xl border bg-white p-5 shadow-sm">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-slate-900">
                {editingId
                  ? "Edit Journal"
                  : "New Journal"}
              </h2>

              <p className="mt-1 text-sm text-slate-500">
                Debit and credit totals must always be equal.
              </p>
            </div>

            {editingId && (
              <button
                type="button"
                onClick={resetForm}
                className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                <X size={16} />
                Cancel Edit
              </button>
            )}
          </div>

          {loading ? (
            <div className="flex items-center justify-center p-12 text-sm text-slate-500">
              <Loader2
                size={18}
                className="mr-2 animate-spin"
              />
              Loading accounts...
            </div>
          ) : (
            <form
              onSubmit={submitJournal}
              className="space-y-6"
            >
              {/* HEADER */}

              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Journal Date
                  </label>

                  <input
                    type="date"
                    value={journalDate}
                    onChange={(e) =>
                      setJournalDate(
                        e.target.value
                      )
                    }
                    className="w-full rounded-lg border px-3 py-2.5 outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Particulars
                  </label>

                  <input
                    type="text"
                    value={description}
                    onChange={(e) =>
                      setDescription(
                        e.target.value
                      )
                    }
                    placeholder="Journal particulars"
                    className="w-full rounded-lg border px-3 py-2.5 outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Reference
                  </label>

                  <input
                    type="text"
                    value={referenceNumber}
                    onChange={(e) =>
                      setReferenceNumber(
                        e.target.value
                      )
                    }
                    placeholder="Optional reference"
                    className="w-full rounded-lg border px-3 py-2.5 outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              {/* JOURNAL LINES */}

              <div className="overflow-hidden rounded-xl border">
                <div className="flex items-center justify-between border-b bg-slate-50 px-4 py-3">
                  <div>
                    <h3 className="font-semibold text-slate-900">
                      Journal Lines
                    </h3>

                    <p className="text-xs text-slate-500">
                      Add two or more debit/credit lines.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={addLine}
                    className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                  >
                    <Plus size={15} />
                    Add Line
                  </button>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full min-w-[900px]">
                    <thead className="bg-white">
                      <tr className="border-b">
                        <th className="px-4 py-3 text-left text-xs text-slate-500">
                          #
                        </th>

                        <th className="px-4 py-3 text-left text-xs text-slate-500">
                          Account
                        </th>

                        <th className="px-4 py-3 text-right text-xs text-slate-500">
                          Debit
                        </th>

                        <th className="px-4 py-3 text-right text-xs text-slate-500">
                          Credit
                        </th>

                        <th className="px-4 py-3 text-left text-xs text-slate-500">
                          Description
                        </th>

                        <th className="px-4 py-3 text-right text-xs text-slate-500">
                          Action
                        </th>
                      </tr>
                    </thead>

                    <tbody className="divide-y">
                      {lines.map(
                        (line, index) => (
                          <tr key={index}>
                            <td className="px-4 py-3 text-sm text-slate-500">
                              {index + 1}
                            </td>

                            <td className="px-4 py-3">
                              <select
                                value={
                                  line.account_id
                                }
                                onChange={(e) =>
                                  updateLine(
                                    index,
                                    "account_id",
                                    e.target.value
                                  )
                                }
                                className="w-full rounded-lg border bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-500"
                              >
                                <option value="">
                                  Select Account
                                </option>

                                {accounts.map(
                                  (account) => (
                                    <option
                                      key={
                                        account.id
                                      }
                                      value={
                                        account.id
                                      }
                                    >
                                      {account.name}
                                      {account.code
                                        ? ` (${account.code})`
                                        : ""}
                                    </option>
                                  )
                                )}
                              </select>
                            </td>

                            <td className="px-4 py-3">
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={
                                  line.debit
                                }
                                onChange={(e) => {
                                  updateLine(
                                    index,
                                    "debit",
                                    e.target.value
                                  );

                                  if (
                                    Number(
                                      e.target
                                        .value
                                    ) > 0
                                  ) {
                                    updateLine(
                                      index,
                                      "credit",
                                      ""
                                    );
                                  }
                                }}
                                placeholder="0.00"
                                className="w-full rounded-lg border px-3 py-2.5 text-right text-sm outline-none focus:border-blue-500"
                              />
                            </td>

                            <td className="px-4 py-3">
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={
                                  line.credit
                                }
                                onChange={(e) => {
                                  updateLine(
                                    index,
                                    "credit",
                                    e.target.value
                                  );

                                  if (
                                    Number(
                                      e.target
                                        .value
                                    ) > 0
                                  ) {
                                    updateLine(
                                      index,
                                      "debit",
                                      ""
                                    );
                                  }
                                }}
                                placeholder="0.00"
                                className="w-full rounded-lg border px-3 py-2.5 text-right text-sm outline-none focus:border-blue-500"
                              />
                            </td>

                            <td className="px-4 py-3">
                              <input
                                type="text"
                                value={
                                  line.description
                                }
                                onChange={(e) =>
                                  updateLine(
                                    index,
                                    "description",
                                    e.target.value
                                  )
                                }
                                placeholder="Optional"
                                className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none focus:border-blue-500"
                              />
                            </td>

                            <td className="px-4 py-3 text-right">
                              <button
                                type="button"
                                onClick={() =>
                                  removeLine(
                                    index
                                  )
                                }
                                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-red-200 text-red-600 hover:bg-red-50"
                              >
                                <Trash2 size={16} />
                              </button>
                            </td>
                          </tr>
                        )
                      )}
                    </tbody>

                    <tfoot>
                      <tr className="border-t bg-slate-50">
                        <td
                          colSpan={2}
                          className="px-4 py-4 text-right font-semibold text-slate-700"
                        >
                          Total
                        </td>

                        <td className="px-4 py-4 text-right font-bold text-red-600">
                          {money(totalDebit)}
                        </td>

                        <td className="px-4 py-4 text-right font-bold text-blue-600">
                          {money(totalCredit)}
                        </td>

                        <td
                          colSpan={2}
                        />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              {/* NOTES */}

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Notes
                </label>

                <textarea
                  value={notes}
                  onChange={(e) =>
                    setNotes(e.target.value)
                  }
                  rows={3}
                  placeholder="Optional notes"
                  className="w-full rounded-lg border px-3 py-2.5 outline-none focus:border-blue-500"
                />
              </div>

              {/* BALANCE STATUS */}

              <div
                className={`rounded-xl border p-4 ${
                  balanced
                    ? "border-emerald-200 bg-emerald-50"
                    : "border-amber-200 bg-amber-50"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p
                      className={`font-semibold ${
                        balanced
                          ? "text-emerald-800"
                          : "text-amber-800"
                      }`}
                    >
                      {balanced
                        ? "Journal Balanced"
                        : "Journal Not Balanced"}
                    </p>

                    <p
                      className={`mt-1 text-sm ${
                        balanced
                          ? "text-emerald-700"
                          : "text-amber-700"
                      }`}
                    >
                      Debit:{" "}
                      {money(totalDebit)}
                      {"  "}
                      Credit:{" "}
                      {money(totalCredit)}
                    </p>
                  </div>

                  <div
                    className={`text-lg font-bold ${
                      balanced
                        ? "text-emerald-700"
                        : "text-amber-700"
                    }`}
                  >
                    Difference:{" "}
                    {money(
                      Math.abs(
                        difference
                      )
                    )}
                  </div>
                </div>
              </div>

              {/* BUTTONS */}

              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={resetForm}
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-lg border px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  <RefreshCw size={16} />
                  Clear
                </button>

                <button
                  type="submit"
                  disabled={
                    saving ||
                    !balanced
                  }
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? (
                    <>
                      <Loader2
                        size={17}
                        className="animate-spin"
                      />
                      {editingId
                        ? "Updating..."
                        : "Saving..."}
                    </>
                  ) : (
                    <>
                      {editingId ? (
                        <Pencil size={17} />
                      ) : (
                        <Plus size={17} />
                      )}

                      {editingId
                        ? "Update Journal"
                        : "Save Journal"}
                    </>
                  )}
                </button>
              </div>
            </form>
          )}
        </section>

        {/* =================================================
            JOURNAL HISTORY
        ================================================= */}

        <section className="overflow-hidden rounded-2xl border bg-white">
          <div className="flex items-center justify-between border-b px-5 py-4">
            <div>
              <h2 className="font-semibold text-slate-900">
                Journal History
              </h2>

              <p className="text-xs text-slate-500">
                {journals.length} journal entries
              </p>
            </div>

            <button
              type="button"
              onClick={() => {
                if (schoolId) {
                  loadJournals(schoolId);
                }
              }}
              className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-slate-50"
            >
              <RefreshCw size={15} />
              Refresh
            </button>
          </div>

          {journals.length === 0 ? (
            <div className="p-12 text-center">
              <p className="font-semibold text-slate-900">
                No journal entries
              </p>

              <p className="mt-1 text-sm text-slate-500">
                Saved journal entries will appear here.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1100px]">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-5 py-3 text-left text-xs text-slate-500">
                      Date
                    </th>

                    <th className="px-5 py-3 text-left text-xs text-slate-500">
                      Journal No.
                    </th>

                    <th className="px-5 py-3 text-left text-xs text-slate-500">
                      Particulars
                    </th>

                    <th className="px-5 py-3 text-right text-xs text-slate-500">
                      Debit
                    </th>

                    <th className="px-5 py-3 text-right text-xs text-slate-500">
                      Credit
                    </th>

                    <th className="px-5 py-3 text-right text-xs text-slate-500">
                      Lines
                    </th>

                    <th className="px-5 py-3 text-right text-xs text-slate-500">
                      Actions
                    </th>
                  </tr>
                </thead>

                <tbody className="divide-y">
                  {journals.map(
                    (journal) => {
                      const debit = journal.entries.reduce(
                        (sum, entry) =>
                          sum +
                          Number(
                            entry.debit || 0
                          ),
                        0
                      );

                      const credit = journal.entries.reduce(
                        (sum, entry) =>
                          sum +
                          Number(
                            entry.credit || 0
                          ),
                        0
                      );

                      return (
                        <tr
                          key={journal.id}
                          className="hover:bg-slate-50"
                        >
                          <td className="px-5 py-4 text-sm text-slate-600">
                            {journal.transaction_date}
                          </td>

                          <td className="px-5 py-4 font-mono text-xs">
                            {journal.transaction_number ||
                              journal.id.slice(
                                0,
                                8
                              )}
                          </td>

                          <td className="max-w-[320px] px-5 py-4">
                            <div className="truncate text-sm font-medium text-slate-900">
                              {journal.description
                                ?.split(
                                  " | "
                                )[0] ||
                                "-"}
                            </div>
                          </td>

                          <td className="px-5 py-4 text-right font-semibold text-red-600">
                            {money(debit)}
                          </td>

                          <td className="px-5 py-4 text-right font-semibold text-blue-600">
                            {money(credit)}
                          </td>

                          <td className="px-5 py-4 text-right text-sm text-slate-600">
                            {journal.entries.length}
                          </td>

                          <td className="px-5 py-4">
                            <div className="flex justify-end gap-2">
                              {/* VIEW */}

                              <button
                                type="button"
                                title="View Journal"
                                onClick={() =>
                                  setViewJournal(
                                    journal
                                  )
                                }
                                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border text-slate-600 hover:bg-slate-50 hover:text-blue-600"
                              >
                                <Eye size={16} />
                              </button>

                              {/* EDIT */}

                              <button
                                type="button"
                                title="Edit Journal"
                                onClick={() =>
                                  startEdit(
                                    journal
                                  )
                                }
                                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border text-slate-600 hover:bg-slate-50 hover:text-amber-600"
                              >
                                <Pencil size={16} />
                              </button>

                              {/* DELETE */}

                              <button
                                type="button"
                                title="Delete Journal"
                                onClick={() =>
                                  setDeleteJournal(
                                    journal
                                  )
                                }
                                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-red-200 text-red-600 hover:bg-red-50"
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    }
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {/* ===================================================
          VIEW MODAL
      =================================================== */}

      {viewJournal && (
        <ViewJournalModal
          journal={viewJournal}
          onClose={() =>
            setViewJournal(null)
          }
        />
      )}

      {/* ===================================================
          DELETE MODAL
      =================================================== */}

      {deleteJournal && (
        <DeleteJournalModal
          journal={deleteJournal}
          deleting={deleting}
          onCancel={() =>
            setDeleteJournal(null)
          }
          onConfirm={confirmDelete}
        />
      )}
    </main>
  );
}

/*
 * =========================================================
 * VIEW MODAL
 * =========================================================
 */

function ViewJournalModal({
  journal,
  onClose,
}: {
  journal: JournalEntry;
  onClose: () => void;
}) {
  const debit = journal.entries.reduce(
    (sum, entry) =>
      sum + Number(entry.debit || 0),
    0
  );

  const credit = journal.entries.reduce(
    (sum, entry) =>
      sum + Number(entry.credit || 0),
    0
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div>
            <h2 className="text-xl font-bold text-slate-900">
              Journal Details
            </h2>

            <p className="mt-1 font-mono text-xs text-slate-500">
              {journal.transaction_number ||
                journal.id}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
          >
            <X size={20} />
          </button>
        </div>

        <div className="space-y-6 p-6">
          <div className="grid gap-4 md:grid-cols-3">
            <Detail
              label="Date"
              value={journal.transaction_date}
            />

            <Detail
              label="Particulars"
              value={
                journal.description
                  ?.split(" | ")[0] ||
                "-"
              }
            />

            <Detail
              label="Reference"
              value={
                journal.description
                  ?.split(" | ")
                  .find((part) =>
                    part.startsWith(
                      "Reference:"
                    )
                  )
                  ?.replace(
                    "Reference:",
                    ""
                  )
                  .trim() || "-"
              }
            />
          </div>

          <div className="overflow-hidden rounded-xl border">
            <div className="grid grid-cols-4 border-b bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-500">
              <div className="col-span-2">
                Account
              </div>

              <div className="text-right">
                Debit
              </div>

              <div className="text-right">
                Credit
              </div>
            </div>

            {journal.entries.map(
              (entry) => (
                <div
                  key={
                    entry.id ||
                    `${entry.account_id}-${entry.debit}-${entry.credit}`
                  }
                  className="grid grid-cols-4 border-b px-4 py-4 last:border-0"
                >
                  <div className="col-span-2">
                    <p className="font-medium text-slate-900">
                      {
                        entry.account_name
                      }
                    </p>

                    {entry.account_code && (
                      <p className="text-xs text-slate-400">
                        {
                          entry.account_code
                        }
                      </p>
                    )}

                    {entry.description && (
                      <p className="mt-1 text-xs text-slate-500">
                        {
                          entry.description
                        }
                      </p>
                    )}
                  </div>

                  <div className="text-right font-medium text-red-600">
                    {entry.debit > 0
                      ? money(
                          entry.debit
                        )
                      : "-"}
                  </div>

                  <div className="text-right font-medium text-blue-600">
                    {entry.credit > 0
                      ? money(
                          entry.credit
                        )
                      : "-"}
                  </div>
                </div>
              )
            )}

            <div className="grid grid-cols-4 bg-slate-50 px-4 py-4 font-bold">
              <div className="col-span-2 text-right">
                Total
              </div>

              <div className="text-right text-red-600">
                {money(debit)}
              </div>

              <div className="text-right text-blue-600">
                {money(credit)}
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end border-t px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/*
 * =========================================================
 * DELETE MODAL
 * =========================================================
 */

function DeleteJournalModal({
  journal,
  deleting,
  onCancel,
  onConfirm,
}: {
  journal: JournalEntry;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const total = journal.entries.reduce(
    (sum, entry) =>
      sum + Number(entry.debit || 0),
    0
  );

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <h2 className="text-lg font-bold text-slate-900">
            Delete Journal?
          </h2>

          <button
            type="button"
            onClick={onCancel}
            disabled={deleting}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
          >
            <X size={19} />
          </button>
        </div>

        <div className="p-6">
          <div className="rounded-xl border border-red-200 bg-red-50 p-4">
            <p className="font-semibold text-red-800">
              This action cannot be undone.
            </p>

            <p className="mt-2 text-sm leading-6 text-red-700">
              The journal transaction and all of its accounting lines will be deleted.
            </p>
          </div>

          <div className="mt-5 space-y-3">
            <Detail
              label="Journal"
              value={
                journal.transaction_number ||
                journal.id.slice(0, 8)
              }
            />

            <Detail
              label="Particulars"
              value={
                journal.description
                  ?.split(" | ")[0] ||
                "-"
              }
            />

            <Detail
              label="Amount"
              value={money(total)}
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 border-t px-6 py-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={deleting}
            className="rounded-lg border px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={onConfirm}
            disabled={deleting}
            className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
          >
            {deleting ? (
              <>
                <Loader2
                  size={16}
                  className="animate-spin"
                />
                Deleting...
              </>
            ) : (
              <>
                <Trash2 size={16} />
                Delete Journal
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

/*
 * =========================================================
 * DETAIL
 * =========================================================
 */

function Detail({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </p>

      <p className="mt-1 break-words text-sm font-medium text-slate-900">
        {value}
      </p>
    </div>
  );
}