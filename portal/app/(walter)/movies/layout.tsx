import { Suspense } from "react";
import { MoviesPathRecorder } from "@/components/media/MoviesPathRecorder";

export default function MoviesLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* usePathname 需 Suspense，否则部分环境下 /movies 会 CSR bailout 报错 */}
      <Suspense fallback={null}>
        <MoviesPathRecorder />
      </Suspense>
      {children}
    </>
  );
}
