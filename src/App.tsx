import { useState } from 'react';
import { useNavigation } from './context/NavigationContext';
import LoadingScreen from './components/LoadingScreen';
import ScrollProgress from './components/ScrollProgress';
import Navigation from './components/Navigation';
import Hero from './components/Hero';
import SocialProof from './components/SocialProof';
import Services from './components/Services';
import WhyChooseUs from './components/WhyChooseUs';
import Process from './components/Process';
import Portfolio from './components/Portfolio';
import FreePreview from './components/FreePreview';
import Testimonials from './components/Testimonials';
import FAQ from './components/FAQ';
import CTA from './components/CTA';
import Footer from './components/Footer';
import ServicePage from './components/ServicePage';
import ProjectPage from './components/ProjectPage';
import { MessageCircle } from 'lucide-react';

export default function App() {
  const [loading, setLoading] = useState(true);
  const { currentPage } = useNavigation();

  const renderPage = () => {
    switch (currentPage.type) {
      case 'service':
        return <ServicePage slug={currentPage.slug} />;
      case 'project':
        return <ProjectPage slug={currentPage.slug} />;
      default:
        return (
          <main>
            <Hero />
            <SocialProof />
            <Services />
            <WhyChooseUs />
            <Process />
            <Portfolio />
            <FreePreview />
            <Testimonials />
            <FAQ />
            <CTA />
          </main>
        );
    }
  };

  return (
    <>
      {loading && <LoadingScreen onComplete={() => setLoading(false)} />}

      <div className={`transition-opacity duration-700 ${loading ? 'opacity-0' : 'opacity-100'}`}>
        <ScrollProgress />
        <Navigation />
        {renderPage()}
        <Footer />

        {/* WhatsApp Floating Button */}
        <a
          href="https://wa.me/?text=Hi%20Lixxon%20Studio!%20I%27d%20like%20a%20free%20homepage%20preview."
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Chat on WhatsApp"
          className="fixed bottom-6 right-6 z-50 w-14 h-14 bg-green-500 rounded-full flex items-center justify-center shadow-2xl shadow-green-500/40 hover:scale-110 hover:shadow-green-500/60 transition-all duration-300"
          style={{ animation: 'float-2 6s ease-in-out infinite' }}
        >
          <MessageCircle size={26} className="text-white fill-white" />
        </a>
      </div>
    </>
  );
}
