"use client";

import { Loader2, X } from "lucide-react";

/*
 * Small shared building blocks for the inventory / book-sale screens. They
 * follow the same slate + blue admin styling already used across the
 * accounting pages so the new screens match the rest of the app.
 */

export const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";

export function money(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

/* Quantities are stored to three decimals; only show them when used. */
export function qty(value: number) {
  const n = Number(value || 0);

  return Number.isInteger(n) ? String(n) : n.toFixed(3);
}

export function dateText(value: string) {
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

export function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;

  return "Something went wrong.";
}

export function Card({
  title,
  value,
  icon,
  blue = false,
  danger = false,
  positive = false,
}: {
  title: string;
  value: string;
  icon: React.ReactNode;
  blue?: boolean;
  danger?: boolean;
  positive?: boolean;
}) {
  let valueClass = "text-slate-900";

  if (danger) valueClass = "text-red-600";
  else if (positive) valueClass = "text-emerald-600";
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

export function IconButton({
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

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">
        {label}
      </span>
      {children}
      {hint ? (
        <span className="mt-1 block text-xs text-slate-500">{hint}</span>
      ) : null}
    </label>
  );
}

export function Modal({
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
          wide ? "max-w-5xl" : "max-w-2xl"
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

export function ModalActions({
  saving,
  onCancel,
  onConfirm,
  confirmLabel,
  confirmDisabled = false,
}: {
  saving: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  confirmLabel: string;
  confirmDisabled?: boolean;
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
        disabled={saving || confirmDisabled}
        className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
      >
        {saving && <Loader2 size={16} className="animate-spin" />}
        {confirmLabel}
      </button>
    </div>
  );
}

export function Alerts({ error, success }: { error: string; success: string }) {
  return (
    <>
      {error && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <div className="font-semibold">Something needs attention</div>
          <div className="mt-1">{error}</div>
        </div>
      )}

      {success && (
        <div className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
          {success}
        </div>
      )}
    </>
  );
}
