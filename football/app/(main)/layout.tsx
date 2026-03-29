import { MainNav } from "@/components/MainNav";

export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <MainNav />
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </>
  );
}
