# Quick Stickies — Complete Project Documentation

> **Last Updated:** September 25, 2026  
> **Purpose:** Comprehensive handoff document for onboarding a new AI agent or developer.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture](#2-architecture)
3. [File Structure](#3-file-structure)
4. [Platform Constraints & Hard Limits](#4-platform-constraints--hard-limits)
5. [Web App (index.html)](#5-web-app-indexhtml)
6. [Lambda Function (index.js)](#6-lambda-function-indexjs)
7. [APL Widget](#7-apl-widget)
8. [Messaging Protocol](#8-messaging-protocol)
9. [Data Persistence (S3)](#9-data-persistence-s3)
10. [Canvas Chunking Protocol](#10-canvas-chunking-protocol)
    - [10a. Autosave & Closing](#10a-autosave--closing)
11. [Alert Bell System](#11-alert-bell-system)
12. [Deployment Guide](#12-deployment-guide)
13. [Known Issues & Lessons Learned](#13-known-issues--lessons-learned)
14. [Configuration Reference](#14-configuration-reference)

---

## 1. Project Overview

**Quick Stickies** is an Alexa Echo Show widget that provides a desktop sticky-notes experience. Users can:

- Create, move, resize, and delete sticky notes
- Draw freehand with multiple pen colors and sizes
- Type text with selectable font sizes (S/M/L)
- Change note colors (5 presets)
- Undo/redo drawing actions
- Toggle a "bell" alert visible on the widget icon
- Autosave: only what changed is saved, about a second after each edit (the 💾 button shows the status)
- Save manually at any time (with a spinner overlay)
- Say "Alexa, stop" to save everything and then close
- All data persists across sessions via S3

**Invocation:** "Alexa, open sticky notes" or tapping the widget icon on the Echo Show home screen.

---

## 2. Architecture

```
┌───────────────────────────┐
│   Echo Show (Device)      │
│                           │
│  ┌─────────────────────┐  │     ┌──────────────────────────┐
│  │  APL Widget (icon)  │──┼────▶│  Lambda (index.js)       │
│  │  widget.json        │  │     │  - Alexa Skill Backend   │
│  └─────────────────────┘  │     │  - Node.js 16+ (ES5)     │
│           │ tap           │     │  - ask-sdk-core           │
│           ▼               │     │                          │
│  ┌─────────────────────┐  │     │  Handlers:               │
│  │  HTML Web App       │◀─┼────▶│  - LaunchRequest         │
│  │  index.html         │  │     │  - UserEvent (widget tap)│
│  │  (GitHub Pages)     │  │     │  - HTML.Message           │
│  └─────────────────────┘  │     │  - DataStore lifecycle   │
│                           │     │                          │
└───────────────────────────┘     │  Storage:               │
                                  │  ├─ S3 (notes, canvas,  │
                                  │  │   prefs)              │
                                  │  └─ DataStore (bell)     │
                                  └──────────────────────────┘
                                           │
                                  ┌────────┴────────┐
                                  │   S3 Bucket      │
                                  │   (persistent)   │
                                  └─────────────────┘
```

### Communication Flow

1. **Widget tap / Voice launch** → Lambda → `startWebApp()` → loads `index.html` from GitHub Pages
2. **HTML ↔ Lambda** — bidirectional via `Alexa.Presentation.HTML` messaging:
   - Web App → Lambda: `alexaClient.skill.sendMessage(msg)` (max 16KB per message)
   - Lambda → Web App: `Alexa.Presentation.HTML.HandleMessage` directive (in response)
3. **Lambda → Device DataStore** — for updating the widget icon bell state (async HTTP to Amazon API)

### Key Constraint: Request-Response Model
Lambda can only send ONE response per incoming message. It cannot push messages to the web app independently. The web app must initiate all communication.

---

## 3. File Structure

```
sticky_notes/
├── .nojekyll              # Tells GitHub Pages not to use Jekyll processing
├── _config.yml            # Jekyll config (excludes lambda/, models/, etc. from Pages)
├── skill.json             # Alexa skill manifest (interfaces: APL + HTML)
│
├── web/
│   └── index.html         # The entire web app (HTML + CSS + JS in one file)
│                           # Served via GitHub Pages
│                           # URL: https://jjgithu.github.io/sticky-notes/web/index.html
│
├── lambda/
│   └── index.js           # AWS Lambda function (Alexa skill backend)
│                           # Deployed manually via Alexa Developer Console
│                           # Lines 11-12: Client ID/Secret (must be filled in each deploy)
│
├── apl/
│   ├── widget-manifest.json  # Widget registration (id: StickyNotesWidget)
│   └── widget.json           # APL template for the widget icon/face
│
└── models/
    └── en-US.json          # Interaction model (invocation: "sticky notes")
```

### Deployment Targets

| File | Deployed To | Method |
|------|------------|--------|
| `web/index.html` | GitHub Pages | Auto-deploy on `git push` to `main` |
| `lambda/index.js` | Alexa Developer Console → Lambda | Manual paste + Deploy |
| `apl/widget.json` | Alexa Developer Console → APL editor | Manual paste |
| `apl/widget-manifest.json` | Alexa Developer Console → Widget config | Manual paste |
| `models/en-US.json` | Alexa Developer Console → Interaction Model | Manual paste + Build |
| `skill.json` | Alexa Developer Console → Skill manifest | Reference only |

---

## 4. Platform Constraints & Hard Limits

These constraints were discovered through extensive testing and are **critical** for any future changes:

### Message Limits
| Limit | Value | Impact |
|-------|-------|--------|
| `sendMessage` payload | **16 KB** (16,384 bytes) | Canvas data MUST be chunked if > ~14KB |
| `HandleMessage` response | **~24 KB** total response | Lambda responses with canvas data must chunk |
| `HTML.Start` data field | **~24 KB** | Cannot embed canvas data for multiple notes |
| Message rate | **2 messages / second** (Amazon docs) | Queue sends one message at a time, waits for the Lambda's reply, and keeps ≥ 550 ms between sends. Throttled sends get `statusCode: 429` in the `sendMessage` callback. |

### Session
| Parameter | Value |
|-----------|-------|
| Session timeout | 300 seconds without user interaction (configured in `startWebApp`; 300 is the maximum) — then the app closes |
| Lambda timeout | 8 seconds (Alexa platform default) |

### Canvas
| Parameter | Value |
|-----------|-------|
| Default canvas size | 420 × 296 px (note 420×330 minus 34px header) |
| Save format | PNG (lossless, full resolution) |
| Chunk size (save) | 12,000 chars per message |
| Chunk size (load) | 14,000 chars per response |
| Typical PNG size | 10–60 KB (2–5 chunks) |

### Critical Discovery: Message Flooding
Sending multiple messages simultaneously **drops packets** silently. All outgoing messages MUST go through the serialized queue. Since v13 the queue treats the Lambda's reply as the delivery confirmation: each message carries a `seq`, the Lambda echoes it, and a message with no reply within 5 s is sent again (up to 4 attempts).

### Critical Discovery: No Close Event
The web app gets **no warning** when the user leaves by swiping, pressing Home, saying "Alexa, exit" / "Alexa, go home", or when the idle timeout closes it. Only the skill can close the app on purpose (a response with `shouldEndSession: true`). This is why saving is automatic and why "Alexa, stop" is routed through the web app (see [Autosave & Closing](#10a-autosave--closing)).

### Critical Discovery: HTML.Start Size Limit
Embedding all canvas data in the `HTML.Start` directive caused the response to exceed 24KB, which silently stripped data. The fix was loading canvases individually after startup via separate messages.

---

## 5. Web App (index.html)

The entire web app is a single HTML file with embedded CSS and JavaScript. **ES5 only** — the Echo Show's web engine does not support ES6+ reliably.

### Global Variables

```javascript
alexaClient         // Alexa SDK client instance
workspace           // DOM element #workspace
noteCount           // Number of notes created
zIdx                // z-index counter for note stacking
currentMode         // 'type' | 'draw' | 'erase'
penColor            // Current pen color (hex string, default '#000000')
penSize             // Current pen thickness (2 | 5 | 10, default 5)
fontSize            // Current font size (14 | 18 | 24, default 18)
selectedNoteEl      // Currently selected note DOM element (or null)
notesRestoredFromServer  // Boolean: true if notes were loaded from S3
NOTE_COLORS         // Array: ['#FFF2AB', '#FFB3BA', '#BAFFC9', '#BAE1FF', '#E0BBE4']
undoMap             // Object: noteId → array of canvas PNG snapshots
redoMap             // Object: noteId → array of canvas PNG snapshots
MAX_UNDO            // 10 undo steps per note
```

### Message Queue

```javascript
msgQueue            // Array of {key, msg, onDone, attempts, seqs} waiting to be sent
inFlight            // The message waiting for the Lambda's reply (or null)
msgSeq              // Counter stamped on every message as msg.seq
CHUNK_SIZE          // 12000 chars per chunk
```

**Queue behavior:**
- Messages with the same `key` are **deduplicated** (latest replaces earlier)
- One message in flight at a time; the next is sent when the Lambda's reply (same `seq`) arrives, at least 550 ms after the previous send
- No reply within 5 s, or a 429/error in the `sendMessage` callback → the same message is sent again (max 4 attempts), then `onDone(false)`
- Replies without `seq` (Lambda older than v13) confirm whatever is in flight

### Key Functions

| Function | Purpose |
|----------|---------|
| `addNote(data)` | Creates a note DOM element. `data` is optional (for restoring saved notes) |
| `selectNote(noteEl)` | Highlights a note with blue border/glow |
| `setMode(m)` | Switches between 'type', 'draw', 'erase' |
| `pickPen(el)` | Sets pen color from toolbar dot |
| `pickSize(sz, el)` | Sets pen thickness |
| `pickFontSize(sz, el)` | Sets font size for selected note |
| `pushUndo(noteEl)` | Saves canvas snapshot to undo stack |
| `doUndo()` / `doRedo()` | Restores canvas from undo/redo stack |
| `queueMsg(msg, key, onDone)` | Adds message to outgoing queue; `onDone(ok, reply)` runs on reply or final failure |
| `drainQueue()` / `onReply(msg)` | Sends the next message / confirms the one in flight |
| `markMetaDirty()` / `markCanvasDirty(noteEl)` | Records a change and schedules an autosave |
| `runSave()` | One save round: note metadata (if changed) + changed canvases only |
| `saveNow(cb)` | Save immediately; `cb(ok)` once everything is confirmed saved |
| `doSave()` | Save button: overlay until the save is confirmed |
| `saveAndClose()` | "Alexa, stop": save everything, then send `closeApp` |
| `requestCanvas(id)` / `canvasLoadDone(id)` | Load a saved drawing / mark it loaded (saving that note is blocked until then) |
| `toggleAlert(checked)` | Sends alert state to Lambda (auto-sends, not manual) |
| `restorePrefs(prefs)` | Restores toolbar state from saved preferences |
| `handleCanvasMessage(msg)` | Handles `canvasLoaded` and `canvasChunk` responses |
| `drawCanvasData(noteId, dataUrl)` | Draws a data URL onto the correct note's canvas |

### Drawing Implementation

- Uses `touchstart/touchmove/touchend` + `mousedown/mousemove/mouseup` events
- **Quadratic Bézier curves** for smooth strokes (not straight lines between points)
- Erase mode uses `globalCompositeOperation = 'destination-out'` with 4× pen size
- Canvas is layered above the textarea; `draw-active` class swaps z-index

### Note DOM Structure

```html
<div class="note draw-active selected" data-color="#FFF2AB" data-id="n_1234_abc" data-fontsize="18">
  <div class="note-hdr">
    <span class="cdot" data-color="#FFF2AB" style="background:#FFF2AB"></span>
    <!-- ... 4 more color dots ... -->
    <span class="note-del">✕</span>
  </div>
  <canvas class="note-canvas" width="420" height="296"></canvas>
  <textarea class="note-text" style="font-size:18px"></textarea>
  <div class="resize-hdl"></div>
</div>
```

### CSS Classes

| Class | Purpose |
|-------|---------|
| `.note` | Base note styling (absolute positioned, rounded, shadow) |
| `.note.selected` | Blue inset box-shadow + glow (avoids border-based layout shifts) |
| `.note.draw-active` | Swaps canvas z-index above textarea |
| `.note-hdr` | Header bar with color dots and delete button |
| `.note-canvas` | Drawing canvas (absolute positioned below textarea) |
| `.note-text` | Textarea for typed content |
| `.resize-hdl` | Bottom-right resize handle |
| `.pdot` / `.pdot.sel` | Pen color dots in toolbar |
| `.tool-btn` / `.tool-btn.sel` | Toolbar buttons with selection state |
| `#saveOverlay` / `#saveOverlay.show` | Full-screen save spinner overlay |

### Startup Sequence

1. `Alexa.create({version: '1.1'})` → receives `args.alexa` and `args.message` (init data from Lambda)
2. Restore alert checkbox from `initData.alertOn`
3. Restore toolbar preferences from `initData.prefs`
4. If saved notes exist, clear workspace and recreate all notes via `addNote(data)`
5. For each restored note, `requestCanvas()` queues a `loadCanvas` message to fetch its drawing
6. Register `onMessage` handler for canvas chunk responses
7. A default blank note is always created at boot (at bottom of script)

---

## 6. Lambda Function (index.js)

### Dependencies
```javascript
var Alexa = require('ask-sdk-core');  // Alexa Skills Kit
var https = require('https');          // For LWA token + DataStore API
var querystring = require('querystring');
var AWS = require('aws-sdk');          // S3 access
```

### Environment Variables
| Variable | Purpose |
|----------|---------|
| `S3_PERSISTENCE_BUCKET` | S3 bucket name for all persistence |
| `SKILL_CLIENT_ID` | LWA client ID (hardcoded on line 11) |
| `SKILL_CLIENT_SECRET` | LWA client secret (hardcoded on line 12) |

> ⚠️ **CRITICAL:** Lines 11-12 must have the actual Client ID and Secret pasted in. These are obtained from Alexa Developer Console → Build → Permissions. They must be re-pasted every time the Lambda code is replaced.

### Request Handlers

| Handler | Trigger | Action |
|---------|---------|--------|
| `LaunchRequestHandler` | "Alexa, open sticky notes" | Calls `startWebApp()` |
| `UserEventHandler` | Widget icon tapped | Calls `startWebApp()` |
| `HtmlMessageHandler` | `Alexa.Presentation.HTML.Message` | Routes by `msg.type`; every reply goes through `replyToWebApp()` (echoes `seq`) |
| `StopIntentHandler` | "Alexa, stop" / "cancel" (and `NavigateHomeIntent` if Alexa sends it) | Sends `prepareToClose` to the web app and keeps the session open; the app saves, then sends `closeApp`. Asked again ≥ 5 s later with no message from the page since → ends the session |
| `UsagesInstalledHandler` | Widget installed on device | Initializes DataStore (bell off) |
| `UsagesRemovedHandler` | Widget removed from device | Logs removal |
| `SessionEndedRequestHandler` | Session ended | Logs reason |
| `ErrorHandler` | Any unhandled error | Web app messages get a silent `{type:'error'}` reply; everything else speaks an error message |

### S3 Persistence Functions

| Function | Purpose |
|----------|---------|
| `saveNotesToS3(userId, notes)` | Saves note metadata array as JSON |
| `loadNotesFromS3(userId)` | Loads note metadata array |
| `saveCanvasToS3(userId, noteId, base64Data)` | Saves assembled canvas binary |
| `loadCanvasData(userId, notes)` | **LEGACY** — bulk loads all canvases (no longer used in startup) |
| `savePrefsToS3(userId, prefs)` | Saves user preferences JSON |
| `loadPrefsFromS3(userId)` | Loads user preferences JSON |
| `safeUserId(userId)` | Sanitizes userId for S3 key safety |

### `startWebApp()` Flow

1. Load notes from S3 (metadata only, no canvas data)
2. Load prefs from S3 (includes `alertOn` flag)
3. Set `alertState` from prefs
4. Build `Alexa.Presentation.HTML.Start` directive with:
   - `data`: `{ appName, alertOn, notes, prefs }`
   - `request.uri`: GitHub Pages URL with cache-bust query param `?v=13`
   - `configuration.timeoutInSeconds`: 300
5. Return response

### Cache Busting

The URL in `startWebApp()` includes `?v=13`. **This must be incremented** whenever `index.html` changes to force the Echo Show to load the latest version. Without this, the device caches the old HTML indefinitely.

```javascript
uri: 'https://jjgithu.github.io/sticky-notes/web/index.html?v=13'
```

---

## 7. APL Widget

### widget-manifest.json
- Widget ID: `StickyNotesWidget`
- Background: `#121212` (dark)
- Preview: placeholder image

### widget.json (APL Template)
- Uses **DataStore extension** (`alexaext:datastore:10`)
- Binds to namespace `quickStickies`, key `alertState`
- Displays:
  - 🔔 emoji (large) when `alertData.showBell == true`
  - "Quick Stickies" title in `#FFF2AB`
  - "Tap to open" subtitle
  - "🔔 ALERT ACTIVE" text at bottom when bell is on
- `TouchWrapper` sends `OpenWidget` UserEvent on tap

---

## 8. Messaging Protocol

Every web app → Lambda message carries `seq` (a counter). Every Lambda reply to it echoes the same `seq`, so the web app knows which message was confirmed.

The Lambda keeps two timestamps in session attributes for the stop flow: `closeRequestedAt` (last `prepareToClose` sent) and `lastWebMsgAt` (last message from the web app).

### Web App → Lambda Messages

| `msg.type` | Payload | Purpose |
|------------|---------|---------|
| `saveNotes` | `{ notes: [...], prefs: {...} }` | Save note metadata + user prefs |
| `saveCanvasChunk` | `{ noteId, saveId, index, total, length, data }` | Save one chunk of PNG canvas data (`saveId` and `length` since v13) |
| `saveCanvas` | `{ noteId, data }` | Save small canvas in one message (legacy, still handled) |
| `loadCanvas` | `{ noteId }` | Request canvas data for a note |
| `loadCanvasChunk` | `{ noteId, chunkIndex }` | Request a specific chunk of canvas data |
| `setAlert` | `{ value: boolean }` | Toggle bell alert |
| `savePrefs` | `{ prefs: {...} }` | Save preferences only |
| `closing` | `{}` | Web app received `prepareToClose` and is saving (lets the Lambda know the page is alive) |
| `closeApp` | `{}` | Everything is saved: Lambda ends the session (closes the app) |

### Lambda → Web App Messages

| `msg.type` | Payload | Purpose |
|------------|---------|---------|
| `saveResult` | `{ status, count }` | Notes saved confirmation (`status: 'error'` if S3 failed) |
| `chunkSaved` | `{ noteId, index, ok }` | Canvas chunk saved confirmation (`ok: false` if S3 failed or the joined data was incomplete) |
| `canvasSaved` | `{ noteId, ok }` | Full canvas saved confirmation |
| `canvasLoaded` | `{ noteId, data, error? }` | Complete canvas data (fits in one message). `data: null` = no drawing saved; `error: true` = S3 read failed (not the same as "no drawing") |
| `canvasChunk` | `{ noteId, chunkIndex, totalChunks, data, error? }` | One chunk of canvas data (`error: true` if the read failed) |
| `prefsSaved` | `{}` | Preferences saved confirmation |
| `{status, code, bell}` | Alert status | Alert toggle result |
| `prepareToClose` | `{}` | Sent for "Alexa, stop" / "cancel" (not a reply; has no `seq`) |
| `closingAck` | `{}` | Reply to `closing` |
| `ignored` / `error` | `{}` | Unknown message type / handler crashed — keeps the web app's queue moving |

---

## 9. Data Persistence (S3)

### S3 Key Structure

```
<bucket>/
├── notes/
│   └── <safeUserId>.json          # Note metadata array
│       Example content: [
│         { id, x, y, w, h, color, text, fontSize },
│         ...
│       ]
│
├── canvas/
│   └── <safeUserId>/
│       └── <noteId>               # Assembled binary (PNG/JPEG)
│           ContentType: image/png
│
├── canvas_chunks/                 # Temporary; deleted after the canvas is assembled
│   └── <safeUserId>/
│       ├── <noteId>_<saveId>_c0   # Chunk 0 (text/plain, base64 fragment)
│       ├── <noteId>_<saveId>_c1   # Chunk 1
│       └── <noteId>_<saveId>_cN   # Chunk N  (no <saveId> for pre-v13 web apps)
│
└── prefs/
    └── <safeUserId>.json          # User preferences
        Example content: {
          penColor: "#000000",
          penSize: 5,
          fontSize: 18,
          alertOn: true
        }
```

### Note Metadata Schema

```json
{
  "id": "n_1718000000000_abc123",
  "x": 20,
  "y": 10,
  "w": 420,
  "h": 330,
  "color": "#FFF2AB",
  "text": "Hello world",
  "fontSize": 18
}
```

### Note ID Format
`n_<timestamp>_<random6chars>` — e.g., `n_1718000000000_x7k2m9`

### `safeUserId()`
Replaces all non-alphanumeric characters (except `.`, `_`, `-`) with `_`. Alexa user IDs contain characters like `amzn1.ask.account.XXXXXXX...` which are safe, but this prevents issues with special chars.

---

## 10. Canvas Chunking Protocol

### Save Flow (Web App → Lambda → S3)

```
Web App                           Lambda                          S3
  │                                 │                              │
  │ saveCanvasChunk                 │                              │
  │ {noteId, index:0, total:3,     │                              │
  │  data:"data:image/png;b..."}   │                              │
  │ ───────────────────────────────▶│  putObject                   │
  │                                 │  canvas_chunks/usr/note_c0   │
  │                                 │─────────────────────────────▶│
  │◀─── chunkSaved {index:0}  ─────│                              │
  │                                 │                              │
  │ saveCanvasChunk {index:1,...}   │  putObject                   │
  │ ───────────────────────────────▶│  canvas_chunks/usr/note_c1   │
  │                                 │─────────────────────────────▶│
  │◀─── chunkSaved {index:1}  ─────│                              │
  │                                 │                              │
  │ saveCanvasChunk {index:2,...}   │  putObject c2                │
  │ (last chunk: index == total-1)  │  + read c0, c1, c2          │
  │ ───────────────────────────────▶│  + concatenate               │
  │                                 │  + decode base64             │
  │                                 │  + putObject                 │
  │                                 │    canvas/usr/noteId (binary)│
  │                                 │─────────────────────────────▶│
  │◀─── chunkSaved {index:2}  ─────│                              │
```

The web app sends the next chunk only after the previous `chunkSaved` reply arrives.

**When the last chunk arrives** (`index === total - 1`), Lambda:
1. Reads ALL chunks of this `saveId` from `canvas_chunks/`
2. Concatenates the text into a full data URL string
3. Checks the result is exactly `length` characters — if not, replies `ok: false` and leaves the stored drawing untouched
4. Strips the `data:image/png;base64,` prefix
5. Decodes base64 to binary
6. Saves the binary to `canvas/<userId>/<noteId>` with correct `ContentType`
7. Deletes this save's chunks (best effort)

### Load Flow (Web App ← Lambda ← S3)

```
Web App                           Lambda                          S3
  │                                 │                              │
  │ loadCanvas {noteId}             │  getObject                   │
  │ ───────────────────────────────▶│  canvas/usr/noteId           │
  │                                 │◀─────────────────────────────│
  │                                 │  Convert to data URL         │
  │                                 │  Calculate chunks            │
  │                                 │                              │
  │ (if small, fits in one msg)     │                              │
  │◀── canvasLoaded {data:full} ────│                              │
  │                                 │                              │
  │ (if large, send first chunk)    │                              │
  │◀── canvasChunk {idx:0,          │                              │
  │     totalChunks:3, data:...} ───│                              │
  │                                 │                              │
  │ loadCanvasChunk {idx:1}         │  getObject (re-read)         │
  │ ───────────────────────────────▶│  extract chunk 1             │
  │◀── canvasChunk {idx:1,...}  ────│                              │
  │                                 │                              │
  │ loadCanvasChunk {idx:2}         │  getObject (re-read)         │
  │ ───────────────────────────────▶│  extract chunk 2             │
  │◀── canvasChunk {idx:2,...}  ────│                              │
  │                                 │                              │
  │ All chunks received!            │                              │
  │ Concatenate → full data URL     │                              │
  │ Create Image → draw on canvas   │                              │
```

**Note:** Lambda re-reads the full S3 object for each `loadCanvasChunk` request (stateless). This is inefficient but simple and reliable.

---

## 10a. Autosave & Closing

### What gets saved, and when
- Every change bumps a version number: `markCanvasDirty(note)` after a stroke, resize, undo or redo; `markMetaDirty()` after adding, deleting, moving, recoloring a note, typing, or changing pen/size/font.
- An autosave round starts **1 s after the last change** (at most 10 s after the first one while changes keep coming), and not in the middle of a stroke.
- A round sends the note metadata if it changed, then **only the canvases that changed**, as full-resolution PNGs. A version counts as saved only when the Lambda confirms it; changes made during a round are picked up by the next one.
- A note whose saved drawing is still loading is not uploaded until the load finishes. Otherwise the upload would replace the saved drawing with just the new strokes.
- If loading a saved drawing fails (S3 error, broken chunk), the web app retries it (3 attempts, 3 s apart). If it still fails, that note's drawing is **not** saved (the button shows ⚠) so the stored drawing is never replaced; the Save button and "Try again" retry the load.
- Before drawing a restored image (load, undo, redo) the canvas is switched back from eraser mode (`globalCompositeOperation = 'source-over'`); otherwise the image would erase the canvas.
- A failed round (no reply after retries, or `ok: false`) shows **⚠ Save** and retries after 10 s.

### Save button states
| Label | Color | Meaning |
|-------|-------|---------|
| ✓ Saved | green | Everything is saved — safe to close |
| 💾 Save | orange | Unsaved changes (autosave will start shortly) |
| Saving… | blue | Upload in progress |
| ⚠ Save | orange | Last save failed; retrying |

Tapping the button saves immediately and shows the overlay until the save is confirmed.

### Closing
| How the user closes | Saved before closing? |
|---------------------|-----------------------|
| "Alexa, stop" / "Alexa, cancel" | **Yes.** Lambda sends `prepareToClose`; the app answers `closing`, shows "Saving before closing… N%", saves everything (finishing any stroke in progress), then sends `closeApp`; the Lambda ends the session. If saving fails, the user can **Try again** (or say "Alexa, stop" again) or **Close without saving**. If the page never answers (old cached version, script error), saying "Alexa, stop" again after 5 s closes the app. |
| Swipe away, Home, "Alexa, exit", "Alexa, go home" | Can't be intercepted (no close event). Only what autosave already finished is kept. |
| Idle timeout (300 s without interaction) | Yes in practice — autosave runs long before the timeout. |

---

## 11. Alert Bell System

### How it works

1. User checks "ALERT 🔔" checkbox in the web app
2. Web app sends `{ type: 'setAlert', value: true }` via queue
3. Lambda:
   a. Sets in-memory `alertState = true`
   b. Persists to S3 prefs: `prefs.alertOn = true`
   c. Gets LWA OAuth token from Amazon (`api.amazon.com/auth/o2/token`)
   d. Calls DataStore API (`api.amazonalexa.com/v1/datastore/commands`)
   e. Sends `PUT_OBJECT` command to update `quickStickies.alertState.showBell`
4. Widget APL template reactively shows 🔔 when `alertData.showBell == true`

### LWA (Login with Amazon) Authentication

```
POST https://api.amazon.com/auth/o2/token
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials
&client_id=<SKILL_CLIENT_ID>
&client_secret=<SKILL_CLIENT_SECRET>
&scope=alexa::datastore
```

Returns: `{ access_token: "Atza|..." }`

### DataStore API Call

```
POST https://api.amazonalexa.com/v1/datastore/commands
Authorization: Bearer <token>
Content-Type: application/json

{
  "commands": [{
    "type": "PUT_OBJECT",
    "namespace": "quickStickies",
    "key": "alertState",
    "content": { "showBell": true }
  }],
  "target": {
    "type": "DEVICES",
    "items": ["<deviceId>"]
  }
}
```

### Alert Persistence
- `alertOn` is saved in the prefs S3 object
- On startup, `startWebApp()` reads `prefs.alertOn` and passes it to the web app
- The web app checks the checkbox accordingly

---

## 12. Deployment Guide

### HTML (Auto-deploys)
1. Edit `web/index.html`
2. `git add -A && git commit -m "..." && git push`
3. GitHub Pages auto-deploys in ~1 min
4. **If the Lambda hasn't been updated with a new `?v=N`**, the Echo Show will use cached HTML

### Lambda (Manual deploy)
1. Open [Alexa Developer Console](https://developer.amazon.com/alexa/console/ask)
2. Open the "Quick Stickies" skill → **Code** tab
3. Replace the contents of `index.js` with the latest `lambda/index.js`
4. **CRITICAL:** Paste the Client ID on line 11 and Client Secret on line 12
5. Click **Save** → **Deploy**
6. Wait for deployment to complete (~30s)

### Cache Busting (Required when HTML changes)
When `index.html` changes, the cache-bust version in `lambda/index.js` must be incremented:
```javascript
// In startWebApp(), update the version:
uri: 'https://jjgithu.github.io/sticky-notes/web/index.html?v=14'  // was v=13
```
Then redeploy Lambda.

> **v13 (autosave):** deploy the web app first (merge to `main`, wait until GitHub Pages serves it), then the Lambda. The Lambda's `?v=13` is what makes devices load the new page; deploying it before Pages is updated can leave the old page cached under the new URL. The new page also works with the old Lambda (autosave, Save button), but "Alexa, stop" saving before closing needs the v13 Lambda. No interaction model build and no widget (APL) changes are needed.

### GitHub Pages Settings
- **Source:** Deploy from branch → `main` / `/ (root)`
- **Custom domain:** (leave blank)
- Repo must be **public** for free GitHub Pages

### S3 Bucket Setup
The Lambda needs an S3 bucket. Set the bucket name in the Lambda environment variable `S3_PERSISTENCE_BUCKET` in the Alexa Developer Console (or hardcode it).

---

## 13. Known Issues & Lessons Learned

### 🔴 Critical Lessons

| # | Lesson | Detail |
|---|--------|--------|
| 1 | **No concurrent sendMessage** | Sending multiple `sendMessage` calls simultaneously drops messages silently. ALL outgoing messages must go through a serialized queue with delays. |
| 2 | **HTML.Start data limit ~24KB** | Cannot embed canvas data for multiple notes in the start directive. Canvas must be loaded individually after startup. |
| 3 | **sendMessage limit 16KB** | Large canvas PNGs (20-60KB) must be chunked into ~12KB pieces. |
| 4 | **HandleMessage response limit** | Lambda responses with canvas data must also be chunked (~14KB per chunk). |
| 5 | **Lambda cold starts reset state** | Any in-memory variable (like `alertState`) is lost on cold start. All state must be persisted to S3. |
| 6 | **Echo Show caches HTML aggressively** | The `?v=N` query param on the URL is the only reliable way to bust the cache. Must be incremented and Lambda redeployed. |
| 7 | **ES5 only** | The Echo Show web engine does not reliably support ES6. No `let`, `const`, arrow functions, template literals, `class`, destructuring, etc. |
| 8 | **CSS `border` causes layout shifts** | Using `border` for note selection changed the element's total size, pushing canvas content outside the note. Use `inset box-shadow` instead. |
| 9 | **GitHub Pages requires public repo** | Private repos cannot use free GitHub Pages. If the repo is made private, the widget gets a 404. |
| 10 | **Prefs save must be non-blocking** | If prefs save fails in `saveNotes` handler, the note save was also failing. Prefs save is now fire-and-forget. |
| 11 | **No close event** | Swipe/Home/"Alexa, exit" close the app without warning. Saves must happen continuously (autosave), not at close time. |
| 12 | **A reply is the only real confirmation** | `sendMessage` gives no delivery guarantee. The queue waits for the Lambda's reply (matched by `seq`) and re-sends when none arrives. |
| 13 | **Canvas context stays in eraser mode** | After an Erase stroke the 2D context keeps `globalCompositeOperation = 'destination-out'`, so `drawImage` erases instead of drawing. Reset it to `'source-over'` before drawing a restored image. |

### 🟡 Historical Issues (Resolved)

- **White shadow around drawings on reload:** Caused by saving canvas with background fill as JPEG, then restoring on a different background. Fixed by using PNG with transparent background.
- **Canvas larger than note borders:** `border`-based selection indicator added 3px × 2 = 6px to the note dimensions. Fixed by switching to `inset box-shadow`.
- **Notes not saving:** Multiple simultaneous `sendMessage` calls flooding the channel. Fixed with message queue.

---

## 14. Configuration Reference

### web/index.html Constants

```javascript
// Note defaults
NOTE_COLORS = ['#FFF2AB', '#FFB3BA', '#BAFFC9', '#BAE1FF', '#E0BBE4'];
Default note size: 420 × 330 px
Default header height: 34 px
Default canvas size: 420 × 296 px

// Drawing
Default penColor: '#000000'
Default penSize: 5
Available pen sizes: 2 (Thin), 5 (Med), 10 (Thick)
Available font sizes: 14 (S), 18 (M), 24 (L)
MAX_UNDO: 10 snapshots per note

// Message queue
SEND_GAP_MS: 550 ms minimum between sends (platform limit: 2/s)
REPLY_TIMEOUT_MS: 5000 ms before a message is sent again
MAX_SEND_ATTEMPTS: 4
CHUNK_SIZE: 12000 chars per save chunk

// Autosave
AUTOSAVE_DELAY_MS: 1000 ms after the last change
AUTOSAVE_MAX_WAIT_MS: 10000 ms while changes keep coming
SAVE_RETRY_MS: 10000 ms after a failed save
Save overlay auto-hide delay: 1200 ms after "Saved!"
```

### lambda/index.js Constants

```javascript
S3_BUCKET: process.env.S3_PERSISTENCE_BUCKET
Load chunk size: 14000 chars
Session timeout: 300 seconds
Cache bust version: v=13
```

### S3 Keys

```
notes/<safeUserId>.json           # Note metadata
canvas/<safeUserId>/<noteId>      # Assembled canvas binary
canvas_chunks/<safeUserId>/<noteId>_<saveId>_c<N>  # Canvas chunk (during save, then deleted)
prefs/<safeUserId>.json           # User preferences + alertOn
```

---

## Appendix: Complete Message Flow Diagram

```
                    ┌─────────────┐
                    │  User opens  │
                    │   widget     │
                    └──────┬──────┘
                           │
            ┌──────────────▼──────────────┐
            │  Lambda: startWebApp()      │
            │  1. Load notes from S3      │
            │  2. Load prefs from S3      │
            │  3. Set alertOn from prefs  │
            │  4. Return HTML.Start       │
            └──────────────┬──────────────┘
                           │
            ┌──────────────▼──────────────┐
            │  Web App: Alexa.create()    │
            │  1. Restore alert checkbox  │
            │  2. Restore toolbar prefs   │
            │  3. Create notes from data  │
            │  4. Queue loadCanvas × N    │
            └──────────────┬──────────────┘
                           │
        ┌──────────────────▼──────────────────┐
        │  Message Queue drains (1.5s gaps):   │
        │  loadCanvas(note1) → canvasChunk(0)  │
        │  loadCanvasChunk(1) → canvasChunk(1) │
        │  loadCanvas(note2) → canvasLoaded    │
        │  ...                                 │
        └──────────────────┬──────────────────┘
                           │
            ┌──────────────▼──────────────┐
            │  User works with notes...   │
            │  - Draw, type, move, resize │
            │  - Change colors, fonts     │
            │  - Toggle alert             │
            └──────────────┬──────────────┘
                           │
            ┌──────────────▼──────────────┐
            │  Autosave (1 s after edits) │
            │  1. saveNotes if changed    │
            │  2. Chunks of CHANGED       │
            │     canvases, each one      │
            │     confirmed by the Lambda │
            │  3. Button: "✓ Saved"       │
            └──────────────┬──────────────┘
                           │
            ┌──────────────▼──────────────┐
            │  "Alexa, stop"              │
            │  1. Lambda → prepareToClose │
            │  2. App saves everything    │
            │  3. App → closeApp          │
            │  4. Lambda ends session     │
            └─────────────────────────────┘
```

---

*This document was generated from the codebase as of commit `907cb27` (June 18, 2026) and updated for autosave (v13, September 25, 2026).*
