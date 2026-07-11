import { useEffect } from 'react';
import { useNavigation } from '../context/NavigationContext';
import {
  ArrowRight, ArrowLeft, CheckCircle2,
  Target, Lightbulb, TrendingUp, Star
} from 'lucide-react';
import { getProjectBySlug, projects } from '../data/projects';
import { getServiceBySlug } from '../data/services';

export default function ProjectPage({ slug }: { slug: string }) {
  const { navigate, goHome } = useNavigation();
  const project = getProjectBySlug(slug);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [slug]);

  if (!project) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-center">
          <p className="text-gray-500 mb-4">Project not found.</p>
          <button onClick={goHome} className="text-accent-500 font-semibold">Return home</button>
        </div>
      </div>
    );
  }

  const relatedService = getServiceBySlug(project.relatedService);
  const relatedProjects = projects.filter(p => p.slug !== slug).slice(0, 3);

  return (
    <div className="bg-white">
      {/* Hero */}
      <section className="relative pt-32 pb-20 overflow-hidden animated-bg">
        <div className="absolute top-20 left-10 w-96 h-96 rounded-full bg-accent-500/15 blur-3xl blob-1 pointer-events-none" />
        <div className="absolute bottom-10 right-10 w-80 h-80 rounded-full bg-secondary-500/15 blur-3xl blob-2 pointer-events-none" />

        <div className="relative z-10 max-w-7xl mx-auto px-6">
          <button
            onClick={goHome}
            className="inline-flex items-center gap-2 text-white/50 hover:text-white transition-colors mb-8 text-sm"
          >
            <ArrowLeft size={16} />
            <span>Back to Home</span>
          </button>

          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <span className={`inline-flex items-center px-4 py-1.5 text-xs font-semibold text-white rounded-full bg-gradient-to-r ${project.color} shadow-lg mb-6`}>
                {project.tag}
              </span>

              <h1 className="font-display text-4xl md:text-5xl lg:text-6xl font-bold text-white leading-tight mb-4">
                {project.title}
              </h1>
              <p className="text-white/60 text-lg md:text-xl leading-relaxed mb-8 max-w-lg">
                {project.tagline}
              </p>

              <div className="flex flex-wrap gap-3">
                {project.metrics.slice(0, 2).map((m, i) => (
                  <div key={i} className="glass border border-white/20 rounded-2xl px-5 py-3">
                    <div className="font-display font-bold text-2xl text-white">{m.value}</div>
                    <div className="text-white/50 text-xs">{m.label}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="relative">
              <div className="img-zoom rounded-3xl overflow-hidden shadow-2xl">
                <img src={project.heroImage} alt={project.title} className="w-full h-[400px] object-cover" />
              </div>
              <div className="absolute inset-0 rounded-3xl bg-gradient-to-tr from-primary/40 via-transparent to-accent-500/20" />
            </div>
          </div>
        </div>
      </section>

      {/* Before / After */}
      <section className="py-20 bg-white">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-14">
            <span className="inline-flex items-center gap-2 px-4 py-1.5 bg-accent-100 text-accent-600 text-xs font-semibold rounded-full tracking-widest uppercase mb-4">
              The Transformation
            </span>
            <h2 className="font-display text-3xl md:text-4xl font-bold text-primary">
              Before and After
            </h2>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            <div className="relative">
              <div className="absolute top-4 left-4 z-10 px-3 py-1 bg-gray-900 text-white text-xs font-semibold rounded-full">Before</div>
              <div className="rounded-3xl overflow-hidden shadow-xl">
                <img src={project.before} alt={`${project.title} before`} className="w-full h-[350px] object-cover grayscale" />
              </div>
            </div>
            <div className="relative">
              <div className={`absolute top-4 left-4 z-10 px-3 py-1 bg-gradient-to-r ${project.color} text-white text-xs font-semibold rounded-full`}>After</div>
              <div className="rounded-3xl overflow-hidden shadow-xl">
                <img src={project.after} alt={`${project.title} after`} className="w-full h-[350px] object-cover" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Challenge / Solution / Outcome */}
      <section className="py-20 bg-gray-50">
        <div className="max-w-4xl mx-auto px-6">
          <div className="space-y-10">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center">
                  <Target size={18} className="text-red-500" />
                </div>
                <h3 className="font-semibold text-primary text-lg uppercase tracking-wider">The Challenge</h3>
              </div>
              <p className="text-gray-500 leading-relaxed text-lg pl-12">{project.challenge}</p>
            </div>

            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center">
                  <Lightbulb size={18} className="text-amber-500" />
                </div>
                <h3 className="font-semibold text-primary text-lg uppercase tracking-wider">Our Solution</h3>
              </div>
              <p className="text-gray-500 leading-relaxed text-lg pl-12">{project.solution}</p>
            </div>

            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-10 h-10 rounded-xl bg-green-50 flex items-center justify-center">
                  <TrendingUp size={18} className="text-green-500" />
                </div>
                <h3 className="font-semibold text-primary text-lg uppercase tracking-wider">The Outcome</h3>
              </div>
              <p className="text-gray-500 leading-relaxed text-lg pl-12">{project.outcome}</p>
            </div>
          </div>
        </div>
      </section>

      {/* Metrics */}
      <section className="py-20 bg-white">
        <div className="max-w-5xl mx-auto px-6">
          <div className="text-center mb-12">
            <h2 className="font-display text-3xl md:text-4xl font-bold text-primary mb-4">
              Results in Numbers
            </h2>
            <p className="text-gray-500 text-lg">The measurable impact after launch.</p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {project.metrics.map((m, i) => (
              <div key={i} className="text-center bg-gray-50 rounded-3xl p-6 border border-gray-100">
                <div className={`text-3xl md:text-4xl font-display font-bold bg-gradient-to-br ${project.color} bg-clip-text text-transparent`}>
                  {m.value}
                </div>
                <div className="text-gray-500 text-xs mt-2">{m.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20 bg-gray-50">
        <div className="max-w-5xl mx-auto px-6">
          <div className="text-center mb-12">
            <h2 className="font-display text-3xl md:text-4xl font-bold text-primary mb-4">
              What We Built
            </h2>
            <p className="text-gray-500 text-lg">Key features delivered in this project.</p>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            {project.features.map((feature, i) => (
              <div key={i} className="flex items-center gap-3 p-4 bg-white rounded-2xl border border-gray-100 shadow-sm">
                <div className={`w-6 h-6 rounded-full bg-gradient-to-br ${project.color} flex items-center justify-center flex-shrink-0`}>
                  <CheckCircle2 size={14} className="text-white" />
                </div>
                <span className="text-gray-700 text-sm font-medium">{feature}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonial */}
      <section className="py-20 bg-white">
        <div className="max-w-4xl mx-auto px-6">
          <div className="relative bg-gradient-to-br from-gray-50 to-accent-50 rounded-3xl p-10 border border-gray-100">
            <div className="absolute top-6 left-8 text-accent-200">
              <svg width="48" height="48" viewBox="0 0 48 48" fill="currentColor">
                <path d="M18 32c0 4 3 7 7 7v-4c-2 0-3-1-3-3V20h6v-8H18v20zm14 0c0 4 3 7 7 7v-4c-2 0-3-1-3-3V20h6v-8H32v20z"/>
              </svg>
            </div>

            <div className="relative z-10 pt-8">
              <div className="flex items-center gap-1 mb-4">
                {[...Array(5)].map((_, i) => (
                  <Star key={i} size={16} fill="#F59E0B" className="text-amber-400" />
                ))}
              </div>

              <p className="text-primary text-lg md:text-xl leading-relaxed font-medium mb-6">
                &ldquo;{project.testimonial.text}&rdquo;
              </p>

              <div className="flex items-center gap-3">
                <img src={project.testimonial.avatar} alt={project.testimonial.name} className="w-12 h-12 rounded-2xl object-cover" />
                <div>
                  <div className="font-semibold text-primary text-sm">{project.testimonial.name}</div>
                  <div className="text-gray-400 text-xs">{project.testimonial.role}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Related service CTA */}
      {relatedService && (
        <section className="py-16 bg-gray-50">
          <div className="max-w-5xl mx-auto px-6">
            <div className="bg-white rounded-3xl p-8 border border-gray-100 shadow-sm flex flex-col md:flex-row items-center justify-between gap-6">
              <div>
                <p className="text-gray-400 text-xs font-semibold uppercase tracking-widest mb-2">Want a website like this?</p>
                <h3 className="font-display text-2xl font-bold text-primary">{relatedService.title}</h3>
                <p className="text-gray-500 text-sm mt-1">{relatedService.shortDesc}</p>
              </div>
              <button
                onClick={() => navigate({ type: 'service', slug: relatedService.slug })}
                className="group inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-accent-500 to-secondary-500 text-white font-semibold rounded-2xl shadow-lg shadow-accent-500/30 hover:-translate-y-0.5 transition-all duration-300 whitespace-nowrap"
              >
                <span>Learn More</span>
                <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Related projects */}
      <section className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-6">
          <h2 className="font-display text-3xl font-bold text-primary mb-10 text-center">
            More Projects
          </h2>
          <div className="grid md:grid-cols-3 gap-5">
            {relatedProjects.map((p) => (
              <button
                key={p.slug}
                onClick={() => navigate({ type: 'project', slug: p.slug })}
                className="group relative rounded-3xl overflow-hidden shadow-lg text-left"
                style={{ aspectRatio: '4/3' }}
              >
                <img src={p.after} alt={p.title} className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                <div className="absolute inset-0 bg-gradient-to-t from-primary/90 via-primary/20 to-transparent" />
                <div className="absolute bottom-0 left-0 right-0 p-5">
                  <span className={`inline-block px-3 py-1 text-xs font-semibold text-white rounded-full bg-gradient-to-r ${p.color} mb-2`}>
                    {p.tag}
                  </span>
                  <h3 className="text-white font-semibold text-lg">{p.title}</h3>
                  <p className="text-white/70 text-sm mt-1">{p.result}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 relative overflow-hidden animated-bg">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full bg-accent-500/20 blur-3xl blob-1 pointer-events-none" />
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 rounded-full bg-secondary-500/20 blur-3xl blob-2 pointer-events-none" />

        <div className="relative z-10 max-w-4xl mx-auto px-6 text-center">
          <h2 className="font-display text-3xl md:text-5xl font-bold text-white leading-tight mb-6">
            Want Results Like This?
          </h2>
          <p className="text-white/60 text-lg mb-8 max-w-xl mx-auto">
            Get a free homepage preview for your business today. No commitment, no pressure.
          </p>
          <a
            href="https://wa.me/2349040057383?text=Hi%20Lixxon%20Studio!%20I'd%20like%20a%20free%20homepage%20preview%20for%20my%20business."
            target="_blank"
            rel="noopener noreferrer"
            className="group inline-flex items-center gap-3 px-10 py-5 bg-white text-primary font-bold text-lg rounded-2xl shadow-2xl hover:-translate-y-1 transition-all duration-300"
          >
            <span>Get My Free Homepage Preview</span>
            <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
          </a>
        </div>
      </section>
    </div>
  );
}
