"use client";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="sc-empty sc-rise mx-auto max-w-md">
      <p className="font-display text-lg font-bold text-[var(--ink)]">Something went wrong</p>
      <p className="mt-2 text-sm text-[var(--muted)]">
        {error.message || "Please try again. Your session and wallet are safe."}
      </p>
      <button type="button" className="sc-btn mt-5" onClick={() => reset()}>
        Try again
      </button>
    </div>
  );
}
