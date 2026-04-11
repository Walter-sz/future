import Link from "next/link";

export default function WalterHubLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-amber-50/40 to-slate-50">
      <header className="border-b border-amber-200/60 bg-white/90 shadow-sm backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-col gap-1 px-4 py-4 sm:flex-row sm:items-baseline sm:justify-between">
          <Link href="/" className="text-2xl font-bold tracking-tight text-slate-900">
            Walter&apos;s world
          </Link>
          <p className="text-sm text-slate-500">个人主页 · 信息与活动总览</p>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  );
}
