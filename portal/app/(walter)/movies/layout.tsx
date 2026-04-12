import { MoviesPathRecorder } from "@/components/media/MoviesPathRecorder";

export default function MoviesLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <MoviesPathRecorder />
      {children}
    </>
  );
}
