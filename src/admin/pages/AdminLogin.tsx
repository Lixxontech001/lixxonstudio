import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useNavigation } from '../../context/NavigationContext';
import { Lock, Mail } from 'lucide-react';

export default function AdminLogin() {
  const { signIn } = useAuth();
  const { navigate } = useNavigation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await signIn(email, password);
    if (error) {
      setError(error);
      setLoading(false);
    } else {
      navigate({ name: 'admin-dashboard' });
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-bronze/20 mb-4">
            <Lock size={22} strokeWidth={1.5} className="text-bronze" />
          </div>
          <h1 className="font-serif text-2xl text-white">Lixxon Studio</h1>
          <p className="text-gray-500 text-sm mt-1 tracking-wider uppercase">Editorial CMS</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1.5 tracking-wider uppercase">Email</label>
            <div className="relative">
              <Mail size={16} strokeWidth={1.5} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                className="w-full bg-gray-800 border border-gray-700 text-white pl-10 pr-4 py-3 rounded text-sm focus:outline-none focus:border-bronze"
                placeholder="editor@lixxonstudio.com"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1.5 tracking-wider uppercase">Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              className="w-full bg-gray-800 border border-gray-700 text-white px-4 py-3 rounded text-sm focus:outline-none focus:border-bronze"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <div className="bg-red-900/30 border border-red-800 text-red-300 text-sm px-4 py-3 rounded">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-bronze text-white py-3 rounded text-sm font-medium hover:bg-bronze-dark transition-colors disabled:opacity-50"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
