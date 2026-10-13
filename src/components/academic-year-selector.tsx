"use client";

export type AcademicYearSelectorOption = {
  id: string;
  name: string;
  is_current: boolean;
};

export function AcademicYearSelector({
  years,
  value,
  onChange,
  disabled = false,
  label = "Academic year",
  includeAll = false,
  allLabel = "All academic years",
  allValue = "all",
  id,
  labelClassName,
  labelTextClassName,
  selectClassName,
}: {
  years: AcademicYearSelectorOption[];
  value: string;
  onChange: (yearId: string) => void;
  disabled?: boolean;
  label?: string;
  includeAll?: boolean;
  allLabel?: string;
  allValue?: string;
  id?: string;
  labelClassName?: string;
  labelTextClassName?: string;
  selectClassName?: string;
}) {
  return (
    <label
      className={
        labelClassName ??
        "flex flex-col gap-1.5 text-sm font-medium text-slate-700"
      }
    >
      <span className={labelTextClassName}>{label}</span>
      <select
        id={id}
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className={
          selectClassName ??
          "rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-medium outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100 disabled:bg-slate-100"
        }
      >
        {!years.length && <option value="">No academic years configured</option>}
        {includeAll && <option value={allValue}>{allLabel}</option>}
        {years.map((year) => (
          <option key={year.id} value={year.id}>
            {year.name}{year.is_current ? " (Current)" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
