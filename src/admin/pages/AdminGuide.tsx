import { ArrowLeft, Compass } from 'lucide-react';
import { useEffect, useState } from 'react';
import { GUIDE_BACK_DEFAULT, guideBackTarget, type GuideSection } from '../lib/guide';
import { restoreHashFocus } from '../lib/hashFocus';

interface GuideGroup {
  group: string;
  sections: GuideSection[];
}

/**
 * The owner guide: one section per action, in plain English, with an anchor for each. Pages link here with
 * "Don't get it? Open the guide". Back returns to the page and field the owner came from.
 *
 * The steps are loaded when this page opens, so the rest of the admin screens stay small.
 */
export default function AdminGuide() {
  const back = guideBackTarget(window.location.search);
  const [groups, setGroups] = useState<GuideGroup[] | null>(null);

  useEffect(() => {
    let live = true;
    void import('../lib/guideSections').then((module) => {
      if (live) setGroups(module.guideGroups());
    });
    return () => {
      live = false;
    };
  }, []);

  // An address like /admin/guide#vapid opens on that section.
  useEffect(() => restoreHashFocus(window.location.hash), []);

  return (
    <div className="max-w-3xl space-y-6">
      <a
        href={back}
        className="inline-flex min-h-11 items-center gap-2 rounded-sm border border-taupe/50 bg-white px-4 text-sm text-charcoal hover:border-bronze"
      >
        <ArrowLeft size={15} aria-hidden="true" />
        Back to where I was
      </a>

      <header>
        <div className="mb-2 flex items-center gap-2 text-bronze">
          <Compass size={18} aria-hidden="true" />
          <span className="text-xs font-semibold uppercase tracking-[0.18em]">Admin</span>
        </div>
        <h1 className="font-serif text-3xl text-charcoal">Guide</h1>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-charcoal-muted">
          Every owner action, one section each, in plain words. Open the section you need, or press the link on the
          page you were on. Back returns to the field you came from, or to Keys at{' '}
          <a href={GUIDE_BACK_DEFAULT} className="underline hover:text-bronze">/admin/automation/keys</a>.
        </p>
      </header>

      {groups === null && (
        <p role="status" aria-live="polite" className="text-sm text-charcoal-muted">Loading the guide…</p>
      )}

      {groups?.map((group) => (
        <section key={group.group} className="space-y-4">
          <h2 className="font-serif text-2xl text-charcoal">{group.group}</h2>
          {group.sections.map((section) => (
            <article key={section.id} id={section.id} className="rounded-sm border border-taupe/40 bg-white p-4 shadow-sm">
              <h3 className="font-medium text-charcoal">{section.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-charcoal-muted">{section.short}</p>
              <ol className="mt-3 list-decimal pl-5 text-sm leading-relaxed text-charcoal">
                {section.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </article>
          ))}
        </section>
      ))}
    </div>
  );
}
