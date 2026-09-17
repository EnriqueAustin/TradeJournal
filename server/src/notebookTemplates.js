// Default notebook templates, seeded once by migrate(). Kept dependency-free so
// db.js can import it without a cycle through notebook.js.
export const DEFAULT_NOTE_TEMPLATES = [
  [
    'Pre-market plan',
    `## Pre-market plan

**Bias:**
**Session:** London / New York

### Key levels
- Previous day high / low:
- Asia high / low:
- Weekly open:

### News
-

### Scenarios
1. **If** price sweeps … **then** …
2. **If** …

### Rules for today
- [ ] Max risk per trade:
- [ ] Max trades:
- [ ] Stop after daily loss of:
`,
  ],
  [
    'Session recap',
    `## Session recap

**Net P&L:**
**Trades:**

### What went well
-

### What went wrong
-

### Did I follow the plan?
- [ ] Entries matched a playbook setup
- [ ] Risk stayed within limits
- [ ] No revenge / FOMO trades

### Carry into tomorrow
-
`,
  ],
  [
    'Weekly review',
    `## Weekly review

**Net P&L:**
**Win rate:**
**Best day / worst day:**

### Patterns this week
-

### Mistakes that cost the most
1.

### Best trade (link with #id)
-

### Focus for next week
-
`,
  ],
  [
    'Trade post-mortem',
    `## Trade post-mortem — #

**Setup:**
**Result:**

### Thesis at entry
-

### What actually happened
-

### Execution
- Entry:
- Stop:
- Exit:

### Lesson
>
`,
  ],
];

export const DEFAULT_NOTEBOOK_FOLDERS = ['Trading Plan', 'Session Recaps', 'Lessons', 'Playbook Ideas'];
