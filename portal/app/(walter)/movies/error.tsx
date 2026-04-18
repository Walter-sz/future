"use client";

export default function MoviesError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50/80 px-6 py-8">
      <h2 className="text-lg font-semibold text-red-900">影视资源页加载失败</h2>
      <p className="mt-2 text-sm text-red-800">
        {process.env.NODE_ENV === "development" ? error.message : "服务器处理请求时出错，请查看终端日志或稍后重试。"}
      </p>
      {error.digest ? (
        <p className="mt-1 font-mono text-xs text-red-700/80">digest: {error.digest}</p>
      ) : null}
      <button
        type="button"
        className="mt-4 rounded-lg bg-red-800 px-4 py-2 text-sm text-white hover:bg-red-900"
        onClick={() => reset()}
      >
        重试
      </button>
    </div>
  );
}
