export const MODULE_CODES = {
  fees: 1,
  payroll: 2,
  transport: 3,
} as const;

export type ModuleCode = keyof typeof MODULE_CODES;
export type ModuleId = (typeof MODULE_CODES)[ModuleCode];

export const MODULE_LABELS: Record<ModuleCode, string> = {
  fees: "1 – Fee collection & payments",
  payroll: "2 – Staff attendance & payroll",
  transport: "3 – Live bus tracking (coming soon)",
};

export type ModuleDefinition = {
  code: ModuleCode;
  id: ModuleId;
  label: string;
};

export const MODULES = [
  { code: "fees", id: MODULE_CODES.fees, label: MODULE_LABELS.fees },
  { code: "payroll", id: MODULE_CODES.payroll, label: MODULE_LABELS.payroll },
  { code: "transport", id: MODULE_CODES.transport, label: MODULE_LABELS.transport },
] as const satisfies readonly ModuleDefinition[];

const moduleCodeSet = new Set<string>(Object.keys(MODULE_CODES));

export function isModuleCode(value: unknown): value is ModuleCode {
  return typeof value === "string" && moduleCodeSet.has(value);
}

export function validateModules(input: unknown): ModuleCode[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new TypeError("At least one module must be selected.");
  }

  const modules: ModuleCode[] = [];
  const seen = new Set<ModuleCode>();

  for (const value of input) {
    if (!isModuleCode(value)) {
      throw new TypeError(`Unknown module: ${String(value)}.`);
    }

    if (seen.has(value)) {
      throw new TypeError(`Duplicate module: ${value}.`);
    }

    seen.add(value);
    modules.push(value);
  }

  return modules;
}
