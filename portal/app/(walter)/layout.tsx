import { WalterHubHeader } from "@/hub/walter-hub-header";

export default function WalterHubLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-amber-50/40 to-slate-50">
      <WalterHubHeader />
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  );
}

