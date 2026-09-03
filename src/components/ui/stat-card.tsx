import { ReactNode } from "react";

type StatCardProps = {
  title: string;
  value: string;
  subtitle: string;
  icon: ReactNode;
  iconClassName?: string;
};

export function StatCard({
  title,
  value,
  subtitle,
  icon,
  iconClassName = "bg-blue-100 text-blue-600",
}: StatCardProps) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-slate-500">{title}</p>

          <p className="mt-2 text-2xl font-bold tracking-tight text-slate-900">
            {value}
          </p>
        </div>

        <div
          className={`flex h-11 w-11 items-center justify-center rounded-xl ${iconClassName}`}
        >
          {icon}
        </div>
      </div>

      <p className="mt-4 text-xs text-slate-500">{subtitle}</p>
    </div>
  );
}