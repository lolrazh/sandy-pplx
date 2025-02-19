/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      keyframes: {
        flicker: {
          '0%, 100%': { opacity: '0' },
          '50%': { opacity: '1' }
        }
      },
      animation: {
        flicker: 'flicker 2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
} 