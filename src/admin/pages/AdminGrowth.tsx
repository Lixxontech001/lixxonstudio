import { useState } from 'react';
import { TrendingUp, Search, Users, ShoppingBag, FileText, Eye } from 'lucide-react';
import { Panel, Notice, useAdminRpc, Loading, Empty, Btn } from '../components/ui';

type Growth = {
  days: number;
  traffic: { views: number; views_previous: number; readers: number; readers_previous: number; sessions: number; daily: { date: string; views: number }[]; top_posts: { title: string; slug: string; views: number }[] };
  content: { published: number; published_previous: number; drafts: number; scheduled: number; avg_reading_time: number | null; missing_meta: number; thin: number; orphans: number; no_inbound_links: number };
  search: { total: number; unique_terms: number; zero_result: number; top_queries: { query: string; searches: number; avg_results: number }[]; misses: { query: string; misses: number }[] };
  audience: { subscribers_total: number; subscribers_new: number; pending_double_optin: number; preferred_categories: { category: string; readers: number }[] };
  commerce: { paid_orders: number; paid_orders_previous: number; revenue: number; revenue_previous: number; aov: number; refund_requests: number; abandoned_carts: number; recoverable_carts: number; gift_card_liability: number; promo_redemptions: number; top_products: { name: string; units: number; revenue: number }[] };
};

const delta = (now: number, prev: number) => {
  if (!prev) return now > 0 ? 'new' : '—';
  const pct = Math.round(((now - prev) / prev) * 100);
  return `${pct >= 0 ? '+' : ''}${pct}%`;
};

export default function AdminGrowth() {
  const [days, setDays] = useState(30);
  const report = useAdminRpc<Growth>('admin_growth_report', { p_days: days });

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="font-serif text-2xl text-charcoal flex items-center gap-2"><TrendingUp size={20} className="text-bronze" /> Growth &amp; SEO</h1>
          <p className="text-sm text-charcoal-muted mt-1">Everything below is computed from live rows — traffic, pipeline, search demand, audience and money.</p>
        </div>
        <div className="flex gap-1">
          {[7, 30, 90, 180, 365].map(d => (
            <button key={d} onClick={() => setDays(d)}
              className={`px-3 py-1.5 text-xs rounded-sm border ${days === d ? 'bg-charcoal text-white border-charcoal' : 'border-taupe/50 text-charcoal-muted hover:border-bronze'}`}>{d}d</button>
          ))}
        </div>
      </div>

      {report.loading ? <Loading /> : report.error ? <Notice tone="error">{report.error}</Notice> : !report.data ? <Empty>No data.</Empty> : (() => {
        const r = report.data;
        const maxDaily = Math.max(1, ...r.traffic.daily.map(d => d.views));
        return (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
              {[
                { label: 'Article views', value: r.traffic.views.toLocaleString(), sub: `${delta(r.traffic.views, r.traffic.views_previous)} vs previous`, icon: <Eye size={14} /> },
                { label: 'Readers', value: r.traffic.readers.toLocaleString(), sub: `${delta(r.traffic.readers, r.traffic.readers_previous)} vs previous`, icon: <Users size={14} /> },
                { label: 'Subscribers', value: r.audience.subscribers_total.toLocaleString(), sub: `+${r.audience.subscribers_new} confirmed in range`, icon: <Users size={14} /> },
                { label: 'Revenue', value: `${r.commerce.revenue.toFixed(2)}`, sub: `${delta(r.commerce.revenue, r.commerce.revenue_previous)} vs previous`, icon: <ShoppingBag size={14} /> },
              ].map(c => (
                <div key={c.label} className="bg-white border border-taupe/30 rounded-sm p-4">
                  <p className="text-xs uppercase tracking-wide text-charcoal-muted flex items-center gap-1.5">{c.icon}{c.label}</p>
                  <p className="text-2xl font-serif text-charcoal mt-1">{c.value}</p>
                  <p className="text-[11px] text-charcoal-muted">{c.sub}</p>
                </div>
              ))}
            </div>

            <Panel title="Traffic" icon={<TrendingUp size={15} className="text-bronze" />}>
              {r.traffic.daily.length === 0 ? <Empty>No views recorded in this window.</Empty> : (
                <div className="flex items-end gap-0.5 h-24 mb-4">
                  {r.traffic.daily.map(d => (
                    <div key={d.date} title={`${d.date}: ${d.views} views`} className="flex-1 bg-bronze/70 hover:bg-bronze" style={{ height: `${Math.max(3, (d.views / maxDaily) * 100)}%` }} />
                  ))}
                </div>
              )}
              {r.traffic.top_posts.length > 0 && (
                <ol className="text-sm space-y-1">
                  {r.traffic.top_posts.map((p, i) => (
                    <li key={p.slug} className="flex justify-between gap-3">
                      <span className="truncate text-charcoal-light">{i + 1}. {p.title}</span>
                      <span className="text-charcoal-muted text-xs">{p.views.toLocaleString()} views</span>
                    </li>
                  ))}
                </ol>
              )}
            </Panel>

            <div className="grid lg:grid-cols-2 gap-5">
              <Panel title="Content pipeline" icon={<FileText size={15} className="text-bronze" />}>
                <ul className="text-sm space-y-1.5 text-charcoal-light">
                  <li className="flex justify-between"><span>Published in range</span><span>{r.content.published} ({delta(r.content.published, r.content.published_previous)})</span></li>
                  <li className="flex justify-between"><span>Drafts / scheduled</span><span>{r.content.drafts} / {r.content.scheduled}</span></li>
                  <li className="flex justify-between"><span>Average reading time</span><span>{r.content.avg_reading_time ?? '—'} min</span></li>
                  <li className="flex justify-between"><span>Missing SEO title/description</span><span className={r.content.missing_meta ? 'text-amber-700' : ''}>{r.content.missing_meta}</span></li>
                  <li className="flex justify-between"><span>Thin articles (&lt; 2000 chars)</span><span>{r.content.thin}</span></li>
                  <li className="flex justify-between"><span>No category or author</span><span>{r.content.orphans}</span></li>
                  <li className="flex justify-between"><span>Never linked from another article</span><span className={r.content.no_inbound_links ? 'text-amber-700' : ''}>{r.content.no_inbound_links}</span></li>
                </ul>
              </Panel>

              <Panel title="Search demand" icon={<Search size={15} className="text-bronze" />}>
                <p className="text-xs text-charcoal-muted mb-3">{r.search.total} searches · {r.search.unique_terms} unique terms · {r.search.zero_result} with no results</p>
                {r.search.top_queries.length > 0 && (
                  <table className="min-w-full text-xs mb-3">
                    <thead><tr className="text-charcoal-muted text-left"><th className="py-1">Top query</th><th className="py-1">Searches</th><th className="py-1">Avg results</th></tr></thead>
                    <tbody>{r.search.top_queries.map(q => <tr key={q.query} className="border-t border-taupe/15"><td className="py-1">{q.query}</td><td className="py-1">{q.searches}</td><td className="py-1">{q.avg_results}</td></tr>)}</tbody>
                  </table>
                )}
                {r.search.misses.length > 0 && (
                  <>
                    <p className="text-xs font-medium text-charcoal mb-1">Content briefs (no results)</p>
                    <ul className="text-xs text-charcoal-muted space-y-0.5">
                      {r.search.misses.map(m => <li key={m.query}>{m.query} — {m.misses}×</li>)}
                    </ul>
                  </>
                )}
              </Panel>

              <Panel title="Audience" icon={<Users size={15} className="text-bronze" />}>
                <ul className="text-sm space-y-1.5 text-charcoal-light">
                  <li className="flex justify-between"><span>Confirmed subscribers</span><span>{r.audience.subscribers_total}</span></li>
                  <li className="flex justify-between"><span>New in range</span><span>{r.audience.subscribers_new}</span></li>
                  <li className="flex justify-between"><span>Awaiting double opt-in</span><span>{r.audience.pending_double_optin}</span></li>
                </ul>
                {r.audience.preferred_categories.length > 0 && (
                  <p className="text-xs text-charcoal-muted mt-3">Most requested topics: {r.audience.preferred_categories.map(c => `${c.category} (${c.readers})`).join(', ')}</p>
                )}
              </Panel>

              <Panel title="Commerce" icon={<ShoppingBag size={15} className="text-bronze" />}>
                <ul className="text-sm space-y-1.5 text-charcoal-light">
                  <li className="flex justify-between"><span>Paid orders</span><span>{r.commerce.paid_orders} ({delta(r.commerce.paid_orders, r.commerce.paid_orders_previous)})</span></li>
                  <li className="flex justify-between"><span>Average order value</span><span>{r.commerce.aov.toFixed(2)}</span></li>
                  <li className="flex justify-between"><span>Refund requests</span><span>{r.commerce.refund_requests}</span></li>
                  <li className="flex justify-between"><span>Abandoned / recoverable carts</span><span>{r.commerce.abandoned_carts} / {r.commerce.recoverable_carts}</span></li>
                  <li className="flex justify-between"><span>Gift-card liability</span><span>{r.commerce.gift_card_liability.toFixed(2)}</span></li>
                  <li className="flex justify-between"><span>Promo redemptions</span><span>{r.commerce.promo_redemptions}</span></li>
                </ul>
                {r.commerce.top_products.length > 0 && (
                  <table className="min-w-full text-xs mt-3">
                    <thead><tr className="text-charcoal-muted text-left"><th className="py-1">Product</th><th className="py-1">Units</th><th className="py-1">Revenue</th></tr></thead>
                    <tbody>{r.commerce.top_products.map(p => <tr key={p.name} className="border-t border-taupe/15"><td className="py-1">{p.name}</td><td className="py-1">{p.units}</td><td className="py-1">{p.revenue?.toFixed?.(2) ?? p.revenue}</td></tr>)}</tbody>
                  </table>
                )}
              </Panel>
            </div>

            <div className="mt-5">
              <Btn variant="ghost" onClick={() => report.reload()} busy={report.loading}>Refresh report</Btn>
            </div>
          </>
        );
      })()}
    </div>
  );
}
