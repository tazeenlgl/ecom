// Only on /shop: a root loading boundary would stream before notFound()/redirect() run,
// turning real 404s and sign-in redirects into 200 responses.
export default function Loading() {
  return (
    <div className="container-x py-16" aria-busy="true" aria-label="Loading">
      <div className="skeleton h-12 w-64 rounded-xl" />
      <div className="mt-10 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => <div key={i} className="skeleton aspect-[4/5] rounded-2xl" />)}
      </div>
    </div>
  );
}
