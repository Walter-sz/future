import { WalterSectionGrid } from "@/hub/section-grid";

export default function WalterHomePage() {
  return (
    <div>
      <p className="mb-8 text-sm leading-relaxed text-slate-600">
        选择一个板块进入。小川足球为本站内的 Mike 足球管理；其余板块为预留位，后续扩展。
      </p>
      <WalterSectionGrid />
    </div>
  );
}
