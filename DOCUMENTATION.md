# Quick Stickies — Complete Project Documentation

> **Last Updated:** June 18, 2026  
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
- Manually save all notes (with a spinner overlay)
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
| Message rate | ~1 msg / 200ms min | Queue uses 1.5s gap for safety |

### Session
| Parameter | Value |
|-----------|-------|
| Session timeout | 300 seconds (configured in `startWebApp`) |
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
Alexa's `sendMessage` is fire-and-forget. Sending multiple messages simultaneously **drops packets** silently. All outgoing messages MUST go through a serialized queue with delays between sends.

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
msgQueue            // Array of {key, msg} objects
msgSending          // Boolean: true if a message is in-flight
saveInProgress      // Boolean: true during manual save
CHUNK_SIZE          // 12000 chars per chunk
```

**Queue behavior:**
- Messages with the same `key` are **deduplicated** (latest replaces earlier)
- 1.5s gap between each `sendMessage` call
- When queue empties during a save, overlay shows "Saved!" for 1.2s

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
| `queueMsg(msg, key)` | Adds message to outgoing queue |
| `drainQueue()` | Processes queue (sends one message, waits 1.5s) |
| `doSave()` | Manual save: overlay + note metadata + chunked canvas PNGs |
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
5. For each restored note, queue a `loadCanvas` message to fetch its drawing
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
| `HtmlMessageHandler` | `Alexa.Presentation.HTML.Message` | Routes by `msg.type` |
| `UsagesInstalledHandler` | Widget installed on device | Initializes DataStore (bell off) |
| `UsagesRemovedHandler` | Widget removed from device | Logs removal |
| `SessionEndedRequestHandler` | Session ended | Logs reason |
| `ErrorHandler` | Any unhandled error | Speaks error message |

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
   - `request.uri`: GitHub Pages URL with cache-bust query param `?v=12`
   - `configuration.timeoutInSeconds`: 300
5. Return response

### Cache Busting

The URL in `startWebApp()` includes `?v=12`. **This must be incremented** whenever `index.html` changes to force the Echo Show to load the latest version. Without this, the device caches the old HTML indefinitely.

```javascript
uri: 'https://jjgithu.github.io/sticky-notes/web/index.html?v=12'
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

### Web App → Lambda Messages

| `msg.type` | Payload | Purpose |
|------------|---------|---------|
| `saveNotes` | `{ notes: [...], prefs: {...} }` | Save note metadata + user prefs |
| `saveCanvasChunk` | `{ noteId, index, total, data }` | Save one chunk of PNG canvas data |
| `saveCanvas` | `{ noteId, data }` | Save small canvas in one message (legacy, still handled) |
| `loadCanvas` | `{ noteId }` | Request canvas data for a note |
| `loadCanvasChunk` | `{ noteId, chunkIndex }` | Request a specific chunk of canvas data |
| `setAlert` | `{ value: boolean }` | Toggle bell alert |
| `savePrefs` | `{ prefs: {...} }` | Save preferences only |

### Lambda → Web App Messages

| `msg.type` | Payload | Purpose |
|------------|---------|---------|
| `saveResult` | `{ status, count }` | Notes saved confirmation |
| `chunkSaved` | `{ noteId, index }` | Canvas chunk saved confirmation |
| `canvasSaved` | `{ noteId }` | Full canvas saved confirmation |
| `canvasLoaded` | `{ noteId, data }` | Complete canvas data (fits in one message) |
| `canvasChunk` | `{ noteId, chunkIndex, totalChunks, data }` | One chunk of canvas data |
| `prefsSaved` | `{}` | Preferences saved confirmation |
| `{status, code, bell}` | Alert status | Alert toggle result |

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
├── canvas_chunks/
│   └── <safeUserId>/
│       ├── <noteId>_c0            # Chunk 0 (text/plain, base64 fragment)
│       ├── <noteId>_c1            # Chunk 1
│       └── <noteId>_cN            # Chunk N
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

**When the last chunk arrives** (`index === total - 1`), Lambda:
1. Reads ALL chunks from `canvas_chunks/`
2. Concatenates the text into a full data URL string
3. Strips the `data:image/png;base64,` prefix
4. Decodes base64 to binary
5. Saves the binary to `canvas/<userId>/<noteId>` with correct `ContentType`

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
uri: 'https://jjgithu.github.io/sticky-notes/web/index.html?v=13'  // was v=12
```
Then redeploy Lambda.

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
Queue delay: 1500 ms between messages
CHUNK_SIZE: 12000 chars per save chunk
Save overlay auto-hide delay: 1200 ms after "Saved!"
Canvas save debounce: 2000 ms (legacy, not used in manual save)
Note metadata save debounce: 800 ms (legacy, not used in manual save)
```

### lambda/index.js Constants

```javascript
S3_BUCKET: process.env.S3_PERSISTENCE_BUCKET
Load chunk size: 14000 chars
Session timeout: 300 seconds
Cache bust version: v=12
```

### S3 Keys

```
notes/<safeUserId>.json           # Note metadata
canvas/<safeUserId>/<noteId>      # Assembled canvas binary
canvas_chunks/<safeUserId>/<noteId>_c<N>  # Canvas chunk (during save)
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
            │  User clicks "💾 Save"      │
            │  1. Show overlay + spinner  │
            │  2. Queue saveNotes (meta)  │
            │  3. Queue canvas chunks × N │
            │  4. Queue drains            │
            │  5. "Saved!" → hide overlay │
            └─────────────────────────────┘
```

---

*This document was generated from the codebase as of commit `907cb27` (June 18, 2026).*
