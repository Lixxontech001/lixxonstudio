export function PostCardSkeleton() {
  return (
    <div className="flex flex-col">
      <div className="skeleton aspect-[4/5] rounded-sm" />
      <div className="mt-4 space-y-3">
        <div className="skeleton h-3 w-20 rounded-full" />
        <div className="skeleton h-5 w-full" />
        <div className="skeleton h-5 w-3/4" />
        <div className="flex gap-3 pt-1">
          <div className="skeleton h-3 w-16" />
          <div className="skeleton h-3 w-12" />
        </div>
      </div>
    </div>
  );
}

export function HeroSkeleton() {
  return (
    <div className="container-wide pt-12 pb-20 grid lg:grid-cols-2 gap-10 lg:gap-16">
      <div className="skeleton aspect-[3/4] rounded-sm" />
      <div className="flex flex-col gap-6 pt-6">
        <div className="skeleton h-3 w-24 rounded-full" />
        <div className="skeleton h-16 w-full" />
        <div className="skeleton h-16 w-2/3" />
        <div className="skeleton h-4 w-full mt-4" />
        <div className="skeleton h-4 w-4/5" />
        <div className="skeleton h-12 w-48 mt-6" />
      </div>
    </div>
  );
}

export function FeedSkeleton() {
  return (
    <section className="container-wide py-16">
      <div className="flex items-center justify-between mb-10">
        <div>
          <div className="skeleton h-3 w-24 rounded-full mb-2" />
          <div className="skeleton h-8 w-48" />
        </div>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-12">
        {[...Array(6)].map((_, i) => (
          <PostCardSkeleton key={i} />
        ))}
      </div>
    </section>
  );
}
