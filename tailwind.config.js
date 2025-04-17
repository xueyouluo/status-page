/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./public/**/*.{html,js}",
  ],
  theme: {
    extend: {
      colors: {
        operational: '#10b981',
        degraded: '#f59e0b',
        down: '#ef4444',
        incident: '#fffbeb'
      }
    },
  },
  plugins: [],
} 