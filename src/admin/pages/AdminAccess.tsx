import { Fragment, useMemo, useState, type FormEvent } from 'react';
import { KeyRound, UserPlus, ShieldCheck, Trash2, LogOut, Crown, Users, Grid3x3 } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../context/AuthContext';
import { Panel, Btn, Notice, Severity, useAdminRpc, useAdminAction, Loading, Empty } from '../components/ui';

type Member = {
  user_id: string; email: string; display_name: string | null; role: string; role_label: string | null;
  status: 'active' | 'suspended'; is_founder: boolean; note: string | null; created_at: string;
  last_sign_in_at: string | null; last_seen_at: string | null;
  permissions: string[] | null; overrides: Record<string, string> | null;
};
type Role = { name: string; label: string; description: string; rank: number; is_system: boolean; members: number; permissions: string[] | null };
type Permission = { key: string; label: string; description: string; category: string; is_dangerous: boolean };

const when = (iso: string | null) => iso ? new Date(iso).toLocaleString() : 'never';

export default function AdminAccess() {
  const { can, isFounder, adminAccess, refreshAdmin } = useAuth();
  const [tab, setTab] = useState<'team' | 'roles' | 'overrides'>('team');
  const team = useAdminRpc<Member[]>('admin_team');
  const roles = useAdminRpc<Role[]>('admin_roles_overview');
  const catalogue = useAdminRpc<Permission[]>('admin_permission_catalogue');
  const action = useAdminAction();

  const members = team.data || [];
  const roleList = roles.data || [];
  const permissions = catalogue.data || [];

  const grouped = useMemo(() => {
    const map = new Map<string, Permission[]>();
    permissions.forEach(p => map.set(p.category, [...(map.get(p.category) || []), p]));
    return Array.from(map.entries());
  }, [permissions]);

  const canManage = can('team.manage');
  const canEditRoles = can('team.roles');
  const canRevoke = can('security.sessions');

  const reloadAll = () => { team.reload(); roles.reload(); };

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('editor');
  const invite = async (e: FormEvent) => {
    e.preventDefault();
    await action.run('invite', async () => {
      const { data, error } = await supabase.rpc('set_admin_role', { p_email: inviteEmail.trim(), p_role: inviteRole });
      if (error) return { error: error.message, text: '' };
      if (data === 'not_found') return { error: 'No account with that email yet — they must sign in once at /account first.', text: '' };
      setInviteEmail('');
      reloadAll();
      return { error: null, text: 'Saved.' };
    });
  };

  const changeRole = (m: Member, role: string) => action.run(`role-${m.user_id}`, async () => {
    const { error } = await supabase.rpc('set_admin_role', { p_email: m.email, p_role: role });
    reloadAll();
    return { error: error?.message || null, text: `${m.email} is now ${role}.` };
  });

  const setStatus = (m: Member, status: 'active' | 'suspended') => action.run(`status-${m.user_id}`, async () => {
    const { error } = await supabase.rpc('admin_update_member', { p_user_id: m.user_id, p_status: status });
    reloadAll();
    return { error: error?.message || null, text: status === 'suspended' ? `${m.email} suspended.` : `${m.email} restored.` };
  });

  const remove = (m: Member) => {
    if (!confirm(`Remove ${m.email} from the team? They keep their reader account.`)) return;
    action.run(`remove-${m.user_id}`, async () => {
      const { error } = await supabase.rpc('remove_admin', { p_user_id: m.user_id });
      reloadAll();
      return { error: error?.message || null, text: `${m.email} removed.` };
    });
  };

  const forceSignout = (m: Member) => action.run(`signout-${m.user_id}`, async () => {
    const { data, error } = await supabase.rpc('admin_force_signout', { p_user_id: m.user_id });
    return { error: error?.message || null, text: error ? '' : `${m.email} will need to sign in again (${data ?? 0} session rows removed).` };
  });

  const transferFounder = (m: Member) => {
    if (!confirm(`Make ${m.email} the protected super admin? Your own account loses the protection and becomes a normal owner.`)) return;
    action.run(`founder-${m.user_id}`, async () => {
      const { error } = await supabase.rpc('admin_transfer_founder', { p_user_id: m.user_id });
      await refreshAdmin();
      reloadAll();
      return { error: error?.message || null, text: `Super admin transferred to ${m.email}.` };
    });
  };

  const toggleOverride = (m: Member, key: string, next: 'grant' | 'deny' | '') => action.run(`ov-${m.user_id}-${key}`, async () => {
    const { error } = await supabase.rpc('admin_set_override', { p_user_id: m.user_id, p_permission: key, p_effect: next });
    team.reload();
    return { error: error?.message || null, text: 'Overrides updated.' };
  });

  const toggleRolePermission = (role: Role, key: string, enabled: boolean) => action.run(`rp-${role.name}-${key}`, async () => {
    const { error } = await supabase.rpc('admin_set_role_permission', { p_role: role.name, p_permission: key, p_enabled: enabled });
    roles.reload();
    return { error: error?.message || null, text: 'Role updated.' };
  });

  const createRole = async (e: FormEvent) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const name = (form.elements.namedItem('roleName') as HTMLInputElement).value;
    const label = (form.elements.namedItem('roleLabel') as HTMLInputElement).value;
    const description = (form.elements.namedItem('roleDesc') as HTMLInputElement).value;
    await action.run('create-role', async () => {
      const { error } = await supabase.rpc('admin_create_role', { p_name: name, p_label: label, p_description: description, p_permissions: [] });
      if (!error) { form.reset(); roles.reload(); }
      return { error: error?.message || null, text: 'Role created.' };
    });
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-serif text-2xl text-charcoal flex items-center gap-2"><KeyRound size={20} className="text-bronze" /> Team &amp; access</h1>
        <p className="text-sm text-charcoal-muted mt-1">
          Roles and permissions are rows in the database, not a list in the app. Everything you change here takes effect on the next request; row-level security enforces it even if someone calls the API directly.
        </p>
      </div>

      {action.message && <div className="mb-4"><Notice tone={action.message.tone}>{action.message.text}</Notice></div>}

      <div className="flex gap-1 mb-5 border-b border-taupe/30">
        {([['team', 'Members', <Users size={14} key="u" />], ['roles', 'Roles & permissions', <Grid3x3 size={14} key="g" />], ['overrides', 'Per-admin overrides', <ShieldCheck size={14} key="s" />]] as const).map(([id, label, icon]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex items-center gap-2 px-3 py-2 text-xs border-b-2 -mb-px ${tab === id ? 'border-bronze text-charcoal' : 'border-transparent text-charcoal-muted hover:text-charcoal'}`}>
            {icon}{label}
          </button>
        ))}
      </div>

      {tab === 'team' && (
        <>
          {canManage && (
            <Panel title="Add an admin" icon={<UserPlus size={15} className="text-bronze" />}>
              <form onSubmit={invite} className="flex flex-wrap items-end gap-3">
                <label className="text-xs text-charcoal-muted uppercase tracking-wide flex-1 min-w-[220px]">Email
                  <input required type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder="them@example.com"
                    className="w-full mt-1 border border-taupe/50 px-3 py-2 text-sm rounded-sm focus:outline-none focus:border-bronze normal-case" />
                </label>
                <label className="text-xs text-charcoal-muted uppercase tracking-wide">Role
                  <select value={inviteRole} onChange={e => setInviteRole(e.target.value)} className="block mt-1 border border-taupe/50 px-3 py-2 text-sm rounded-sm bg-white normal-case">
                    {roleList.map(r => <option key={r.name} value={r.name}>{r.label}</option>)}
                  </select>
                </label>
                <Btn type="submit" busy={action.busy === 'invite'} icon={<UserPlus size={13} />}>Add / update</Btn>
              </form>
              <p className="text-xs text-charcoal-muted mt-3">The person must have signed in once (magic link at /account) before they can be added.</p>
            </Panel>
          )}

          <Panel title={`Members (${members.length})`} icon={<Users size={15} className="text-bronze" />}
            actions={<Btn variant="ghost" onClick={reloadAll} busy={team.loading}>Reload</Btn>}>
            {team.loading ? <Loading /> : team.error ? <Notice tone="error">{team.error}</Notice> : members.length === 0 ? <Empty>No admins yet.</Empty> : (
              <div className="divide-y divide-taupe/20">
                {members.map(m => (
                  <div key={m.user_id} className="py-4 flex flex-wrap items-center gap-3">
                    <div className="flex-1 min-w-[240px]">
                      <p className="text-sm text-charcoal font-medium flex items-center gap-2">
                        {m.display_name || m.email}
                        {m.is_founder && <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-sm"><Crown size={10} /> super admin</span>}
                        {m.status === 'suspended' && <Severity level="warning" />}
                        {m.user_id === adminAccess?.user_id && <span className="text-xs text-charcoal-muted">(you)</span>}
                      </p>
                      <p className="text-xs text-charcoal-muted mt-0.5">
                        {m.email} · signed in {when(m.last_sign_in_at)} · seen {when(m.last_seen_at)} · {m.permissions?.length ?? 0} permissions
                      </p>
                    </div>

                    {canManage && !m.is_founder ? (
                      <select value={m.role} onChange={e => changeRole(m, e.target.value)}
                        className="border border-taupe/50 px-2 py-1.5 text-xs rounded-sm bg-white">
                        {roleList.map(r => <option key={r.name} value={r.name}>{r.label}</option>)}
                      </select>
                    ) : <span className="text-xs uppercase tracking-wide text-bronze">{m.role_label || m.role}</span>}

                    {canManage && !m.is_founder && m.user_id !== adminAccess?.user_id && (
                      m.status === 'active'
                        ? <Btn variant="ghost" onClick={() => setStatus(m, 'suspended')} busy={action.busy === `status-${m.user_id}`}>Suspend</Btn>
                        : <Btn variant="ghost" onClick={() => setStatus(m, 'active')} busy={action.busy === `status-${m.user_id}`}>Restore</Btn>
                    )}
                    {canRevoke && !m.is_founder && m.user_id !== adminAccess?.user_id && (
                      <Btn variant="ghost" title="Revoke sessions" onClick={() => forceSignout(m)} busy={action.busy === `signout-${m.user_id}`} icon={<LogOut size={13} />}>Sign out</Btn>
                    )}
                    {isFounder && !m.is_founder && m.status === 'active' && (
                      <Btn variant="ghost" title="Transfer the protected super-admin flag" onClick={() => transferFounder(m)} busy={action.busy === `founder-${m.user_id}`} icon={<Crown size={13} />}>Make super admin</Btn>
                    )}
                    {canManage && !m.is_founder && m.user_id !== adminAccess?.user_id && (
                      <Btn variant="danger" onClick={() => remove(m)} busy={action.busy === `remove-${m.user_id}`} icon={<Trash2 size={13} />}>Remove</Btn>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </>
      )}

      {tab === 'roles' && (
        <>
          {!canEditRoles && <Notice tone="info">You can see roles, but changing the matrix needs the <code>team.roles</code> permission.</Notice>}
          {canEditRoles && (
            <Panel title="New role">
              <form onSubmit={createRole} className="flex flex-wrap items-end gap-3">
                <input name="roleName" required placeholder="key (a-z_)" className="border border-taupe/50 px-3 py-2 text-sm rounded-sm w-36" />
                <input name="roleLabel" required placeholder="Label" className="border border-taupe/50 px-3 py-2 text-sm rounded-sm w-44" />
                <input name="roleDesc" placeholder="What is this role for?" className="border border-taupe/50 px-3 py-2 text-sm rounded-sm flex-1 min-w-[200px]" />
                <Btn type="submit" busy={action.busy === 'create-role'}>Create role</Btn>
              </form>
            </Panel>
          )}

          <Panel title="Permission matrix" actions={<Btn variant="ghost" onClick={() => roles.reload()} busy={roles.loading} disabled={!canEditRoles}>Reload</Btn>}>
            {roles.loading || catalogue.loading ? <Loading /> : roles.error || catalogue.error ? <Notice tone="error">{roles.error || catalogue.error}</Notice> : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr>
                      <th className="text-left p-2 sticky left-0 bg-white">Permission</th>
                      {roleList.map(r => <th key={r.name} className="p-2 text-center whitespace-nowrap">{r.label}<br /><span className="text-charcoal-muted font-normal">{r.members} member(s)</span></th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {grouped.map(([category, perms]) => (
                      <Fragment key={category}>
                        <tr><td colSpan={roleList.length + 1} className="pt-4 pb-1 text-[10px] uppercase tracking-editorial text-bronze sticky left-0 bg-white">{category}</td></tr>
                        {perms.map(p => (
                          <tr key={p.key} className="border-t border-taupe/15">
                            <td className="p-2 sticky left-0 bg-white">
                              <span className={p.is_dangerous ? 'text-red-700' : 'text-charcoal'}>{p.label}</span>
                              <span className="block text-[10px] text-charcoal-muted">{p.key}</span>
                            </td>
                            {roleList.map(r => {
                              const owner = r.name === 'owner';
                              const on = owner || (r.permissions || []).includes(p.key);
                              return (
                                <td key={r.name} className="p-2 text-center">
                                  <input type="checkbox" checked={on} disabled={owner || !canEditRoles || action.busy === `rp-${r.name}-${p.key}`}
                                    onChange={e => toggleRolePermission(r, p.key, e.target.checked)}
                                    aria-label={`${r.label}: ${p.label}`} />
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </>
      )}

      {tab === 'overrides' && (
        <Panel title="Per-admin overrides" icon={<ShieldCheck size={15} className="text-bronze" />}>
          <p className="text-sm text-charcoal-muted mb-4">
            An override beats the role: <strong>grant</strong> adds a permission, <strong>deny</strong> removes one. Owners and the super admin always hold everything.
          </p>
          {team.loading || catalogue.loading ? <Loading /> : (
            <div className="space-y-6">
              {members.filter(m => !m.is_founder && m.role !== 'owner').map(m => (
                <div key={m.user_id} className="border border-taupe/30 rounded-sm p-4">
                  <p className="text-sm text-charcoal mb-3">{m.display_name || m.email} <span className="text-xs text-charcoal-muted">({m.role_label || m.role})</span></p>
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
                    {permissions.map(p => {
                      const effect = m.overrides?.[p.key] || '';
                      const fromRole = !effect && (roleList.find(r => r.name === m.role)?.permissions || []).includes(p.key);
                      return (
                        <div key={p.key} className="flex items-center justify-between gap-2 text-xs py-1">
                          <span className={fromRole || effect === 'grant' ? 'text-charcoal' : 'text-charcoal-muted'}>{p.label}</span>
                          <select value={effect} disabled={!canEditRoles} onChange={e => toggleOverride(m, p.key, e.target.value as 'grant' | 'deny' | '')}
                            className="border border-taupe/40 px-1.5 py-1 text-[11px] rounded-sm bg-white">
                            <option value="">role default</option>
                            <option value="grant">grant</option>
                            <option value="deny">deny</option>
                          </select>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
              {members.filter(m => !m.is_founder && m.role !== 'owner').length === 0 && <Empty>No non-owner admins to override.</Empty>}
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}
