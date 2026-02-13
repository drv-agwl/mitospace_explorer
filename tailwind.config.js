/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['DM Sans', 'system-ui', 'sans-serif'],
        display: ['DM Sans', 'system-ui', 'sans-serif'],
      },
      colors: {
        surface: {
          50: '#ffffff',
          100: 'rgba(255,255,255,0.9)',
          200: 'rgba(255,255,255,0.5)',
          300: 'rgba(255,255,255,0.3)',
          400: 'rgba(255,255,255,0.2)',
          500: 'rgba(255,255,255,0.1)',
        },
        mito: {
          500: '#14b8a6',
          600: '#0d9488',
          400: '#2dd4bf',
        },
        ink: {
          900: '#ffffff',
          800: 'rgba(255,255,255,0.9)',
          700: 'rgba(255,255,255,0.8)',
          600: 'rgba(255,255,255,0.6)',
          500: 'rgba(255,255,255,0.5)',
          400: 'rgba(255,255,255,0.4)',
        },
      },
      boxShadow: {
        'panel': '0 4px 6px -1px rgba(0, 0, 0, 0.3), 0 2px 4px -2px rgba(0, 0, 0, 0.2)',
        'panel-lg': '0 10px 15px -3px rgba(0, 0, 0, 0.3), 0 4px 6px -4px rgba(0, 0, 0, 0.2)',
        'elevated': '0 20px 25px -5px rgba(0, 0, 0, 0.4), 0 8px 10px -6px rgba(0, 0, 0, 0.3)',
      },
      animation: {
        'fade-in': 'fadeIn 0.2s ease-out',
        'slide-up': 'slideUp 0.3s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      borderRadius: {
        'xl': '1rem',
        '2xl': '1.25rem',
        '3xl': '1.5rem',
      },
    },
  },
  plugins: [],
};
