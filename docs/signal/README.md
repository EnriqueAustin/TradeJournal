# Signal — Research & Analysis Module (docs)

This folder is the **persistent memory** for building **Signal**: a Bloomberg-class research/analysis layer for **XAUUSD** and **US100**, fused into the trade-journal app. It exists so any build session (Claude Code Opus, 5-hour Pro limit) can resume with full context.

## How to use these docs — every session

**At session start:**
1. Read **[STATE.md](STATE.md)** — the resume pointer (last done, next task, in-progress notes).
2. Read **[ROADMAP.md](ROADMAP.md)** — find the next session `Sx.y` and its acceptance criteria.
3. If starting a new **epic**, first run the deep-research pass and write `FEATURE-SPEC-<epic>.md` (see the auto-mode directive below), then update [BLOOMBERG-PARITY.md](BLOOMBERG-PARITY.md).
4. Skim **[CONVENTIONS.md](CONVENTIONS.md)** so new code mirrors existing app patterns.

**During the session:** build one vertical slice that ends green (compiles, runs, visible result). Keep [SCHEMA.md](SCHEMA.md) and [API-CONTRACT.md](API-CONTRACT.md) in sync as you add tables/endpoints.

**At session end:**
1. Append to **[BUILD-LOG.md](BUILD-LOG.md)** (what shipped, decisions, gotchas).
2. Update **[STATE.md](STATE.md)** (tick the completed session, set the next one, note any partial state).
3. Tick the checkbox in **[ROADMAP.md](ROADMAP.md)**.

## Auto-mode deep-research directive ★
Target = **true Bloomberg-Terminal parity** for these two assets using free data. [BLOOMBERG-PARITY.md](BLOOMBERG-PARITY.md) is the **floor, not the ceiling**. Before building each epic, run a fresh deep-research pass on how Bloomberg (and Refinitiv/TradingView) handle that domain for XAUUSD/US100, and write `FEATURE-SPEC-<epic>.md` expanding parity to full depth (every sub-panel, metric, formula, interaction, and its free-data source). No Terminal capability is silently dropped — where free data can't reach it, the spec records the gap + the paid-feed upgrade path.

## Doc index
| File | What it is |
|---|---|
| [STATE.md](STATE.md) | Resume pointer — read first, update last. |
| [ROADMAP.md](ROADMAP.md) | All build sessions + acceptance criteria + checkboxes. |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Right-sized architecture + service split. |
| [DATA-SOURCES.md](DATA-SOURCES.md) | Free-feed registry (endpoints, keys, limits, ToS). |
| [SCHEMA.md](SCHEMA.md) | `market.db` tables (kept in sync). |
| [API-CONTRACT.md](API-CONTRACT.md) | Node `/api/research/*` + Python `/compute/*`. |
| [CONVENTIONS.md](CONVENTIONS.md) | Coding patterns to mirror. |
| [BLOOMBERG-PARITY.md](BLOOMBERG-PARITY.md) | Master coverage matrix (function → feature → status). |
| [BUILD-LOG.md](BUILD-LOG.md) | Append-only session log. |
| `FEATURE-SPEC-<epic>.md` | Written just-in-time per epic (parity depth). |

## One-line thesis
Bloomberg is broad and $30k/yr. Signal is **narrow by design** — two instruments, every driver/positioning/event study purpose-built and complete — then **fused into the user's own journal**, which no terminal can do. Analysis tool only; not financial advice; no execution.
