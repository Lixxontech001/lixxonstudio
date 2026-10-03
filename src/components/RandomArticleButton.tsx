import { Shuffle, Loader2 } from 'lucide-react';
import { useNavigation } from '../context/NavigationContext';
import { useRandomArticle } from '../hooks/usePlatform';
import { useToast } from '../context/ToastContext';

export default function RandomArticleButton() {
  const { navigate } = useNavigation();
  const { getRandom, loading } = useRandomArticle();
  const { showToast } = useToast();

  const handleRandom = async () => {
    const result = await getRandom();
    if (result) {
      navigate({ name: 'article', slug: result.slug });
    } else {
      showToast('No articles found', 'info');
    }
  };

  return (
    <button
      onClick={handleRandom}
      disabled={loading}
      className="inline-flex items-center gap-2 px-5 py-3 border border-taupe rounded-sm text-charcoal text-sm hover:border-bronze transition-all disabled:opacity-50"
      aria-label="Read a random article"
    >
      {loading ? <Loader2 size={16} className="animate-spin" /> : <Shuffle size={16} strokeWidth={1.5} />}
      Surprise Me
    </button>
  );
}
