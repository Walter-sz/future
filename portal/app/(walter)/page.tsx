import { WalterAgentGrid } from "@/hub/agent-grid";
import { WalterSectionGrid } from "@/hub/section-grid";

export default function WalterHomePage() {
  return (
    <div className="space-y-14">
      <section aria-labelledby="sections-heading">
        <h2 id="sections-heading" className="mb-1 text-lg font-semibold text-slate-900">
          功能板块
        </h2>
        <p className="mb-6 max-w-2xl text-sm leading-relaxed text-slate-600">
          按业务域进入各功能空间。小川足球、影视资源、持续学习&amp;知识管理等已接入，其余板块仍在建设中。
        </p>
        <WalterSectionGrid />
      </section>

      <section aria-labelledby="agents-heading" className="border-t border-amber-200/60 pt-14">
        <h2 id="agents-heading" className="mb-1 text-lg font-semibold text-slate-900">
          Agents 管理
        </h2>
        <p className="mb-6 max-w-2xl text-sm leading-relaxed text-slate-600">
          每个 Agent 有独立入口，便于后续接入自动化、工具调用与对话编排；当前为占位控制台。
        </p>
        <WalterAgentGrid />
      </section>
    </div>
  );
}
