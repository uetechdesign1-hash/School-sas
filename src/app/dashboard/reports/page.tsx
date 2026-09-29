/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

/*
|----------------------------------------------------------------------------
| Statistics - Income & Expenditure
|----------------------------------------------------------------------------
| Pure statistics: no accounting forms, no ledger links, no navigation into
| the books. The numbers still come from the same source of truth the ledger
| uses so the story can never disagree with the books:
|
|   canonical : journal_entries -> journal_lines
|   legacy    : transactions -> transaction_entries, but only the rows the
|               canonical bridge (legacy_superseded_transactions and the
|               journal reference_id) has not already represented.
|
| Filters: any academic year (or All Years) and, inside a year, a single
| month. Every tile, bar and ring below recalculates for that selection.
|
| Look & feel: iOS style - frosted glass panels over a soft wallpaper, one
| accent per idea, system font, gentle depth instead of loud colour blocks.
*/

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  type LucideIcon,
  Award,
  Banknote,
  BarChart3,
  CalendarRange,
  CircleDollarSign,
  Coins,
  Flame,
  GraduationCap,
  IndianRupee,
  Landmark,
  Layers,
  Loader2,
  Percent,
  PiggyBank,
  Printer,
  Receipt,
  RefreshCw,
  Scale,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Trophy,
  Users,
  Wallet,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { getCurrentSchoolId } from "@/lib/supabase/current-school";

/* ------------------------------------------------------------------ types */

type AcademicYear = {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  is_current: boolean;
};

type Account = {
  id: string;
  name: string;
  account_type: string;
};

type Journal = {
  id: string;
  entry_date: string;
  reference_id: string | null;
};

type JournalLine = {
  journal_entry_id: string;
  account_id: string;
  debit: number | string | null;
  credit: number | string | null;
};

type LegacyTxn = { id: string; transaction_date: string };

type LegacyEntry = {
  transaction_id: string;
  account_id: string;
  debit: number | string | null;
  credit: number | string | null;
};

type Posting = {
  date: string;
  kind: "income" | "expense";
  accountName: string;
  entryId: string;
  amount: number;
};

type Slice = {
  name: string;
  amount: number;
  percentage: number;
  color: string;
};

type Bucket = {
  key: string;
  label: string;
  income: number;
  expense: number;
  net: number;
};

type YearOption = {
  id: string;
  label: string;
  subLabel: string;
  start: string;
  end: string;
  isCurrent: boolean;
  isAll: boolean;
};

type Summary = {
  income: number;
  expense: number;
  net: number;
  buckets: Bucket[];
  granularity: "month" | "year";
  focusKey: string | null;
  maxBucket: number;
  incomeHeads: Slice[];
  expenseHeads: Slice[];
  incomeVouchers: number;
  expenseVouchers: number;
  elapsedBuckets: number;
};

type Segment = {
  id: string;
  label: string;
  hint?: string;
};

/* --------------------------------------------------------------- palette */

/* Apple system colours: one accent per idea, never more. */
const INCOME = "#30D158";
const EXPENSE = "#FF453A";

const PALETTE = [
  "#0A84FF",
  "#30D158",
  "#FF9F0A",
  "#FF375F",
  "#5E5CE6",
  "#64D2FF",
  "#FFD60A",
  "#BF5AF2",
  "#40C8E0",
  "#FF453A",
  "#34C759",
  "#AC8E68",
];

const ALL = "__all__";
const ALL_YEARS_ID = "__all_years__";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/* iOS system stack - the page reads like a native screen. */
const SCREEN: CSSProperties = {
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Segoe UI Variable Display", "Segoe UI", Inter, Roboto, "Helvetica Neue", Arial, sans-serif',
  letterSpacing: "-0.01em",
};

/* --------------------------------------------------------------- helpers */

function toNum(value: number | string | null | undefined) {
  return Number(value || 0) || 0;
}

const INR_FORMAT = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

function money(value: number) {
  return INR_FORMAT.format(Math.round(Number(value || 0)));
}

function shortMoney(value: number) {
  const num = Number(value || 0);
  const sign = num < 0 ? "-" : "";
  const abs = Math.abs(num);

  if (abs >= 10000000) return `${sign}\u20B9${(abs / 10000000).toFixed(2)}Cr`;
  if (abs >= 100000) return `${sign}\u20B9${(abs / 100000).toFixed(1)}L`;
  if (abs >= 1000) return `${sign}\u20B9${(abs / 1000).toFixed(1)}K`;

  return `${sign}\u20B9${abs.toFixed(0)}`;
}

function percent(value: number) {
  if (!Number.isFinite(value)) return "0%";

  return `${value < 0 ? "-" : ""}${Math.abs(value).toFixed(1)}%`;
}

function share(part: number, whole: number) {
  if (!whole) return 0;

  return (part / whole) * 100;
}

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function toISO(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function fromISO(value: string) {
  return new Date(`${value}T00:00:00`);
}

function prettyDate(value: string) {
  if (!value) return "-";

  return fromISO(value).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/* Indian financial year starts on 1 April. */
function fiscalStartOf(value: string) {
  const date = fromISO(value);

  return new Date(
    date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1,
    3,
    1,
  );
}

function fiscalLabel(start: Date) {
  return `FY ${start.getFullYear()}-${String(
    (start.getFullYear() + 1) % 100,
  ).padStart(2, "0")}`;
}

function monthLabelOf(date: Date) {
  return `${MONTHS[date.getMonth()]} '${String(date.getFullYear()).slice(2)}`;
}

/* "2025-04" -> "Apr" / "April 2025" - the month filter chips and header. */
function monthName(key: string) {
  return MONTHS[Number(key.slice(5, 7)) - 1] || key;
}

function monthNameLong(key: string) {
  const index = Number(key.slice(5, 7)) - 1;

  if (Number.isNaN(index) || index < 0) return key;

  return new Date(Number(key.slice(0, 4)), index, 1).toLocaleDateString(
    "en-IN",
    { month: "long", year: "numeric" },
  );
}

/*
 * A single session is read month by month. "All years" (any period longer
 * than 15 months) is grouped by financial year so the page never turns into
 * an unreadable wall of bars.
 */
function spanGranularity(start: string, end: string): "month" | "year" {
  const startDate = fromISO(start);
  const endDate = fromISO(end);

  const spanMonths =
    (endDate.getFullYear() - startDate.getFullYear()) * 12 +
    (endDate.getMonth() - startDate.getMonth()) +
    1;

  return spanMonths <= 15 ? "month" : "year";
}

/* ------------------------------------------------------------- summarise */

/*
 * focusKey narrows the headline figures to a single bucket (one month) while
 * the bar chart keeps every bucket, so the picked month stays in context
 * instead of being shown alone. Null means the whole period.
 */
function summarize(
  postings: Posting[],
  start: string,
  end: string,
  focusKey: string | null = null,
): Summary {
  const scoped = postings.filter((p) => p.date >= start && p.date <= end);

  const startDate = fromISO(start);
  const endDate = fromISO(end);

  const granularity = spanGranularity(start, end);

  const keys: { key: string; label: string }[] = [];

  if (granularity === "month") {
    const cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1);

    while (cursor <= endDate) {
      keys.push({
        key: `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(
          2,
          "0",
        )}`,
        label: monthLabelOf(cursor),
      });

      cursor.setMonth(cursor.getMonth() + 1);
    }
  } else {
    let cursor = fiscalStartOf(start);
    const last = fiscalStartOf(end);

    while (cursor <= last) {
      keys.push({ key: toISO(cursor), label: fiscalLabel(cursor) });
      cursor = new Date(cursor.getFullYear() + 1, 3, 1);
    }
  }

  const bucketMap = new Map<string, Bucket>(
    keys.map((entry) => [
      entry.key,
      { ...entry, income: 0, expense: 0, net: 0 },
    ]),
  );

  const incomeHeads = new Map<string, number>();
  const expenseHeads = new Map<string, number>();
  const incomeVouchers = new Set<string>();
  const expenseVouchers = new Set<string>();

  let income = 0;
  let expense = 0;

  for (const posting of scoped) {
    const key =
      granularity === "month"
        ? posting.date.slice(0, 7)
        : toISO(fiscalStartOf(posting.date));

    const bucket = bucketMap.get(key);
    if (!bucket) continue;

    /* The bars always keep the full period. */
    if (posting.kind === "income") bucket.income += posting.amount;
    else bucket.expense += posting.amount;

    /* Headlines, rings and facts follow the active month filter. */
    if (focusKey !== null && key !== focusKey) continue;

    /* Signed amounts: a contra posting lowers the head it belongs to. */
    if (posting.kind === "income") {
      income += posting.amount;
      incomeVouchers.add(posting.entryId);
      incomeHeads.set(
        posting.accountName,
        toNum(incomeHeads.get(posting.accountName)) + posting.amount,
      );
    } else {
      expense += posting.amount;
      expenseVouchers.add(posting.entryId);
      expenseHeads.set(
        posting.accountName,
        toNum(expenseHeads.get(posting.accountName)) + posting.amount,
      );
    }
  }

  const buckets = keys
    .map((entry) => bucketMap.get(entry.key) as Bucket)
    .map((bucket) => ({ ...bucket, net: bucket.income - bucket.expense }));

  const toSlices = (map: Map<string, number>): Slice[] => {
    /* Only heads that net out positive can be drawn as a slice; a net
     * contra head (returns exceeding charges) stays inside the grand total. */
    const rows = [...map.entries()]
      .filter(([, amount]) => amount > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([name, amount]) => ({ name, amount }));

    const total = rows.reduce((sum, row) => sum + row.amount, 0);
    const top = rows.slice(0, 7);
    const rest = rows.slice(7).reduce((sum, row) => sum + row.amount, 0);

    return top
      .map((row, index) => ({
        ...row,
        color: PALETTE[index % PALETTE.length],
        percentage: share(row.amount, total),
      }))
      .concat(
        rest > 0
          ? [
              {
                name: "Other heads",
                amount: rest,
                color: "#94A3B8",
                percentage: share(rest, total),
              },
            ]
          : [],
      );
  };

  const today = toISO(new Date());

  return {
    income,
    expense,
    net: income - expense,
    buckets,
    granularity,
    focusKey,
    maxBucket: Math.max(
      1,
      ...buckets.map((bucket) => Math.max(bucket.income, bucket.expense)),
    ),
    incomeHeads: toSlices(incomeHeads),
    expenseHeads: toSlices(expenseHeads),
    incomeVouchers: incomeVouchers.size,
    expenseVouchers: expenseVouchers.size,
    elapsedBuckets: focusKey
      ? 1
      : Math.max(
          1,
          buckets.filter(
            (bucket) =>
              (granularity === "month" ? `${bucket.key}-01` : bucket.key) <=
              today,
          ).length,
        ),
  };
}

/* ------------------------------------------------------------------ page */

export default function StatisticsPage() {
  /* One stable Supabase browser client for the lifetime of the page. */
  const supabase = useMemo(() => createClient(), []);

  const [schoolName, setSchoolName] = useState("");
  const [academicYears, setAcademicYears] = useState<AcademicYear[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [journals, setJournals] = useState<Journal[]>([]);
  const [journalLines, setJournalLines] = useState<JournalLine[]>([]);
  const [legacyTxns, setLegacyTxns] = useState<LegacyTxn[]>([]);
  const [legacyEntries, setLegacyEntries] = useState<LegacyEntry[]>([]);
  const [legacyEnabled, setLegacyEnabled] = useState(false);
  const [supersededIds, setSupersededIds] = useState<Set<string>>(new Set());
  const [studentCount, setStudentCount] = useState(0);
  const [staffCount, setStaffCount] = useState(0);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedYear, setSelectedYear] = useState("");
  const [selectedMonth, setSelectedMonth] = useState(ALL);

  /*
   * loadReport only touches state after an await, so mounting it never causes
   * a cascading render. The spinner is turned on by the click handlers below.
   */
  const loadReport = useCallback(async () => {
    try {
      const schoolId = await getCurrentSchoolId();

      const [
        schoolResult,
        yearResult,
        accountResult,
        journalResult,
        lineResult,
        studentResult,
        staffResult,
      ] = await Promise.all([
        supabase
          .from("schools")
          .select("id, name")
          .eq("id", schoolId)
          .maybeSingle(),

        supabase
          .from("academic_years")
          .select("id, name, start_date, end_date, is_current")
          .eq("school_id", schoolId)
          .order("start_date", { ascending: true }),

        supabase
          .from("accounts")
          .select("id, name, account_type")
          .eq("school_id", schoolId),

        supabase
          .from("journal_entries")
          .select("id, entry_date, reference_id")
          .eq("school_id", schoolId),

        supabase
          .from("journal_lines")
          .select("journal_entry_id, account_id, debit, credit")
          .eq("school_id", schoolId),

        supabase
          .from("students")
          .select("id", { count: "exact", head: true })
          .eq("school_id", schoolId),

        supabase
          .from("staff")
          .select("id", { count: "exact", head: true })
          .eq("school_id", schoolId),
      ]);

      if (yearResult.error) {
        throw new Error(`Unable to load academic years: ${yearResult.error.message}`);
      }

      if (accountResult.error) {
        throw new Error(`Unable to load accounts: ${accountResult.error.message}`);
      }

      if (journalResult.error) {
        throw new Error(`Unable to load journal entries: ${journalResult.error.message}`);
      }

      if (lineResult.error) {
        throw new Error(`Unable to load journal lines: ${lineResult.error.message}`);
      }

      /*
       * The legacy books (and the canonical bridge view) are optional: older
       * schools still have rows in them, brand new schools do not. A missing
       * table must never break the report - the journal alone is complete.
       */
      const [txnResult, entryResult, supersededResult] = await Promise.all([
        supabase
          .from("transactions")
          .select("id, transaction_date")
          .eq("school_id", schoolId),

        supabase
          .from("transaction_entries")
          .select("transaction_id, account_id, debit, credit")
          .eq("school_id", schoolId),

        supabase
          .from("legacy_superseded_transactions")
          .select("transaction_id")
          .eq("school_id", schoolId),
      ]);

      setSchoolName(schoolResult.data?.name || "");
      setAcademicYears((yearResult.data || []) as AcademicYear[]);
      setAccounts((accountResult.data || []) as Account[]);
      setJournals((journalResult.data || []) as Journal[]);
      setJournalLines((lineResult.data || []) as JournalLine[]);
      setStudentCount(studentResult.count || 0);
      setStaffCount(staffResult.count || 0);

      setLegacyTxns((txnResult.data || []) as LegacyTxn[]);
      setLegacyEntries((entryResult.data || []) as LegacyEntry[]);
      setLegacyEnabled(!txnResult.error && !entryResult.error);
      setSupersededIds(
        new Set(
          (supersededResult.data || []).map((row: any) =>
            String(row.transaction_id),
          ),
        ),
      );
    } catch (loadError: any) {
      console.error("STATISTICS ERROR:", loadError);

      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load the statistics.",
      );
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  /* Reload button: flips the spinner from an event handler, then refetches. */
  function refreshReport() {
    setLoading(true);
    setError("");

    void loadReport();
  }

  useEffect(() => {
    /*
     * Wrapped so the first paint is never blocked: every setState inside
     * loadReport runs after its awaits, i.e. outside this effect body.
     */
    void (async () => {
      await loadReport();
    })();
  }, [loadReport]);

  /*
   * Flatten every money movement into income / expense postings. Income is the
   * credit side of Income accounts, expense is the debit side of Expense
   * accounts - exactly how the books read them.
   */
  const postings = useMemo<Posting[]>(() => {
    const accountById = new Map(
      accounts.map((account) => [account.id, account]),
    );

    const rows: Posting[] = [];

    const pushRow = (
      kind: "income" | "expense",
      accountId: string,
      entryId: string,
      date: string,
      amount: number,
    ) => {
      const account = accountById.get(accountId);

      /*
       * The amount is signed (credit - debit for income, debit - credit for
       * expense) so contra postings such as purchase returns net the figures
       * down instead of inflating them.
       */
      if (
        !account ||
        account.account_type.toLowerCase() !== kind ||
        amount === 0
      ) {
        return;
      }

      rows.push({
        kind,
        accountName: account.name || "Unnamed account",
        entryId,
        date,
        amount,
      });
    };

    const journalDate = new Map(
      journals.map((journal) => [journal.id, journal.entry_date]),
    );

    /* Journals created by the legacy bridge point back at their old txn. */
    const legacyBridge = new Map(
      journals
        .filter((journal) => journal.reference_id)
        .map((journal) => [String(journal.reference_id), journal.id]),
    );

    for (const line of journalLines) {
      const date = journalDate.get(line.journal_entry_id);
      if (!date) continue;

      pushRow(
        "income",
        line.account_id,
        line.journal_entry_id,
        date,
        toNum(line.credit) - toNum(line.debit),
      );

      pushRow(
        "expense",
        line.account_id,
        line.journal_entry_id,
        date,
        toNum(line.debit) - toNum(line.credit),
      );
    }

    const legacyDate = new Map(
      legacyTxns.map((txn) => [String(txn.id), txn.transaction_date]),
    );

    for (const entry of legacyEnabled ? legacyEntries : []) {
      const legacyId = String(entry.transaction_id);

      /* Never double count a row the canonical journal already holds. */
      if (supersededIds.has(legacyId) || legacyBridge.has(legacyId)) continue;

      const date = legacyDate.get(legacyId);
      if (!date) continue;

      pushRow(
        "income",
        entry.account_id,
        legacyId,
        date,
        toNum(entry.credit) - toNum(entry.debit),
      );

      pushRow(
        "expense",
        entry.account_id,
        legacyId,
        date,
        toNum(entry.debit) - toNum(entry.credit),
      );
    }

    return rows.sort((a, b) => a.date.localeCompare(b.date));
  }, [
    accounts,
    journals,
    journalLines,
    legacyTxns,
    legacyEntries,
    legacyEnabled,
    supersededIds,
  ]);

  /* ------------------------------------------------------ year selection */

  const yearOptions = useMemo<YearOption[]>(() => {
    const today = toISO(new Date());
    const options: YearOption[] = [];

    const sessions = [...academicYears]
      .filter((year) => year.start_date && year.end_date)
      .sort((a, b) => String(a.start_date).localeCompare(String(b.start_date)));

    for (const session of sessions) {
      options.push({
        id: session.id,
        label: session.name,
        subLabel: `${prettyDate(session.start_date)} - ${prettyDate(
          session.end_date,
        )}`,
        start: session.start_date,
        end: session.end_date,
        isCurrent:
          session.is_current ||
          (today >= session.start_date && today <= session.end_date),
        isAll: false,
      });
    }

    /*
     * No academic years configured: fall back to Indian financial years
     * (Apr - Mar) built from the money data itself, newest six only.
     */
    if (options.length === 0) {
      const starts = new Map<string, Date>([
        [toISO(fiscalStartOf(today)), fiscalStartOf(today)],
      ]);

      for (const posting of postings) {
        const start = fiscalStartOf(posting.date);
        starts.set(toISO(start), start);
      }

      const ordered = [...starts.values()]
        .sort((a, b) => a.getTime() - b.getTime())
        .slice(-6);

      for (const start of ordered) {
        const end = toISO(new Date(start.getFullYear() + 1, 2, 31));

        options.push({
          id: `fy-${toISO(start)}`,
          label: fiscalLabel(start),
          subLabel: `1 Apr ${start.getFullYear()} - 31 Mar ${
            start.getFullYear() + 1
          }`,
          start: toISO(start),
          end,
          isCurrent: today >= toISO(start) && today <= end,
          isAll: false,
        });
      }
    }

    if (options.length > 1) {
      options.push({
        id: ALL_YEARS_ID,
        label: "All Years",
        subLabel: `${prettyDate(options[0].start)} - ${prettyDate(
          options[options.length - 1].end,
        )}`,
        start: options[0].start,
        end: options[options.length - 1].end,
        isCurrent: false,
        isAll: true,
      });
    }

    return options;
  }, [academicYears, postings]);

  /*
   * Nothing is stored for the active period: with no click yet it falls back
   * to the running session and then to the newest one, so the page is never
   * blank and no state needs to be mirrored in an effect.
   */
  const selected =
    yearOptions.find((option) => option.id === selectedYear) ||
    yearOptions.find((option) => option.isCurrent && !option.isAll) ||
    yearOptions[yearOptions.length - 1] ||
    null;

  /*
   * The whole period, never narrowed: it feeds the bars, the year-on-year
   * panel and the "this month is x% of the year" context line.
   */
  const period = useMemo(
    () =>
      selected ? summarize(postings, selected.start, selected.end) : null,
    [postings, selected],
  );

  /* Month chips only exist while the period is read month by month. */
  const monthChoices = useMemo<Segment[]>(() => {
    if (!period || period.granularity !== "month") return [];

    return [
      { id: ALL, label: "Whole year" },
      ...period.buckets.map((bucket) => ({
        id: bucket.key,
        label: monthName(bucket.key),
      })),
    ];
  }, [period]);

  /* A month chosen for another year can never leak into this one. */
  const focusKey =
    monthChoices.length > 0 &&
    selectedMonth !== ALL &&
    monthChoices.some((choice) => choice.id === selectedMonth)
      ? selectedMonth
      : null;

  const summary = useMemo(
    () =>
      selected
        ? summarize(postings, selected.start, selected.end, focusKey)
        : null,
    [postings, selected, focusKey],
  );

  /* Totals of every single year - used by the year-on-year infographic. */
  const perYear = useMemo(
    () =>
      yearOptions
        .filter((option) => !option.isAll)
        .map((option) => {
          const totals = summarize(postings, option.start, option.end);

          return {
            option,
            income: totals.income,
            expense: totals.expense,
            net: totals.net,
          };
        }),
    [yearOptions, postings],
  );

  /* ------------------------------------------------------- derived stats */

  const facts = useMemo(() => {
    if (!summary || !period) return null;

    const { income, expense, net, buckets, elapsedBuckets } = summary;

    const peakIncome = buckets.reduce<Bucket | null>(
      (best, bucket) =>
        !best || bucket.income > best.income ? bucket : best,
      null,
    );

    const heaviest = buckets.reduce<Bucket | null>(
      (best, bucket) =>
        !best || bucket.expense > best.expense ? bucket : best,
      null,
    );

    const busy = buckets.filter(
      (bucket) => bucket.income > 0 || bucket.expense > 0,
    );

    return {
      income,
      expense,
      net,
      isMonth: focusKey !== null,
      scopeLabel: focusKey
        ? monthNameLong(focusKey)
        : selected
          ? selected.label
          : "Selected period",
      yearIncome: period.income,
      yearExpense: period.expense,
      incomeShareOfYear: share(income, period.income),
      expenseShareOfYear: share(expense, period.expense),
      isSurplus: net >= 0,
      savingsRate: income > 0 ? (net / income) * 100 : 0,
      spendRatio:
        income > 0 ? (expense / income) * 100 : expense > 0 ? 100 : 0,
      flowShare:
        income + expense > 0 ? (income / (income + expense)) * 100 : 50,
      avgIncome: income / elapsedBuckets,
      avgExpense: expense / elapsedBuckets,
      peakIncome: peakIncome && peakIncome.income > 0 ? peakIncome : null,
      heaviest: heaviest && heaviest.expense > 0 ? heaviest : null,
      activePeriods: busy.length,
      totalPeriods: buckets.length,
      earnedPerRupee: expense > 0 ? income / expense : 0,
      perStudent: studentCount > 0 ? income / studentCount : 0,
      perStaff: staffCount > 0 ? expense / staffCount : 0,
      topIncome: summary.incomeHeads[0] || null,
      topExpense: summary.expenseHeads[0] || null,
    };
  }, [summary, period, focusKey, selected, studentCount, staffCount]);

  const yearOverYear = useMemo(() => {
    const index = perYear.findIndex(
      (row) => row.option.id === selected?.id,
    );

    if (index <= 0) return null;

    const current = perYear[index];
    const previous = perYear[index - 1];

    return {
      label: previous.option.label,
      incomeGrowth:
        previous.income > 0
          ? share(current.income - previous.income, previous.income)
          : null,
      expenseGrowth:
        previous.expense > 0
          ? share(current.expense - previous.expense, previous.expense)
          : null,
    };
  }, [perYear, selected]);

  const maxYearAmount = useMemo(
    () =>
      Math.max(
        1,
        ...perYear.map((row) => Math.max(row.income, row.expense)),
      ),
    [perYear],
  );

  const periodWord = period?.granularity === "year" ? "year" : "month";

  const incomeDelta = yearOverYear?.incomeGrowth ?? null;
  const expenseDelta = yearOverYear?.expenseGrowth ?? null;
  const deltaLabel = yearOverYear?.label ?? "previous year";

  const yearSegments = useMemo<Segment[]>(
    () =>
      yearOptions.map((option) => ({
        id: option.id,
        label: option.label,
        hint: option.isCurrent ? "running" : undefined,
      })),
    [yearOptions],
  );

  function pickYear(id: string) {
    setSelectedYear(id);
  }

  function pickMonth(id: string) {
    setSelectedMonth(id);
  }

  function handlePrint() {
    window.print();
  }

  return (
    <div
      style={SCREEN}
      className="relative min-h-screen overflow-hidden bg-[#EAEEF6] text-slate-900 antialiased print:bg-white"
    >
      <Wallpaper />

      <div className="relative mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6 sm:gap-5 sm:px-6 sm:py-8 lg:px-8">
        {/* ------------------------------------------------------- header */}
        <Glass className="p-5 sm:p-7">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-4">
              <Squircle
                icon={BarChart3}
                tone="from-[#0A84FF] to-[#5E5CE6]"
                big
              />

              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                  {schoolName || "School"} &middot; statistics
                </p>

                <h1 className="mt-1.5 text-[26px] font-semibold leading-tight tracking-[-0.025em] text-slate-900 sm:text-[34px]">
                  Income &amp; Expenditure
                </h1>

                <p className="mt-1.5 max-w-md text-[13px] leading-relaxed text-slate-500 sm:text-sm">
                  The year-wise and month-wise money story, counted from every
                  entry in the books.
                </p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2 print:hidden">
              <IconButton
                icon={loading ? Loader2 : RefreshCw}
                label="Refresh"
                busy={loading}
                onClick={refreshReport}
              />

              <IconButton
                icon={Printer}
                label="Print"
                primary
                onClick={handlePrint}
              />
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-1.5">
            <Chip tone="blue">{selected ? selected.label : "No period"}</Chip>

            {focusKey ? (
              <Chip tone="mint">{monthNameLong(focusKey)}</Chip>
            ) : (
              <Chip tone="slate">Whole {periodWord}</Chip>
            )}

            <Chip tone="slate">
              {period ? period.buckets.length : 0} {periodWord}s
            </Chip>

            <Chip tone="slate">
              {(
                journalLines.length +
                (legacyEnabled ? legacyEntries.length : 0)
              ).toLocaleString("en-IN")}{" "}
              entries read
            </Chip>

            {loading ? (
              <Chip tone="amber">
                <Loader2 className="h-3 w-3 animate-spin" />
                syncing
              </Chip>
            ) : null}
          </div>
        </Glass>

        {/* -------------------------------------------------------- error */}
        {error ? (
          <Glass tone="danger" className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-[13px] font-medium text-[#8A1B16]">
                {error}
              </p>

              <button
                type="button"
                onClick={refreshReport}
                className="rounded-full bg-white px-4 py-2 text-[13px] font-semibold text-[#B3261E] shadow-sm ring-1 ring-[#FF453A]/25 transition hover:bg-[#FFF1F0]"
              >
                Try again
              </button>
            </div>
          </Glass>
        ) : null}

        {/* ------------------------------------------------------ filters */}
        <Glass className="p-4 sm:p-5 print:hidden">
          <div className="space-y-2.5">
            <FilterLabel icon={CalendarRange} title="Year" />

            <Segmented
              items={yearSegments}
              value={selected ? selected.id : ""}
              onChange={pickYear}
            />

            {monthChoices.length > 1 ? (
              <>
                <div className="flex items-center justify-between gap-2 pt-1">
                  <FilterLabel icon={Layers} title="Month" />

                  {focusKey ? (
                    <button
                      type="button"
                      onClick={() => pickMonth(ALL)}
                      className="text-[12px] font-semibold text-[#0A84FF] transition hover:text-[#0060C7]"
                    >
                      Clear month
                    </button>
                  ) : null}
                </div>

                <Segmented
                  items={monthChoices}
                  value={focusKey || ALL}
                  onChange={pickMonth}
                  compact
                />
              </>
            ) : null}

            {facts && selected ? (
              <p className="px-0.5 pt-1 text-[12px] leading-relaxed text-slate-500">
                {focusKey ? (
                  <>
                    {facts.scopeLabel} holds{" "}
                    <b className="font-semibold text-slate-800">
                      {percent(facts.incomeShareOfYear)}
                    </b>{" "}
                    of {selected.label} income and{" "}
                    <b className="font-semibold text-slate-800">
                      {percent(facts.expenseShareOfYear)}
                    </b>{" "}
                    of its spending.
                  </>
                ) : (
                  <>
                    Every {periodWord} from {prettyDate(selected.start)} to{" "}
                    {prettyDate(selected.end)}
                    {selected.isAll
                      ? ", grouped by financial year."
                      : ", month by month."}
                  </>
                )}
              </p>
            ) : null}
          </div>
        </Glass>

        {/* ------------------------------------------------------ loading */}
        {!period && loading ? <SkeletonBoard /> : null}

        {summary && facts && period ? (
          <>
            {/* -------------------------------------------------- headline */}
            <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Kpi
                icon={Coins}
                tone="from-[#30D158] to-[#00B389]"
                label="Income received"
                value={money(facts.income)}
                caption={
                  focusKey
                    ? `${monthNameLong(focusKey)} receipts`
                    : `Average ${shortMoney(facts.avgIncome)} per ${periodWord}`
                }
                meter={facts.flowShare}
                meterClass="from-[#30D158] to-[#7BEBAE]"
                delta={focusKey ? null : incomeDelta}
                goodWhenUp
                deltaHint={deltaLabel}
              />

              <Kpi
                icon={Banknote}
                tone="from-[#FF453A] to-[#FF9F0A]"
                label="Money spent"
                value={money(facts.expense)}
                caption={
                  focusKey
                    ? `${monthNameLong(focusKey)} payments`
                    : `Average ${shortMoney(facts.avgExpense)} per ${periodWord}`
                }
                meter={100 - facts.flowShare}
                meterClass="from-[#FF453A] to-[#FFB340]"
                delta={focusKey ? null : expenseDelta}
                goodWhenUp={false}
                deltaHint={deltaLabel}
              />

              <Kpi
                icon={Scale}
                tone={
                  facts.isSurplus
                    ? "from-[#0A84FF] to-[#5E5CE6]"
                    : "from-[#FF375F] to-[#BF5AF2]"
                }
                label={facts.isSurplus ? "Surplus" : "Deficit"}
                value={money(facts.net)}
                caption={`${percent(facts.savingsRate)} of income kept back`}
                meter={clamp(Math.abs(facts.savingsRate))}
                meterClass="from-[#0A84FF] to-[#64D2FF]"
              />

              <Kpi
                icon={Percent}
                tone="from-[#5E5CE6] to-[#BF5AF2]"
                label="Spent per ₹100 earned"
                value={`\u20B9${Math.round(facts.spendRatio)}`}
                caption={
                  facts.earnedPerRupee > 0
                    ? `\u20B9${facts.earnedPerRupee.toFixed(2)} earned per \u20B91 spent`
                    : "Nothing earned against this spend"
                }
                meter={clamp(facts.spendRatio)}
                meterClass="from-[#5E5CE6] to-[#DA8FFF]"
              />
            </section>

            {/* ----------------------------------------------- rhythm bars */}
            <Glass className="p-5 sm:p-6">
              <PanelHead
                icon={CalendarRange}
                tone="from-[#0A84FF] to-[#64D2FF]"
                title={`Income against spending, ${periodWord} by ${periodWord}`}
                subtitle={
                  focusKey
                    ? `${facts.scopeLabel} is highlighted - tap any ${periodWord} to focus it`
                    : `Tap a ${periodWord} to focus every tile on it`
                }
                right={
                  <div className="flex items-center gap-3">
                    <Dot color={INCOME} label="Income" />
                    <Dot color={EXPENSE} label="Spending" />
                  </div>
                }
              />

              <MonthBars
                buckets={period.buckets}
                maxBucket={period.maxBucket}
                focusKey={focusKey}
                granularity={period.granularity}
                onPick={(key) => pickMonth(key === focusKey ? ALL : key)}
              />

              <div className="mt-5 flex items-center gap-3 rounded-2xl bg-white/55 px-3.5 py-3 ring-1 ring-white/70">
                <p className="w-16 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Split
                </p>

                <div className="flex h-2.5 flex-1 overflow-hidden rounded-full bg-slate-200/70">
                  <span
                    className="print-exact h-full rounded-l-full bg-gradient-to-r from-[#30D158] to-[#7BEBAE]"
                    style={{ width: `${clamp(facts.flowShare)}%` }}
                  />
                  <span className="print-exact h-full flex-1 bg-gradient-to-r from-[#FF9F0A] to-[#FF453A]" />
                </div>

                <p className="shrink-0 text-[12px] font-semibold text-slate-600">
                  {Math.round(facts.flowShare)} /{" "}
                  {Math.max(0, 100 - Math.round(facts.flowShare))}
                </p>
              </div>
            </Glass>

            {/* ----------------------------------------------- breakdowns */}
            <section className="grid gap-3 lg:grid-cols-2">
              <Glass className="p-5 sm:p-6">
                <PanelHead
                  icon={Coins}
                  tone="from-[#30D158] to-[#00B389]"
                  title="Where money comes from"
                  subtitle={
                    facts.topIncome
                      ? `Led by ${facts.topIncome.name}`
                      : "No income recorded"
                  }
                  right={<Chip tone="mint">{shortMoney(facts.income)}</Chip>}
                />

                <Breakdown
                  slices={summary.incomeHeads}
                  ringLabel="income"
                  empty="No income in this period"
                />
              </Glass>

              <Glass className="p-5 sm:p-6">
                <PanelHead
                  icon={Banknote}
                  tone="from-[#FF453A] to-[#FF9F0A]"
                  title="Where money goes"
                  subtitle={
                    facts.topExpense
                      ? `Led by ${facts.topExpense.name}`
                      : "No spending recorded"
                  }
                  right={<Chip tone="rose">{shortMoney(facts.expense)}</Chip>}
                />

                <Breakdown
                  slices={summary.expenseHeads}
                  ringLabel="spending"
                  empty="No spending in this period"
                />
              </Glass>
            </section>

            {/* ------------------------------------------------ fast facts */}
            <Glass className="p-5 sm:p-6">
              <PanelHead
                icon={Sparkles}
                tone="from-[#FF9F0A] to-[#FF375F]"
                title="Fast facts"
                subtitle={`${facts.scopeLabel} at a glance`}
              />

              <section className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
                {facts.isMonth ? (
                  <>
                    <Fact
                      icon={CircleDollarSign}
                      tone="from-[#30D158] to-[#00B389]"
                      label="Share of year income"
                      value={percent(facts.incomeShareOfYear)}
                      hint={`${money(facts.yearIncome)} across the period`}
                    />

                    <Fact
                      icon={Wallet}
                      tone="from-[#FF453A] to-[#FF9F0A]"
                      label="Share of year spend"
                      value={percent(facts.expenseShareOfYear)}
                      hint={`${money(facts.yearExpense)} across the period`}
                    />
                  </>
                ) : (
                  <>
                    <Fact
                      icon={Trophy}
                      tone="from-[#30D158] to-[#00B389]"
                      label={`Best ${periodWord} for income`}
                      value={
                        facts.peakIncome
                          ? shortMoney(facts.peakIncome.income)
                          : "\u2014"
                      }
                      hint={
                        facts.peakIncome
                          ? `${facts.peakIncome.label} earned the most`
                          : "No income yet"
                      }
                    />

                    <Fact
                      icon={Flame}
                      tone="from-[#FF453A] to-[#FF9F0A]"
                      label={`Heaviest ${periodWord}`}
                      value={
                        facts.heaviest
                          ? shortMoney(facts.heaviest.expense)
                          : "\u2014"
                      }
                      hint={
                        facts.heaviest
                          ? `${facts.heaviest.label} spent the most`
                          : "No spending yet"
                      }
                    />
                  </>
                )}

                <Fact
                  icon={Receipt}
                  tone="from-[#0A84FF] to-[#64D2FF]"
                  label="Money-in vouchers"
                  value={summary.incomeVouchers.toLocaleString("en-IN")}
                  hint="entries carrying an income line"
                />

                <Fact
                  icon={Landmark}
                  tone="from-[#5E5CE6] to-[#0A84FF]"
                  label="Money-out vouchers"
                  value={summary.expenseVouchers.toLocaleString("en-IN")}
                  hint="entries carrying a spend line"
                />

                <Fact
                  icon={GraduationCap}
                  tone="from-[#FFD60A] to-[#FF9F0A]"
                  label="Income per student"
                  value={shortMoney(facts.perStudent)}
                  hint={
                    studentCount > 0
                      ? `${studentCount.toLocaleString("en-IN")} students on roll`
                      : "No students on record"
                  }
                />

                <Fact
                  icon={Users}
                  tone="from-[#BF5AF2] to-[#FF375F]"
                  label="Spend per staff member"
                  value={shortMoney(facts.perStaff)}
                  hint={
                    staffCount > 0
                      ? `${staffCount.toLocaleString("en-IN")} staff on roll`
                      : "No staff on record"
                  }
                />

                <Fact
                  icon={IndianRupee}
                  tone="from-[#30D158] to-[#64D2FF]"
                  label="Earned per ₹1 spent"
                  value={
                    facts.earnedPerRupee > 0
                      ? `₹${facts.earnedPerRupee.toFixed(2)}`
                      : "\u2014"
                  }
                  hint={`Spending is ${percent(facts.spendRatio)} of income`}
                />

                <Fact
                  icon={Layers}
                  tone="from-[#64D2FF] to-[#0A84FF]"
                  label={`Active ${periodWord}s`}
                  value={`${facts.activePeriods} / ${facts.totalPeriods}`}
                  hint={`Avg ${shortMoney(facts.avgIncome)} in per ${periodWord}`}
                />

                {facts.topIncome ? (
                  <Fact
                    icon={Award}
                    tone="from-[#30D158] to-[#64D2FF]"
                    label="Top income head"
                    value={shortMoney(facts.topIncome.amount)}
                    hint={`${facts.topIncome.name} · ${percent(facts.topIncome.percentage)}`}
                  />
                ) : null}

                {facts.topExpense ? (
                  <Fact
                    icon={PiggyBank}
                    tone="from-[#FF453A] to-[#BF5AF2]"
                    label="Top spend head"
                    value={shortMoney(facts.topExpense.amount)}
                    hint={`${facts.topExpense.name} · ${percent(facts.topExpense.percentage)}`}
                  />
                ) : null}
              </section>
            </Glass>

            {/* -------------------------------------------- year on year */}
            <Glass className="p-5 sm:p-6">
              <PanelHead
                icon={Trophy}
                tone="from-[#5E5CE6] to-[#0A84FF]"
                title="Year on year"
                subtitle="Every year on record - tap one to switch to it"
                right={
                  perYear.length > 0 ? (
                    <Chip tone="violet">{perYear.length} years</Chip>
                  ) : null
                }
              />

              {perYear.length === 0 ? (
                <Empty text="No years to compare yet." />
              ) : (
                <section className="space-y-1.5">
                  {perYear.map((row) => (
                    <YearRow
                      key={row.option.id}
                      label={row.option.label}
                      income={row.income}
                      expense={row.expense}
                      net={row.net}
                      max={maxYearAmount}
                      active={row.option.id === selected?.id}
                      onPick={() => pickYear(row.option.id)}
                    />
                  ))}
                </section>
              )}
            </Glass>

            <p className="px-1 pb-2 text-[11px] leading-relaxed text-slate-400">
              Statistics only. Figures are net of contra entries such as
              returns and are read from the same money data as the books, so
              they always agree with the detailed statements.
            </p>
          </>
        ) : null}
      </div>

      {/*
       * Print: the wallpaper and every control are already print:hidden, so a
       * printout is a clean white sheet. Chart fills are gradients, and
       * browsers drop background paint by default - print-color-adjust keeps
       * the bars readable on paper.
       */}
      <style>{`
        @media print {
          html,
          body {
            background: #ffffff !important;
          }

          .print-exact {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
        }
      `}</style>
    </div>
  );
}

/* ------------------------------------------------------------- surfaces */

/* Soft iOS wallpaper: blurred colour fields behind frosted glass. */
function Wallpaper() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden print:hidden"
    >
      <div className="absolute -left-32 -top-40 h-[26rem] w-[26rem] rounded-full bg-[#8FB8FF] opacity-55 blur-[110px]" />
      <div className="absolute -right-28 -top-24 h-[24rem] w-[24rem] rounded-full bg-[#C9B7FF] opacity-55 blur-[110px]" />
      <div className="absolute left-1/4 top-[26rem] h-[22rem] w-[22rem] rounded-full bg-[#9BE7C4] opacity-45 blur-[120px]" />
      <div className="absolute right-1/3 top-[54rem] h-[24rem] w-[24rem] rounded-full bg-[#FFD6A8] opacity-45 blur-[120px]" />
      <div className="absolute bottom-[-8rem] left-1/3 h-[24rem] w-[24rem] rounded-full bg-[#A5D8FF] opacity-45 blur-[120px]" />
      <div className="absolute inset-0 bg-white/25" />
    </div>
  );
}

function Glass({
  children,
  className = "",
  tone = "clear",
}: {
  children: ReactNode;
  className?: string;
  tone?: "clear" | "danger";
}) {
  return (
    <section
      className={`relative overflow-hidden rounded-[26px] border backdrop-blur-2xl shadow-[inset_0_1px_1px_rgba(255,255,255,0.85),0_10px_30px_-18px_rgba(15,23,42,0.35)] ${
        tone === "clear"
          ? "border-white/70 bg-white/60"
          : "border-[#FF453A]/25 bg-[#FF453A]/[0.07]"
      } ${className}`}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/70 to-transparent"
      />

      <div className="relative">{children}</div>
    </section>
  );
}

function Squircle({
  icon: Icon,
  tone,
  big = false,
}: {
  icon: LucideIcon;
  tone: string;
  big?: boolean;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-[30%] bg-gradient-to-b text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.5),0_8px_18px_-8px_rgba(15,23,42,0.55)] ${tone} ${
        big ? "h-14 w-14" : "h-9 w-9"
      }`}
    >
      <Icon
        className={big ? "h-7 w-7" : "h-4 w-4"}
        strokeWidth={big ? 1.9 : 2.2}
      />
    </span>
  );
}

function IconButton({
  icon: Icon,
  label,
  onClick,
  primary = false,
  busy = false,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  primary?: boolean;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`inline-flex items-center gap-2 rounded-full px-3.5 py-2.5 text-[13px] font-semibold transition active:scale-[0.97] ${
        primary
          ? "bg-gradient-to-b from-[#0A84FF] to-[#0060DF] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_10px_20px_-10px_rgba(10,132,255,0.9)] hover:from-[#2E96FF] hover:to-[#0A77E0]"
          : "border border-white/70 bg-white/70 text-slate-600 shadow-sm backdrop-blur hover:bg-white"
      }`}
    >
      <Icon className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />

      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

const CHIP_TONES = {
  blue: "bg-[#0A84FF]/10 text-[#0060C7] ring-[#0A84FF]/20",
  mint: "bg-[#30D158]/10 text-[#0A7A2E] ring-[#30D158]/25",
  rose: "bg-[#FF453A]/10 text-[#B3261E] ring-[#FF453A]/20",
  violet: "bg-[#5E5CE6]/10 text-[#4B49B8] ring-[#5E5CE6]/20",
  amber: "bg-[#FF9F0A]/15 text-[#8A5100] ring-[#FF9F0A]/25",
  slate: "bg-slate-500/[0.07] text-slate-500 ring-slate-400/25",
};

function Chip({
  children,
  tone = "slate",
}: {
  children: ReactNode;
  tone?: keyof typeof CHIP_TONES;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset ${CHIP_TONES[tone]}`}
    >
      {children}
    </span>
  );
}

function FilterLabel({
  icon: Icon,
  title,
}: {
  icon: LucideIcon;
  title: string;
}) {
  return (
    <div className="flex items-center gap-1.5 px-0.5">
      <Icon className="h-3.5 w-3.5 text-slate-400" />

      <h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">
        {title}
      </h2>
    </div>
  );
}

/* ------------------------------------------------------------- controls */

function Segmented({
  items,
  value,
  onChange,
  compact = false,
}: {
  items: Segment[];
  value: string;
  onChange: (id: string) => void;
  compact?: boolean;
}) {
  if (items.length === 0) return null;

  return (
    <div className="flex gap-1 overflow-x-auto rounded-[18px] border border-white/70 bg-white/55 p-1 shadow-[inset_0_1px_2px_rgba(15,23,42,0.06)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {items.map((item) => {
        const active = item.id === value;

        return (
          <button
            key={item.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(item.id)}
            className={`shrink-0 rounded-[14px] transition active:scale-[0.98] ${
              compact ? "px-3 py-1.5" : "px-4 py-2"
            } ${
              active
                ? "bg-white text-slate-900 ring-1 ring-white shadow-[0_1px_1px_rgba(15,23,42,0.05),0_8px_16px_-8px_rgba(15,23,42,0.35)]"
                : "text-slate-500 hover:bg-white/60 hover:text-slate-800"
            }`}
          >
            <span
              className={`block whitespace-nowrap font-semibold ${
                compact ? "text-[12px]" : "text-[13px]"
              }`}
            >
              {item.label}
            </span>

            {item.hint ? (
              <span className="mt-0.5 block whitespace-nowrap text-[10px] font-medium text-slate-400">
                {item.hint}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------- tiles */

function Kpi({
  icon,
  tone,
  label,
  value,
  caption,
  meter,
  meterClass = "from-[#0A84FF] to-[#64D2FF]",
  delta = null,
  goodWhenUp = true,
  deltaHint = "",
}: {
  icon: LucideIcon;
  tone: string;
  label: string;
  value: string;
  caption: string;
  meter: number;
  meterClass?: string;
  delta?: number | null;
  goodWhenUp?: boolean;
  deltaHint?: string;
}) {
  const shown = typeof delta === "number" && Number.isFinite(delta);
  const up = shown ? (delta as number) >= 0 : false;
  const good = up === goodWhenUp;

  return (
    <Glass className="p-4">
      <div className="flex items-start justify-between gap-3">
        <Squircle icon={icon} tone={tone} />

        {shown ? (
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-bold ring-1 ring-inset ${
              good
                ? "bg-[#30D158]/10 text-[#0A7A2E] ring-[#30D158]/25"
                : "bg-[#FF453A]/10 text-[#B3261E] ring-[#FF453A]/20"
            }`}
          >
            {up ? (
              <TrendingUp className="h-3 w-3" />
            ) : (
              <TrendingDown className="h-3 w-3" />
            )}

            {percent(Math.abs(delta as number))}
          </span>
        ) : null}
      </div>

      <p className="mt-3 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">
        {label}
      </p>

      <p className="mt-1 text-[22px] font-semibold leading-tight tracking-[-0.02em] text-slate-900 sm:text-[26px]">
        {value}
      </p>

      <p className="mt-1 text-[12px] leading-snug text-slate-500">{caption}</p>

      {shown && deltaHint ? (
        <p className="mt-0.5 truncate text-[11px] text-slate-400">
          vs {deltaHint}
        </p>
      ) : null}

      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-300/40">
        <span
          className={`print-exact block h-full rounded-full bg-gradient-to-r ${meterClass}`}
          style={{ width: `${clamp(meter)}%` }}
        />
      </div>
    </Glass>
  );
}

function PanelHead({
  icon,
  tone,
  title,
  subtitle,
  right,
}: {
  icon: LucideIcon;
  tone: string;
  title: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <Squircle icon={icon} tone={tone} />

        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold tracking-[-0.015em] text-slate-900">
            {title}
          </h2>

          {subtitle ? (
            <p className="mt-0.5 text-[12px] leading-snug text-slate-500">
              {subtitle}
            </p>
          ) : null}
        </div>
      </div>

      {right ? <div className="shrink-0">{right}</div> : null}
    </div>
  );
}

function Dot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
      <span
        className="h-2 w-2 rounded-full"
        style={{ background: color }}
      />

      {label}
    </span>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-[22px] border border-dashed border-slate-300/80 bg-white/40 px-4 py-8 text-center">
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-500/10">
        <Sparkles className="h-4 w-4 text-slate-400" />
      </span>

      <p className="text-[13px] font-medium text-slate-500">{text}</p>
    </div>
  );
}

/* ------------------------------------------------------------ graphics */

function MonthBars({
  buckets,
  maxBucket,
  focusKey,
  granularity,
  onPick,
}: {
  buckets: Bucket[];
  maxBucket: number;
  focusKey: string | null;
  granularity: "month" | "year";
  onPick: (key: string) => void;
}) {
  const activity = buckets.reduce(
    (sum, bucket) => sum + Math.max(bucket.income, bucket.expense),
    0,
  );

  if (activity <= 0) {
    return <Empty text="No income or spending recorded in this period." />;
  }

  return (
    <div className="flex items-end gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {buckets.map((bucket) => {
        const active = focusKey === bucket.key;
        const dim = focusKey !== null && !active;

        const label =
          granularity === "month" ? monthName(bucket.key) : bucket.label;

        const incomeHeight = Math.max(
          3,
          share(bucket.income, maxBucket) * 0.92,
        );

        const expenseHeight = Math.max(
          3,
          share(bucket.expense, maxBucket) * 0.92,
        );

        return (
          <button
            key={bucket.key}
            type="button"
            onClick={() => onPick(bucket.key)}
            aria-pressed={active}
            title={`${label} - in ${money(bucket.income)}, out ${money(
              bucket.expense,
            )}`}
            className={`flex min-w-[3.5rem] flex-1 flex-col items-center gap-1.5 rounded-2xl px-1.5 pb-2 pt-2.5 transition active:scale-[0.98] ${
              active
                ? "bg-white/85 ring-1 ring-white shadow-[0_12px_26px_-18px_rgba(15,23,42,0.5)]"
                : "hover:bg-white/50"
            } ${dim ? "opacity-45 saturate-[0.6]" : ""}`}
          >
            <span className="flex h-28 w-full items-end justify-center gap-[3px]">
              <span
                className="print-exact relative w-1/2 max-w-[14px] overflow-hidden rounded-full bg-gradient-to-t from-[#1FBF5A] to-[#7BEBAE]"
                style={{ height: `${clamp(incomeHeight)}%` }}
              >
                <span className="absolute inset-x-0 top-0 h-1/3 bg-white/45" />
              </span>

              <span
                className="print-exact relative w-1/2 max-w-[14px] overflow-hidden rounded-full bg-gradient-to-t from-[#FF6A2A] to-[#FFC94D]"
                style={{ height: `${clamp(expenseHeight)}%` }}
              >
                <span className="absolute inset-x-0 top-0 h-1/3 bg-white/45" />
              </span>
            </span>

            <span
              className={`text-[11px] font-semibold tracking-tight ${
                active ? "text-slate-900" : "text-slate-500"
              }`}
            >
              {label}
            </span>

            <span
              className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                bucket.net >= 0
                  ? "bg-[#30D158]/10 text-[#0A7A2E]"
                  : "bg-[#FF453A]/10 text-[#B3261E]"
              }`}
            >
              {shortMoney(bucket.net)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function Breakdown({
  slices,
  ringLabel,
  empty,
}: {
  slices: Slice[];
  ringLabel: string;
  empty: string;
}) {
  const shown = slices.reduce((sum, slice) => sum + slice.amount, 0);

  if (slices.length === 0 || shown <= 0) return <Empty text={empty} />;

  const radius = 54;
  const circumference = 2 * Math.PI * radius;

  /* Cumulative ring offsets, built up front so render never mutates. */
  const arcs = slices.map((slice, index) => {
    const length = (clamp(slice.percentage) / 100) * circumference;

    const before = slices
      .slice(0, index)
      .reduce(
        (sum, item) => sum + (clamp(item.percentage) / 100) * circumference,
        0,
      );

    return { key: slice.name, color: slice.color, length, before };
  });

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-start">
      <div className="relative h-[168px] w-[168px] shrink-0">
        <svg viewBox="0 0 140 140" className="h-full w-full -rotate-90">
          <circle
            cx="70"
            cy="70"
            r={radius}
            fill="none"
            stroke="rgba(148,163,184,0.18)"
            strokeWidth="16"
          />

          {arcs.map((arc) => {
            const dash = Math.max(arc.length - 3, 1);

            return (
              <circle
                key={arc.key}
                cx="70"
                cy="70"
                r={radius}
                fill="none"
                stroke={arc.color}
                strokeWidth="16"
                strokeLinecap="round"
                strokeDasharray={`${dash} ${circumference - dash}`}
                strokeDashoffset={-arc.before}
              />
            );
          })}
        </svg>

        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="rounded-full bg-white/75 px-3 py-1 text-[17px] font-semibold tracking-[-0.02em] text-slate-900 shadow-[0_4px_14px_-8px_rgba(15,23,42,0.5)] backdrop-blur">
            {shortMoney(shown)}
          </span>

          <span className="mt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
            {ringLabel}
          </span>
        </div>
      </div>

      <section className="w-full space-y-1.5">
        {slices.map((slice, index) => (
          <div
            key={slice.name}
            className="flex items-center gap-3 rounded-[18px] bg-white/55 px-3 py-2 ring-1 ring-white/70"
          >
            <span
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
              style={{ background: slice.color }}
            >
              {index + 1}
            </span>

            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold text-slate-800">
                {slice.name}
              </span>

              <span className="mt-1 block h-1 w-full overflow-hidden rounded-full bg-slate-300/40">
                <span
                  className="print-exact block h-full rounded-full"
                  style={{
                    width: `${clamp(slice.percentage)}%`,
                    background: slice.color,
                  }}
                />
              </span>
            </span>

            <span className="shrink-0 text-right">
              <span className="block text-[12px] font-semibold text-slate-700">
                {shortMoney(slice.amount)}
              </span>

              <span className="block text-[11px] text-slate-400">
                {Math.round(slice.percentage)}%
              </span>
            </span>
          </div>
        ))}
      </section>
    </div>
  );
}

/* ----------------------------------------------------------- small parts */

function Fact({
  icon,
  tone,
  label,
  value,
  hint,
}: {
  icon: LucideIcon;
  tone: string;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-[22px] border border-white/70 bg-white/55 p-3.5 shadow-[inset_0_1px_1px_rgba(255,255,255,0.8),0_8px_20px_-16px_rgba(15,23,42,0.45)] backdrop-blur-xl">
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/70 to-transparent"
      />

      <div className="relative">
        <Squircle icon={icon} tone={tone} />

        <p className="mt-2.5 text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">
          {label}
        </p>

        <p className="mt-0.5 truncate text-[18px] font-semibold tracking-[-0.02em] text-slate-900">
          {value}
        </p>

        <p className="mt-0.5 truncate text-[11px] text-slate-500">{hint}</p>
      </div>
    </div>
  );
}

function YearRow({
  label,
  income,
  expense,
  net,
  max,
  active,
  onPick,
}: {
  label: string;
  income: number;
  expense: number;
  net: number;
  max: number;
  active: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={active}
      className={`flex w-full items-center gap-3 rounded-[20px] px-3 py-2.5 text-left transition active:scale-[0.99] ${
        active
          ? "bg-white/85 ring-1 ring-[#0A84FF]/25 shadow-[0_10px_26px_-18px_rgba(15,23,42,0.5)]"
          : "hover:bg-white/50"
      }`}
    >
      <span className="w-20 shrink-0 truncate text-[12px] font-bold text-slate-600">
        {label}
      </span>

      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-center gap-2">
          <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-300/35">
            <span
              className="print-exact block h-full rounded-full bg-gradient-to-r from-[#30D158] to-[#7BEBAE]"
              style={{ width: `${clamp(share(income, max))}%` }}
            />
          </span>

          <span className="w-16 shrink-0 text-right text-[11px] font-semibold text-slate-500">
            {shortMoney(income)}
          </span>
        </span>

        <span className="flex items-center gap-2">
          <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-300/35">
            <span
              className="print-exact block h-full rounded-full bg-gradient-to-r from-[#FF9F0A] to-[#FF453A]"
              style={{ width: `${clamp(share(expense, max))}%` }}
            />
          </span>

          <span className="w-16 shrink-0 text-right text-[11px] font-semibold text-slate-500">
            {shortMoney(expense)}
          </span>
        </span>
      </span>

      <span
        className={`w-20 shrink-0 rounded-full px-2 py-1 text-center text-[11px] font-bold ${
          net >= 0
            ? "bg-[#30D158]/10 text-[#0A7A2E]"
            : "bg-[#FF453A]/10 text-[#B3261E]"
        }`}
      >
        {shortMoney(net)}
      </span>
    </button>
  );
}

function SkeletonBoard() {
  return (
    <div className="space-y-3">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((slot) => (
          <div
            key={slot}
            className="h-[150px] animate-pulse rounded-[26px] border border-white/70 bg-white/50 backdrop-blur-2xl"
          />
        ))}
      </section>

      <div className="h-[280px] animate-pulse rounded-[26px] border border-white/70 bg-white/50 backdrop-blur-2xl" />

      <div className="h-[220px] animate-pulse rounded-[26px] border border-white/70 bg-white/50 backdrop-blur-2xl" />
    </div>
  );
}