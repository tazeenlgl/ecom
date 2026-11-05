'use client';

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="container-x flex min-h-[60vh] flex-col items-center justify-center py-24 text-center">
      <h1 className="display-title text-4xl">Something went wrong</h1>
      <p className="mt-4 text-muted">Please try again in a moment.</p>
      <button className="btn-primary mt-8" onClick={reset}>Try again</button>
    </div>
  );
}
