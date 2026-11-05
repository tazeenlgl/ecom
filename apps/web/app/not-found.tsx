import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="container-x flex min-h-[60vh] flex-col items-center justify-center py-24 text-center">
      <p className="eyebrow">404</p>
      <h1 className="display-title mt-3 text-5xl">We couldn’t find that page</h1>
      <p className="mt-4 text-muted">It may have moved, or it’s no longer available.</p>
      <Link href="/shop" className="btn-primary mt-8">Continue shopping</Link>
    </div>
  );
}
