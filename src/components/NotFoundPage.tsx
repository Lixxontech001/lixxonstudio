import { Compass, ArrowLeft } from 'lucide-react';
import { useNavigation } from '../context/NavigationContext';

export default function NotFoundPage() {
  const { navigate } = useNavigation();

  return (
    <main className="container-narrow py-24 md:py-32 text-center">
      <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-taupe-light mb-10">
        <Compass size={32} strokeWidth={1.25} className="text-bronze" />
      </div>
      <p className="text-[10px] tracking-ultra-wide uppercase text-bronze mb-4">Error 404</p>
      <h1 className="font-serif text-4xl md:text-6xl text-charcoal font-light leading-tight">
        This page wandered off.
      </h1>
      <p className="text-charcoal-muted text-lg mt-6 max-w-md mx-auto leading-relaxed">
        The story you are looking for may have been moved, retitled, or never existed. Let us guide you back to the magazine.
      </p>
      <button
        onClick={() => navigate({ name: 'home' })}
        className="inline-flex items-center gap-3 mt-10 px-8 py-4 bg-charcoal text-white text-xs tracking-editorial uppercase font-medium hover:bg-bronze transition-all duration-500 rounded-sm"
      >
        <ArrowLeft size={14} strokeWidth={1.5} /> Return to Feed
      </button>
    </main>
  );
}
