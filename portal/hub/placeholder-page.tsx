import Link from "next/link";

type Props = {
  title: string;
  description?: string;
};

export function WalterPlaceholderPage({
  title,
  description = "该板块尚未建设，后续会逐步完善。",
}: Props) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/80 px-6 py-16 text-center">
      <p className="sr-only">{title}</p>
      <p className="mx-auto mb-8 max-w-md text-sm leading-relaxed text-slate-600">{description}</p>
      <Link
        href="/"
        scroll={false}
        className="inline-flex rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-amber-700"
      >
        返回 Walter&apos;s world
      </Link>
    </div>
  );
}
