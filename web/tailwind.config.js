/** @type {import('tailwindcss').Config} */
// Every colour family the app leans on resolves to a CSS variable holding an
// "R G B" triplet (defined per theme in src/index.css), so the same
// bg-slate-900 / text-emerald-400 utilities flip between the dark terminal
// palette and the light palette via <html data-theme>. The triplet form keeps
// opacity modifiers (bg-slate-900/40) working.
const v = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;
const scale = (family, steps) =>
  Object.fromEntries(steps.map((s) => [s, v(`${family}-${s}`)]));

const STEPS = [200, 300, 400, 500, 600, 700, 800, 900, 950];
const accent = scale('amber', STEPS);

const term = {
  bg: v('bg'),
  bg2: v('bg-2'),
  panel: v('panel'),
  panelHd: v('panel-hd'),
  border: v('border'),
  border2: v('border-2'),
  muted: v('muted'),
  textDim: v('text-dim'),
  text: v('text'),
  textHi: v('text-hi'),
  green: v('green'),
  red: v('red'),
  amber: v('amber'),
  cyan: v('cyan'),
  blue: v('blue'),
  mag: v('mag'),
};

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        pos: term.green,
        neg: term.red,
        // slate -> terminal neutrals so existing bg-slate-*/text-slate-*/border-slate-*
        // utilities pick up the theme for free.
        slate: {
          50: term.textHi,
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
        // indigo -> amber (primary accent).
        indigo: accent,
        amber: accent,
        emerald: scale('emerald', STEPS),
        red: scale('red', STEPS),
        cyan: scale('cyan', STEPS),
        orange: scale('orange', [300, 400, 800, 950]),
        term,
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
        sans: ['Inter', 'system-ui', '-apple-system', '"Segoe UI"', 'Roboto', 'sans-serif'],
      },
      letterSpacing: {
        // Uppercase labels read fine with a hint of tracking; the old 0.1em
        // terminal spacing made small labels hard to scan.
        wide: '0.02em',
        wider: '0.04em',
        widest: '0.06em',
      },
      borderRadius: {
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
