import { useNavigation } from '../context/NavigationContext';

interface LogoProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'dark' | 'light';
}

export default function Logo({ className = '', size = 'md', variant = 'dark' }: LogoProps) {
  const { goHome } = useNavigation();

  const heights: Record<string, string> = {
    sm: 'h-9',
    md: 'h-12',
    lg: 'h-16',
  };

  if (variant === 'light') {
    return (
      <button
        onClick={goHome}
        aria-label="Go to homepage"
        className={`flex items-center group ${className}`}
      >
        {/* White pill so the dark-colored logo is fully visible on dark backgrounds */}
        <div className="bg-white rounded-2xl px-4 py-2 shadow-lg group-hover:shadow-xl transition-shadow duration-300">
          <img
            src="/assets/images/lixxon_studio.png"
            alt="Lixxon Studio"
            className={`${heights[size]} w-auto object-contain`}
            draggable={false}
          />
        </div>
      </button>
    );
  }

  return (
    <button
      onClick={goHome}
      aria-label="Go to homepage"
      className={`flex items-center group ${className}`}
    >
      <img
        src="/assets/images/lixxon_studio.png"
        alt="Lixxon Studio"
        className={`${heights[size]} w-auto object-contain group-hover:opacity-80 transition-opacity duration-300`}
        draggable={false}
      />
    </button>
  );
}
