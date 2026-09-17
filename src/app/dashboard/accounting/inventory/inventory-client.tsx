"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Boxes,
  CheckCircle2,
  History,
  Loader2,
  Package,
  Plus,
  Power,
  Pencil,
  RefreshCw,
  SlidersHorizontal,
  TrendingDown,
  TrendingUp,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getCurrentSchoolId } from "@/lib/supabase/current-school";
import {
  getStockSummary,
  InventoryError,
  type StockSummaryItem,
} from "@/lib/inventory/valuation";
import {
  INVENTORY_CATEGORY_LABELS,
  applyStockAdjustment,
  createInventoryItem,
  listInventoryItems,
  listStockMovements,
  setInventoryItemActive,
  updateInventoryItem,
  type InventoryCategory,
  type InventoryItemRecord,
  type InventoryMovementRecord,
} from "@/lib/inventory/inventory-items";

type Draft = {
  name: string;
  category: InventoryCategory;
  unit: string;
  openingQuantity: string;
  openingUnitCost: string;
  notes: string;
};

const today = () => new Date().toISOString().slice(0, 10);

const emptyDraft: Draft = {
  name: "",
  category: "books",
  unit: "pcs",
  openingQuantity: "0",
  openingUnitCost: "0",
  notes: "",
};

function money(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function qty(value: number) {
  const n = Number(value || 0);

  return Number.isInteger(n) ? String(n) : n.toFixed(3);
}

function dateText(value: string) {
  if (!value) return "-";

  const d = new Date(`${value}T00:00:00`);

  return Number.isNaN(d.getTime())
    ? value
    : d.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
}

function errorMessage(error: unknown) {
  if (error instanceof InventoryError) return error.message;
  if (error instanceof Error) return error.message;

  return "Something went wrong.";
}

const MOVEMENT_LABELS: Record<string, string> = {
  purchase: "Purchase",
  purchase_return: "Purchase return",
  sale: "Sale",
  sale_return: "Sale return",
  adjustment: "Adjustment",
};

export default function InventoryClient() {
  const supabase = useMemo(() => createClient(), []);

  const [schoolId, setSchoolId] = useState<string | null>(null);
  const [items, setItems] = useState<InventoryItemRecord[]>([]);
  const [summary, setSummary] = useState<StockSummaryItem[]>([]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [showItemModal, setShowItemModal] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItemRecord | null>(
    null,
  );
  const [draft, setDraft] = useState<Draft>(emptyDraft);

  const [adjustItem, setAdjustItem] = useState<InventoryItemRecord | null>(
    null,
  );
  const [adjustDirection, setAdjustDirection] = useState<
    "increase" | "decrease"
  >("increase");
  const [adjustDate, setAdjustDate] = useState(today());
  const [adjustQuantity, setAdjustQuantity] = useState("");
  const [adjustUnitCost, setAdjustUnitCost] = useState("");
  const [adjustNotes, setAdjustNotes] = useState("");

  const [ledgerItem, setLedgerItem] = useState<InventoryItemRecord | null>(
    null,
  );
  const [ledgerRows, setLedgerRows] = useState<InventoryMovementRecord[]>([]);
  const [ledgerLoading, setLedgerLoading] = useState(false);

  async function loadData(id: string) {
    const [itemRows, stockRows] = await Promise.all([
      listInventoryItems(supabase, id),
      getStockSummary(supabase, id),
    ]);

    setItems(itemRows);
    setSummary(stockRows);
  }

  useEffect(() => {
    void (async () => {
      try {
        setLoading(true);

        const id = await getCurrentSchoolId();

        setSchoolId(id);
        await loadData(id);
      } catch (e) {
        setError(errorMessage(e));
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
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setRefreshing(false);
    }
  }

  /* Closing quantity and average cost live in the movement ledger, so the
     summary row is looked up by item id rather than recomputed here. */
  const summaryById = useMemo(
    () => new Map(summary.map((row) => [row.id, row])),
    [summary],
  );

  const totalStockValue = useMemo(
    () => summary.reduce((sum, row) => sum + row.stockValue, 0),
    [summary],
  );

  const outOfStockCount = useMemo(
    () =>
      summary.filter((row) => row.closingQuantity <= 0 && row.isActive).length,
    [summary],
  );

  const activeItems = useMemo(
    () => items.filter((item) => item.is_active),
    [items],
  );

  function openAddItem() {
    setEditingItem(null);
    setDraft(emptyDraft);
    setError("");
    setSuccess("");
    setShowItemModal(true);
  }

  function openEditItem(item: InventoryItemRecord) {
    setEditingItem(item);
    setDraft({
      name: item.name,
      category: item.category,
      unit: item.unit,
      openingQuantity: String(item.opening_quantity),
      openingUnitCost: String(item.opening_unit_cost),
      notes: item.notes || "",
    });
    setError("");
    setSuccess("");
    setShowItemModal(true);
  }

  async function saveItem() {
    if (!schoolId) return;

    try {
      setSaving(true);
      setError("");

      if (editingItem) {
        await updateInventoryItem(supabase, {
          schoolId,
          itemId: editingItem.id,
          name: draft.name,
          category: draft.category,
          unit: draft.unit,
          openingQuantity: Number(draft.openingQuantity || 0),
          openingUnitCost: Number(draft.openingUnitCost || 0),
          notes: draft.notes.trim() || null,
        });

        setSuccess(`"${draft.name.trim()}" updated.`);
      } else {
        const user =
          (await supabase.auth.getUser()).data.user?.id || null;

        await createInventoryItem(supabase, {
          schoolId,
          name: draft.name,
          category: draft.category,
          unit: draft.unit,
          openingQuantity: Number(draft.openingQuantity || 0),
          openingUnitCost: Number(draft.openingUnitCost || 0),
          notes: draft.notes.trim() || null,
          createdBy: user,
        });

        setSuccess(`"${draft.name.trim()}" added.`);
      }

      setShowItemModal(false);
      await loadData(schoolId);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  function openAdjust(item: InventoryItemRecord) {
    const row = summaryById.get(item.id);

    setAdjustItem(item);
    setAdjustDirection("increase");
    setAdjustDate(today());
    setAdjustQuantity("");
    setAdjustUnitCost(String(row?.avgCost || 0));
    setAdjustNotes("");
    setError("");
    setSuccess("");
  }

  async function saveAdjustment() {
    if (!schoolId || !adjustItem) return;

    try {
      setSaving(true);
      setError("");

      const result = await applyStockAdjustment(supabase, {
        schoolId,
        itemId: adjustItem.id,
        adjustmentDate: adjustDate,
        direction: adjustDirection,
        quantity: Number(adjustQuantity || 0),
        unitCost: Number(adjustUnitCost || 0),
        notes: adjustNotes.trim() || null,
      });

      setSuccess(
        `${adjustItem.name} adjusted. Closing stock is now ${qty(
          result.balanceQuantity,
        )} at ${money(result.balanceUnitCost)} average cost.`,
      );

      setAdjustItem(null);
      await loadData(schoolId);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function openLedger(item: InventoryItemRecord) {
    if (!schoolId) return;

    try {
      setLedgerItem(item);
      setLedgerLoading(true);
      setError("");

      setLedgerRows(await listStockMovements(supabase, schoolId, item.id));
    } catch (e) {
      setError(errorMessage(e));
      setLedgerItem(null);
    } finally {
      setLedgerLoading(false);
    }
  }

  async function toggleActive(item: InventoryItemRecord) {
    if (!schoolId) return;

    try {
      setError("");
      await setInventoryItemActive(
        supabase,
        schoolId,
        item.id,
        !item.is_active,
      );

      setSuccess(
        `"${item.name}" is now ${item.is_active ? "inactive" : "active"}.`,
      );

      await loadData(schoolId);
    } catch (e) {
      setError(errorMessage(e));
    }
  }
const itemsById = useMemo(
    () => new Map(items.map((item) => [item.id, item])),
    [items],
  );

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="border-b bg-white">
        <div className="mx-auto max-w-7xl px-6 py-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-blue-600">
                <Boxes size={16} />
                Accounting
              </div>

              <h1 className="mt-1 text-3xl font-bold text-slate-900">
                Inventory
              </h1>

              <p className="mt-1 text-sm text-slate-500">
                Resale stock held as an asset until it is sold to a student.
              </p>
            </div>

            <div className="flex gap-2">
              <button
                onClick={refresh}
                disabled={refreshing || loading}
                className="inline-flex items-center gap-2 rounded-lg border bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {refreshing ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <RefreshCw size={16} />
                )}
                Refresh
              </button>

              <button
                onClick={openAddItem}
                className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
              >
                <Plus size={16} />
                Add item
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-6 py-6">
        <div className="mb-6 grid gap-4 md:grid-cols-3">
          <Card
            title="Active items"
            value={String(activeItems.length)}
            icon={<Package size={18} />}
          />
          <Card
            title="Stock value at cost"
            value={money(totalStockValue)}
            icon={<TrendingUp size={18} />}
            blue
          />
          <Card
            title="Out of stock"
            value={String(outOfStockCount)}
            icon={<TrendingDown size={18} />}
            danger={outOfStockCount > 0}
          />
        </div>

        {error && (
          <div className="mb-6 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            <AlertCircle size={18} className="mt-0.5" />
            <div>
              <div className="font-semibold">Inventory error</div>
              <div className="mt-1">{error}</div>
            </div>
          </div>
        )}

        {success && (
          <div className="mb-6 flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
            <CheckCircle2 size={18} className="mt-0.5" />
            <div className="mt-0.5">{success}</div>
          </div>
        )}

        <section className="overflow-hidden rounded-2xl border bg-white">
          <div className="flex items-center justify-between border-b px-5 py-4">
            <div>
              <h2 className="font-semibold text-slate-900">Stock summary</h2>
              <p className="text-xs text-slate-500">
                Opening + purchases − purchase returns − sales = closing.
                Closing is valued at weighted average cost.
              </p>
            </div>
            <span className="text-xs font-semibold text-slate-500">
              {summary.length} items
            </span>
          </div>

          {loading ? (
            <div className="flex items-center justify-center gap-2 p-12 text-sm text-slate-500">
              <Loader2 size={16} className="animate-spin" />
              Loading inventory...
            </div>
          ) : summary.length === 0 ? (
            <div className="p-12 text-center">
              <Package size={28} className="mx-auto text-slate-300" />
              <h3 className="mt-3 font-semibold text-slate-900">
                No inventory items yet
              </h3>
              <p className="mt-1 text-sm text-slate-500">
                Add the books, uniforms or other goods the school buys to
                resell. Purchases then increase stock instead of becoming an
                expense.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1080px]">
                <thead className="bg-slate-50">
                  <tr>
                    {[
                      { label: "Item", align: "left" },
                      { label: "Category", align: "left" },
                      { label: "Opening", align: "right" },
                      { label: "Purchases", align: "right" },
                      { label: "Returns", align: "right" },
                      { label: "Sales", align: "right" },
                      { label: "Closing", align: "right" },
                      { label: "Avg cost", align: "right" },
                      { label: "Stock value", align: "right" },
                      { label: "Actions", align: "right" },
                    ].map((column) => (
                      <th
                        key={column.label}
                        className={`px-5 py-3 text-xs font-semibold text-slate-500 ${
                          column.align === "right" ? "text-right" : "text-left"
                        }`}
                      >
                        {column.label}
                      </th>
                    ))}
                  </tr>
                </thead>

                <tbody className="divide-y">
                  {summary.map((row) => {
                    const item = itemsById.get(row.id);

                    return (
                      <tr
                        key={row.id}
                        className={`hover:bg-slate-50 ${
                          row.isActive ? "" : "opacity-60"
                        }`}
                      >
                        <td className="px-5 py-4">
                          <div className="font-medium text-slate-900">
                            {row.name}
                          </div>
                          <div className="mt-0.5 text-xs text-slate-500">
                            {row.isActive ? row.unit : `${row.unit} · inactive`}
                          </div>
                        </td>

                        <td className="px-5 py-4 text-sm text-slate-600">
                          {INVENTORY_CATEGORY_LABELS[
                            row.category as InventoryCategory
                          ] || row.category}
                        </td>

                        <td className="px-5 py-4 text-right text-sm text-slate-600">
                          {qty(row.openingQuantity)}
                        </td>

                        <td className="px-5 py-4 text-right text-sm text-emerald-600">
                          {row.purchases ? qty(row.purchases) : "-"}
                        </td>

                        <td className="px-5 py-4 text-right text-sm text-amber-600">
                          {row.purchaseReturns ? qty(row.purchaseReturns) : "-"}
                        </td>

                        <td className="px-5 py-4 text-right text-sm text-red-600">
                          {row.sales ? qty(row.sales) : "-"}
                        </td>

                        <td className="px-5 py-4 text-right font-semibold text-slate-900">
                          {qty(row.closingQuantity)}
                        </td>

                        <td className="px-5 py-4 text-right text-sm text-slate-600">
                          {money(row.avgCost)}
                        </td>

                        <td className="px-5 py-4 text-right font-semibold text-slate-900">
                          {money(row.stockValue)}
                        </td>

                        <td className="px-5 py-4">
                          <div className="flex items-center justify-end gap-1">
                            <IconButton
                              title="Stock ledger"
                              onClick={() => item && openLedger(item)}
                            >
                              <History size={16} />
                            </IconButton>

                            <IconButton
                              title="Adjust stock"
                              onClick={() => item && openAdjust(item)}
                            >
                              <SlidersHorizontal size={16} />
                            </IconButton>

                            <IconButton
                              title="Edit item"
                              onClick={() => item && openEditItem(item)}
                            >
                              <Pencil size={16} />
                            </IconButton>

                            <IconButton
                              title={row.isActive ? "Deactivate" : "Activate"}
                              onClick={() => item && toggleActive(item)}
                            >
                              <Power size={16} />
                            </IconButton>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>

                <tfoot className="bg-slate-50">
                  <tr>
                    <td
                      colSpan={8}
                      className="px-5 py-4 text-right font-semibold text-slate-700"
                    >
                      Total stock value
                    </td>
                    <td className="px-5 py-4 text-right font-bold text-slate-900">
                      {money(totalStockValue)}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </section>

        <p className="mt-4 text-xs text-slate-500">
          Inventory purchases are recorded under{" "}
          <span className="font-semibold">Vendor Purchases</span> with purchase
          type “Inventory / Resale”. They never appear as an operating expense
          on the Expense page; only the cost of goods actually sold reaches the
          Profit & Loss through COGS.
        </p>
      </div>

      {showItemModal && (
        <Modal
          title={editingItem ? "Edit inventory item" : "Add inventory item"}
          onClose={() => setShowItemModal(false)}
        >
          <div className="grid gap-4">
            <Field label="Item name">
              <input
                value={draft.name}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, name: e.target.value }))
                }
                placeholder="Class 5 Mathematics Book"
                className={inputClass}
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Category">
                <select
                  value={draft.category}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      category: e.target.value as InventoryCategory,
                    }))
                  }
                  className={inputClass}
                >
                  <option value="books">Books (resale)</option>
                  <option value="uniform">Uniform (resale)</option>
                  <option value="other">Other resale goods</option>
                </select>
              </Field>

              <Field label="Unit">
                <input
                  value={draft.unit}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, unit: e.target.value }))
                  }
                  placeholder="pcs"
                  className={inputClass}
                />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Opening quantity">
                <input
                  type="number"
                  min="0"
                  step="0.001"
                  value={draft.openingQuantity}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      openingQuantity: e.target.value,
                    }))
                  }
                  className={inputClass}
                />
              </Field>

              <Field label="Opening unit cost">
                <input
                  type="number"
                  min="0"
                  step="0.0001"
                  value={draft.openingUnitCost}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      openingUnitCost: e.target.value,
                    }))
                  }
                  className={inputClass}
                />
              </Field>
            </div>

            {editingItem && (
              <p className="text-xs text-slate-500">
                Opening quantity and cost can only be changed while the item has
                no stock movements. After that, use a stock adjustment.
              </p>
            )}

            <Field label="Notes">
              <textarea
                value={draft.notes}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, notes: e.target.value }))
                }
                rows={2}
                className={inputClass}
              />
            </Field>
          </div>

          <ModalActions
            saving={saving}
            onCancel={() => setShowItemModal(false)}
            onConfirm={saveItem}
            confirmLabel={editingItem ? "Save changes" : "Add item"}
          />
        </Modal>
      )}

      {adjustItem && (
        <Modal title={`Adjust stock · ${adjustItem.name}`} onClose={() => setAdjustItem(null)}>
          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Direction">
                <select
                  value={adjustDirection}
                  onChange={(e) =>
                    setAdjustDirection(
                      e.target.value as "increase" | "decrease",
                    )
                  }
                  className={inputClass}
                >
                  <option value="increase">Increase stock in</option>
                  <option value="decrease">Decrease stock out</option>
                </select>
              </Field>

              <Field label="Date">
                <input
                  type="date"
                  value={adjustDate}
                  onChange={(e) => setAdjustDate(e.target.value)}
                  className={inputClass}
                />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Quantity">
                <input
                  type="number"
                  min="0"
                  step="0.001"
                  value={adjustQuantity}
                  onChange={(e) => setAdjustQuantity(e.target.value)}
                  className={inputClass}
                />
              </Field>

              <Field label="Unit cost">
                <input
                  type="number"
                  min="0"
                  step="0.0001"
                  value={adjustUnitCost}
                  onChange={(e) => setAdjustUnitCost(e.target.value)}
                  disabled={adjustDirection === "decrease"}
                  className={`${inputClass} disabled:bg-slate-100 disabled:text-slate-500`}
                />
              </Field>
            </div>

            <p className="text-xs text-slate-500">
              A decrease is valued at the current weighted average cost, exactly
              like a sale. A decrease larger than the quantity in hand is
              rejected — negative stock is not allowed.
            </p>

            <Field label="Reason">
              <input
                value={adjustNotes}
                onChange={(e) => setAdjustNotes(e.target.value)}
                placeholder="Stock count correction"
                className={inputClass}
              />
            </Field>
          </div>

          <ModalActions
            saving={saving}
            onCancel={() => setAdjustItem(null)}
            onConfirm={saveAdjustment}
            confirmLabel="Post adjustment"
          />
        </Modal>
      )}

      {ledgerItem && (
        <Modal
          title={`Stock ledger · ${ledgerItem.name}`}
          onClose={() => setLedgerItem(null)}
          wide
        >
          {ledgerLoading ? (
            <div className="flex items-center justify-center gap-2 p-10 text-sm text-slate-500">
              <Loader2 size={16} className="animate-spin" />
              Loading ledger...
            </div>
          ) : ledgerRows.length === 0 ? (
            <p className="p-6 text-center text-sm text-slate-500">
              No stock movements yet. The opening balance is recorded the first
              time this item is purchased, sold or adjusted.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px]">
                <thead className="bg-slate-50">
                  <tr>
                    {[
                      "Date",
                      "Type",
                      "In",
                      "Out",
                      "Unit cost",
                      "Value",
                      "Balance",
                    ].map((label, index) => (
                      <th
                        key={label}
                        className={`px-4 py-3 text-xs font-semibold text-slate-500 ${
                          index === 0 || index === 1
                            ? "text-left"
                            : "text-right"
                        }`}
                      >
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {ledgerRows.map((row) => (
                    <tr key={row.id}>
                      <td className="px-4 py-3 text-sm text-slate-600">
                        {dateText(row.movement_date)}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        {MOVEMENT_LABELS[row.movement_type] ||
                          row.movement_type}
                        {row.notes ? (
                          <div className="text-xs text-slate-400">
                            {row.notes}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-emerald-600">
                        {Number(row.quantity) > 0 ? qty(row.quantity) : "-"}
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-red-600">
                        {Number(row.quantity) < 0
                          ? qty(Math.abs(Number(row.quantity)))
                          : "-"}
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-slate-600">
                        {money(row.unit_cost)}
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-slate-600">
                        {money(row.total_cost)}
                      </td>
                      <td className="px-4 py-3 text-right text-sm font-semibold text-slate-900">
                        {qty(row.balance_quantity)}
                        <div className="text-xs font-normal text-slate-400">
                          @ {money(row.balance_unit_cost)}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex justify-end border-t px-5 py-4">
            <button
              onClick={() => setLedgerItem(null)}
              className="rounded-lg border px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Close
            </button>
          </div>
        </Modal>
      )}
    </main>
  );
}
const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";

function Card({
  title,
  value,
  icon,
  blue = false,
  danger = false,
}: {
  title: string;
  value: string;
  icon: React.ReactNode;
  blue?: boolean;
  danger?: boolean;
}) {
  let valueClass = "text-slate-900";

  if (danger) valueClass = "text-red-600";
  else if (blue) valueClass = "text-blue-600";

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        {icon}
        {title}
      </div>

      <p className={`mt-2 text-2xl font-bold ${valueClass}`}>{value}</p>
    </div>
  );
}

function IconButton({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50 hover:text-slate-900"
    >
      {children}
    </button>
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
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">
        {label}
      </span>
      {children}
    </label>
  );
}

function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4">
      <div
        className={`mt-10 w-full rounded-2xl bg-white shadow-xl ${
          wide ? "max-w-4xl" : "max-w-2xl"
        }`}
      >
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h2 className="font-semibold text-slate-900">{title}</h2>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-5">{children}</div>
      </div>
    </div>
  );
}

function ModalActions({
  saving,
  onCancel,
  onConfirm,
  confirmLabel,
}: {
  saving: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  confirmLabel: string;
}) {
  return (
    <div className="mt-6 flex justify-end gap-2 border-t pt-5">
      <button
        type="button"
        onClick={onCancel}
        disabled={saving}
        className="rounded-lg border px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
      >
        Cancel
      </button>

      <button
        type="button"
        onClick={onConfirm}
        disabled={saving}
        className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
      >
        {saving && <Loader2 size={16} className="animate-spin" />}
        {confirmLabel}
      </button>
    </div>
  );
}
