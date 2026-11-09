import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        background: '#0d1117',
        surface: '#161b22',
        surfaceBorder: '#30363d',
        textMain: '#f0f6fc',
        textMuted: '#8b949e',
        accentGreen: '#238636',
        accentGreenHover: '#2ea043',
      },
    },
  },
  plugins: [],
};
export default config;
