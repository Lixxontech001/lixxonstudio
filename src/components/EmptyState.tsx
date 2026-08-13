import { Feather } from 'lucide-react';

export default function EmptyState({ message }: { message?: string }) {
  return (
    <div className="container-narrow py-24 text-center">
      <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-taupe-light mb-8">
        <Feather size={24} strokeWidth={1.5} className="text-bronze" />
      </div>
      <h3 className="font-serif text-3xl text-charcoal font-light">
        {message || 'No articles yet'}
      </h3>
      <p className="text-charcoal-muted text-base mt-4 max-w-md mx-auto leading-relaxed">
        Our editors are crafting new stories. Check back soon for the latest in skincare, style, and minimalist wellness.
      </p>
    </div>
  );
}
