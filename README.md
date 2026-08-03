_This project has been created as part of the 42 curriculum by dpinto, wacista, acattet, wiwu._

# VS MODE

A competitive multi-game platform: teams, ELO ladders, challenge-based matchmaking, result
submission with dispute arbitration, and real-time social features.

---

## Table of contents

1. [Description](#1-description)
2. [Team information](#2-team-information)
3. [Project management](#3-project-management)
4. [Technical stack](#4-technical-stack)
5. [Instructions](#5-instructions)
6. [Database schema](#6-database-schema)
7. [Features list](#7-features-list)
8. [Modules](#8-modules)
9. [Individual contributions](#9-individual-contributions)
10. [Accessibility and quality](#10-accessibility-and-quality)
11. [Known limitations](#11-known-limitations)
12. [Resources](#12-resources)

---

## 1. Description

**VS MODE** is a competitive platform for **external** games — Counter-Strike 2, League of
Legends, Valorant, Rocket League and Chess. It does not host a playable game: it hosts everything
that happens *around* one. Players register, link their game accounts, form teams, climb ELO
ladders, challenge each other, report results, and settle disagreements through a dispute system.

The platform is **config-driven**: a game is a row in a table, a ladder is a (game, format) pair.
Adding a new game or a new format (1v1, 2v2, 3v3, 5v5) requires no new code path — the current
database ships **5 games across 9 ladders**, including two solo (1v1) ladders where the player is
the side and no team is involved.

### Key features

- **Challenge-based matchmaking.** There is no queue and no automatic pairing. A captain opens a
  time slot on a ladder, any eligible opponent accepts it, both sides report the score, and ELO
  moves. This is a deliberate product decision: it mirrors how amateur competitive scenes actually
  organise matches, and it keeps every step visible and auditable.
- **Teams as first-class organizations.** Creation, roster management, captaincy, an invitation
  cycle with accept/decline, logo upload, and dissolution — with guard rails that refuse to break a
  team while it is engaged in a match.
- **Result submission and disputes.** Both sides submit a best-of-3 score. If they disagree, the
  match enters a dispute; each side can attach written arguments and file evidence, and an
  administrator arbitrates. Timed background jobs resolve slots and confirmations that are left
  hanging for 24 hours.
- **ELO ladders and history.** Per-ladder rankings for teams and for solo players, with full match
  history at team, player and global level.
- **Real-time social layer.** Friends, blocks, direct messages over a native WebSocket, online
  presence, and 17 kinds of live notifications, all served by a social rail present on every
  authenticated page.
- **Account security.** Email/password with strict policy, Google OAuth 2.0, and TOTP
  two-factor authentication.
- **Accessible by construction.** The whole interface is WCAG 2.1 AA compliant, verified both
  automatically and by hand (see [section 10](#10-accessibility-and-quality)).

---

## 2. Team information

| Member  | 42 login  | Role(s)                  | Responsibilities                                                                                                                                                     |
| ------- | --------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| David   | `dpinto`  | **Product Owner**, Developer | Owns the product vision and the backlog, decides on features and priorities, validates completed work, and speaks for the project. Also responsible for the platform: infrastructure, database design and API contract. |
| Adrien  | `acattet` | **Project Manager**, Developer | Runs the board and the weekly planning, tracks progress and deadlines, keeps the team communicating, and manages blockers. Also responsible for the account area, the design system and accessibility. |
| Walid   | `wacista` | **Tech Lead / Architect**, Developer | Owns technical architecture and stack decisions, code quality and conventions, and reviews critical changes. Also responsible for the social and real-time layer. |
| William | `wiwu`    | **Developer**            | Implements features, reviews teammates' code, and documents his work. Responsible for the competitive cycle: teams, matches, ELO and disputes.                        |

All four members are developers on top of their assigned role, as required by the subject
(chapter II.1.1). With a four-person team, the subject explicitly allows a member to carry more
than one role.

---

## 3. Project management

**How the work was organised.** The project was cut into **tickets**, each sized at roughly one to
three days of work. One ticket equals one branch, one commit (squashed) and one review. Nothing
reaches `master` without a second pair of eyes: a teammate reads `git diff master..<branch>` and
only then is the branch merged with `--no-ff` and the card moved to Done.

**Planning cadence.** Planning happens **every Sunday**, and only for the week ahead — a
just-in-time backlog rather than a plan written once and drifting for two months. This kept the
scope honest: features that stopped making sense were dropped instead of being built.

**Tools.**

| Tool                    | Use                                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------------------- |
| **Trello**              | Task board — https://trello.com/b/3FHFbUa3 — four lists: Todo / In Progress / Review / Done             |
| **Discord**             | Day-to-day communication, plus a dedicated channel where every merge to `master` is announced           |
| **Git** (42 Vogsphere)  | `feature/<ticket>-<subject>` and `fix/<subject>` branches, Conventional Commits, no force push on `master` |

**Card format.** Title (verb + object), description, definition of done, assignee, and a label
among `backend` / `frontend` / `infra` / `docs`.

**Reviews.** Every change went through **two** reviews before reaching `master`: a teammate reading
the diff, and an AI reviewer the team configured for this project, whose job is to flag defects on
a diff — it writes no code. The human review is the one that decides; the AI pass is there to catch
what a tired pair of eyes misses at the end of a long day.

**Communication.** The team worked in the same room whenever possible, with Discord covering
everything else. Decisions that outlived a conversation were written down in the repository
(`CLAUDE.md` and `docs/`), so that a decision taken in week two could still be explained in week
eight.

---

## 4. Technical stack

### Frontend

| Technology                 | Version | Why                                                                                                        |
| -------------------------- | ------- | ---------------------------------------------------------------------------------------------------------- |
| **React**                  | 19      | Required framework tier; the component model fits an interface made of many small, repeated states.          |
| **TypeScript** (strict)    | 6       | The API surface is large; strict typing catches contract drift at compile time rather than in the browser.   |
| **Vite**                   | 8       | Instant dev server and HMR, and it doubles as the single browser origin (see infrastructure below).          |
| **TanStack Router**        | 1.x     | File-based routing with **typed** params and loaders — a route parameter cannot be read without being typed. |
| **TanStack Query**         | 5.x     | Server-state caching and invalidation; the social rail and the pages it affects stay consistent for free.    |
| **Zustand**                | 5.x     | Client state (session, panels) without the ceremony of a full Redux setup.                                   |
| **Tailwind CSS**           | 4       | Design tokens declared once in `index.css`; no colour, font, radius or shadow is hard-coded in a page.        |
| **React Hook Form + Zod**  | 7 / 4   | The same Zod schemas validate on the client and on the server — one definition, two enforcement points.       |
| **lucide-react**           | 1.x     | Consistent icon set for the design system.                                                                   |
| **Native WebSocket**       | —       | The browser API is enough for a typed event stream; no client library, no second protocol to reason about.    |

### Backend

| Technology            | Version | Why                                                                                                              |
| --------------------- | ------- | ------------------------------------------------------------------------------------------------------------------ |
| **Fastify**           | 5       | Faster than Express, with schema validation and a first-party plugin ecosystem (JWT, cookies, WebSocket, multipart, OAuth2, rate limit) instead of an assembly of third-party middleware. |
| **Node.js**           | 24 LTS  | Native ESM and long-term support for the duration of the project.                                                  |
| **Drizzle ORM**       | 0.45    | Required ORM module. TypeScript types are derived from the schema, migrations are generated and versioned, and the generated SQL stays readable — no hidden query layer. |
| **Zod**               | 4       | Every request body, query string and URL parameter is parsed before it reaches the database.                        |
| **bcryptjs**          | 3       | Password hashing, cost 12.                                                                                         |
| **speakeasy + qrcode**| 2 / 1   | TOTP secrets and enrolment QR codes for two-factor authentication.                                                 |
| **ws**                | 8       | Server-side WebSocket, via `@fastify/websocket`.                                                                   |

### Data and storage

| Technology     | Version                       | Why                                                                                                                             |
| -------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **PostgreSQL** | 17.10                         | The domain is relational end to end (users → teams → matches → sides → participants → rankings), and ELO updates need real transactions. Enums, partial indexes and check constraints let the database enforce invariants the application would otherwise have to re-check. |
| **Redis**      | 8.8.0                         | Online-presence set for the real-time layer; password authentication enabled.                                                      |
| **MinIO**      | RELEASE.2025-09-07T16-13-09Z  | S3-compatible object storage for user-uploaded files: a public `avatars` bucket and a private `evidence` bucket for dispute files.  |

### Infrastructure

- **Docker Compose**, with every third-party image fully qualified and pinned to a version — never
  `latest`.
- **No Nginx.** The Vite dev server is the **single browser origin** (`https://localhost:5173`) and
  proxies `/api/*` to Fastify and `/media/*` to MinIO over the internal Docker network. Everything
  the browser sees is same-origin, which removes an entire class of cookie and CORS problems, and
  removes one component to configure and secure.
- **HTTPS everywhere**, including in development: the backend generates a self-signed certificate
  into a shared volume at first boot, so the browser has exactly one fingerprint to accept.
- **Automated bootstrap**: health checks on PostgreSQL, Redis and MinIO, automatic Drizzle
  migrations, dependency installation guarded by a lockfile hash. After filling `.env`, a single
  `docker compose up -d --build` brings the whole platform up.
- **Environment validation**: the backend parses its environment with Zod at boot and refuses to
  start on an invalid value (for example a `JWT_SECRET` shorter than 16 characters).

---

## 5. Instructions

### Prerequisites

| Requirement                        | Notes                                                              |
| ---------------------------------- | -------------------------------------------------------------------- |
| **Docker** + **Docker Compose v2** | Or Podman with its Compose provider (`podman compose`).              |
| **OpenSSL**                        | Only to generate a JWT secret (any random 64-byte hex value works).  |
| **Node.js 24 LTS**                 | Optional — only needed to run tooling outside the containers.        |
| A **Google OAuth 2.0 client**      | Optional — required only to exercise "Sign in with Google".          |

### 1. Clone and configure

```bash
git clone <repository-url> transcendence
cd transcendence
cp .env.example .env
```

Edit `.env` and replace every `changeme`:

| Variable                                   | What to put                                                                    |
| ------------------------------------------ | -------------------------------------------------------------------------------- |
| `POSTGRES_USER` / `_PASSWORD` / `_DB`      | Any credentials you like.                                                        |
| `REDIS_PASSWORD`                           | Any password.                                                                    |
| `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD`  | Any credentials, password of 8 characters minimum.                               |
| `JWT_SECRET`                               | A real random secret: `openssl rand -hex 64`. **16 characters minimum**, or the backend refuses to boot. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`| From the Google Cloud Console. The redirect URI must be registered **identically**: `https://localhost:5173/api/auth/oauth/google/callback`. |

`FRONTEND_URL`, the proxy targets and `RATE_LIMIT_FACTOR` are already set to their delivery values
and can be left untouched. `RATE_LIMIT_FACTOR=1` means production rate-limit quotas.

### 2. Start

```bash
docker compose up -d --build
```

Compose builds the images, waits for PostgreSQL, Redis and MinIO to report healthy, generates the
HTTPS certificate, applies the Drizzle migrations, then starts the backend and the frontend.

### 3. Verify

```bash
docker compose ps                        # every service healthy, no restart loop
curl -k https://localhost:5173/api/ping  # through the proxy
```

Then open **https://localhost:5173** and accept the self-signed certificate once. This is the only
fingerprint to accept — the API and the media both travel through this same origin.

### 4. Load the demonstration database (recommended)

```bash
docker compose exec backend npm run seed:demo
```

This populates a full, deterministic platform: **120 players, 124 teams, all 9 ladders filled,
80 completed matches with ELO actually computed, 6 matches in flight** (2 open slots, 1 score
awaiting confirmation, 2 disputes, 1 cancelled), plus friendships, requests, a block, messages and
notifications.

Six named accounts share the password **`Demo1234!`**:

| Account                | What it is for                                                                   |
| ---------------------- | ---------------------------------------------------------------------------------- |
| `correcteur@demo.local`| A regular player: captain of 3 teams on 3 different ladders and 3 different formats. |
| `admin@demo.local`     | Administrator: arbitrates disputes. Deliberately a member of **no** team.           |
| `david@demo.local`     | Regular player, opponent in the demonstration scenarios.                            |
| `walid@demo.local`     | Regular player.                                                                     |
| `william@demo.local`   | Regular player.                                                                     |
| `adrien@demo.local`    | Regular player.                                                                     |

> This script wipes and rebuilds the game state. Manually created real accounts are never touched.

### Local interfaces

| Service            | URL                          | Notes                                            |
| ------------------ | ---------------------------- | -------------------------------------------------- |
| **Application**    | **https://localhost:5173**   | The only origin the browser should ever talk to.   |
| Backend (direct)   | https://localhost:3000       | Diagnostics only, outside the browser.             |
| Adminer            | http://localhost:8080        | PostgreSQL UI.                                     |
| redis-commander    | http://localhost:8081        | Redis UI.                                          |
| MinIO console      | http://localhost:9001        | Object storage UI.                                 |

### Useful commands

```bash
docker compose ps                    # service status
docker compose logs -f backend       # follow a service's logs
docker compose exec backend sh       # shell inside a container
docker compose down                  # stop, keep the data
docker compose down -v               # stop and drop managed volumes (certs, node_modules)
docker compose exec backend npx drizzle-kit generate   # generate a migration after a schema change
```

---

## 6. Database schema

PostgreSQL, 18 tables, managed by Drizzle with generated and versioned SQL migrations.

### Tables

| Domain          | Table                     | Purpose                                                                                     |
| --------------- | ------------------------- | --------------------------------------------------------------------------------------------- |
| **Identity**    | `users`                   | Account: pseudo, email, password hash (nullable for OAuth-only accounts), display name, bio, avatar URL, OAuth provider/id, TOTP secret and flag, `is_admin`. |
|                 | `user_external_accounts`  | Game accounts linked to a user (Riot, Steam, Epic, chess.com), one per provider.               |
| **Social**      | `friendships`             | Directed request that becomes a symmetric relation once accepted (`pending` → `accepted`).     |
|                 | `blocks`                  | One-way block; the application reads it symmetrically.                                         |
|                 | `messages`                | Direct messages between two users.                                                             |
|                 | `notifications`           | 17 notification types, read/unread state.                                                      |
| **Catalogue**   | `games`                   | A game: id, display name, required provider, active flag.                                      |
|                 | `game_maps`               | Map pool per game, drawn when a match is created.                                              |
|                 | `ladders`                 | A (game, format) pair — unique — with its lockout window in minutes.                           |
| **Teams**       | `teams`                   | Team on a given ladder: name, tag, logo, captain.                                              |
|                 | `team_members`            | Roster. A user can belong to **one team per ladder** only.                                     |
|                 | `team_invitations`        | Invitation cycle with status and expiry.                                                       |
| **Competition** | `matches`                 | The match itself: ladder, status, map list, winning side, `scheduled_at`, `started_at`, `completed_at`. |
|                 | `match_sides`             | The two sides of a match — a team, or a single player on a solo ladder.                        |
|                 | `match_participants`      | The players actually fielded on a side (the bench is excluded).                                |
|                 | `rankings`                | ELO, wins, losses per ladder, for a team **or** a player.                                      |
| **Disputes**    | `disputes`                | Dispute opened on a match: status, resolution, arbitration.                                    |
|                 | `dispute_evidence`        | Files and written arguments attached by each side.                                             |

### Relations

```
users ──< team_members >── teams ──> ladders ──> games ──< game_maps
  │                          │                     │
  │                          └──< team_invitations │
  │                                                │
  ├──< user_external_accounts                      │
  ├──< friendships >── users                       │
  ├──< blocks >── users                            │
  ├──< messages >── users                          │
  ├──< notifications                               │
  │                                                │
  └──< match_participants >── match_sides >── matches ──> ladders
                                   │             │
                                   │             └──< disputes ──< dispute_evidence
                                   │
      rankings ──> ladders, and ──> teams XOR users
```

### Constraints worth knowing

- **`rankings` is an exclusive-or**: a row references either a team or a user, never both and never
  neither — enforced by a check constraint, not by application code. This is what lets team ladders
  and solo ladders share one ranking table.
- **One team per user per ladder** (`team_members_user_ladder_unique`). This single constraint is
  what makes a ladder a real competition rather than a list of overlapping rosters.
- **A ladder is unique per (game, format)**, so the catalogue cannot grow two competing 5v5 ladders
  for the same game.
- **Case-insensitive unique pseudos**, plus prefix indexes on lowercased pseudo and team name that
  serve the advanced search.
- **Time windows are compared strictly.** Two matches that merely touch — 21:00–22:00 and
  22:00–23:00 — do not overlap, because back-to-back scheduling is the central use case.

---

## 7. Features list

| Feature                          | What it does                                                                                                          | Built by    |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------- |
| Infrastructure and deployment    | Docker Compose stack, single HTTPS origin with proxy, automatic certificates and migrations, Zod-validated environment.   | David       |
| Database schema and API contract | 18-table domain model, migrations, and `openapi.yaml` as the single source of truth for the front-end types.             | David       |
| Registration and login           | Email/password with strict policy, JWT access token (15 min) and refresh cookie (7 days), account-enumeration protection. | David, Adrien |
| Google OAuth 2.0                 | Sign-in with Google, linked by email to an existing account when there is one.                                           | David, Adrien |
| Two-factor authentication        | TOTP enrolment with QR code, verification at login through a short-lived scoped token, disabling.                        | David, Adrien |
| Profile and account settings     | Display name, bio, avatar upload, password change, external game accounts, account deletion.                             | Adrien      |
| Design system                    | 26 reusable components plus colour, typography, radius and shadow tokens.                                                | Adrien      |
| Accessibility                    | WCAG 2.1 AA conformance across the whole interface, verified automatically and manually.                                 | Adrien      |
| Responsive layout                | Single navigation source served both as a desktop rail and a mobile drawer, from 320 px up.                              | Adrien      |
| Friends and blocks               | Requests, accept/decline, cancel, removal, blocking and unblocking with symmetric invisibility.                          | Walid       |
| Real-time chat                   | Native WebSocket, direct messages, conversation list, multiple windows, online presence.                                 | Walid       |
| Notifications                    | 17 live notification types, bell with unread count, mark one/all as read.                                                | Walid       |
| Social rail                      | Persistent panel on every authenticated page: friends, conversations, notifications, search and requests.                 | Walid       |
| Advanced search                  | Global search over players and teams, filtered by type, paginated, alphabetically ordered.                               | Walid       |
| Teams                            | Creation, roster, captaincy, logo upload, invitation cycle, leaving and dissolution, with engagement guards.              | William     |
| Ladders and ELO                  | Per-ladder rankings for teams and solo players, ELO computed transactionally on match completion.                        | William     |
| Challenge-based matchmaking      | Opening and cancelling a slot, browsing open slots with an eligibility verdict, accepting a challenge.                    | William     |
| Result submission                | Best-of-3 score entry, confirmation by the other side, automatic ELO update.                                             | William     |
| Disputes and arbitration         | Opening a dispute, written arguments, file evidence in a private bucket, administrator resolution.                        | William     |
| Timed jobs                       | 24-hour background resolution of expired slots and unconfirmed results.                                                  | William     |
| Match history                    | Team history, solo history, and a global per-user history across every ladder.                                           | William     |
| Legal pages                      | Privacy Policy and Terms of Service, describing what the code actually stores and deletes.                               | David       |
| Demonstration seed               | One command that builds a complete, deterministic platform for the evaluation.                                           | David       |

---

## 8. Modules

**Total claimed: 21 points** — 14 mandatory + 7 above the threshold, of which **the subject counts
a maximum of 5** (chapter VII). The effective ceiling is therefore **19 points**; the two extra
points are deliberate margin, as the subject itself recommends, in case a module is not validated
during the evaluation.

### Major modules — 7 × 2 = 14 points

| Module                              | How it was implemented                                                                                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Frontend + backend frameworks**   | React 19 + TypeScript strict on the front, Fastify 5 + Node 24 on the back, both in strict ESM.                                                    |
| **Standard user management**        | Registration, login, profile, avatar upload, password change, account deletion, and public player pages.                                           |
| **Real-time (WebSocket)**           | A single native WebSocket per session carrying chat, presence and notifications, with backoff reconnection and token rotation without socket churn. |
| **User interaction**                | Direct messages, friends, blocks, and a social rail available on every authenticated page.                                                          |
| **Organization system**             | Teams: create, **edit**, delete, manage members, plus a full invitation cycle.                                                                      |
| **Accessibility (WCAG 2.1 AA)**     | Full conformance, measured — see [section 10](#10-accessibility-and-quality).                                                                       |
| **Module of choice: competitive cycle** | Slots, challenge/accept, best-of-3 results, transactional ELO, disputes and arbitration, 24-hour jobs. Justified below.                          |

### Minor modules — 7 × 1 = 7 points

| Module                    | How it was implemented                                                                                                     |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **ORM**                   | Drizzle ORM with generated, versioned migrations and types derived from the schema.                                          |
| **OAuth 2.0**             | Google sign-in through `@fastify/oauth2`, linked by email to an existing account when there is one.                          |
| **Two-factor auth**       | TOTP with `speakeasy`, QR enrolment, and a short-lived token scoped to the verification endpoint only.                       |
| **File upload**           | Avatars and team logos to MinIO, dispute evidence to a private bucket; client-side type and 2 MB validation, preview, progress bar. |
| **Notification system**   | 17 event types written inside the business transaction and pushed after commit, so a notification never describes a rollback. |
| **Advanced search**       | Global search over players and teams, type filter, pagination, backed by prefix indexes on lowercased columns.                |
| **Custom design system**  | 26 reusable components and a full token set. Justified below.                                                                |

### Justification — Module of choice: the competitive cycle (Major)

**Why this module.** The heart of the product is not a feature the official list covers. No module
describes opening a match slot, having an opponent accept it, collecting a result from both sides,
detecting disagreement, arbitrating it, and moving a rating accordingly. Without it, the platform
would be a directory of teams.

**Technical challenges.** Three, and none of them are cosmetic:

1. **Concurrency.** Two captains can accept the same slot in the same millisecond. Acceptance runs
   inside a transaction with an explicit lock ordering, so the second one is refused rather than
   silently overwriting the first.
2. **Time semantics.** Matches must be schedulable back to back. Every overlap check uses strict
   inequalities, so 21:00–22:00 and 22:00–23:00 coexist while a genuine overlap is rejected.
   `scheduled_at` is the single temporal reference; no rule reads any other timestamp.
3. **State machine.** A match moves through six states (`pending`, `in_progress`,
   `awaiting_confirmation`, `completed`, `disputed`, `cancelled`), and each transition has its own
   set of authorised actors and its own set of blocking conditions — leaving a team and dissolving
   a team, for instance, are refused on *different* status sets.

**Value added.** It is what makes the platform usable by a real amateur scene: a match cannot be
faked by one side alone, a disagreement has a formal outcome instead of an argument, and nothing
stays stuck — timed jobs close what humans leave open after 24 hours.

**Why Major rather than Minor.** It spans the whole stack (schema, transactional business logic,
background jobs, REST API, real-time notifications and six front-end screens), and it is the module
the rest of the project depends on: ladders, teams and history all exist to serve it.

### Justification — Custom design system (Minor)

The subject asks for at least 10 reusable components plus a palette, typography and icons. The
interface is built on **26** components in `frontend/src/components/ui/` (buttons, inputs, selects,
textareas, cards, tabs, dialogs, avatars, pills, progress bars, stat strips, row lists, menus,
callouts, and more), and on a token set declared once in `index.css` covering colours, fonts, radii
and shadows. No page hard-codes a colour, a font, a radius or a shadow. Icons come from a single
set (lucide). Components are extended, never copied: the rule the team enforced in review is that a
`ui/` component bends — it is never rewritten for one caller.

---

## 9. Individual contributions

> Each member describes, in their own words, what they built, what blocked them, and how they got
> past it.

### David — `dpinto` — Product Owner

_What I built:_

_What blocked me:_

_How I got past it:_

### Adrien — `acattet` — Project Manager

_What I built:_

_What blocked me:_

_How I got past it:_

### Walid — `wacista` — Tech Lead

_What I built:_

_What blocked me:_

_How I got past it:_

### William — `wiwu` — Developer

_What I built:_

_What blocked me:_

_How I got past it:_

---

## 10. Accessibility and quality

Accessibility was verified in **two passes**, because either one alone proves nothing.

**Automated sweep.** An `axe-core` scan restricted to the `wcag2a`, `wcag2aa`, `wcag21a` and
`wcag21aa` rule sets, run over **17 routes × 2 viewport widths (1280 px and 375 px), plus 4
interactive states** that a static page scan never reaches: mobile navigation drawer open, mobile
social panel open, login form in error, registration form in error. **Result: 0 violations.**

**Manual pass.** Automated tooling only covers a fraction of the criteria, and this is not a
detail: **all four real defects found during this work were found by hand, none by the scanner.**
They were a missing per-page document title (criterion 2.4.2, level A — every route rendered the
same title), an input border below the 3:1 contrast the norm requires for user-interface
components, a button border at the same fault, and a tab strip that made the page scroll
horizontally by less than a pixel at 320 px.

**Measurements retained.**

| Check                                      | Result                                                  |
| ------------------------------------------ | --------------------------------------------------------- |
| `axe-core`, 17 routes × 2 widths + 4 states | 0 violations                                             |
| Horizontal overflow at 320 / 375 / 768 px   | 0 overflow on 21 routes, tables and open dialogs included |
| 200 % zoom (criterion 1.4.4)                | Conformant on the 7 routes tested                        |
| Enforced text spacing (criterion 1.4.12)    | Conformant on the 7 routes tested                        |
| Text contrast                               | No text below AA on any of the 5 surfaces                 |

**Other quality guarantees.** TypeScript strict on both sides, ESLint clean, no warnings or errors
in the browser console, systematic validation with Zod on the client and on the server, explicit
column projections so that a password hash or an email can never leak through a naive select, and
rate limiting on every authentication route.

---

## 11. Known limitations

Stated plainly, because they are deliberate rather than accidental:

- **Linked game accounts are declared, not verified.** A player states their Riot, Steam, Epic or
  chess.com identifier; the platform does not yet confirm ownership through the provider's OAuth.
  The data model is ready for it (`verified` flag), the verification flow is not implemented.
- **Administrators are promoted directly in the database.** There is no promotion screen by design:
  arbitration is a trust role, and the team preferred no UI over a half-secured one.
- **Search results are ordered, not sortable.** Results come back alphabetically across both types;
  the user cannot yet choose a different ordering.
- **No in-app playable game.** This is the founding product decision: VS MODE tracks external
  games. Match results are declared by both sides and arbitrated on disagreement, which is exactly
  why the dispute system exists.

---

## 12. Resources

**Documentation**

- Fastify — https://fastify.dev/docs/latest/
- Drizzle ORM — https://orm.drizzle.team/docs/overview
- PostgreSQL 17 — https://www.postgresql.org/docs/17/
- React 19 — https://react.dev/
- TanStack Router / Query — https://tanstack.com/router / https://tanstack.com/query
- Tailwind CSS v4 — https://tailwindcss.com/docs
- Zod — https://zod.dev/
- MDN, WebSocket API — https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
- MinIO — https://min.io/docs/minio/linux/developers/javascript/API.html
- Docker Compose — https://docs.docker.com/compose/

**Standards and references**

- WCAG 2.1 quick reference — https://www.w3.org/WAI/WCAG21/quickref/
- WAI-ARIA Authoring Practices — https://www.w3.org/WAI/ARIA/apg/
- Elo rating system — https://en.wikipedia.org/wiki/Elo_rating_system
- RFC 6238, TOTP — https://datatracker.ietf.org/doc/html/rfc6238
- OAuth 2.0 — https://oauth.net/2/
- Conventional Commits — https://www.conventionalcommits.org/

**Internal documentation.** Design decisions, per-domain details and the traps encountered along
the way are kept in `docs/` (`schema.md`, `backend.md`, `frontend.md`, `infra.md`, `modules.md`,
`stack.md`, `pieges.md`, `journal.md`).

### Use of AI

AI assistance (Claude) was used on this project for:

- **Initial planning and architecture** — shaping the concept, comparing stack options and cutting
  the project into tickets before any code was written.
- **Code review** — the team set up a dedicated AI reviewer that reads the diff of a branch and
  reports defects. It runs **in addition to**, never instead of, the mandatory review by a
  teammate: every branch merged into `master` was read by a human. The reviewer reports problems;
  the fixes were written and committed by the author of the ticket.
- **Debugging** — code snippets to isolate and fix defects, in particular around concurrency,
  session handling and proxy configuration.
- **Documentation** — internal technical notes and this README.

Product decisions — scope, features and priorities — were made by the team.
