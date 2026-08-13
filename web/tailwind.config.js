/** @type {import('tailwindcss').Config} */
// Terminal palette — mirrors web/src/features/signal/terminal/terminal.css
// so the whole app inherits the Signal look via existing slate/indigo utilities.
const term = {
  bg: '#05080a',
  bg2: '#0a0f12',
  panel: '#0b1114',
  panelHd: '#0e161a',
  border: '#17242a',
  border2: '#23343b',
  muted: '#526059',
  textDim: '#7d8f88',
  text: '#c6d3cc',
  textHi: '#e3ecda',
  green: '#2ee56b',
  red: '#ff5a5a',
  amber: '#f5a623',
  cyan: '#35c7e0',
  blue: '#4f9dff',
  mag: '#c07bff',
};

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        pos: term.green,
        neg: term.red,
        // Remap slate -> terminal neutrals so existing bg-slate-*/text-slate-*/border-slate-*
        // utilities across every page pick up the Bloomberg-terminal look for free.
        slate: {
          50:  term.textHi,
          100: term.textHi,
          200: term.text,
          300: term.text,
          400: term.textDim,
          500: term.textDim,
          600: term.muted,
          700: term.border2,
          800: term.border,
          900: term.panel,
          950: term.bg,
        },
        // Remap indigo -> amber (primary accent) so btn-primary / accent chips read as terminal-amber.
        indigo: {
          200: '#ffdc90',
          300: '#ffd070',
          400: '#ffc043',
          500: term.amber,
          600: term.amber,
          700: '#c47f00',
          800: '#8f5c00',
          900: '#4a3200',
          950: '#231800',
        },
        // Semantic status colors -> terminal red/green/amber for consistent P/L + alerts.
        emerald: {
          200: '#a5f0be',
          300: '#7fe8a1',
          400: term.green,
          500: term.green,
          600: '#1fbf58',
          700: '#188c43',
          800: '#0f5a2c',
          900: '#082e16',
          950: '#03170a',
        },
        red: {
          200: '#ffc1c1',
          300: '#ffa0a0',
          400: term.red,
          500: term.red,
          600: '#e43a3a',
          700: '#a52424',
          800: '#701818',
          900: '#3d0d0d',
          950: '#1c0505',
        },
        amber: {
          200: '#ffdc90',
          300: '#ffcc66',
          400: '#ffbb44',
          500: term.amber,
          600: term.amber,
          700: '#c47f00',
          800: '#8f5c00',
          900: '#4a3200',
          950: '#231800',
        },
        cyan: {
          300: '#7de6f5',
          400: term.cyan,
          500: term.cyan,
          600: '#1ea5bd',
        },
        term,
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
        // Route Tailwind's default sans stack to the terminal mono so every existing
        // component switches typeface without touching JSX.
        sans: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      borderRadius: {
        // Terminal look uses tight 2–3px corners, not 8–12px pills.
        DEFAULT: '2px',
        sm: '2px',
        md: '2px',
        lg: '3px',
        xl: '3px',
        '2xl': '4px',
      },
    },
  },
  plugins: [],
};
