import { useEffect, useState, type FormEvent } from 'react';
import { Users, ShieldCheck, Trash2, Loader2 } from 'lucide-react';
import { supabase, rows } from '../../lib/supabaseClient';
import { useAuth } from '../../context/AuthContext';

type Member = { user_id: string; email: string; role: 'owner' | 'editor' | 'moderator'; created_at: string; last_sign_in_at: string | null };
const ROLES: Record<Member['role'], string> = {
  owner: 'Everything, including team, settings, backups and payments',
  editor: 'Articles, media, categories, series, glossary, collections, newsletter',
  moderator: 'Comments, reviews, reader questions, messages and feedback only',
};

export default function AdminTeam() {
  const { adminRole, user } = useAuth();
  const [members, setMembers] = useState<Member[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Member['role']>('editor');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const isOwner = adminRole === 'owner';

  const load = async () => { const { data } = await supabase.rpc('list_admins'); setMembers(rows(data)); };
  useEffect(() => { load(); }, []);

  const add = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setMsg('');
    const { data, error } = await supabase.rpc('set_admin_role', { p_email: email.trim(), p_role: role });
    setBusy(false);
    if (error) { setMsg(error.message); return; }
    if (data === 'not_found') { setMsg('No account with that email yet. Ask them to sign in once at /account (magic link), then add them.'); return; }
    setMsg('Saved.'); setEmail(''); load();
  };
  const changeRole = async (m: Member, r: Member['role']) => { const { error } = await supabase.rpc('set_admin_role', { p_email: m.email, p_role: r }); if (error) alert(error.message); load(); };
  const remove = async (m: Member) => { if (!confirm(`Remove ${m.email} from the team?`)) return; const { error } = await supabase.rpc('remove_admin', { p_user_id: m.user_id }); if (error) alert(error.message); load(); };

  return (
    <div>
      <div className="mb-6"><h1 className="font-serif text-2xl text-charcoal flex items-center gap-2"><Users size={20} className="text-bronze" /> Team & roles</h1><p className="text-sm text-charcoal-muted mt-1">Access is enforced by the database (row-level security), not just hidden in the UI.</p></div>
      <div className="grid sm:grid-cols-3 gap-3 mb-6">{(Object.keys(ROLES) as Member['role'][]).map(r => <div key={r} className="bg-white border border-taupe/30 rounded-sm p-4"><p className="text-xs uppercase tracking-wide text-bronze flex items-center gap-1"><ShieldCheck size={12} /> {r}</p><p className="text-sm text-charcoal-light mt-1">{ROLES[r]}</p></div>)}</div>
      {isOwner && (
        <form onSubmit={add} className="bg-white rounded-sm p-5 border border-taupe/30 mb-6 flex flex-wrap gap-3 items-end">
          <label className="text-xs text-charcoal-muted uppercase tracking-wide flex-1 min-w-[220px]">Email<input required type="email" value={email} onChange={e => setEmail(e.target.value)} className="w-full mt-1 border border-taupe/50 px-3 py-2 text-sm rounded-sm focus:outline-none focus:border-bronze normal-case" /></label>
          <label className="text-xs text-charcoal-muted uppercase tracking-wide">Role<select value={role} onChange={e => setRole(e.target.value as Member['role'])} className="block mt-1 border border-taupe/50 px-3 py-2 text-sm rounded-sm bg-white normal-case"><option value="editor">Editor</option><option value="moderator">Moderator</option><option value="owner">Owner</option></select></label>
          <button disabled={busy} className="px-4 py-2 bg-charcoal text-white text-sm rounded-sm hover:bg-bronze disabled:opacity-60">{busy ? <Loader2 size={14} className="animate-spin" /> : 'Add / update'}</button>
          {msg && <p className="w-full text-sm text-charcoal-light">{msg}</p>}
        </form>
      )}
      <div className="bg-white rounded-sm border border-taupe/30 divide-y divide-taupe/20">
        {members.map(m => (
          <div key={m.user_id} className="p-4 flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[200px]"><p className="text-sm text-charcoal font-medium">{m.email} {m.user_id === user?.id && <span className="text-xs text-charcoal-muted">(you)</span>}</p><p className="text-xs text-charcoal-muted">Added {new Date(m.created_at).toLocaleDateString()}{m.last_sign_in_at && ` · last sign-in ${new Date(m.last_sign_in_at).toLocaleDateString()}`}</p></div>
            {isOwner && m.user_id !== user?.id ? <select value={m.role} onChange={e => changeRole(m, e.target.value as Member['role'])} className="border border-taupe/50 px-2 py-1.5 text-xs rounded-sm bg-white"><option value="owner">Owner</option><option value="editor">Editor</option><option value="moderator">Moderator</option></select> : <span className="text-xs uppercase tracking-wide text-bronze">{m.role}</span>}
            {isOwner && m.user_id !== user?.id && <button onClick={() => remove(m)} className="p-2 text-charcoal-muted hover:text-red-600" aria-label="Remove"><Trash2 size={14} /></button>}
          </div>
        ))}
      </div>
    </div>
  );
}
