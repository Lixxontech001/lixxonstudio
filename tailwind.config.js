/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        serif: ['Playfair Display', 'Georgia', 'serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        porcelain: '#FDFBF7',
        ivory: '#FFFFFF',
        charcoal: {
          DEFAULT: '#1A1A1A',
          light: '#2D2D2D',
          muted: '#5A5A5A',
        },
        taupe: {
          DEFAULT: '#E8DFD8',
          light: '#F2EDE7',
          dark: '#D4C7BC',
        },
        bronze: {
          DEFAULT: '#C48B71',
          light: '#D9A88E',
          dark: '#A87056',
          50: '#FBF3EF',
          100: '#F5E6DD',
          200: '#E8C9B6',
        },
      },
      animation: {
        'fade-in': 'fadeIn 0.6s ease forwards',
        'fade-up': 'fadeUp 0.8s cubic-bezier(0.16,1,0.3,1) forwards',
        'slide-in': 'slideIn 0.4s cubic-bezier(0.16,1,0.3,1) forwards',
        'shimmer': 'shimmer 2s infinite',
        'ticker': 'ticker 40s linear infinite',
      },
      keyframes: {
        fadeIn: {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        fadeUp: {
          from: { opacity: '0', transform: 'translateY(24px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        slideIn: {
          from: { transform: 'translateX(100%)' },
          to: { transform: 'translateX(0)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        ticker: {
          '0%': { transform: 'translateX(0%)' },
          '100%': { transform: 'translateX(-50%)' },
        },
      },
      letterSpacing: {
        'editorial': '0.25em',
        'ultra-wide': '0.4em',
      },
    },
  },
  plugins: [],
};
