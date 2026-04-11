import Link from "next/link";
import { getWalterSections } from "@/hub/sections";

export function WalterSectionGrid() {
  const sections = getWalterSections();

  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {sections.map((s) => (
        <li key={s.id}>
          <Link
            href={s.href}
            scroll={false}
            className="flex h-full flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-amber-300/80 hover:shadow-md"
          >
            <div className="mb-2 flex items-start justify-between gap-2">
              <h2 className="text-base font-semibold text-slate-900">{s.title}</h2>
              {s.ready ? (
                <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                  已接入
                </span>
              ) : (
                <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                  预留
                </span>
              )}
            </div>
            <p className="text-sm leading-relaxed text-slate-600">{s.description}</p>
            <span className="mt-4 text-sm font-medium text-amber-700">进入 →</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
