/** Accordion FAQ rendered from `posts.faq` (also emitted as FAQPage JSON-LD by ArticleReader). */
export default function ArticleFaq({ faq }: { faq?: { q: string; a: string }[] | null }) {
  if (!faq || faq.length === 0) return null;
  return (
    <section aria-labelledby="faq-heading" className="my-12">
      <h2 id="faq-heading" className="font-serif text-2xl text-charcoal mb-5">Frequently asked</h2>
      <div className="divide-y divide-taupe/40 border-y border-taupe/40">
        {faq.map((f, i) => (
          <details key={i} className="group py-4">
            <summary className="cursor-pointer list-none flex items-center justify-between gap-4 text-[15px] font-medium text-charcoal">
              {f.q}
              <span className="text-bronze text-xl leading-none transition-transform group-open:rotate-45" aria-hidden>+</span>
            </summary>
            <p className="mt-3 text-[15px] leading-relaxed text-charcoal-light whitespace-pre-line">{f.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
