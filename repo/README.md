<!-- project-type: web -->
# AlignSpace — Offline Collaboration for Cross-Functional Teams

**Project type:** web (static HTML/CSS/JavaScript, no backend, runs entirely in the browser)

A fully offline, no-backend collaboration app built with vanilla HTML/CSS/JavaScript. Teams align inside shared "rooms" with a whiteboard, sticky notes, chat, and more — all data stays on the device.

## Quick Start (Docker-only — required path)

Docker is the supported and required path for both serving the app and running tests.

```bash
# Build the image and serve the static app on http://localhost:8080
docker compose up --build app

# Open the app
open http://localhost:8080
```

Once the container is running, the app is reachable at:

| URL | Purpose |
|---|---|
| http://localhost:8080/ | App root (redirects to `#/login`) |
| http://localhost:8080/#/login | Sign-in page |
| http://localhost:8080/#/rooms | Room list (after login) |
| http://localhost:8080/#/ops | Ops Console (requires `ops` role) |

Stop with `docker compose down`. All app state lives in the browser's IndexedDB/LocalStorage — clearing site data resets the account.

## Demo Auth Credentials (deterministic)

These accounts are seeded into IndexedDB on first boot (via the demo seeder) so reviewers can sign in without going through account creation. Usernames are lowercase; display names and email-style handles are shown for reference only — the login form takes the **username** and **password** fields.

| Role | Username | Display email | Password | Capabilities |
|---|---|---|---|---|
| user | `demo_user` | demo_user@alignspace.local | `demo-user-pass-1` | Default member — can create rooms, whiteboard, stickies, chat, meals, bookings, notifications, relationships |
| ops  | `demo_ops`  | demo_ops@alignspace.local  | `demo-ops-pass-1`  | Everything a user can do, plus the Ops Console (`#/ops`): announcements, templates, sensitive-word library, rules, booking policies, analytics |

To switch into the ops role after signing in as `demo_ops`, click the **Ops** toggle in the header (role is a client-side toggle backed by `localStorage.alignspace_role`). The `#/ops` route is protected by the `requireOps` guard; non-ops users are redirected to `#/rooms`.

> If the seeded accounts are missing (e.g. fresh browser profile before the seeder runs), create them manually on `#/login` → "Create Account" with the same username/password combinations above, then flip the role toggle to Ops for `demo_ops`.

## Running Tests (Docker-only)

```bash
# Build the test image and run the full Vitest suite inside Docker
docker compose run --rm tests

# Or via the helper script (Docker mode)
./run_tests.sh docker
```

Docker is the only supported way to run tests. The test image resolves exact pinned dependencies during its build and runs the full suite with `NODE_ENV=test CI=true`. There is no host-side test path — all verification must happen inside the container.

## Verification Flow (Docker)

1. `docker compose up --build app` — wait until the container logs show the static server is listening on `:8080`.
2. Open http://localhost:8080/#/login in a browser.
3. Sign in as `demo_user` / `demo-user-pass-1`. The app should navigate to `#/rooms`.
4. Sign out (avatar menu → Logout). Sign in as `demo_ops` / `demo-ops-pass-1`.
5. Click the **Ops** toggle in the header. An "Administration" section with "Ops Console" appears in the sidebar. Navigate to `#/ops` — the console renders.
6. In a second terminal: `docker compose run --rm tests`. All Vitest suites should pass.

## Routes

| Route | Page | Auth |
|---|---|---|
| `#/login` | Sign in / Create account | Guest only |
| `#/lock` | Lock screen (20-min idle) | Locked sessions |
| `#/rooms` | Room list | Required |
| `#/rooms/:id` | Room (whiteboard, stickies, chat drawer, activity) | Required |
| `#/ops` | Ops Console (announcements, templates, analytics) | Required + ops role (enforced via route guard) |
| `#/relationships` | Friends, requests, blocklist | Required |
| `#/meals` | Meal planner with nutrient tracking | Required |
| `#/bookings` | Booking/order workflow | Required |
| `#/notifications` | Notification inbox | Required |

## Feature Coverage

### Authentication & Sessions
- Local profile creation with PBKDF2 password hashing (100k iterations, SHA-256)
- 20-minute inactivity lock screen with password re-entry
- Multi-user support on the same device

### Rooms & Collaboration
- **Whiteboard**: Canvas/SVG drawing with pen, rectangle, ellipse, line, image, and text tools. Element selection, move, resize, delete, z-index reorder, undo/redo. Each element supports notes (up to 20,000 chars) and threaded comments with sensitive-word filtering.
- **Sticky Notes**: Drag-and-drop wall with color-coded notes, group management, CSV bulk import (up to 1,000 rows with error reporting and downloadable error CSV).
- **Chat**: Drawer-style room messaging panel (slides in from the right via a "Chat" button in the room header). 500-char limit, 10 msg/min rate limit, 500-message retention cap per room, and sensitive-word filtering. Auto-appends new messages while open.
- **Activity Feed**: Changelog recording create/edit/delete/move, snapshot/rollback, import/export actions.
- **Room Creation with Templates**: When creating a room, users can select a starter-kit template (if any exist in Ops). The selected template seeds the room with pre-built sticky notes, whiteboard elements, and a welcome chat message. Default template preference is persisted in LocalStorage.
- **Ops Announcement Banner**: Active ops announcements are loaded and rendered as a banner inside the room view. Precedence rule: storage-exceeded warnings take priority; the ops announcement banner shows when storage is healthy. Banner is dismissible by the user.

### Presence & Sync
- Explicit active/idle presence labels in room header: each user avatar shows an "Active" (green) or "Idle" (amber) label, with a summary count (e.g. "2 active, 1 idle"). Updated across same-machine tabs via BroadcastChannel.
- Auto-save every 5 seconds. Multi-tab sync for edits, presence, and notifications.

### Snapshots & Import/Export
- Up to 50 room snapshots with rollback capability.
- JSON export (≤ 50 MB) and import with last-modified-wins merge. Conflict detection: if the same element is edited more than twice within 10 seconds during a merge, a duplicate is created and flagged.

### Storage Management
- Per-room 200 MB storage cap with warning at 180 MB.
- Guided cleanup view showing largest images, oldest snapshots, and old messages with deletion controls.

### Ops Console (role toggle + route guard)
- **Access model:** Any logged-in user can switch to the "Ops" role via the role toggle button in the header. The toggle sets a `role` value in localStorage (`alignspace_role`). When role is `ops`, the sidebar shows an "Administration" section linking to `#/ops`. The `#/ops` and `#/ops/:section` routes are protected by a `requireOps` route guard that checks both authentication and `role === 'ops'`; non-ops users navigating to these routes are redirected to `#/rooms`. There is no server-enforced RBAC; role switching is a client-side toggle for this offline-first app.
- Announcement banner editor (announcements are rendered in the room UI as a banner), featured template carousel, sensitive-word/keyword library, rules/templates library.
- **Templates & Starter Kits:** Templates created in the Ops Console are available during room creation as starter kits. Each template can contain pre-built sticky notes, whiteboard elements, and a welcome message. Templates support a `featured` flag and category-based filtering.
- **Booking Policies:** Configure cancellation and reschedule rules (standard fee, deadline hours, late fee, block late, max reschedules). Policies are enforced in real-time when users attempt to cancel or reschedule a booking.
- Local event tracking with funnel-style analytics and canary toggles for experimental UI.

### Relationships
- Friend requests (send/accept/reject/withdraw), named groups, personal notes, local blocklist.

### Meal Planner
- Offline nutrient database (50 foods) auto-initialized from `/data/nutrients.json` on first use (at app boot and on meal page load). If seeding fails (e.g. file missing), a user-facing error banner with a Retry button is shown.
- Food search and barcode lookup require the nutrient database to be initialized.
- Meal plan CRUD with macro/micro nutrient calculation per meal and daily totals.

### Booking/Orders
- State machine: draft → pending → approved → paid-marked → completed (+ canceled → refunding-marked).
- Configurable cancellation/reschedule policies (set in Ops Console → Booking Policies), printable receipts, CSV export.
- Reschedule button available on draft/pending/approved bookings; checks reschedule policy before prompting for a new date.

### Notifications
- Inbox retaining 200 items with read/unread state, type-specific icons, and badge counts.

## Storage Model

| Store | Engine | Purpose |
|---|---|---|
| IndexedDB (`alignspace_db`) | 23 object stores | All heavy data: rooms, whiteboard elements, comments, sticky notes, chat messages, snapshots, presence, activity logs, notifications, relationships, announcements, templates, rules, canary flags, analytics, meal plans, nutrients, bookings, policies |
| LocalStorage | Key-value (prefixed `alignspace_`) | Lightweight preferences: current user session, UI role, sidebar state, notification toggles, last-opened room, default template selection |

### IndexedDB Object Stores
`profiles` · `sessions` · `rooms` · `whiteboardElements` · `comments` · `stickyNotes` · `stickyGroups` · `chatMessages` · `presence` · `activityLogs` · `snapshots` · `notifications` · `relationships` · `opsAnnouncements` · `opsTemplates` · `opsSensitiveWords` · `opsRules` · `canaryFlags` · `analyticsEvents` · `mealPlans` · `nutrientDb` · `bookings` · `bookingPolicies`

## Architecture

```
js/
├── core/          # Infrastructure (event-bus, store, router, db, storage, sync, autosave, component, utils)
├── services/      # Business logic — no DOM (auth, room, whiteboard, sticky, chat, presence, etc.)
├── ui/
│   ├── components/  # Reusable (modal, toast, drawer, confirm-dialog, whiteboard)
│   └── pages/       # Route pages (login, lock, room-list, room, ops-console, etc.)
└── workers/       # Web Workers (csv, snapshot, export, report)
```

Three-layer separation: `core/` → `services/` → `ui/`. Services never import from `ui/`. Cross-module communication uses the EventBus (`bus.on/emit`). Multi-tab sync via `BroadcastChannel`.

## PWA Support

The app includes a service worker (`sw.js`) with cache-first strategy and a `manifest.json` for installable offline use. After first load, the app works entirely without network.

## Tech Stack

- **Vanilla HTML/CSS/JavaScript** — no frameworks, no build step
- **IndexedDB** via native API with migration-based schema
- **BroadcastChannel** for multi-tab sync
- **Web Workers** for CSV parsing, snapshot serialization, report generation
- **Service Worker** for offline caching
- **Web Crypto API** (PBKDF2) for password hashing
- **Vitest** + jsdom + fake-indexeddb for testing (run via Docker)

## In-Browser Verification Steps

All verifications below assume you already ran `docker compose up --build app` and are signed in at http://localhost:8080.

### Booking Policy Configuration
1. Sign in as `demo_ops` / `demo-ops-pass-1`.
2. Toggle to "Ops" role via the header button.
3. Navigate to Ops Console → Booking Policies tab.
4. Set a cancellation policy (e.g. fee: 10, deadline: 24h, blockLate: checked).
5. Save; confirm the success toast.
6. Navigate to Bookings → create a booking with a scheduled date within 24h.
7. Submit it (draft → pending), then try Cancel. You should see the "not allowed" blocking message.
8. For reschedule: set a reschedule policy with maxReschedules: 1, then reschedule the booking twice — the second attempt should be blocked.

### Nutrient Database Bootstrap
1. Open the app in a fresh browser profile (no IndexedDB data).
2. Sign in as `demo_user` / `demo-user-pass-1` and navigate to Meal Planner.
3. The nutrient DB loads automatically; click "Create Meal Plan" → "Add Food" → search "rice" — results should appear.
4. To test error handling: open DevTools → Application → IndexedDB → delete the `nutrientDb` store, then block `/data/nutrients.json` in Network tab. Reload the meals page — an error banner with "Retry" should appear. Unblock the URL and click Retry — the banner should disappear and food search should work.

### Cross-tab Sync
1. Open two tabs of the app at http://localhost:8080, both signed in as `demo_user` and viewing the same room.
2. In Tab A, draw on the whiteboard. Tab B should reflect the change.
3. In Tab A, send a chat message. Tab B should display it.
4. Create a booking in Tab A — Tab B's booking list updates on navigation.
