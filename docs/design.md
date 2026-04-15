# AlignSpace Offline Collaboration - System Design

## Overview

AlignSpace is an offline-first collaboration app for small cross-functional teams operating in network-isolated environments. It runs fully in-browser using Vanilla HTML/CSS/JavaScript with no backend. Collaboration happens within local "rooms" that combine a whiteboard, sticky-note wall, threaded comments, chat, presence, and activity tracking. The system also includes an ops console for local administration and optional tools for nutrition planning and internal booking/order workflows.

## Goals and Non-Goals

### Goals

- Provide a fully functional multi-feature collaboration system with zero network dependency.
- Support same-machine multi-tab collaboration with near-instant synchronization.
- Persist all critical room/workflow data locally with predictable storage limits.
- Keep UI responsive during heavy operations through background processing.
- Provide traceability through activity feed, analytics funnels, and conflict visibility.

### Non-Goals

- Cross-device or internet-based real-time collaboration.
- Server-side authentication/authorization or remote user identity.
- Cloud backup, remote analytics export pipelines, or remote notifications.

## Architecture

### Runtime Topology

- **UI Layer (Main Thread):** room UI, whiteboard rendering, sticky walls, chat/comments, ops console, planner, order workflow.
- **Domain Layer (Client Services):** room service, whiteboard service, chat service, comments service, import/export service, snapshot service, presence service, ops service, analytics service.
- **Persistence Layer:** IndexedDB for heavy/structured domain data; LocalStorage for lightweight preferences.
- **Coordination Layer:** BroadcastChannel for cross-tab events (edits, presence, inbox, conflict notifications).
- **Background Workers:** Web Workers for CSV import, package import/export, snapshot generation, report export.
- **Offline Asset Layer:** Service Worker for static asset caching and installable behavior.

### Module Boundaries

- `Auth/Lock`: local profile sign-in and inactivity lock (20-minute timeout).
- `Room Core`: room state, participants, current canvas context, activity feed.
- `Whiteboard`: Canvas/SVG entities, notes per entity (up to 20,000 chars), image stickers.
- `Sticky Wall`: draggable groups, CSV import up to 1,000 rows with row-level error reporting + downloadable error CSV.
- `Communication`: threaded element comments and chat drawer.
- `Ops Console`: announcement banner, featured templates carousel config, sensitive-word keyword library, starter kit rules/templates, canary toggles, analytics tracking.
- `Optional Tools`: nutrition planner and request/order workflow with strict state machine.

## Data Model

### IndexedDB Stores

- `profiles`: local profile credentials and profile metadata.
- `rooms`: room metadata, members, settings, storage usage counters.
- `whiteboard_elements`: shape/pen/sticker entities with geometry/style payloads.
- `element_notes`: optional long notes (max 20,000 chars per element).
- `sticky_notes`: note cards, grouping metadata, import metadata.
- `comments_threads`: threaded comments per element.
- `chat_messages`: capped at most recent 500 messages per room.
- `presence_state`: per-tab active/idle presence records.
- `activity_feed`: append-only key actions (create/edit/delete/move, snapshot/rollback, import/export, conflict duplicate generated).
- `ops_config`: announcement, templates carousel, keyword library, rules/templates, canary flags.
- `notifications_inbox`: capped to 200 items.
- `relationship_graph`: friend requests and group/note relations with local blocklist.
- `nutrition_table`: offline nutrient reference data.
- `orders`: booking/order entities with status transitions and policy snapshots.
- `snapshots`: up to 50 snapshots per room.
- `import_jobs` / `export_jobs`: background job state and artifacts.

### LocalStorage Keys

- `uiRole`
- `lastOpenedRoomId`
- `notificationToggles`
- `templateDefaults`
- `lockScreenLastState`

### Limits and Retention

- Chat message length: 500 chars.
- Per-user local chat rate: 10 messages per minute.
- Room chat retention: latest 500 messages.
- Sticky CSV import: max 1,000 rows, required columns `title`, `body`.
- Element note max length: 20,000 chars.
- Room storage hard cap: 200 MB; warning at 180 MB with guided cleanup.
- Snapshot retention: max 50 per room.
- Inbox retention: max 200 items.
- Export/import package size: single file <= 50 MB.

## Core Flows

### 1) Profile Entry and Session Lock

1. User signs in with local username/password profile.
2. Session is marked active; inactivity timer starts/reset on input events.
3. After 20 minutes idle, UI transitions to lock screen.
4. Unlock requires local credential re-entry.

### 2) Whiteboard and Notes

1. User creates/edits whiteboard elements (pen/shapes/stickers).
2. Optional note can be attached/edited (max 20,000 chars).
3. Changes persist to IndexedDB and broadcast across tabs.
4. Activity feed logs actions.

### 3) Sticky CSV Import

1. User selects CSV file.
2. Worker parses and validates rows (<= 1,000, required `title` + `body`).
3. Valid rows are inserted; invalid rows are collected.
4. UI displays modal row-level errors and allows error CSV download.

### 4) Chat and Comments

1. Chat input enforces max 500 chars.
2. Rate limiter enforces 10 messages/minute per local user.
3. Message persists, propagates via BroadcastChannel, and room list is trimmed to 500.
4. Comment threads on whiteboard elements follow same local persistence/broadcast pattern.

### 5) Import Merge and Conflict Handling

1. User imports offline package via File API.
2. Merge policy applies "last modified wins".
3. During merge window, if same element receives >2 edits within 10 seconds, system creates conflict duplicate.
4. Conflict duplicate is flagged in activity feed and sent as tab notification.

### 6) Snapshots and Rollback

1. Snapshot creation runs in Worker.
2. Snapshot metadata and payload persist in `snapshots`.
3. Rollback action restores targeted snapshot state and logs activity.
4. Retention policy prunes oldest snapshots beyond 50.

### 7) Booking/Order Workflow

Allowed states: `draft -> pending -> approved -> paid-marked -> completed` with side branches to `canceled` and `refunding-marked` under policy constraints.

## Security and Privacy Considerations

- Credential gate is a local privacy barrier, not a hard security boundary.
- Passwords are stored locally and never transmitted (no backend).
- Sensitive text warnings are performed client-side via keyword library in ops config.
- Lock screen and inactivity timeout reduce shoulder-surfing risk.
- Imports validate schema/limits to reduce malformed data corruption.
- Optional camera barcode scanning is capability-gated with manual fallback.

## Performance and Scalability Constraints

- Auto-save every 5 seconds while app is open.
- Heavy tasks (imports, snapshots, report exports) run in Web Workers.
- BroadcastChannel keeps multi-tab consistency with low-latency event fan-out.
- Whiteboard rendering should batch redraws and use dirty-region updates to avoid full-canvas rerendering under frequent edits.
- Storage guardrails enforce per-room limits and cleanup UX.

## Reliability and Failure Handling

- IndexedDB transaction errors trigger user-visible toast + retry path.
- BroadcastChannel desync recovery via periodic state checksum/reconcile.
- Import failures are isolated per row/job; partial success is preserved when valid.
- Snapshot rollback failure leaves current state untouched and emits failure event.
- Corrupt package import aborts with validation report; no partial apply unless transaction segment validates.

## Observability and Analytics

- Local event tracking for major actions and flow milestones.
- Funnel metrics in ops console, including `room_created -> first_whiteboard_edit -> first_comment`.
- Activity feed is user-facing audit timeline.
- Diagnostics include import/export job durations, conflict duplicate counts, storage usage progression.

## Deployment/Runtime Assumptions

- Browser supports IndexedDB, BroadcastChannel, Worker, and File/Blob APIs.
- Service Worker is optional but recommended for installable offline shell.
- Single-machine, multi-tab collaboration is in scope; multi-machine sync is out of scope.
- No server secrets, no backend runtime, no remote dependency required.
