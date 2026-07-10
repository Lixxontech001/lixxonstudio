/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'sans-serif'],
        display: ['Fraunces', 'serif'],
      },
      colors: {
        primary: {
          DEFAULT: '#0F172A',
          50: '#f0f4ff',
          100: '#e0e9ff',
          500: '#0F172A',
          600: '#0a1020',
          700: '#060b15',
        },
        accent: {
          DEFAULT: '#2563EB',
          50: '#EFF6FF',
          100: '#DBEAFE',
          400: '#60A5FA',
          500: '#2563EB',
          600: '#1D4ED8',
          700: '#1E40AF',
        },
        secondary: {
          DEFAULT: '#06B6D4',
          50: '#ECFEFF',
          100: '#CFFAFE',
          400: '#22D3EE',
          500: '#06B6D4',
          600: '#0891B2',
        },
      },
      animation: {
        'float': 'float 6s ease-in-out infinite',
        'float-delayed': 'float 6s ease-in-out 2s infinite',
        'float-slow': 'float 8s ease-in-out 1s infinite',
        'pulse-slow': 'pulse 4s ease-in-out infinite',
        'spin-slow': 'spin 20s linear infinite',
        'gradient': 'gradient 8s ease infinite',
        'slide-up': 'slideUp 0.6s ease forwards',
        'fade-in': 'fadeIn 0.8s ease forwards',
        'blob': 'blob 8s ease-in-out infinite',
        'marquee': 'marquee 30s linear infinite',
        'counter': 'counter 2s ease-out forwards',
        'shimmer': 'shimmer 2s infinite',
        'glow': 'glow 2s ease-in-out infinite alternate',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0px) rotate(0deg)' },
          '50%': { transform: 'translateY(-20px) rotate(2deg)' },
        },
        gradient: {
          '0%, 100%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
        },
        slideUp: {
          from: { opacity: '0', transform: 'translateY(40px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        fadeIn: {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        blob: {
          '0%, 100%': { transform: 'translate(0, 0) scale(1)' },
          '33%': { transform: 'translate(30px, -50px) scale(1.1)' },
          '66%': { transform: 'translate(-20px, 20px) scale(0.9)' },
        },
        marquee: {
          '0%': { transform: 'translateX(0%)' },
          '100%': { transform: 'translateX(-50%)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        glow: {
          from: { boxShadow: '0 0 20px rgba(37, 99, 235, 0.3)' },
          to: { boxShadow: '0 0 40px rgba(37, 99, 235, 0.7), 0 0 80px rgba(6, 182, 212, 0.3)' },
        },
      },
      backgroundSize: {
        '300%': '300%',
      },
      backdropBlur: {
        xs: '2px',
      },
    },
  },
  plugins: [],
};
