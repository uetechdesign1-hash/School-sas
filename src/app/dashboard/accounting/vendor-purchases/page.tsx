"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Banknote,
  CalendarDays,
  CheckCircle2,
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
  Landmark,
  Loader2,
  Pencil,
  Plus,
  Receipt,
  RefreshCw,
  Trash2,
  Truck,
  Users,
  Wallet,
  X,
} from "lucide-react";
import jsPDF from "jspdf";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/client";
import {
  ensureSchoolAccountingSetup,
  postPurchaseBillJournal,
  postVendorPaymentJournal,
} from "@/lib/accounting/canonical-accounting";

type Vendor = {
  id: string;
  school_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  gstin: string | null;
  notes: string | null;
  is_active: boolean;
};

type Bill = {
  id: string;
  school_id: string;
  vendor_id: string;
  bill_number: string | null;
  bill_date: string;
  due_date: string | null;
  total_amount: number;
  notes: string | null;
  journal_entry_id: string | null;
};

type BillItem = {
  id: string;
  bill_id: string;
  description: string | null;
  expense_account_id: string | null;
  quantity: number;
  unit_price: number;
  amount: number;
};

type Payment = {
  id: string;
  school_id: string;
  vendor_id: string;
  payment_date: string;
  amount: number;
  paid_from_account_id: string | null;
  reference_number: string | null;
  notes: string | null;
  journal_entry_id: string | null;
};

type Allocation = {
  id: string;
  payment_id: string;
  bill_id: string;
  amount: number;
};

type Account = {
  id: string;
  school_id: string;
  code: string | null;
  name: string;
  account_type: string;
  is_active: boolean;
};

type BillView = Bill & {
  vendorName: string;
  paid: number;
  outstanding: number;
  status: "Paid" | "Partial" | "Unpaid";
  overdue: boolean;
  items: BillItem[];
};

type JournalLineView = {
  id: string;
  account_name: string | null;
  debit: number;
  credit: number;
  description: string | null;
};

type LedgerRow = {
  date: string;
  particulars: string;
  kind: "purchase" | "payment" | "opening";
  purchase: number;
  payment: number;
  balance: number;
};

type Tab = "vendors" | "bills" | "payments" | "outstanding" | "ledger";

type LineDraft = {
  description: string;
  accountId: string;
  qty: string;
  price: string;
};

const round2 = (n: number) =>
  Math.round(Number(n || 0) * 100) / 100;

const today = () =>
  new Date().toISOString().slice(0, 10);

function money(n: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number(n || 0));
}

function dateText(v: string) {
  if (!v) return "-";

  const d = new Date(`${v}T00:00:00`);

  return Number.isNaN(d.getTime())
    ? v
    : d.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
}

function csv(v: unknown) {
  const s = String(v ?? "");

  return /[",\n]/.test(s)
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function monthKeyOf(value: string | null | undefined) {
  return String(value || "").slice(0, 7);
}

function matchesPeriod(
  value: string | null | undefined,
  year: string,
  month: string,
) {
  if (!year && !month) return true;

  const key = monthKeyOf(value);

  if (!/^\d{4}-\d{2}$/.test(key)) return false;
  if (year && key.slice(0, 4) !== year) return false;
  if (month && key.slice(5, 7) !== month) return false;

  return true;
}

type ExportColumn = {
  label: string;
  numeric?: boolean;
};

type ExportTable = {
  name: string;
  columns: ExportColumn[];
  rows: (string | number)[][];
};

// "2026-03" when a month is chosen, "2026-00" for a whole year, "" for no
// filter. Used to split transactions into "before the period" and "inside it".
function periodStartKey(year: string, month: string) {
  if (!year && !month) return "";
  return `${year || "0000"}-${month || "00"}`;
}

function safeFileName(value: string) {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function downloadWorkbook(fileName: string, table: ExportTable) {
  if (typeof document === "undefined") return;

  const sheet = XLSX.utils.aoa_to_sheet([
    table.columns.map((column) => column.label),
    ...table.rows,
  ]);

  sheet["!cols"] = table.columns.map((column, index) => ({
    wch: Math.max(
      column.label.length + 2,
      10,
      ...table.rows.map((row) => String(row[index] ?? "").length + 2),
    ),
  }));

  const workbook = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(workbook, sheet, table.name.slice(0, 31));
  XLSX.writeFile(workbook, `${safeFileName(fileName)}.xlsx`);
}

function downloadCsv(fileName: string, table: ExportTable) {
  if (typeof document === "undefined") return;

  const lines = [
    table.columns.map((column) => csv(column.label)).join(","),
    ...table.rows.map((row) => row.map((cell) => csv(cell)).join(",")),
  ];

  const blob = new Blob([lines.join("\n")], {
    type: "text/csv;charset=utf-8;",
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `${safeFileName(fileName)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function downloadTablePdf(input: {
  fileName: string;
  title: string;
  subtitle: string;
  table: ExportTable;
}) {
  if (typeof document === "undefined") return;

  const { fileName, title, subtitle, table } = input;

  const pdf = new jsPDF({
    orientation: "landscape",
    unit: "mm",
    format: "a4",
    compress: true,
  });

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const left = 10;
  const usableWidth = pageWidth - left * 2;

  const weights = table.columns.map((column) =>
    column.numeric ? 0.72 : 1.35,
  );

  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);

  const widths = weights.map(
    (weight) => (usableWidth * weight) / weightSum,
  );

  const xs: number[] = [];

  let cursor = left;

  for (const width of widths) {
    xs.push(cursor);
    cursor += width;
  }

  let y = 12;

  const drawTitle = () => {
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(14);
    pdf.text(title, left, y);
    y += 6;

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.text(subtitle, left, y);
    y += 7;
  };

  const drawHeader = () => {
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(7);

    table.columns.forEach((column, index) => {
      const align = column.numeric ? "right" : "left";

      pdf.text(
        column.label.toUpperCase(),
        column.numeric ? xs[index] + widths[index] : xs[index],
        y,
        { align },
      );
    });

    y += 3.5;

    pdf.setDrawColor(150);
    pdf.line(left, y, pageWidth - left, y);
    y += 4.5;

    pdf.setFont("helvetica", "normal");
  };

  drawTitle();
  drawHeader();

  const wrap = (value: unknown, width: number) =>
    pdf.splitTextToSize(
      String(value ?? "—"),
      Math.max(width - 2, 8),
    ) as string[];

  for (const row of table.rows) {
    const cells = row.map((cell, index) => wrap(cell, widths[index]));
    const rowHeight =
      Math.max(...cells.map((cell) => cell.length), 1) * 3.4;

    if (y + rowHeight > pageHeight - 10) {
      pdf.addPage();
      y = 12;
      drawTitle();
      drawHeader();
    }

    pdf.setFontSize(6.5);

    cells.forEach((lines, index) => {
      const numeric = Boolean(table.columns[index]?.numeric);

      lines.forEach((line, lineIndex) => {
        pdf.text(
          line,
          numeric ? xs[index] + widths[index] : xs[index],
          y + lineIndex * 3.4,
          { align: numeric ? "right" : "left" },
        );
      });
    });

    y += rowHeight + 2;

    pdf.setDrawColor(220);
    pdf.line(left, y - 1, pageWidth - left, y - 1);
  }

  pdf.save(`${safeFileName(fileName)}.pdf`);
}

export default function VendorPurchasesPage() {
  const supabase = useMemo(() => createClient(), []);

  const [schoolId, setSchoolId] = useState<string | null>(null);
  const [schoolName, setSchoolName] = useState("School");

  const [tab, setTab] = useState<Tab>("outstanding");

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [billItems, setBillItems] = useState<BillItem[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);

  const [vendorPayablesAccountId, setVendorPayablesAccountId] = useState("");

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [showVendorModal, setShowVendorModal] = useState(false);
  const [editingVendor, setEditingVendor] = useState<Vendor | null>(null);
  const [vendorName, setVendorName] = useState("");
  const [vendorPhone, setVendorPhone] = useState("");
  const [vendorEmail, setVendorEmail] = useState("");
  const [vendorGstin, setVendorGstin] = useState("");
  const [vendorAddress, setVendorAddress] = useState("");
  const [vendorNotes, setVendorNotes] = useState("");
  const [savingVendor, setSavingVendor] = useState(false);

  const [showBillModal, setShowBillModal] = useState(false);
  const [billVendorId, setBillVendorId] = useState("");
  const [billNumber, setBillNumber] = useState("");
  const [billDate, setBillDate] = useState(today());
  const [dueDate, setDueDate] = useState("");
  const [billNotes, setBillNotes] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [savingBill, setSavingBill] = useState(false);
  const [editingBill, setEditingBill] = useState<BillView | null>(null);

  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [payVendorId, setPayVendorId] = useState("");
  const [payDate, setPayDate] = useState(today());
  const [payAmount, setPayAmount] = useState("");
  const [payAccountId, setPayAccountId] = useState("");
  const [payReference, setPayReference] = useState("");
  const [payNotes, setPayNotes] = useState("");
  const [savingPayment, setSavingPayment] = useState(false);
  const [editingPayment, setEditingPayment] = useState<Payment | null>(null);

  const [filterYear, setFilterYear] = useState("");
  const [filterMonth, setFilterMonth] = useState("");

  const [viewBill, setViewBill] = useState<BillView | null>(null);
  const [viewJournal, setViewJournal] = useState<JournalLineView[]>([]);
  const [viewLoading, setViewLoading] = useState(false);

  const [detailVendor, setDetailVendor] = useState<Vendor | null>(null);

  const [ledgerVendorId, setLedgerVendorId] = useState("");

  const [deleteBillTarget, setDeleteBillTarget] =
    useState<BillView | null>(null);
  const [deletingBill, setDeletingBill] = useState(false);

  const [deletePaymentTarget, setDeletePaymentTarget] =
    useState<Payment | null>(null);
  const [deletingPayment, setDeletingPayment] = useState(false);

  async function getSchool() {
    const { data: auth, error: authError } =
      await supabase.auth.getUser();

    if (authError) throw authError;

    if (!auth.user) {
      window.location.assign("/login");
      throw new Error("Please log in again.");
    }

    const { data: rpcId, error: rpcError } =
      await supabase.rpc("get_my_school_id");

    if (!rpcError && rpcId) {
      return String(rpcId);
    }

    const { data, error } = await supabase
      .from("school_users")
      .select("school_id")
      .eq("user_id", auth.user.id)
      .eq("is_active", true)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    if (!data?.school_id) {
      throw new Error("No active school found.");
    }

    return String(data.school_id);
  }

  async function loadData(id: string) {
    const [
      schoolRes,
      vendorRes,
      billRes,
      itemRes,
      paymentRes,
      allocRes,
      accountRes,
    ] = await Promise.all([
      supabase
        .from("schools")
        .select("id,name")
        .eq("id", id)
        .maybeSingle(),

      supabase
        .from("vendors")
        .select("*")
        .eq("school_id", id)
        .order("name"),

      supabase
        .from("purchase_bills")
        .select("*")
        .eq("school_id", id)
        .order("bill_date", { ascending: false })
        .order("created_at", { ascending: false }),

      supabase
        .from("purchase_bill_items")
        .select("*")
        .eq("school_id", id),

      supabase
        .from("vendor_payments")
        .select("*")
        .eq("school_id", id)
        .order("payment_date", { ascending: false })
        .order("created_at", { ascending: false }),

      supabase
        .from("bill_payment_allocations")
        .select("*")
        .eq("school_id", id),

      supabase
        .from("accounts")
        .select("id,school_id,code,name,account_type,is_active")
        .eq("school_id", id)
        .eq("is_active", true)
        .order("name"),
    ]);

    if (schoolRes.error) throw schoolRes.error;
    if (vendorRes.error) throw vendorRes.error;
    if (billRes.error) throw billRes.error;
    if (itemRes.error) throw itemRes.error;
    if (paymentRes.error) throw paymentRes.error;
    if (allocRes.error) throw allocRes.error;
    if (accountRes.error) throw accountRes.error;

    setSchoolName(schoolRes.data?.name || "School");
    setVendors((vendorRes.data || []) as Vendor[]);
    setBills((billRes.data || []) as Bill[]);
    setBillItems((itemRes.data || []) as BillItem[]);
    setPayments((paymentRes.data || []) as Payment[]);
    setAllocations((allocRes.data || []) as Allocation[]);
    setAccounts((accountRes.data || []) as Account[]);

    const setup = await ensureSchoolAccountingSetup(supabase, id);

    setVendorPayablesAccountId(
      setup.accountMap?.VENDOR_PAYABLES || "",
    );
  }

  useEffect(() => {
    void (async () => {
      try {
        setLoading(true);

        const id = await getSchool();

        setSchoolId(id);
        await loadData(id);
      } catch (e: any) {
        console.error(e);
        setError(e?.message || "Unable to load vendor purchases.");
      } finally {
        setLoading(false);
      }
    })();

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refresh() {
    if (!schoolId) return;

    try {
      setRefreshing(true);
      setError("");
      await loadData(schoolId);
    } catch (e: any) {
      setError(e?.message || "Unable to refresh.");
    } finally {
      setRefreshing(false);
    }
  }
  const vendorMap = useMemo(
    () => new Map(vendors.map((v) => [v.id, v])),
    [vendors],
  );

  const expenseAccounts = useMemo(
    () =>
      accounts.filter(
        (a) =>
          a.account_type === "expense" ||
          a.account_type === "EXPENSE",
      ),
    [accounts],
  );

  const payAccounts = useMemo(
    () =>
      accounts.filter((a) =>
        ["cash", "bank", "CASH", "BANK"].includes(
          a.account_type,
        ),
      ),
    [accounts],
  );

  const itemsByBill = useMemo(() => {
    const map = new Map<string, BillItem[]>();

    for (const item of billItems) {
      const list = map.get(item.bill_id) || [];
      list.push(item);
      map.set(item.bill_id, list);
    }

    return map;
  }, [billItems]);

  const paidByBill = useMemo(() => {
    const map: Record<string, number> = {};

    for (const a of allocations) {
      map[a.bill_id] = round2(
        (map[a.bill_id] || 0) + Number(a.amount || 0),
      );
    }

    return map;
  }, [allocations]);

  const billViews = useMemo<BillView[]>(
    () =>
      bills.map((b) => {
        const total = round2(Number(b.total_amount || 0));
        const paid = round2(paidByBill[b.id] || 0);
        const outstanding = round2(total - paid);

        return {
          ...b,
          vendorName:
            vendorMap.get(b.vendor_id)?.name || "Unknown vendor",
          paid,
          outstanding,
          status:
            outstanding <= 0.009
              ? "Paid"
              : paid > 0.009
                ? "Partial"
                : "Unpaid",
          overdue:
            outstanding > 0.009 &&
            !!b.due_date &&
            b.due_date < today(),
          items: itemsByBill.get(b.id) || [],
        };
      }),
    [bills, paidByBill, itemsByBill, vendorMap],
  );

  const statsByVendor = useMemo(() => {
    const map: Record<
      string,
      {
        purchases: number;
        paid: number;
        outstanding: number;
        billCount: number;
        unpaidCount: number;
      }
    > = {};

    for (const vendor of vendors) {
      map[vendor.id] = {
        purchases: 0,
        paid: 0,
        outstanding: 0,
        billCount: 0,
        unpaidCount: 0,
      };
    }

    for (const bill of billViews) {
      const stat = map[bill.vendor_id];

      if (!stat) continue;

      stat.purchases = round2(
        stat.purchases + Number(bill.total_amount || 0),
      );
      stat.paid = round2(stat.paid + bill.paid);
      stat.outstanding = round2(
        stat.outstanding + bill.outstanding,
      );
      stat.billCount += 1;

      if (bill.outstanding > 0.009) {
        stat.unpaidCount += 1;
      }
    }

    return map;
  }, [vendors, billViews]);

  const periodYears = useMemo(() => {
    const years = new Set<string>();

    for (const bill of bills) {
      const key = monthKeyOf(bill.bill_date);

      if (/^\d{4}-\d{2}$/.test(key)) years.add(key.slice(0, 4));
    }

    for (const payment of payments) {
      const key = monthKeyOf(payment.payment_date);

      if (/^\d{4}-\d{2}$/.test(key)) years.add(key.slice(0, 4));
    }

    years.add(String(new Date().getFullYear()));

    return [...years].sort((a, b) => b.localeCompare(a));
  }, [bills, payments]);

  const filterActive = Boolean(filterYear || filterMonth);

  const periodLabel = useMemo(() => {
    if (!filterActive) return "All periods";

    const monthName = filterMonth
      ? MONTH_NAMES[Number(filterMonth) - 1] || ""
      : "";

    return [monthName, filterYear].filter(Boolean).join(" ") || "All periods";
  }, [filterActive, filterMonth, filterYear]);

  const filteredBills = useMemo(
    () =>
      filterActive
        ? billViews.filter((bill) =>
            matchesPeriod(bill.bill_date, filterYear, filterMonth),
          )
        : billViews,
    [billViews, filterActive, filterYear, filterMonth],
  );

  const filteredPayments = useMemo(
    () =>
      filterActive
        ? payments.filter((payment) =>
            matchesPeriod(
              payment.payment_date,
              filterYear,
              filterMonth,
            ),
          )
        : payments,
    [payments, filterActive, filterYear, filterMonth],
  );

  const filteredUnpaidBills = useMemo(
    () => filteredBills.filter((bill) => bill.outstanding > 0.009),
    [filteredBills],
  );

  const filteredOutstandingTotal = useMemo(
    () =>
      round2(
        filteredUnpaidBills.reduce(
          (sum, bill) => sum + Math.max(0, bill.outstanding),
          0,
        ),
      ),
    [filteredUnpaidBills],
  );

  const filteredPurchasesTotal = useMemo(
    () =>
      round2(
        filteredBills.reduce(
          (sum, bill) => sum + Number(bill.total_amount || 0),
          0,
        ),
      ),
    [filteredBills],
  );

  const filteredPaidTotal = useMemo(
    () =>
      round2(
        filteredPayments.reduce(
          (sum, payment) => sum + Number(payment.amount || 0),
          0,
        ),
      ),
    [filteredPayments],
  );

  const ledgerRows = useMemo<LedgerRow[]>(() => {
    if (!ledgerVendorId) return [];

    const vendorBills = billViews.filter(
      (bill) => bill.vendor_id === ledgerVendorId,
    );

    const vendorPayments = payments.filter(
      (payment) => payment.vendor_id === ledgerVendorId,
    );

    const scopeKey = filterActive
      ? periodStartKey(filterYear, filterMonth)
      : "";

    const isBeforeScope = (value: string | null | undefined) =>
      Boolean(scopeKey) && monthKeyOf(value) < scopeKey;

    // When a period is selected the ledger opens with everything that was
    // already outstanding before that period, so the running balance stays
    // meaningful instead of restarting at zero.
    let opening = 0;

    if (scopeKey) {
      for (const bill of vendorBills) {
        if (!isBeforeScope(bill.bill_date)) continue;

        opening = round2(opening + Number(bill.total_amount || 0));
      }

      for (const payment of vendorPayments) {
        if (!isBeforeScope(payment.payment_date)) continue;

        opening = round2(opening - Number(payment.amount || 0));
      }
    }

    const rows: Omit<LedgerRow, "balance">[] = [];

    if (scopeKey && opening !== 0) {
      rows.push({
        date: "",
        particulars: "Opening balance brought forward",
        kind: "opening",
        purchase: 0,
        payment: 0,
      });
    }

    for (const bill of vendorBills) {
      if (!matchesPeriod(bill.bill_date, filterYear, filterMonth)) continue;

      rows.push({
        date: bill.bill_date,
        particulars: bill.bill_number
          ? `Purchase bill ${bill.bill_number}`
          : "Purchase bill",
        kind: "purchase",
        purchase: Number(bill.total_amount || 0),
        payment: 0,
      });
    }

    for (const payment of vendorPayments) {
      if (
        !matchesPeriod(payment.payment_date, filterYear, filterMonth)
      ) {
        continue;
      }

      rows.push({
        date: payment.payment_date,
        particulars: payment.reference_number
          ? `Payment (Ref: ${payment.reference_number})`
          : "Payment",
        kind: "payment",
        purchase: 0,
        payment: Number(payment.amount || 0),
      });
    }

    rows.sort((a, b) => {
      const rank = (row: Omit<LedgerRow, "balance">) =>
        row.kind === "opening" ? -1 : 0;

      return (
        rank(a) - rank(b) ||
        a.date.localeCompare(b.date) ||
        a.kind.localeCompare(b.kind)
      );
    });

    let balance = opening;

    return rows.map((row) => {
      if (row.kind !== "opening") {
        balance = round2(balance + row.purchase - row.payment);
      }

      return { ...row, balance };
    });
  }, [
    ledgerVendorId,
    billViews,
    payments,
    filterActive,
    filterYear,
    filterMonth,
  ]);


  const billTotal = useMemo(
    () =>
      round2(
        lines.reduce(
          (sum, l) =>
            sum + round2(Number(l.qty || 0) * Number(l.price || 0)),
          0,
        ),
      ),
    [lines],
  );

  // When a payment is being edited its old allocations are released back to
  // the bills first, so the modal preview and the FIFO run use the same
  // restored outstanding amounts.
  const paymentReclaimByBill = useMemo(() => {
    const map = new Map<string, number>();

    if (!editingPayment) return map;

    for (const a of allocations) {
      if (a.payment_id !== editingPayment.id) continue;

      map.set(
        a.bill_id,
        round2((map.get(a.bill_id) || 0) + Number(a.amount || 0)),
      );
    }

    return map;
  }, [allocations, editingPayment]);

  const payVendorOldestBills = useMemo(() => {
    if (!payVendorId) return [];

    return billViews
      .filter((b) => b.vendor_id === payVendorId)
      .map((b) => ({
        ...b,
        outstanding: round2(
          b.outstanding + (paymentReclaimByBill.get(b.id) || 0),
        ),
      }))
      .filter((b) => b.outstanding > 0.009)
      .sort((a, b) =>
        (a.due_date || a.bill_date).localeCompare(
          b.due_date || b.bill_date,
        ),
      );
  }, [payVendorId, billViews, paymentReclaimByBill]);

  const payVendorOutstanding = useMemo(
    () =>
      round2(
        payVendorOldestBills.reduce(
          (sum, bill) => sum + bill.outstanding,
          0,
        ),
      ),
    [payVendorOldestBills],
  );

  // Vendor picker labels. When a payment is being edited its own allocations
  // are released back to the bills first, so the picker matches the preview.
  const payVendorSelectOutstanding = useMemo(() => {
    const map: Record<string, number> = {};

    for (const bill of billViews) {
      map[bill.vendor_id] = round2(
        (map[bill.vendor_id] || 0) +
          bill.outstanding +
          (paymentReclaimByBill.get(bill.id) || 0),
      );
    }

    return map;
  }, [billViews, paymentReclaimByBill]);

  function resetVendorForm() {
    setEditingVendor(null);
    setVendorName("");
    setVendorPhone("");
    setVendorEmail("");
    setVendorGstin("");
    setVendorAddress("");
    setVendorNotes("");
  }

  function openAddVendor() {
    resetVendorForm();
    setShowVendorModal(true);
  }

  function openEditVendor(vendor: Vendor) {
    setEditingVendor(vendor);
    setVendorName(vendor.name || "");
    setVendorPhone(vendor.phone || "");
    setVendorEmail(vendor.email || "");
    setVendorGstin(vendor.gstin || "");
    setVendorAddress(vendor.address || "");
    setVendorNotes(vendor.notes || "");
    setShowVendorModal(true);
  }

  async function saveVendor() {
    if (!schoolId) return;

    if (!vendorName.trim()) {
      setError("Vendor name is required.");
      return;
    }

    try {
      setSavingVendor(true);
      setError("");

      const payload = {
        school_id: schoolId,
        name: vendorName.trim(),
        phone: vendorPhone.trim() || null,
        email: vendorEmail.trim() || null,
        gstin: vendorGstin.trim() || null,
        address: vendorAddress.trim() || null,
        notes: vendorNotes.trim() || null,
      };

      if (editingVendor) {
        const { error: updateError } = await supabase
          .from("vendors")
          .update(payload)
          .eq("id", editingVendor.id)
          .eq("school_id", schoolId);

        if (updateError) throw updateError;

        setSuccess("Vendor updated.");
      } else {
        const { error: insertError } = await supabase
          .from("vendors")
          .insert(payload);

        if (insertError) {
          if (
            String(insertError.message || "").includes(
              "duplicate key",
            )
          ) {
            throw new Error(
              "A vendor with this name already exists.",
            );
          }

          throw insertError;
        }

        setSuccess("Vendor added.");
      }

      setShowVendorModal(false);
      resetVendorForm();
      await loadData(schoolId);
    } catch (e: any) {
      console.error(e);
      setError(e?.message || "Unable to save vendor.");
    } finally {
      setSavingVendor(false);
    }
  }

  function resetBillForm() {
    setEditingBill(null);
    setBillVendorId("");
    setBillNumber("");
    setBillDate(today());
    setDueDate("");
    setBillNotes("");
    setLines([]);
  }

  function openEditBill(bill: BillView) {
    setEditingBill(bill);
    setBillVendorId(bill.vendor_id);
    setBillNumber(bill.bill_number || "");
    setBillDate(bill.bill_date);
    setDueDate(bill.due_date || "");
    setBillNotes(bill.notes || "");

    setLines(
      bill.items.length > 0
        ? bill.items.map((item) => ({
            description: item.description || "",
            accountId: item.expense_account_id || "",
            qty: String(Number(item.quantity || 1)),
            price: String(Number(item.unit_price || 0)),
          }))
        : [
            {
              description: "",
              accountId: expenseAccounts[0]?.id || "",
              qty: "1",
              price: "",
            },
          ],
    );

    setError("");
    setSuccess("");
    setShowBillModal(true);
  }

  function openBillModal() {
    resetBillForm();

    if (expenseAccounts.length > 0) {
      setLines([
        {
          description: "",
          accountId: expenseAccounts[0].id,
          qty: "1",
          price: "",
        },
      ]);
    }

    setShowBillModal(true);
  }

  function addLine() {
    setLines((prev) => [
      ...prev,
      {
        description: "",
        accountId: expenseAccounts[0]?.id || "",
        qty: "1",
        price: "",
      },
    ]);
  }

  function updateLine(index: number, patch: Partial<LineDraft>) {
    setLines((prev) =>
      prev.map((line, i) =>
        i === index ? { ...line, ...patch } : line,
      ),
    );
  }

  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index));
  }

  async function createBill() {
    if (!schoolId) return;

    try {
      setSavingBill(true);
      setError("");

      if (!billVendorId) {
        throw new Error("Select a vendor for this bill.");
      }

      if (!billDate) {
        throw new Error("Select the bill date.");
      }

      const cleanLines = lines
        .map((line) => ({
          description: line.description.trim(),
          accountId: line.accountId,
          qty: Number(line.qty || 0),
          price: Number(line.price || 0),
        }))
        .filter(
          (line) =>
            line.description || line.qty > 0 || line.price > 0,
        );

      if (cleanLines.length === 0) {
        throw new Error(
          "Add at least one line item to the bill.",
        );
      }

      for (const line of cleanLines) {
        if (!(line.qty > 0)) {
          throw new Error(
            "Quantity must be greater than zero on every line item.",
          );
        }

        if (line.price <= 0) {
          throw new Error(
            "Unit price must be greater than zero on every line item.",
          );
        }

        if (!line.accountId) {
          throw new Error(
            "Select an expense account for every line item.",
          );
        }
      }

      const total = round2(
        cleanLines.reduce(
          (sum, line) =>
            sum + round2(line.qty * line.price),
          0,
        ),
      );

      if (!(total > 0)) {
        throw new Error("Bill total must be greater than zero.");
      }

      if (!vendorPayablesAccountId) {
        throw new Error(
          "The Vendor Payables account is missing. Please run accounting setup first.",
        );
      }

      if (editingBill) {
        if (
          billVendorId !== editingBill.vendor_id &&
          editingBill.paid > 0.009
        ) {
          throw new Error(
            `This bill already has ${money(editingBill.paid)} of payments allocated, so the vendor cannot be changed. Delete those payments first.`,
          );
        }

        if (total < round2(editingBill.paid - 0.009)) {
          throw new Error(
            `Bill total cannot be less than the ${money(editingBill.paid)} already paid against it.`,
          );
        }
      }

      const user =
        (await supabase.auth.getUser()).data.user?.id || null;

      let billId = editingBill?.id || "";

      if (editingBill) {
        const { error: updateError } = await supabase
          .from("purchase_bills")
          .update({
            vendor_id: billVendorId,
            bill_number: billNumber.trim() || null,
            bill_date: billDate,
            due_date: dueDate || null,
            total_amount: total,
            notes: billNotes.trim() || null,
          })
          .eq("id", editingBill.id)
          .eq("school_id", schoolId);

        if (updateError) {
          if (
            String(updateError.message || "").includes("duplicate key")
          ) {
            throw new Error(
              "This vendor already has a bill with this number.",
            );
          }

          throw updateError;
        }

        // Replace the line items with the corrected set.
        const { error: clearItemsError } = await supabase
          .from("purchase_bill_items")
          .delete()
          .eq("bill_id", editingBill.id)
          .eq("school_id", schoolId);

        if (clearItemsError) throw clearItemsError;
      } else {
        const { data: bill, error: billError } = await supabase
          .from("purchase_bills")
          .insert({
            school_id: schoolId,
            vendor_id: billVendorId,
            bill_number: billNumber.trim() || null,
            bill_date: billDate,
            due_date: dueDate || null,
            total_amount: total,
            notes: billNotes.trim() || null,
            created_by: user,
          })
          .select("id")
          .single();

        if (billError) {
          if (
            String(billError.message || "").includes(
              "duplicate key",
            )
          ) {
            throw new Error(
              "This vendor already has a bill with this number.",
            );
          }

          throw billError;
        }

        if (!bill?.id) {
          throw new Error("Purchase bill was not created.");
        }

        billId = bill.id;
      }

      if (!billId) {
        throw new Error("Purchase bill was not saved.");
      }

      const { error: itemsError } = await supabase
        .from("purchase_bill_items")
        .insert(
          cleanLines.map((line, index) => ({
            school_id: schoolId,
            bill_id: billId,
            description: line.description || null,
            expense_account_id: line.accountId,
            quantity: line.qty,
            unit_price: line.price,
            amount: round2(line.qty * line.price),
            line_order: index,
          })),
        );

      if (itemsError) throw itemsError;

      // Re-post the accounting entry so corrected amounts are reflected.
      if (editingBill?.journal_entry_id) {
        const { error: clearJournalError } = await supabase
          .from("journal_entries")
          .delete()
          .eq("id", editingBill.journal_entry_id)
          .eq("school_id", schoolId);

        if (clearJournalError) throw clearJournalError;
      }

      const setup = await ensureSchoolAccountingSetup(
        supabase,
        schoolId,
      );

      const grouped = new Map<string, number>();

      for (const line of cleanLines) {
        grouped.set(
          line.accountId,
          round2(
            (grouped.get(line.accountId) || 0) +
              round2(line.qty * line.price),
          ),
        );
      }

      const vendorNameText =
        vendorMap.get(billVendorId)?.name || "Vendor";

      const posted = await postPurchaseBillJournal(supabase, {
        schoolId,
        fiscalYearId: setup.fiscalYearId,
        entryDate: billDate,
        sourceRecordId: billId,
        vendorPayablesAccountId,
        totalAmount: total,
        expenseLines: [...grouped].map(
          ([accountId, amount]) => ({
            accountId,
            amount,
            description: `Purchase - ${vendorNameText}`,
          }),
        ),
        createdBy: user,
      });

      await supabase
        .from("purchase_bills")
        .update({
          journal_entry_id: posted?.journalEntryId || null,
        })
        .eq("id", billId)
        .eq("school_id", schoolId);

      const wasEditing = Boolean(editingBill);

      setShowBillModal(false);
      resetBillForm();
      setSuccess(
        wasEditing
          ? "Purchase bill updated. The linked Dr Expense / Cr Vendor Payables entry was re-posted."
          : "Purchase bill recorded. Dr Expense / Cr Vendor Payables posted.",
      );
      await loadData(schoolId);
    } catch (e: any) {
      console.error(e);
      setError(e?.message || "Unable to create purchase bill.");
    } finally {
      setSavingBill(false);
    }
  }
  function resetPaymentForm() {
    setEditingPayment(null);
    setPayVendorId("");
    setPayDate(today());
    setPayAmount("");
    setPayAccountId("");
    setPayReference("");
    setPayNotes("");
  }

  function openEditPayment(payment: Payment) {
    setEditingPayment(payment);
    setPayVendorId(payment.vendor_id);
    setPayDate(payment.payment_date);
    setPayAmount(String(Number(payment.amount || 0)));
    setPayAccountId(payment.paid_from_account_id || "");
    setPayReference(payment.reference_number || "");
    setPayNotes(payment.notes || "");
    setError("");
    setSuccess("");
    setShowPaymentModal(true);
  }

  function openPaymentModal() {
    resetPaymentForm();
    setShowPaymentModal(true);
  }

  async function recordPayment() {
    if (!schoolId) return;

    try {
      setSavingPayment(true);
      setError("");

      if (!payVendorId) {
        throw new Error("Select the vendor being paid.");
      }

      if (!payDate) {
        throw new Error("Select the payment date.");
      }

      const amount = round2(Number(payAmount || 0));

      if (!(amount > 0)) {
        throw new Error("Enter a payment amount greater than zero.");
      }

      if (!payAccountId) {
        throw new Error(
          "Select the Cash or Bank account the payment leaves from.",
        );
      }

      const editing = editingPayment;
      const available = payVendorOutstanding;

      if (!(available > 0)) {
        throw new Error(
          "This vendor has no outstanding bills to allocate payment to.",
        );
      }

      if (amount > round2(available + 0.009)) {
        throw new Error(
          `Payment exceeds the outstanding payable of ${money(available)}.`,
        );
      }

      if (!vendorPayablesAccountId) {
        throw new Error(
          "The Vendor Payables account is missing. Please run accounting setup first.",
        );
      }

      const user =
        (await supabase.auth.getUser()).data.user?.id || null;

      const payload = {
        vendor_id: payVendorId,
        payment_date: payDate,
        amount,
        paid_from_account_id: payAccountId,
        reference_number: payReference.trim() || null,
        notes: payNotes.trim() || null,
      };

      let paymentId = editing?.id || "";

      if (editing) {
        const { error: updateError } = await supabase
          .from("vendor_payments")
          .update(payload)
          .eq("id", editing.id)
          .eq("school_id", schoolId);

        if (updateError) throw updateError;

        // Old allocations are released so the new amount is applied oldest
        // first all over again.
        const { error: clearAllocationsError } = await supabase
          .from("bill_payment_allocations")
          .delete()
          .eq("payment_id", editing.id)
          .eq("school_id", schoolId);

        if (clearAllocationsError) throw clearAllocationsError;
      } else {
        const { data: payment, error: paymentError } = await supabase
          .from("vendor_payments")
          .insert({
            school_id: schoolId,
            ...payload,
            created_by: user,
          })
          .select("id")
          .single();

        if (paymentError) throw paymentError;

        if (!payment?.id) {
          throw new Error("Vendor payment was not created.");
        }

        paymentId = payment.id;
      }

      // Automatic FIFO allocation: oldest outstanding bills first.
      let remaining = amount;
      const allocationRows: {
        school_id: string;
        payment_id: string;
        bill_id: string;
        amount: number;
      }[] = [];

      for (const bill of payVendorOldestBills) {
        if (remaining <= 0.009) break;

        const take = round2(
          Math.min(remaining, bill.outstanding),
        );

        if (!(take > 0)) continue;

        allocationRows.push({
          school_id: schoolId,
          payment_id: paymentId,
          bill_id: bill.id,
          amount: take,
        });

        remaining = round2(remaining - take);
      }

      if (allocationRows.length > 0) {
        const { error: allocError } = await supabase
          .from("bill_payment_allocations")
          .insert(allocationRows);

        if (allocError) throw allocError;
      }

      const setup = await ensureSchoolAccountingSetup(
        supabase,
        schoolId,
      );

      // Re-post the accounting entry so corrected amounts are reflected.
      if (editing?.journal_entry_id) {
        const { error: clearJournalError } = await supabase
          .from("journal_entries")
          .delete()
          .eq("id", editing.journal_entry_id)
          .eq("school_id", schoolId);

        if (clearJournalError) throw clearJournalError;
      }

      const posted = await postVendorPaymentJournal(supabase, {
        schoolId,
        fiscalYearId: setup.fiscalYearId,
        entryDate: payDate,
        sourceRecordId: paymentId,
        vendorPayablesAccountId,
        paymentAccountId: payAccountId,
        amount,
        createdBy: user,
        vendorName: vendorMap.get(payVendorId)?.name || null,
        paymentReference: payReference.trim() || null,
        paymentNotes: payNotes.trim() || null,
      });

      await supabase
        .from("vendor_payments")
        .update({
          journal_entry_id: posted?.journalEntryId || null,
        })
        .eq("id", paymentId)
        .eq("school_id", schoolId);

      setShowPaymentModal(false);
      resetPaymentForm();
      setSuccess(
        editing
          ? `Payment of ${money(amount)} updated and re-allocated across ${allocationRows.length} bill(s). The linked accounting entry was re-posted.`
          : `Payment of ${money(amount)} recorded and allocated across ${allocationRows.length} bill(s). Dr Vendor Payables / Cr Cash-Bank posted.`,
      );
      await loadData(schoolId);
    } catch (e: any) {
      console.error(e);
      setError(e?.message || "Unable to record vendor payment.");
    } finally {
      setSavingPayment(false);
    }
  }

  async function deleteBill() {
    if (!schoolId || !deleteBillTarget) return;

    try {
      setDeletingBill(true);
      setError("");

      const hasAllocations = allocations.some(
        (a) => a.bill_id === deleteBillTarget.id,
      );

      if (hasAllocations) {
        throw new Error(
          "This bill has payments allocated to it. Delete the vendor payment first.",
        );
      }

      if (deleteBillTarget.journal_entry_id) {
        const { error: journalError } = await supabase
          .from("journal_entries")
          .delete()
          .eq("id", deleteBillTarget.journal_entry_id)
          .eq("school_id", schoolId);

        if (journalError) throw journalError;
      }

      const { error: billError } = await supabase
        .from("purchase_bills")
        .delete()
        .eq("id", deleteBillTarget.id)
        .eq("school_id", schoolId);

      if (billError) throw billError;

      setDeleteBillTarget(null);
      setSuccess(
        "Purchase bill and its accounting entry deleted.",
      );
      await loadData(schoolId);
    } catch (e: any) {
      console.error(e);
      setError(e?.message || "Unable to delete purchase bill.");
    } finally {
      setDeletingBill(false);
    }
  }

  async function deletePayment() {
    if (!schoolId || !deletePaymentTarget) return;

    try {
      setDeletingPayment(true);
      setError("");

      if (deletePaymentTarget.journal_entry_id) {
        const { error: journalError } = await supabase
          .from("journal_entries")
          .delete()
          .eq("id", deletePaymentTarget.journal_entry_id)
          .eq("school_id", schoolId);

        if (journalError) throw journalError;
      }

      const { error: paymentError } = await supabase
        .from("vendor_payments")
        .delete()
        .eq("id", deletePaymentTarget.id)
        .eq("school_id", schoolId);

      if (paymentError) throw paymentError;

      setDeletePaymentTarget(null);
      setSuccess(
        "Vendor payment, its allocations and accounting entry deleted.",
      );
      await loadData(schoolId);
    } catch (e: any) {
      console.error(e);
      setError(e?.message || "Unable to delete vendor payment.");
    } finally {
      setDeletingPayment(false);
    }
  }

  async function openBillView(bill: BillView) {
    setViewBill(bill);
    setViewJournal([]);

    if (!bill.journal_entry_id || !schoolId) return;

    try {
      setViewLoading(true);

      const { data, error } = await supabase
        .from("journal_lines")
        .select(
          "id,debit,credit,description,account_name:accounts(name)",
        )
        .eq("journal_entry_id", bill.journal_entry_id)
        .eq("school_id", schoolId)
        .order("debit", { ascending: false });

      if (error) throw error;

      setViewJournal(
        (data || []) as unknown as JournalLineView[],
      );
    } catch (e: any) {
      console.error(e);
      setError(e?.message || "Unable to load accounting entry.");
    } finally {
      setViewLoading(false);
    }
  }

  function buildExport() {
    const stamp = today();

    if (tab === "outstanding") {
      return {
        fileName: `outstanding-payables-${periodLabel}-${stamp}`,
        title: "Vendor Outstanding Payables",
        table: {
          name: "Outstanding Payables",
          columns: [
            { label: "Vendor" },
            { label: "Bill No" },
            { label: "Bill Date" },
            { label: "Due Date" },
            { label: "Total", numeric: true },
            { label: "Paid", numeric: true },
            { label: "Outstanding", numeric: true },
            { label: "Status" },
          ] as ExportColumn[],
          rows: filteredUnpaidBills.map((bill) => [
            bill.vendorName,
            bill.bill_number || "-",
            bill.bill_date,
            bill.due_date || "-",
            money(Number(bill.total_amount || 0)),
            money(bill.paid),
            money(bill.outstanding),
            bill.overdue ? "Overdue" : bill.status,
          ]),
        } as ExportTable,
      };
    }

    if (tab === "bills") {
      return {
        fileName: `purchase-bills-${periodLabel}-${stamp}`,
        title: "Purchase Bills",
        table: {
          name: "Purchase Bills",
          columns: [
            { label: "Vendor" },
            { label: "Bill No" },
            { label: "Bill Date" },
            { label: "Due Date" },
            { label: "Items", numeric: true },
            { label: "Total", numeric: true },
            { label: "Paid", numeric: true },
            { label: "Outstanding", numeric: true },
            { label: "Status" },
          ] as ExportColumn[],
          rows: filteredBills.map((bill) => [
            bill.vendorName,
            bill.bill_number || "-",
            bill.bill_date,
            bill.due_date || "-",
            bill.items.length,
            money(Number(bill.total_amount || 0)),
            money(bill.paid),
            money(bill.outstanding),
            bill.overdue ? "Overdue" : bill.status,
          ]),
        } as ExportTable,
      };
    }

    if (tab === "payments") {
      return {
        fileName: `vendor-payments-${periodLabel}-${stamp}`,
        title: "Vendor Payments",
        table: {
          name: "Vendor Payments",
          columns: [
            { label: "Date" },
            { label: "Vendor" },
            { label: "Paid From" },
            { label: "Reference" },
            { label: "Amount", numeric: true },
            { label: "Bills Settled", numeric: true },
            { label: "Accounting" },
          ] as ExportColumn[],
          rows: filteredPayments.map((payment) => {
            const paidFrom = accounts.find(
              (a) => a.id === payment.paid_from_account_id,
            );

            return [
              payment.payment_date,
              vendorMap.get(payment.vendor_id)?.name || "Unknown vendor",
              paidFrom
                ? `${paidFrom.code ? `${paidFrom.code} - ` : ""}${paidFrom.name}`
                : "-",
              payment.reference_number || "-",
              money(payment.amount),
              allocations.filter((a) => a.payment_id === payment.id).length,
              payment.journal_entry_id ? "Posted" : "Not posted",
            ];
          }),
        } as ExportTable,
      };
    }

    if (tab === "vendors") {
      return {
        fileName: `vendors-${stamp}`,
        title: "Vendors",
        table: {
          name: "Vendors",
          columns: [
            { label: "Vendor" },
            { label: "Phone" },
            { label: "Email" },
            { label: "GSTIN" },
            { label: "Bills", numeric: true },
            { label: "Purchases", numeric: true },
            { label: "Outstanding", numeric: true },
          ] as ExportColumn[],
          rows: vendors
            .filter((vendor) => vendor.is_active)
            .map((vendor) => [
              vendor.name,
              vendor.phone || "-",
              vendor.email || "-",
              vendor.gstin || "-",
              statsByVendor[vendor.id]?.billCount || 0,
              money(statsByVendor[vendor.id]?.purchases || 0),
              money(statsByVendor[vendor.id]?.outstanding || 0),
            ]),
        } as ExportTable,
      };
    }

    const ledgerVendorName = ledgerVendorId
      ? vendorMap.get(ledgerVendorId)?.name || "Vendor"
      : "Vendor";

    return {
      fileName: `vendor-ledger-${ledgerVendorName}-${periodLabel}-${stamp}`,
      title: `Vendor Ledger — ${ledgerVendorName}`,
      table: {
        name: "Vendor Ledger",
        columns: [
          { label: "Date" },
          { label: "Particulars" },
          { label: "Type" },
          { label: "Purchase", numeric: true },
          { label: "Payment", numeric: true },
          { label: "Balance", numeric: true },
        ] as ExportColumn[],
        rows: ledgerRows.map((row) => [
          row.date,
          row.particulars,
          row.kind === "purchase"
            ? "Purchase"
            : row.kind === "payment"
              ? "Payment"
              : "Opening",
          row.purchase ? money(row.purchase) : "-",
          row.payment ? money(row.payment) : "-",
          money(row.balance),
        ]),
      } as ExportTable,
    };
  }

  function exportActiveTab(format: "pdf" | "excel" | "csv") {
    if (tab === "ledger" && !ledgerVendorId) {
      setError("Select a vendor to export their ledger.");
      return;
    }

    const { fileName, title, table } = buildExport();

    if (table.rows.length === 0) {
      setError("There is nothing to export for the current filter.");
      return;
    }

    setError("");

    if (format === "excel") {
      downloadWorkbook(fileName, table);
      return;
    }

    if (format === "pdf") {
      downloadTablePdf({
        fileName,
        title,
        subtitle: `${schoolName} — ${periodLabel} — ${table.rows.length} row(s)`,
        table,
      });
      return;
    }

    downloadCsv(fileName, table);
  }
  if (loading) {
    return (
      <main className="min-h-screen bg-slate-50 py-16">
        <div className="flex items-center justify-center gap-3 text-slate-500">
          <Loader2 size={20} className="animate-spin" />
          Loading vendor purchases...
        </div>
      </main>
    );
  }

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: "outstanding", label: "Outstanding Payables", icon: <Wallet size={15} /> },
    { key: "bills", label: "Purchase Bills", icon: <FileText size={15} /> },
    { key: "payments", label: "Vendor Payments", icon: <Banknote size={15} /> },
    { key: "vendors", label: "Vendors", icon: <Users size={15} /> },
    { key: "ledger", label: "Vendor Ledger", icon: <Landmark size={15} /> },
  ];

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="border-b bg-white">
        <div className="mx-auto max-w-7xl px-6 py-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
                <Truck size={24} className="text-emerald-600" />
                Vendor Purchases
              </h1>

              <p className="mt-1 text-sm text-slate-500">
                {schoolName} — purchase bills, vendor payments and outstanding payables.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => void refresh()}
                disabled={refreshing}
                className="inline-flex items-center gap-2 rounded-lg border bg-white px-4 py-2.5 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50"
              >
                <RefreshCw
                  size={16}
                  className={refreshing ? "animate-spin" : ""}
                />
                Refresh
              </button>

              <button
                onClick={openAddVendor}
                className="inline-flex items-center gap-2 rounded-lg border bg-white px-4 py-2.5 text-sm font-semibold hover:bg-slate-50"
              >
                <Users size={16} />
                Add Vendor
              </button>

              <button
                onClick={openBillModal}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700"
              >
                <Plus size={17} />
                New Bill
              </button>

              <button
                onClick={openPaymentModal}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
              >
                <Banknote size={17} />
                Record Payment
              </button>
            </div>
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card
              title="Total Payable"
              value={money(filteredOutstandingTotal)}
              sub={`${filteredUnpaidBills.length} unpaid bill(s) • ${periodLabel}`}
              icon={<Wallet size={18} />}
            />

            <Card
              title="Paid to Vendors"
              value={money(filteredPaidTotal)}
              sub={`${filteredPayments.length} payment(s) • ${periodLabel}`}
              icon={<Banknote size={18} />}
            />

            <Card
              title="Purchase Bills"
              value={money(filteredPurchasesTotal)}
              sub={`${filteredBills.length} bill(s) • ${periodLabel}`}
              icon={<Receipt size={18} />}
            />

            <Card
              title="Vendors"
              value={String(vendors.filter((v) => v.is_active).length)}
              sub="Active vendors"
              icon={<Users size={18} />}
            />
          </div>

          <div className="mt-6 flex flex-wrap gap-2">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold ${
                  tab === t.key
                    ? "bg-slate-900 text-white"
                    : "border bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>

          <div className="mt-5 flex flex-wrap items-end gap-3 rounded-xl border bg-slate-50 px-4 py-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
                Year
              </label>

              <select
                value={filterYear}
                onChange={(e) => setFilterYear(e.target.value)}
                className="input w-32"
              >
                <option value="">All years</option>

                {periodYears.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
                Month
              </label>

              <select
                value={filterMonth}
                onChange={(e) => setFilterMonth(e.target.value)}
                className="input w-40"
              >
                <option value="">All months</option>

                {MONTH_NAMES.map((name, index) => (
                  <option
                    key={name}
                    value={String(index + 1).padStart(2, "0")}
                  >
                    {name}
                  </option>
                ))}
              </select>
            </div>

            {filterActive && (
              <button
                onClick={() => {
                  setFilterYear("");
                  setFilterMonth("");
                }}
                className="inline-flex h-[38px] items-center gap-1.5 rounded-lg border bg-white px-3 text-sm font-semibold text-slate-600 hover:bg-slate-50"
              >
                <X size={15} />
                Clear
              </button>
            )}

            <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
              <span className="mr-1 inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500">
                <CalendarDays size={14} />
                {periodLabel}
              </span>

              <button
                onClick={() => exportActiveTab("pdf")}
                className="inline-flex items-center gap-1.5 rounded-lg border bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                <FileText size={15} />
                Export PDF
              </button>

              <button
                onClick={() => exportActiveTab("excel")}
                className="inline-flex items-center gap-1.5 rounded-lg border bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                <FileSpreadsheet size={15} />
                Export Excel
              </button>

              <button
                onClick={() => exportActiveTab("csv")}
                className="inline-flex items-center gap-1.5 rounded-lg border bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                <Download size={15} />
                CSV
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-6 py-6">
        {error && (
          <div className="mb-5 flex items-start justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            <div className="flex gap-2">
              <AlertCircle size={18} />
              <span>{error}</span>
            </div>

            <button onClick={() => setError("")}>
              <X size={16} />
            </button>
          </div>
        )}

        {success && (
          <div className="mb-5 flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={18} />
              <span>{success}</span>
            </div>

            <button onClick={() => setSuccess("")}>
              <X size={16} />
            </button>
          </div>
        )}

        {tab === "outstanding" && (
          <section className="overflow-hidden rounded-2xl border bg-white shadow-sm">
            <div className="flex items-center justify-between border-b px-5 py-4">
              <h2 className="font-bold text-slate-900">
                Outstanding Payables
              </h2>

              <span className="text-sm font-semibold text-slate-500">
                {periodLabel} total: {money(filteredOutstandingTotal)}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-[1050px] w-full">
                <thead className="bg-slate-50">
                  <tr className="border-b">
                    {["Vendor", "Bill No", "Bill Date", "Due Date", "Total", "Paid", "Outstanding", "Status", "Actions"].map(
                      (h, i) => (
                        <th
                          key={i}
                          className="px-5 py-4 text-left text-xs font-bold uppercase tracking-wide text-slate-500"
                        >
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>

                <tbody>
                  {filteredUnpaidBills.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-5 py-12 text-center text-sm text-slate-400">
                        {filterActive
                          ? `No outstanding payables for ${periodLabel}.`
                          : "No outstanding payables. All bills are settled."}
                      </td>
                    </tr>
                  ) : (
                    filteredUnpaidBills.map((bill) => (
                      <tr key={bill.id} className="border-b last:border-0 hover:bg-slate-50">
                        <td className="px-5 py-4 text-sm font-semibold text-slate-800">
                          {bill.vendorName}
                        </td>

                        <td className="px-5 py-4 text-sm text-slate-600">
                          {bill.bill_number || "-"}
                        </td>

                        <td className="px-5 py-4 text-sm text-slate-600">
                          {dateText(bill.bill_date)}
                        </td>

                        <td className={`px-5 py-4 text-sm ${bill.overdue ? "font-semibold text-red-600" : "text-slate-600"}`}>
                          {dateText(bill.due_date || "")}
                        </td>

                        <td className="px-5 py-4 text-sm text-slate-800">
                          {money(bill.total_amount)}
                        </td>

                        <td className="px-5 py-4 text-sm text-emerald-600">
                          {money(bill.paid)}
                        </td>

                        <td className="px-5 py-4 text-sm font-bold text-slate-900">
                          {money(bill.outstanding)}
                        </td>

                        <td className="px-5 py-4">
                          <span
                            className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${
                              bill.overdue
                                ? "bg-red-100 text-red-700"
                                : bill.status === "Partial"
                                  ? "bg-amber-100 text-amber-700"
                                  : "bg-slate-100 text-slate-600"
                            }`}
                          >
                            {bill.overdue ? "Overdue" : bill.status}
                          </span>
                        </td>

                        <td className="px-5 py-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => void openBillView(bill)}
                              className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                            >
                              <Eye size={14} />
                              View
                            </button>

                            <button
                              onClick={() => openEditBill(bill)}
                              className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                            >
                              <Pencil size={14} />
                              Edit
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}
        {tab === "bills" && (
          <section className="overflow-hidden rounded-2xl border bg-white shadow-sm">
            <div className="flex items-center justify-between border-b px-5 py-4">
              <h2 className="font-bold text-slate-900">Purchase Bills</h2>

              <button
                onClick={openBillModal}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
              >
                <Plus size={15} />
                New Bill
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-[1050px] w-full">
                <thead className="bg-slate-50">
                  <tr className="border-b">
                    {["Vendor", "Bill No", "Date", "Due Date", "Items", "Total", "Paid", "Status", "Actions"].map(
                      (h) => (
                        <th
                          key={h}
                          className="px-5 py-4 text-left text-xs font-bold uppercase tracking-wide text-slate-500"
                        >
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>

                <tbody>
                  {filteredBills.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-5 py-12 text-center text-sm text-slate-400">
                        {filterActive
                          ? `No purchase bills recorded for ${periodLabel}.`
                          : "No purchase bills yet. Click New Bill to record one."}
                      </td>
                    </tr>
                  ) : (
                    filteredBills.map((bill) => (
                      <tr key={bill.id} className="border-b last:border-0 hover:bg-slate-50">
                        <td className="px-5 py-4 text-sm font-semibold text-slate-800">
                          {bill.vendorName}
                        </td>

                        <td className="px-5 py-4 text-sm text-slate-600">
                          {bill.bill_number || "-"}
                        </td>

                        <td className="px-5 py-4 text-sm text-slate-600">
                          {dateText(bill.bill_date)}
                        </td>

                        <td className="px-5 py-4 text-sm text-slate-600">
                          {dateText(bill.due_date || "")}
                        </td>

                        <td className="px-5 py-4 text-sm text-slate-600">
                          {bill.items.length}
                        </td>

                        <td className="px-5 py-4 text-sm font-semibold text-slate-800">
                          {money(bill.total_amount)}
                        </td>

                        <td className="px-5 py-4 text-sm text-emerald-600">
                          {money(bill.paid)}
                        </td>

                        <td className="px-5 py-4">
                          <span
                            className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${
                              bill.overdue
                                ? "bg-red-100 text-red-700"
                                : bill.status === "Paid"
                                  ? "bg-emerald-100 text-emerald-700"
                                  : bill.status === "Partial"
                                    ? "bg-amber-100 text-amber-700"
                                    : "bg-slate-100 text-slate-600"
                            }`}
                          >
                            {bill.overdue ? "Overdue" : bill.status}
                          </span>
                        </td>

                        <td className="px-5 py-4">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => void openBillView(bill)}
                              className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                            >
                              <Eye size={14} />
                              View
                            </button>

                            <button
                              onClick={() => openEditBill(bill)}
                              className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                            >
                              <Pencil size={14} />
                              Edit
                            </button>

                            <button
                              onClick={() => setDeleteBillTarget(bill)}
                              className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50"
                            >
                              <Trash2 size={14} />
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {tab === "vendors" && (
          <section className="overflow-hidden rounded-2xl border bg-white shadow-sm">
            <div className="flex items-center justify-between border-b px-5 py-4">
              <h2 className="font-bold text-slate-900">Vendors</h2>

              <button
                onClick={openAddVendor}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
              >
                <Plus size={15} />
                Add Vendor
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-[1050px] w-full">
                <thead className="bg-slate-50">
                  <tr className="border-b">
                    {["Vendor", "Phone", "Email", "GSTIN", "Bills", "Purchases", "Outstanding", "Actions"].map(
                      (h) => (
                        <th
                          key={h}
                          className="px-5 py-4 text-left text-xs font-bold uppercase tracking-wide text-slate-500"
                        >
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>

                <tbody>
                  {vendors.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-5 py-12 text-center text-sm text-slate-400">
                        No vendors yet. Add your first vendor to start recording purchase bills.
                      </td>
                    </tr>
                  ) : (
                    vendors.map((vendor) => {
                      const stat = statsByVendor[vendor.id];

                      return (
                        <tr key={vendor.id} className="border-b last:border-0 hover:bg-slate-50">
                          <td className="px-5 py-4 text-sm font-semibold text-slate-800">
                            {vendor.name}
                            {!vendor.is_active && (
                              <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500">
                                Inactive
                              </span>
                            )}
                          </td>

                          <td className="px-5 py-4 text-sm text-slate-600">
                            {vendor.phone || "-"}
                          </td>

                          <td className="px-5 py-4 text-sm text-slate-600">
                            {vendor.email || "-"}
                          </td>

                          <td className="px-5 py-4 text-sm text-slate-600">
                            {vendor.gstin || "-"}
                          </td>

                          <td className="px-5 py-4 text-sm text-slate-600">
                            {stat ? `${stat.billCount} (${stat.unpaidCount} unpaid)` : "-"}
                          </td>

                          <td className="px-5 py-4 text-sm text-slate-800">
                            {stat ? money(stat.purchases) : "-"}
                          </td>

                          <td className="px-5 py-4 text-sm font-bold text-slate-900">
                            {stat ? money(stat.outstanding) : "-"}
                          </td>

                          <td className="px-5 py-4">
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => setDetailVendor(vendor)}
                                className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                              >
                                <Eye size={14} />
                                Details
                              </button>

                              <button
                                onClick={() => openEditVendor(vendor)}
                                className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                              >
                                Edit
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}
        {tab === "payments" && (
          <section className="overflow-hidden rounded-2xl border bg-white shadow-sm">
            <div className="flex items-center justify-between border-b px-5 py-4">
              <h2 className="font-bold text-slate-900">Vendor Payments</h2>

              <button
                onClick={openPaymentModal}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
              >
                <Plus size={15} />
                Record Payment
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-[1050px] w-full">
                <thead className="bg-slate-50">
                  <tr className="border-b">
                    {["Date", "Vendor", "Paid From", "Reference", "Amount", "Bills Settled", "Accounting", "Actions"].map(
                      (h) => (
                        <th
                          key={h}
                          className="px-5 py-4 text-left text-xs font-bold uppercase tracking-wide text-slate-500"
                        >
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>

                <tbody>
                  {filteredPayments.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-5 py-12 text-center text-sm text-slate-400">
                        {filterActive
                          ? `No vendor payments recorded for ${periodLabel}.`
                          : "No vendor payments yet."}
                      </td>
                    </tr>
                  ) : (
                    filteredPayments.map((payment) => {
                      const paymentAllocations = allocations.filter(
                        (a) => a.payment_id === payment.id,
                      );

                      const paidFrom = accounts.find(
                        (a) => a.id === payment.paid_from_account_id,
                      );

                      return (
                        <tr key={payment.id} className="border-b last:border-0 hover:bg-slate-50">
                          <td className="px-5 py-4 text-sm text-slate-600">
                            {dateText(payment.payment_date)}
                          </td>

                          <td className="px-5 py-4 text-sm font-semibold text-slate-800">
                            {vendorMap.get(payment.vendor_id)?.name || "Unknown vendor"}
                          </td>

                          <td className="px-5 py-4 text-sm text-slate-600">
                            {paidFrom
                              ? `${paidFrom.code ? `${paidFrom.code} - ` : ""}${paidFrom.name}`
                              : "-"}
                          </td>

                          <td className="px-5 py-4 text-sm text-slate-600">
                            {payment.reference_number || "-"}
                          </td>

                          <td className="px-5 py-4 text-sm font-bold text-slate-900">
                            {money(payment.amount)}
                          </td>

                          <td className="px-5 py-4 text-sm text-slate-600">
                            {paymentAllocations.length
                              ? `${paymentAllocations.length} bill(s)`
                              : "-"}
                          </td>

                          <td className="px-5 py-4 text-sm">
                            {payment.journal_entry_id ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                                <CheckCircle2 size={13} />
                                Posted
                              </span>
                            ) : (
                              <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500">
                                Not posted
                              </span>
                            )}
                          </td>

                          <td className="px-5 py-4">
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => openEditPayment(payment)}
                                className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                              >
                                <Pencil size={14} />
                                Edit
                              </button>

                              <button
                                onClick={() => setDeletePaymentTarget(payment)}
                                className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50"
                              >
                                <Trash2 size={14} />
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {tab === "ledger" && (
          <section className="overflow-hidden rounded-2xl border bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
              <h2 className="font-bold text-slate-900">Vendor Ledger</h2>

              <select
                value={ledgerVendorId}
                onChange={(e) => setLedgerVendorId(e.target.value)}
                className="input max-w-xs"
              >
                <option value="">Select a vendor...</option>

                {vendors.map((vendor) => (
                  <option key={vendor.id} value={vendor.id}>
                    {vendor.name}
                  </option>
                ))}
              </select>
            </div>

            {!ledgerVendorId ? (
              <div className="px-5 py-12 text-center text-sm text-slate-400">
                Select a vendor to view their purchase and payment history with the running outstanding balance.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-[900px] w-full">
                  <thead className="bg-slate-50">
                    <tr className="border-b">
                      {["Date", "Particulars", "Type", "Purchase", "Payment", "Balance"].map(
                        (h) => (
                          <th
                            key={h}
                            className="px-5 py-4 text-left text-xs font-bold uppercase tracking-wide text-slate-500"
                          >
                            {h}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>

                  <tbody>
                    {ledgerRows.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-5 py-12 text-center text-sm text-slate-400">
                          No purchases or payments recorded for this vendor yet.
                        </td>
                      </tr>
                    ) : (
                      ledgerRows.map((row, index) => (
                        <tr key={index} className="border-b last:border-0 hover:bg-slate-50">
                          <td className="px-5 py-4 text-sm text-slate-600">
                            {dateText(row.date)}
                          </td>

                          <td className="px-5 py-4 text-sm font-semibold text-slate-800">
                            {row.particulars}
                          </td>

                          <td className="px-5 py-4">
                            <span
                              className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${
                                row.kind === "purchase"
                                  ? "bg-blue-50 text-blue-700"
                                  : row.kind === "payment"
                                    ? "bg-emerald-50 text-emerald-700"
                                    : "bg-slate-100 text-slate-600"
                              }`}
                            >
                              {row.kind === "purchase"
                                ? "Purchase"
                                : row.kind === "payment"
                                  ? "Payment"
                                  : "Opening"}
                            </span>
                          </td>

                          <td className="px-5 py-4 text-sm text-blue-700">
                            {row.purchase ? money(row.purchase) : "-"}
                          </td>

                          <td className="px-5 py-4 text-sm text-emerald-600">
                            {row.payment ? money(row.payment) : "-"}
                          </td>

                          <td className="px-5 py-4 text-sm font-bold text-slate-900">
                            {money(row.balance)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </div>
      {showVendorModal && (
        <Modal
          title={editingVendor ? "Edit Vendor" : "Add Vendor"}
          onClose={() =>
            !savingVendor && setShowVendorModal(false)
          }
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Vendor Name *">
              <input
                value={vendorName}
                onChange={(e) => setVendorName(e.target.value)}
                placeholder="e.g. Sri Lakshmi Books"
                className="input"
              />
            </Field>

            <Field label="Phone">
              <input
                value={vendorPhone}
                onChange={(e) => setVendorPhone(e.target.value)}
                placeholder="Phone number"
                className="input"
              />
            </Field>

            <Field label="Email">
              <input
                value={vendorEmail}
                onChange={(e) => setVendorEmail(e.target.value)}
                placeholder="Email address"
                className="input"
              />
            </Field>

            <Field label="GSTIN">
              <input
                value={vendorGstin}
                onChange={(e) => setVendorGstin(e.target.value)}
                placeholder="GST identification number"
                className="input"
              />
            </Field>

            <div className="sm:col-span-2">
              <Field label="Address">
                <input
                  value={vendorAddress}
                  onChange={(e) => setVendorAddress(e.target.value)}
                  placeholder="Vendor address"
                  className="input"
                />
              </Field>
            </div>

            <div className="sm:col-span-2">
              <Field label="Notes">
                <input
                  value={vendorNotes}
                  onChange={(e) => setVendorNotes(e.target.value)}
                  placeholder="Any additional notes"
                  className="input"
                />
              </Field>
            </div>
          </div>

          <div className="mt-5 flex justify-end gap-3 border-t pt-5">
            <button
              onClick={() => setShowVendorModal(false)}
              className="rounded-lg border px-5 py-2.5 text-sm font-semibold"
            >
              Cancel
            </button>

            <button
              onClick={() => void saveVendor()}
              disabled={savingVendor}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {savingVendor ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <CheckCircle2 size={16} />
                  {editingVendor ? "Update Vendor" : "Add Vendor"}
                </>
              )}
            </button>
          </div>
        </Modal>
      )}

      {showBillModal && (
        <Modal
          title={editingBill ? "Edit Purchase Bill" : "Create Purchase Bill"}
          onClose={() => !savingBill && setShowBillModal(false)}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Vendor *">
              <select
                value={billVendorId}
                onChange={(e) => setBillVendorId(e.target.value)}
                className="input"
              >
                <option value="">Select vendor...</option>

                {vendors.map((vendor) => (
                  <option key={vendor.id} value={vendor.id}>
                    {vendor.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Bill / Invoice Number">
              <input
                value={billNumber}
                onChange={(e) => setBillNumber(e.target.value)}
                placeholder="Vendor invoice number"
                className="input"
              />
            </Field>

            <Field label="Bill Date *">
              <input
                type="date"
                value={billDate}
                onChange={(e) => setBillDate(e.target.value)}
                className="input"
              />
            </Field>

            <Field label="Due Date">
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="input"
              />
            </Field>
          </div>

          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between">
              <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
                Line Items
              </label>

              <button
                onClick={addLine}
                className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                <Plus size={13} />
                Add Line
              </button>
            </div>

            {lines.length === 0 ? (
              <div className="rounded-xl border border-dashed p-6 text-center text-sm text-slate-400">
                No line items. Click Add Line to begin.
              </div>
            ) : (
              <div className="space-y-3">
                {lines.map((line, index) => (
                  <div
                    key={index}
                    className="rounded-xl border bg-slate-50 p-3"
                  >
                    <div className="grid gap-3 sm:grid-cols-12">
                      <div className="sm:col-span-5">
                        <Field label="Description">
                          <input
                            value={line.description}
                            onChange={(e) =>
                              updateLine(index, {
                                description: e.target.value,
                              })
                            }
                            placeholder="Item description"
                            className="input"
                          />
                        </Field>
                      </div>

                      <div className="sm:col-span-3">
                        <Field label="Expense Account">
                          <select
                            value={line.accountId}
                            onChange={(e) =>
                              updateLine(index, {
                                accountId: e.target.value,
                              })
                            }
                            className="input"
                          >
                            <option value="">Select...</option>

                            {expenseAccounts.map((account) => (
                              <option
                                key={account.id}
                                value={account.id}
                              >
                                {account.code
                                  ? `${account.code} - `
                                  : ""}
                                {account.name}
                              </option>
                            ))}
                          </select>
                        </Field>
                      </div>

                      <div className="sm:col-span-1">
                        <Field label="Qty">
                          <input
                            type="number"
                            min="0"
                            step="0.001"
                            value={line.qty}
                            onChange={(e) =>
                              updateLine(index, {
                                qty: e.target.value,
                              })
                            }
                            className="input"
                          />
                        </Field>
                      </div>

                      <div className="sm:col-span-2">
                        <Field label="Unit Price">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={line.price}
                            onChange={(e) =>
                              updateLine(index, {
                                price: e.target.value,
                              })
                            }
                            className="input"
                          />
                        </Field>
                      </div>

                      <div className="flex items-end justify-between gap-2 sm:col-span-1">
                        <div className="text-sm font-bold text-slate-800">
                          {money(
                            Number(line.qty || 0) *
                              Number(line.price || 0),
                          )}
                        </div>

                        <button
                          onClick={() => removeLine(index)}
                          className="rounded-lg p-1.5 text-red-500 hover:bg-red-50"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-3 flex items-center justify-between rounded-xl bg-slate-900 px-4 py-3 text-white">
              <span className="text-sm font-semibold">
                Bill Total
              </span>

              <span className="text-lg font-bold">
                {money(billTotal)}
              </span>
            </div>
          </div>

          <div className="mt-4">
            <Field label="Notes">
              <input
                value={billNotes}
                onChange={(e) => setBillNotes(e.target.value)}
                placeholder="Optional notes"
                className="input"
              />
            </Field>
          </div>

          <div className="mt-4 rounded-xl bg-emerald-50 p-3 text-xs text-emerald-700">
            {editingBill
              ? `On save: the existing accounting entry is removed and re-posted as Dr Expense accounts / Cr Vendor Payables for ${money(billTotal)}.`
              : `On save: Dr Expense accounts / Cr Vendor Payables will be posted automatically for ${money(billTotal)}.`}
          </div>

          <div className="mt-5 flex justify-end gap-3 border-t pt-5">
            <button
              onClick={() => setShowBillModal(false)}
              className="rounded-lg border px-5 py-2.5 text-sm font-semibold"
            >
              Cancel
            </button>

            <button
              onClick={() => void createBill()}
              disabled={savingBill}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-6 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {savingBill ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <CheckCircle2 size={16} />
                  {editingBill ? "Update Bill" : "Save Bill"}
                </>
              )}
            </button>
          </div>
        </Modal>
      )}
      {showPaymentModal && (
        <Modal
          title={
            editingPayment ? "Edit Vendor Payment" : "Record Vendor Payment"
          }
          onClose={() =>
            !savingPayment && setShowPaymentModal(false)
          }
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Vendor *">
              <select
                value={payVendorId}
                onChange={(e) => setPayVendorId(e.target.value)}
                className="input"
              >
                <option value="">Select vendor...</option>

                {vendors.map((vendor) => (
                  <option key={vendor.id} value={vendor.id}>
                    {vendor.name}
                    {payVendorSelectOutstanding[vendor.id]
                      ? ` — ${money(payVendorSelectOutstanding[vendor.id])} due`
                      : ""}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Payment Date *">
              <input
                type="date"
                value={payDate}
                onChange={(e) => setPayDate(e.target.value)}
                className="input"
              />
            </Field>

            <Field label="Amount *">
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                placeholder="Full or partial amount"
                className="input"
              />
            </Field>

            <Field label="Paid From (Cash / Bank) *">
              <select
                value={payAccountId}
                onChange={(e) => setPayAccountId(e.target.value)}
                className="input"
              >
                <option value="">Select account...</option>

                {payAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.code ? `${account.code} - ` : ""}
                    {account.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Payment Reference">
              <input
                value={payReference}
                onChange={(e) => setPayReference(e.target.value)}
                placeholder="Cheque / UPI / transaction reference"
                className="input"
              />
            </Field>

            <Field label="Notes">
              <input
                value={payNotes}
                onChange={(e) => setPayNotes(e.target.value)}
                placeholder="Optional notes"
                className="input"
              />
            </Field>
          </div>

          {payVendorId && (
            <div className="mt-4 rounded-xl border bg-slate-50 p-4">
              <div className="flex items-center justify-between text-sm">
                <span className="font-semibold text-slate-700">
                  Outstanding payable
                </span>

                <span className="font-bold text-slate-900">
                  {money(payVendorOutstanding)}
                </span>
              </div>

              {payVendorOldestBills.length > 0 ? (
                <div className="mt-3 space-y-1 text-xs text-slate-500">
                  <div className="font-semibold uppercase tracking-wide">
                    Allocation order (oldest first)
                  </div>

                  {payVendorOldestBills.map((bill) => (
                    <div
                      key={bill.id}
                      className="flex justify-between"
                    >
                      <span>
                        {bill.bill_number || "Bill"} — due{" "}
                        {dateText(bill.due_date || bill.bill_date)}
                      </span>

                      <span>{money(bill.outstanding)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-2 text-xs text-amber-600">
                  This vendor has no outstanding bills.
                </div>
              )}
            </div>
          )}

          <div className="mt-4 rounded-xl bg-blue-50 p-3 text-xs text-blue-700">
            {editingPayment
              ? "On save: the previous accounting entry is removed, the allocations are rebuilt oldest first, and a corrected Dr Vendor Payables / Cr Cash-Bank entry is posted."
              : "On save: Dr Vendor Payables / Cr Cash-Bank will be posted automatically and the amount allocated to the oldest outstanding bills."}
          </div>

          <div className="mt-5 flex justify-end gap-3 border-t pt-5">
            <button
              onClick={() => setShowPaymentModal(false)}
              className="rounded-lg border px-5 py-2.5 text-sm font-semibold"
            >
              Cancel
            </button>

            <button
              onClick={() => void recordPayment()}
              disabled={savingPayment}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {savingPayment ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <CheckCircle2 size={16} />
                  {editingPayment ? "Update Payment" : "Record Payment"}
                </>
              )}
            </button>
          </div>
        </Modal>
      )}

      {viewBill && (
        <Modal
          title="Purchase Bill"
          onClose={() => {
            setViewBill(null);
            setViewJournal([]);
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Info label="Vendor" value={viewBill.vendorName} />
            <Info
              label="Bill / Invoice No"
              value={viewBill.bill_number || "-"}
            />
            <Info label="Bill Date" value={dateText(viewBill.bill_date)} />
            <Info
              label="Due Date"
              value={dateText(viewBill.due_date || "")}
            />
            <Info label="Status" value={viewBill.overdue ? "Overdue" : viewBill.status} />
            <Info label="Notes" value={viewBill.notes || "-"} />
          </div>

          <div className="mt-5">
            <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">
              Line Items
            </div>

            <div className="overflow-hidden rounded-xl border">
              <table className="w-full">
                <thead className="bg-slate-50">
                  <tr className="border-b">
                    <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                      Description
                    </th>

                    <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-slate-500">
                      Qty
                    </th>

                    <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-slate-500">
                      Unit Price
                    </th>

                    <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-slate-500">
                      Amount
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {viewBill.items.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-6 text-center text-sm text-slate-400">
                        No line items.
                      </td>
                    </tr>
                  ) : (
                    viewBill.items.map((item) => (
                      <tr key={item.id} className="border-b last:border-0">
                        <td className="px-4 py-3 text-sm text-slate-700">
                          {item.description ||
                            accounts.find(
                              (a) => a.id === item.expense_account_id,
                            )?.name ||
                            "-"}
                        </td>

                        <td className="px-4 py-3 text-right text-sm text-slate-600">
                          {Number(item.quantity || 0)}
                        </td>

                        <td className="px-4 py-3 text-right text-sm text-slate-600">
                          {money(Number(item.unit_price || 0))}
                        </td>

                        <td className="px-4 py-3 text-right text-sm font-semibold text-slate-800">
                          {money(Number(item.amount || 0))}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>

                <tfoot className="bg-slate-50">
                  <tr>
                    <td colSpan={3} className="px-4 py-3 text-right text-sm font-bold text-slate-700">
                      Total
                    </td>

                    <td className="px-4 py-3 text-right text-sm font-bold text-slate-900">
                      {money(viewBill.total_amount)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <Info label="Total" value={money(viewBill.total_amount)} />
            <Info label="Paid" value={money(viewBill.paid)} />
            <Info label="Outstanding" value={money(viewBill.outstanding)} />
          </div>

          <div className="mt-5">
            <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">
              Accounting Entry (Dr Expense / Cr Vendor Payables)
            </div>

            {viewLoading ? (
              <div className="flex items-center gap-2 rounded-xl bg-slate-50 p-4 text-sm text-slate-500">
                <Loader2 size={16} className="animate-spin" />
                Loading accounting entry...
              </div>
            ) : viewJournal.length === 0 ? (
              <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-400">
                No accounting entry linked.
              </div>
            ) : (
              <div className="space-y-2">
                {viewJournal.map((line) => (
                  <div
                    key={line.id}
                    className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 text-sm"
                  >
                    <div>
                      <div className="font-semibold text-slate-800">
                        {Number(line.debit || 0) > 0 ? "Dr" : "Cr"}{" "}
                        {line.account_name || "Account"}
                      </div>

                      <div className="text-xs text-slate-500">
                        {line.description || ""}
                      </div>
                    </div>

                    <div className="font-bold text-slate-900">
                      {money(
                        Number(line.debit || 0) > 0
                          ? line.debit
                          : line.credit,
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Modal>
      )}
      {detailVendor && (
        <Modal
          title="Vendor Details"
          onClose={() => setDetailVendor(null)}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Info label="Vendor" value={detailVendor.name} />
            <Info label="Phone" value={detailVendor.phone || "-"} />
            <Info label="Email" value={detailVendor.email || "-"} />
            <Info label="GSTIN" value={detailVendor.gstin || "-"} />
            <Info label="Address" value={detailVendor.address || "-"} />
            <Info label="Notes" value={detailVendor.notes || "-"} />
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            <Info
              label="Total Purchases"
              value={money(statsByVendor[detailVendor.id]?.purchases || 0)}
            />

            <Info
              label="Total Paid"
              value={money(statsByVendor[detailVendor.id]?.paid || 0)}
            />

            <Info
              label="Outstanding"
              value={money(statsByVendor[detailVendor.id]?.outstanding || 0)}
            />
          </div>

          <div className="mt-5">
            <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">
              Recent Bills
            </div>

            <div className="overflow-hidden rounded-xl border">
              {billViews.filter((b) => b.vendor_id === detailVendor.id)
                .length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-slate-400">
                  No bills recorded for this vendor.
                </div>
              ) : (
                <table className="w-full">
                  <thead className="bg-slate-50">
                    <tr className="border-b">
                      <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                        Bill No
                      </th>

                      <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                        Date
                      </th>

                      <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-slate-500">
                        Total
                      </th>

                      <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-slate-500">
                        Outstanding
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {billViews
                      .filter((b) => b.vendor_id === detailVendor.id)
                      .slice(0, 8)
                      .map((bill) => (
                        <tr key={bill.id} className="border-b last:border-0">
                          <td className="px-4 py-3 text-sm text-slate-700">
                            {bill.bill_number || "-"}
                          </td>

                          <td className="px-4 py-3 text-sm text-slate-600">
                            {dateText(bill.bill_date)}
                          </td>

                          <td className="px-4 py-3 text-right text-sm text-slate-800">
                            {money(bill.total_amount)}
                          </td>

                          <td className="px-4 py-3 text-right text-sm font-semibold text-slate-900">
                            {money(bill.outstanding)}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="mt-5 flex justify-end gap-3 border-t pt-5">
            <button
              onClick={() => setDetailVendor(null)}
              className="rounded-lg border px-5 py-2.5 text-sm font-semibold"
            >
              Close
            </button>

            <button
              onClick={() => {
                setLedgerVendorId(detailVendor.id);
                setDetailVendor(null);
                setTab("ledger");
              }}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white"
            >
              <Landmark size={15} />
              View Ledger
            </button>
          </div>
        </Modal>
      )}

      {deleteBillTarget && (
        <Modal
          title="Delete Purchase Bill"
          onClose={() =>
            !deletingBill && setDeleteBillTarget(null)
          }
        >
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            This will delete the purchase bill, its line items and its
            linked accounting entry. Bills with payments allocated to
            them cannot be deleted.
          </div>

          <div className="mt-4 rounded-xl bg-slate-50 p-4">
            <div className="font-semibold">
              {deleteBillTarget.vendorName}
            </div>

            <div className="mt-1 text-sm text-slate-500">
              {deleteBillTarget.bill_number || "Bill"} —{" "}
              {dateText(deleteBillTarget.bill_date)} —{" "}
              {money(deleteBillTarget.total_amount)}
            </div>
          </div>

          <div className="mt-5 flex justify-end gap-3 border-t pt-5">
            <button
              onClick={() => setDeleteBillTarget(null)}
              className="rounded-lg border px-5 py-2.5 text-sm font-semibold"
            >
              Cancel
            </button>

            <button
              onClick={() => void deleteBill()}
              disabled={deletingBill}
              className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-6 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {deletingBill ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 size={16} />
                  Delete Bill
                </>
              )}
            </button>
          </div>
        </Modal>
      )}

      {deletePaymentTarget && (
        <Modal
          title="Delete Vendor Payment"
          onClose={() =>
            !deletingPayment && setDeletePaymentTarget(null)
          }
        >
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            This will delete the vendor payment, its bill allocations
            and its linked accounting entry.
          </div>

          <div className="mt-4 rounded-xl bg-slate-50 p-4">
            <div className="font-semibold">
              {vendorMap.get(deletePaymentTarget.vendor_id)?.name ||
                "Vendor"}
            </div>

            <div className="mt-1 text-sm text-slate-500">
              {dateText(deletePaymentTarget.payment_date)} —{" "}
              {money(deletePaymentTarget.amount)}
            </div>
          </div>

          <div className="mt-5 flex justify-end gap-3 border-t pt-5">
            <button
              onClick={() => setDeletePaymentTarget(null)}
              className="rounded-lg border px-5 py-2.5 text-sm font-semibold"
            >
              Cancel
            </button>

            <button
              onClick={() => void deletePayment()}
              disabled={deletingPayment}
              className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-6 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {deletingPayment ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 size={16} />
                  Delete Payment
                </>
              )}
            </button>
          </div>
        </Modal>
      )}

      <style>{`
        .input {
          width: 100%;
          border: 1px solid rgb(203 213 225);
          border-radius: .5rem;
          background: white;
          padding: .65rem .75rem;
          font-size: .875rem;
          outline: none;
        }

        .input:focus {
          border-color: rgb(59 130 246);
          box-shadow: 0 0 0 3px rgb(219 234 254);
        }
      `}</style>
    </main>
  );
}

function Card({
  title,
  value,
  sub,
  icon,
}: {
  title: string;
  value: string;
  sub: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border bg-white p-5 shadow-sm">
      <div className="flex justify-between">
        <div>
          <div className="text-xs font-bold uppercase tracking-wide text-slate-400">
            {title}
          </div>

          <div className="mt-2 text-2xl font-bold text-slate-900">
            {value}
          </div>

          <div className="mt-1 text-xs text-slate-500">
            {sub}
          </div>
        </div>

        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
          {icon}
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
        {label}
      </label>

      {children}
    </div>
  );
}

function Info({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </div>

      <div className="mt-1 text-sm font-semibold text-slate-800">
        {value}
      </div>
    </div>
  );
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
      <div className="max-h-[92vh] w-full max-w-4xl overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <h2 className="text-lg font-bold text-slate-900">
            {title}
          </h2>

          <button
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"
          >
            <X size={19} />
          </button>
        </div>

        <div className="max-h-[calc(92vh-73px)] overflow-y-auto p-6">
          {children}
        </div>
      </div>
    </div>
  );
}