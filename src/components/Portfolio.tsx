import { useIntersectionObserver } from '../hooks/useIntersectionObserver';
import { useNavigation } from '../context/NavigationContext';
import { ArrowRight, ExternalLink, ArrowLeftRight } from 'lucide-react';
import { projects } from '../data/projects';

export default function Portfolio() {
  const [ref, isVisible] = useIntersectionObserver({ threshold: 0.05 });
  const { navigate } = useNavigation();

  const scrollToSection = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <section
      id="portfolio"
      ref={ref as React.RefObject<HTMLElement>}
      className="py-28 bg-white"
    >
      <div className="max-w-7xl mx-auto px-6">
        <div className={`text-center mb-16 section-reveal ${isVisible ? 'revealed' : ''}`}>
          <span className="inline-flex items-center gap-2 px-4 py-1.5 bg-accent-100 text-accent-600 text-xs font-semibold rounded-full tracking-widest uppercase mb-4">
            Our Work
          </span>
          <h2 className="font-display text-4xl md:text-5xl font-bold text-primary leading-tight">
            Concept Redesigns That{' '}
            <span className="gradient-text">Changed Everything</span>
          </h2>
          <p className="mt-4 text-gray-500 text-lg max-w-2xl mx-auto">
            Tap any project to see the full case study with before and after transformation, results, and client testimonial.
          </p>
        </div>

        <div className={`flex items-center justify-center gap-2 mb-10 section-reveal reveal-delay-1 ${isVisible ? 'revealed' : ''}`}>
          <div className="flex items-center gap-2 bg-gray-100 rounded-full px-4 py-2">
            <ArrowLeftRight size={14} className="text-accent-500" />
            <span className="text-gray-500 text-sm">Tap any card to view the full project</span>
          </div>
        </div>

        {/* Grid: always shows after image, before on hover (desktop) */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {projects.map((project, i) => (
            <button
              key={project.slug}
              onClick={() => navigate({ type: 'project', slug: project.slug })}
              className={`group relative rounded-3xl overflow-hidden shadow-lg cursor-pointer text-left section-reveal reveal-delay-${Math.min((i % 3) + 1, 6)} ${isVisible ? 'revealed' : ''}`}
              style={{ aspectRatio: '4/3' }}
            >
              {/* Before image (fades out on hover, desktop only) */}
              <img
                src={project.before}
                alt={`${project.title} before`}
                className="absolute inset-0 w-full h-full object-cover transition-all duration-700 group-hover:opacity-0 hidden sm:block"
                loading="lazy"
              />

              {/* After image (always visible on mobile, fades in on hover desktop) */}
              <img
                src={project.after}
                alt={`${project.title} after`}
                className="absolute inset-0 w-full h-full object-cover transition-all duration-700 group-hover:scale-105 sm:opacity-0 sm:group-hover:opacity-100"
                loading="lazy"
              />

              {/* Overlay */}
              <div className="absolute inset-0 bg-gradient-to-t from-primary/90 via-primary/20 to-transparent" />

              {/* Top badge */}
              <div className="absolute top-4 left-4">
                <span className={`px-3 py-1 text-xs font-semibold text-white rounded-full bg-gradient-to-r ${project.color} shadow-lg`}>
                  {project.tag}
                </span>
              </div>

              {/* Before/After label */}
              <div className="absolute top-4 right-4 bg-white/10 backdrop-blur-md rounded-full px-3 py-1 border border-white/20 text-white text-[10px] font-medium hidden sm:block">
                <span className="group-hover:hidden">Before</span>
                <span className="hidden group-hover:inline">After</span>
              </div>

              {/* Result badge */}
              <div className="absolute top-14 right-4 bg-white rounded-xl px-3 py-1.5 shadow-lg">
                <span className="text-green-600 font-bold text-xs">{project.result}</span>
              </div>

              {/* Bottom content */}
              <div className="absolute bottom-0 left-0 right-0 p-5">
                <h3 className="text-white font-semibold text-lg">{project.title}</h3>
                <p className="text-white/70 text-sm mt-1 leading-relaxed line-clamp-2">
                  {project.description}
                </p>

                <div className="mt-3 inline-flex items-center gap-2 text-white text-sm font-semibold">
                  <span>View Project</span>
                  <ExternalLink size={14} />
                </div>
              </div>
            </button>
          ))}
        </div>

        <div className={`text-center mt-14 section-reveal reveal-delay-3 ${isVisible ? 'revealed' : ''}`}>
          <p className="text-gray-500 mb-5">Want to see what we'd do with your website?</p>
          <button
            onClick={() => scrollToSection('free-preview')}
            className="inline-flex items-center gap-2 px-8 py-4 bg-gradient-to-r from-accent-500 to-secondary-500 text-white font-semibold rounded-2xl shadow-lg shadow-accent-500/30 hover:-translate-y-1 hover:shadow-accent-500/50 transition-all duration-300"
          >
            <span>Get My Free Homepage Preview</span>
            <ArrowRight size={18} />
          </button>
        </div>
      </div>
    </section>
  );
}
