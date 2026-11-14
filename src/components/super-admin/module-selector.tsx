"use client";

import {
  SCHOOL_MODULES,
  type SchoolModule,
} from "@/lib/modules";

export function ModuleSelector({
  value,
  onChange,
  disabled = false,
  error,
}: {
  value: readonly SchoolModule[];
  onChange: (modules: SchoolModule[]) => void;
  disabled?: boolean;
  error?: string;
}) {
  function toggleModule(module: SchoolModule) {
    onChange(
      value.includes(module)
        ? value.filter((current) => current !== module)
        : [...value, module],
    );
  }

  return (
    <fieldset disabled={disabled} aria-describedby={error ? "modules-error" : undefined}>
      <legend className="text-sm font-semibold text-slate-800">
        Subscription plans
      </legend>
      <p className="mt-1 text-sm text-slate-500">
        Select at least one plan. Plans can be combined and changed later.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {SCHOOL_MODULES.map((module) => (
          <label
            key={module.code}
            className={`flex cursor-pointer gap-3 rounded-xl border p-4 transition ${
              value.includes(module.code)
                ? "border-blue-500 bg-blue-50 ring-1 ring-blue-500"
                : "border-slate-200 bg-white hover:border-blue-300"
            }`}
          >
            <input
              type="checkbox"
              checked={value.includes(module.code)}
              onChange={() => toggleModule(module.code)}
              aria-invalid={Boolean(error)}
              className="mt-1 h-4 w-4 accent-blue-600"
            />
            <span>
              <span className="block text-sm font-semibold text-slate-800">
                {module.label}
              </span>
              <span className="mt-1 block text-xs leading-5 text-slate-500">
                {module.description}
              </span>
            </span>
          </label>
        ))}
      </div>
      {error && (
        <p id="modules-error" role="alert" className="mt-3 text-sm font-medium text-red-700">
          {error}
        </p>
      )}
    </fieldset>
  );
}
