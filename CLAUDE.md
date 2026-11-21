# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A GitHub Pages site (`cnrobbsensei.github.io`) for the Code Ninjas Robbinsville dojo: points leaderboards, riddles, Ninja of the Month, polls, a live "In The Dojo" check-in view, break-time games, a moderated chat, and a kiosk display for a second monitor.

## Running / building

There is no build step, package manager, linter, or test suite. Every page is a standalone `.html` file that loads React 18, ReactDOM, Babel Standalone, and the Firebase compat SDK (v10.12.2) from CDNs, then `shared.js`, `codebot.js` and `codebot-ai.js`, then an inline `<script type="text/babel">` block containing the page's JSX. Deploying means pushing the files to the GitHub Pages repo.

To run locally, serve the folder over HTTP (Babel's in-browser transform and some relative fetches don't work from `file://`), e.g. `python -m http.server 8000` and open `http://localhost:8000/index.html`. The site talks to the **live production Firebase Realtime Database** — there is no dev/staging database, so local testing reads and writes real dojo data.

## Architecture

### `shared.js` is the backbone
Loaded by every page before the page's own script. It initializes Firebase and exposes everything on `window`:
- **Data-layer objects** wrapping Realtime Database paths, each with `getAll`/mutators/`listen(cb)` (listen returns an unsubscribe fn): `fbLeaderboard` (`leaderboards/week_N/entries`), `fbUsernames` (`usernames`), `fbProfiles` (`profiles`), `fbBreak` (`games/onBreak`), `fbSessionLock` (`sessionLocks`), `fbAccessRevocation` (`pointsAccessRevoked`), `fbGoals` (`goals`), `fbModeration` (`moderation/{badWords,flags,bans}`).
- Pages also hit some paths directly via `window.cnDb.ref(...)` (or `db` from the shared closure): `riddles/week_N`, `notm`, `polls`, `chat/messages`, `games/<leaderboardId>/leaderboard`.
- Shared constants/helpers: `CN_NAV` (nav tabs), `CN_GAMES_LIST`, `CN_AVATARS`, `CN_SECTIONS`, week helpers (`getCurrentWeek`/`getWeekLabel`, counted from a hardcoded `WEEK_START` of 2026-05-14), `todayStr`, `cnKeySafe` (Firebase-safe lowercase key), `cnNormalizeName`, `findLinkedAccount`, `cnSampleData`.
- `useCnAuth()` — React hook every logged-in page calls; redirects to `index.html` with no session and polls/listens for expiry, bans, locks, revocations, and `forcedLogouts/<key>`.
- `cnTour` / `CnTourOverlay` — cross-page guided tour driven by `sessionStorage` and `data-tour-nav="<id>"` / `data-tour-mobile-anchor` attributes on nav elements.
- `cnDialog.password({title,message,confirmLabel,danger})` / `cnDialog.alert(msg)` — promise-based in-page modals (plain DOM). Use these instead of native `prompt()`/`confirm()`/`alert()`; `password` resolves `true` only once `CN_ADMIN_PASS` is entered.

### `codebot.js` — CodeBot (loaded on every page right after `shared.js`)
Fully in-browser rule-based assistant; no external AI/API.
- **Weekly engine** runs on every page load (any role, incl. the unauthenticated kiosk) and every 5 min: finalizes each past, unlocked week that has a riddle (grades latest-submission-per-ninja, earliest correct wins, else `winner:null`; sets `answer`, `answerAlts`, `revealed`, `locked`, `lockedBy:"codebot"`), announces last week's result to `chat/messages` as `role:"bot"` and to `codebot/announcements`, then fills the current week with an unused riddle from its bank (falls back to generated code/number riddles). All writes are Firebase transactions so concurrent tabs can't double-set or double-announce.
- Bot answers live in `codebot/answers/week_N` (`{answer, alts, text}`), not in the riddle node; they're only trusted while `text` still matches the riddle (a Sensei hand-editing the riddle sets `byCodeBot:false` and CodeBot will then ask for the answer). Used riddle ids: `codebot/usedRiddles`; action audit trail: `codebot/actions`.
- `cnCodeBot.answerMatches(sub, answer, alts)` is the single grading rule (whole words, ignores a/an/the, punctuation, simple plurals); `riddle.html`'s `isCorrect` calls it so badges match the bot's winner.
- **Moderation**: `cnCodeBot.moderate(text)` → `{ok, category, reason}` is the single content rule (whole-word mild words, in-word strong words with a whitelist, leet/stretched/spaced/wildcard disguises, bullying phrases, personal info, links, spam; plus the Sensei list at `moderation/badWords`). `chat.html` runs it before sending (admins exempt) and hides failing messages; `fbPolls.createPoll` runs `moderatePoll` and saves clean polls as `status:"approved", approvedBy:"codebot"` or keeps them `pending` with `modFlag`. Every tab also sweeps the last 50 chat messages (removes failures) and auto-reviews unchecked pending polls (`modCheckedAt`). Blocked/held items are logged to `moderation/flags` (fixed keys `chat_<id>` / `poll_<id>` when swept, to dedupe across tabs). `cnContainsBadWords` in `shared.js` is legacy (substring match — flags "hello") and only a fallback.
- **Local AI — `codebot-ai.js`** (loaded after `codebot.js`; exposes `window.cnCodeBotAI` and hands itself to `cnCodeBot._attachAI`). Two in-browser models, both optional — CodeBot falls back to rules if they're missing:
  - *Moderation*: Transformers.js `@huggingface/transformers@4.3.2` + `Xenova/toxic-bert` (q8, ~110 MB, WASM). Auto-loads on chat/polls/kiosk (and Sensei pages with AI on) unless `codebot/settings/aiModeration === false`. `classify(text, {strict})` thresholds were calibrated on sample dojo text: chat only blocks threats/general toxicity when aimed at a person (gaming talk like "kill this boss" scores high); polls use `strict` (held, never deleted). `moderateAsync` / `moderatePollAsync` = rules then AI; polls naming a registered ninja are always held.
  - *Sensei brain*: WebLLM `@mlc-ai/web-llm@0.2.87` + `Qwen2.5-1.5B-Instruct` (or 0.5B "small"; q4f16 if the GPU has `shader-f16`, else q4f32). Needs WebGPU; loaded only for admins who opt in ("turn on ai", remembered per computer in `localStorage.cn_codebot_ai_llm`). It never acts directly: `handleCommand` runs `ruleCommand` first, and only unmatched text goes to `interpret()`, which must return one command from `COMMANDS` (JSON-schema constrained) — mutating ones are re-confirmed. `writeRiddle()` output must pass `validateAIRiddle` before entering `codebot/riddleQueue`, which `pickRiddle` uses before the bank.
  - Test hooks: `window.CN_TJS_URL` / `window.CN_WEBLLM_URL` override the CDN module URLs.
- **Admin chat widget** (floating 🤖, only rendered when `role==="admin"`; `handleCommand` re-checks the role). Commands are regex intents in `handleCommand` (points add/undo/remove/rename, audit, stats, leaderboard, who's here, riddle management); conversation lives in `sessionStorage`. Point additions follow the Points tab rules (`CN_MAX_ATTEMPTS_PER_DAY`, login window locked by the day's first entry).

### Auth/session model (all client-side)
- Three roles stored in `sessionStorage` (`cn_role`, `cn_username`, `cn_account_key`, `cn_session_id`, `cn_session_expires`) — closing the tab signs out.
- **admin** ("Sensei"): password `window.CN_ADMIN_PASS`; unlimited concurrent sessions (`activeSessions/admin_<id>`).
- **student** ("ninja"): logs in with username (e.g. `adam.dodo`). Allowed only if a Points entry for them exists dated *today* and their latest entry's sign-in window hasn't ended: `sessionHours` (1, 2 or 3 — `CN_SESSION_HOUR_OPTIONS`, locked by the day's first entry) **+ 20 min** (`SESSION_GRACE_MS`). Always use `cnCleanHours` / `cnAccessEndsAt` / `cnPresenceFromEntries` from `shared.js` — login, In The Dojo, kiosk and CodeBot must agree on who is signed in. Points entries are usually stored under first name only, but under the full username when first names collide — login matches either. Also blocked if locked, banned, or revoked today. Single login per account enforced via `activeSessions/<key>` heartbeat (20s) with 45s staleness takeover.
- **guest**: must never see real student data — pages render `cnSampleData()` instead, and guests can't view profiles (`cnCanViewProfiles`). Guests may play Games without a break, but `fbGames.submitScore` never writes their scores and `getLeaderboard` returns sample data.
- **Goals** (`goals/<accountKey>`) last one visit: stamped with `date`; `fbGoals.getAll/listen` only return today's (`cnGoalActive`); a ninja's first Points entry of the day calls `cnResetGoalOnSignIn` (Points tab and CodeBot); End Session / Remove clear it; CodeBot's engine (`sweepGoals`, every 5 min) deletes goals whose ninja is no longer signed in. Impact goals are picked from `CN_CURRICULUM.Impact` (belts → `[level, build, explore, debug, quest]` rows from the IMPACT belt tables) × `CN_GOAL_PARTS`; text via `cnCurriculumGoalText`, plus `{belt, setIdx, part, project}` saved on the goal. Other sections (JR/Robotics/Unity) still use free text.
- Sensei controls in `nitd.html`: "End Session" (`cnSession.endSession` → lock until unlocked), "Remove from Dojo" (`fbAccessRevocation` + `forceLogoutKey`, clears next day), starting breaks (`fbBreak`) which is what unlocks `games.html` for a ninja.

### Pages
- `index.html` — login; `home.html` — dashboard; `entrygames.html` — Points entry/leaderboard (max `CN_MAX_ATTEMPTS_PER_DAY` entries per ninja per day; `ENTRY_COOLDOWN_MINUTES` is defined in `shared.js` but only CodeBot's audit uses it); `riddle.html`, `notm.html`, `polls.html`, `chat.html`, `nitd.html`, `profile.html` (`?u=<name>`; achievements computed on the fly from other data), `tutorial.html`.
- `games.html` — all browser games in one file; its `GAMES_LIST`/`GAME_META` must stay in sync with `CN_GAMES_LIST` in `shared.js` (profile achievements rely on the shared copy).
- `kiosk.html` — unauthenticated second-monitor display (no `useCnAuth`) showing breaks/goals live; uses ElevenLabs text-to-speech. When announcements are on, it speaks a reminder every 3 min (`GOAL_REMINDER_MS`) if any signed-in, account-linked ninja has no goal for today — "Name does not have a goal set." for one, "N ninjas do not have a goal set." for more — and shows the same list in an on-screen banner.

### Conventions to preserve
- The `Sidebar` component and page layout are **duplicated in each page's inline script**, not shared — nav changes must be made in `CN_NAV` *and* checked in every page's `Sidebar`.
- Account keys everywhere (breaks, goals, locks, bans, sessions) are `cnKeySafe(username)`; keep new per-ninja data keyed the same way so it lines up across features.
- Names typed by Senseis go through `cnNormalizeName` so the same ninja doesn't split into multiple leaderboard rows.
- Avatars are restricted to the fixed `CN_AVATARS` list; chat text is checked with `cnContainsBadWords` and a hit calls `fbModeration.flagAndBan`.
- `leaderboard.txt` is empty and not referenced by any page.
