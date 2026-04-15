# AlignSpace Offline Collaboration - Interface and API Spec

## Spec Scope

This project has no backend service. The API surface is defined as client-side module contracts, persisted data contracts, and cross-tab event contracts.

- **Spec Version:** `1.0.0`
- **Compatibility Policy:** additive-first; breaking changes require spec minor bump + migration note
- **Runtime:** browser-only (offline)

## Error Model

All service calls return one of:

```ts
type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; details?: unknown } };
```

Canonical error codes:

- `VALIDATION_ERROR`
- `NOT_FOUND`
- `RATE_LIMITED`
- `STORAGE_LIMIT_NEAR`
- `STORAGE_LIMIT_EXCEEDED`
- `CONFLICT_DUPLICATE_CREATED`
- `IMPORT_FILE_TOO_LARGE`
- `IMPORT_SCHEMA_INVALID`
- `IMPORT_ROW_ERRORS`
- `STATE_TRANSITION_INVALID`
- `LOCK_REQUIRED`

## Shared Types

```ts
type ISODateTime = string;
type RoomId = string;
type UserId = string;
type ElementId = string;
type SnapshotId = string;

type PresenceStatus = "active" | "idle";
type OrderState =
  | "draft"
  | "pending"
  | "approved"
  | "paid-marked"
  | "canceled"
  | "refunding-marked"
  | "completed";
```

## Auth and Lock Service

### `AuthService.signIn(input)`

```ts
type SignInInput = { username: string; password: string };
type SignInOutput = { userId: UserId; displayName: string; locked: false };
```

Rules:

- Username/password required.
- Fails with `VALIDATION_ERROR` for empty values.
- Fails with `NOT_FOUND` for unknown profile or mismatch.

### `SessionLockService.unlock(input)`

```ts
type UnlockInput = { username: string; password: string };
type UnlockOutput = { unlockedAt: ISODateTime };
```

Rules:

- UI must lock after 20 minutes inactivity.
- Locked actions fail with `LOCK_REQUIRED`.

## Room Service

### `RoomService.createRoom(input)`

```ts
type CreateRoomInput = { name: string; description?: string };
type CreateRoomOutput = { roomId: RoomId; createdAt: ISODateTime };
```

### `RoomService.getRoom(roomId)`

Returns room metadata + current usage:

```ts
type RoomData = {
  roomId: RoomId;
  name: string;
  storageUsedBytes: number;
  storageLimitBytes: 209715200; // 200 MB
  warningThresholdBytes: 188743680; // 180 MB
};
```

## Whiteboard Service

### `WhiteboardService.upsertElement(input)`

```ts
type WhiteboardElement = {
  elementId: ElementId;
  roomId: RoomId;
  type: "pen" | "shape" | "image-sticker";
  payload: Record<string, unknown>;
  updatedAt: ISODateTime;
};
```

Constraints:

- Element note length max 20,000 chars.
- Edits propagate to all tabs via BroadcastChannel.

### `WhiteboardService.setElementNote(input)`

```ts
type SetElementNoteInput = {
  roomId: RoomId;
  elementId: ElementId;
  note: string; // <= 20000 chars
};
```

Validation:

- note length > 20,000 -> `VALIDATION_ERROR`.

## Sticky Wall Service

### `StickyWallService.importCsv(input)`

```ts
type ImportCsvInput = { roomId: RoomId; file: File };
type ImportCsvOutput = {
  importedCount: number;
  rejectedCount: number;
  errorCsvBlob?: Blob;
  rowErrors?: Array<{ rowNumber: number; reason: string }>;
};
```

Validation:

- Rows must be <= 1,000.
- Required columns: `title`, `body`.
- Invalid rows are rejected with row-level reasons; valid rows still import.
- If no valid row exists and schema is broken -> `IMPORT_SCHEMA_INVALID`.

## Chat Service

### `ChatService.sendMessage(input)`

```ts
type SendMessageInput = {
  roomId: RoomId;
  userId: UserId;
  text: string; // <= 500 chars
};
type SendMessageOutput = { messageId: string; sentAt: ISODateTime };
```

Validation:

- text length > 500 -> `VALIDATION_ERROR`.
- >10 messages per minute per local user -> `RATE_LIMITED`.
- Room message retention auto-trims to latest 500.

## Comment Thread Service

### `CommentService.addComment(input)`

```ts
type AddCommentInput = {
  roomId: RoomId;
  elementId: ElementId;
  parentCommentId?: string;
  text: string;
};
```

Behavior:

- Supports threaded replies via `parentCommentId`.
- Stores per-element thread in IndexedDB and broadcasts updates.

## Presence Service

### `PresenceService.heartbeat(input)`

```ts
type PresenceHeartbeatInput = {
  roomId: RoomId;
  userId: UserId;
  tabId: string;
  status: PresenceStatus;
};
```

Behavior:

- Propagates active/idle labels across same-machine tabs.
- Stale tab records expire via heartbeat timeout.

## Activity Feed Service

### `ActivityFeedService.record(event)`

```ts
type ActivityEventType =
  | "create"
  | "edit"
  | "delete"
  | "move"
  | "snapshot"
  | "rollback"
  | "import"
  | "export"
  | "conflict-duplicate";
```

All key actions must emit feed events with actor, room, target, and timestamp.

## Snapshot Service

### `SnapshotService.createSnapshot(input)`

```ts
type CreateSnapshotInput = { roomId: RoomId; reason?: string };
type CreateSnapshotOutput = { snapshotId: SnapshotId; createdAt: ISODateTime };
```

Rules:

- Snapshot generation runs in Worker.
- Retain at most 50 snapshots per room (oldest pruned first).

### `SnapshotService.rollback(input)`

```ts
type RollbackInput = { roomId: RoomId; snapshotId: SnapshotId };
type RollbackOutput = { rolledBackAt: ISODateTime };
```

## Import/Export Service

### `ImportExportService.exportRoomPackage(input)`

```ts
type ExportRoomPackageInput = { roomId: RoomId };
type ExportRoomPackageOutput = { fileName: string; blob: Blob; sizeBytes: number };
```

Validation:

- Export output must be <= 50 MB (`52428800` bytes), else `IMPORT_FILE_TOO_LARGE`.

### `ImportExportService.importRoomPackage(input)`

```ts
type ImportRoomPackageInput = { file: File };
type ImportRoomPackageOutput = {
  mergedRooms: number;
  mergedElements: number;
  conflictsCreated: number;
};
```

Merge policy:

- Last modified wins.
- If same element is edited >2 times within 10 seconds during merge window, create conflict duplicate and emit `CONFLICT_DUPLICATE_CREATED`.

## Storage Service

### `StorageService.getRoomUsage(roomId)`

```ts
type RoomStorageUsage = {
  usedBytes: number;
  warningBytes: 188743680; // 180 MB
  hardLimitBytes: 209715200; // 200 MB
  largestImages: Array<{ assetId: string; sizeBytes: number }>;
  oldestSnapshots: Array<{ snapshotId: SnapshotId; createdAt: ISODateTime }>;
};
```

Behavior:

- At >=180 MB emit warning toast trigger.
- At >200 MB block writes with `STORAGE_LIMIT_EXCEEDED`.

## Ops Console Service

### `OpsService.updateAnnouncement(input)`

```ts
type UpdateAnnouncementInput = { markdown: string; enabled: boolean };
```

### `OpsService.updateFeaturedTemplates(input)`

```ts
type UpdateFeaturedTemplatesInput = {
  templateIds: string[];
  carouselOrder: string[];
};
```

### `OpsService.updateSensitiveKeywords(input)`

```ts
type UpdateSensitiveKeywordsInput = { keywords: string[] };
```

### `OpsService.updateCanaryToggles(input)`

```ts
type UpdateCanaryTogglesInput = Record<string, boolean>;
```

## Analytics Service

### `AnalyticsService.track(event)`

```ts
type AnalyticsEvent =
  | { name: "room_created"; roomId: RoomId; at: ISODateTime }
  | { name: "first_whiteboard_edit"; roomId: RoomId; at: ISODateTime }
  | { name: "first_comment"; roomId: RoomId; at: ISODateTime };
```

### `AnalyticsService.getFunnelReport()`

Returns local funnel conversion counters and per-room completion percentages.

## Relationship Graph Service

Supports local friend request flow and blocklist:

- `send_request`
- `accept_request`
- `reject_request`
- `withdraw_request`
- `set_blocklist`

All transitions are validated for legal state progressions.

## Nutrition Service

### `NutritionService.lookupFood(query)`

Query against offline nutrient table for macro/micro values.

### `NutritionService.scanBarcode(input)`

```ts
type ScanBarcodeInput = { mode: "camera" | "manual"; value?: string };
```

Behavior:

- If camera unavailable, client falls back to manual mode.

## Order Workflow Service

### `OrderService.transitionState(input)`

```ts
type TransitionOrderStateInput = {
  orderId: string;
  from: OrderState;
  to: OrderState;
  reason?: string;
};
```

Allowed transitions:

- `draft -> pending`
- `pending -> approved | canceled`
- `approved -> paid-marked | canceled`
- `paid-marked -> completed | refunding-marked`
- `refunding-marked -> completed`

Invalid transitions return `STATE_TRANSITION_INVALID`.

## BroadcastChannel Event Contract

Channel: `alignspace-events-v1`

```ts
type BroadcastEvent =
  | { type: "room.updated"; roomId: RoomId; at: ISODateTime }
  | { type: "whiteboard.element.updated"; roomId: RoomId; elementId: ElementId; at: ISODateTime }
  | { type: "presence.changed"; roomId: RoomId; userId: UserId; status: PresenceStatus; at: ISODateTime }
  | { type: "chat.message.sent"; roomId: RoomId; messageId: string; at: ISODateTime }
  | { type: "notification.created"; inboxItemId: string; at: ISODateTime }
  | { type: "conflict.duplicate.created"; roomId: RoomId; elementId: ElementId; duplicateId: ElementId; at: ISODateTime };
```

## Example: Send Chat Message

```ts
const result = await ChatService.sendMessage({
  roomId: "room_12",
  userId: "user_7",
  text: "Let's lock scope for this release."
});

if (!result.ok && result.error.code === "RATE_LIMITED") {
  showToast("Message rate limit reached (10/min).");
}
```

## Example: Import Package Merge Result

```ts
const mergeResult = await ImportExportService.importRoomPackage({ file });
if (!mergeResult.ok && mergeResult.error.code === "CONFLICT_DUPLICATE_CREATED") {
  openActivityFeed();
}
```
