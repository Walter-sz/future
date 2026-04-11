import Link from "next/link";
import { getWalterAgents } from "@/hub/agents";

export function WalterAgentGrid() {
  const agents = getWalterAgents();

  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {agents.map((a) => (
        <li key={a.slug}>
          <Link
            href={`/agent/${a.slug}`}
            scroll={false}
            className="flex h-full flex-col rounded-xl border border-violet-200/80 bg-white p-5 shadow-sm transition hover:border-violet-400/70 hover:shadow-md"
          >
            <div className="mb-2 flex items-start justify-between gap-2">
              <h3 className="text-base font-semibold text-slate-900">{a.title}</h3>
              {a.ready ? (
                <span className="shrink-0 rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-900">
                  已接入
                </span>
              ) : (
                <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                  预留
                </span>
              )}
            </div>
            <p className="text-sm leading-relaxed text-slate-600">{a.description}</p>
            <span className="mt-4 text-sm font-medium text-violet-700">进入控制台 →</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
