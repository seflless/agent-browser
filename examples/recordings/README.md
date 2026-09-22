# Repeatable product recordings

Use a deterministic script for the take, and an agent only for discovery, rehearsal, and review. These examples drive the actual UI through the agent-browser CLI. They do not create shapes directly through application APIs or run an LLM loop between recorded actions.

## Known-good setup

The September 2026 Decode recording was verified on macOS with Chrome, ffmpeg, and this fork's native recorder. Start with a 1280×800 logical viewport, native scale 2, and 60 fps output. This yields actual 2560×1600 source frames while keeping the UI legible. Do not start by increasing the logical viewport to 4K; that shrinks the apparent UI. A true 3840×2160 experiment would use 1920×1080 logical pixels at native scale 2 and needs its own capture-performance verification.

Launch a **fresh session** with the native scale flag, then set the emulated viewport too:

```bash
agent-browser --session product-take --args '--force-device-scale-factor=2' open https://example.com
agent-browser --session product-take set viewport 1280 800 2
```

Changing launch flags after a browser already exists does not retrofit that browser. Use a new session or close only the session you own and relaunch after its daemon exits.

`--cursor-icon` takes a local SVG. Supply its hotspot in the original SVG viewBox, not screen or video pixels. `--cursor-scale` scales the icon and hotspot together. The tested `left_ptr.svg` from [seflless.com's cursor collection](https://github.com/seflless/seflless.com/tree/main/public/cursors) uses hotspot `59,28` and scale `0.5`. Those numbers are asset-specific; do not copy them to an unrelated arrow. OS cursor-size limits do not apply.

## Run the 4×3 Decode color palette demo

Requirements: Node.js 22+ (built-in WebSocket and fetch), ffmpeg/ffprobe, a built fork binary, a running local Decode web app, and an existing local user. The example prefers `cli/target/debug/agent-browser`, or set `AGENT_BROWSER_BIN` explicitly. No Node packages are required.

```bash
# In the agent-browser checkout:
cargo build --manifest-path cli/Cargo.toml

# In your Decode checkout, start its normal local web development environment.
# Use a real existing local user ID and its username, not an invented ID.
node examples/recordings/decode-color-grid.mjs \
  --base-url http://127.0.0.1:4266 \
  --dev-user-id "$DECODE_DEMO_USER_ID" \
  --username "$DECODE_DEMO_USERNAME" \
  --cursor-icon /absolute/path/to/left_ptr.svg \
  --output /absolute/path/to/takes/color-grid-01.mp4
```

The dev-auth flow is limited to localhost hosts. It creates a new board without deleting any existing board. An already accessible empty board can instead be supplied with `--board-url`; this example's fresh browser must be able to access it without an interactive login. The script requires Decode's development `window.__tldraw_editor__` hook for read-only preflight/postflight checks. It does not mutate editor state through that hook.

The sequence is deliberately simple:

1. Establish local auth, create/open an empty board, set viewport/DPR, wait for the actual Rectangle and Color controls (the editor hook can appear before toolbar hydration), and reset board zoom to 100% before recording.
2. Probe one actual screencast JPEG and require 2560×1600 source pixels.
3. Run one batch: create rectangle, enter the color name, choose that color; set Solid only on the first rectangle. Repeat in four columns and three rows. There are no arrows and no redundant Select-tool clicks.
4. Escape, select all, and press Shift+2 to center/zoom the selection. Hold the finished result for 900 ms, then stop recording.
5. Verify 12 rectangles, exact one-paragraph labels, matching colors, inherited solid fills, geometry, selection, and viewport centering. Capture a still and close the owned browser session.

The order preserves palette pairs: Black/Grey, Violet/Light violet, Blue/Light blue, Orange/Yellow, Green/Light green, Red/Light red. This is a longer demonstration than the two-box Start/End take; twelve complete create-and-style interactions take roughly a minute, depending on the machine.

```bash
# Inspect the complete action list without opening a browser:
node examples/recordings/decode-color-grid.mjs --dry-run

# Check the script's sequence and postflight assertions:
node --test examples/recordings/decode-color-grid.test.mjs
```

Each take gets `.commands.json`, `.commands-result.json`, `.manifest.json`, and `.png` sidecars. The manifest records viewport, real source dimensions, Chrome version, output metadata, cursor checksum/settings, and verified shape state. The output MP4 is never silently overwritten. Keep the script, cursor asset, fork commit, app revision, and sidecars together for reproducibility; do not commit cookies, auth state, or private board data.

## Pacing rules

- Discover menus/selectors and inspect screenshots before the take. Record with a single `batch --bail` call; do not pause for an agent to decide each action.
- Use semantic selectors for controls. The CLI computes their hit targets; use fixed coordinates only for canvas gestures in a verified fixed viewport.
- Seed curved paths so rehearsals are repeatable. Use explicit durations and step counts where the gesture matters. The current CDP dispatch loop awaits acknowledgements, so durations are targets, not hard wall-clock guarantees. Requesting 120 samples/second does not prove that Chrome delivers 120 input events/second.
- Human clicks include movement and a short settle before clicking. Add only small, justified waits: about 90 ms before a manual mouse-down, 100 ms after entering a text editor, and 120 ms for a menu to open. Avoid arbitrary multi-second waits between rectangles or menus.
- After creating a rectangle or arrow, Decode automatically returns to Select. Do not click Select again.
- For shape labels use `keydown Enter`, `keyup Enter`, a 100 ms editor settle, Select All inside the editor, `keyboard inserttext`, then Escape. This replaces the initial paragraph and avoids the earlier leading-newline/vertical-centering bug. Select All must happen after text editing starts.
- Set a persistent style once when it should be inherited. Postflight must check that inheritance actually happened instead of adding unnecessary menu actions to every shape.
- Keep a short end hold so viewers can see the result. Put loading, authentication, capture probes, screenshots, and assertions outside the recorded interval.

## What makes the recording smooth

The cursor and click ripple are rendered **during capture**, not composited onto the finished movie. A closed, inert shadow root contains one DPR-aware canvas. A stable damage region prevents Chromium's capture sampler from dropping cursor-only frames after a large canvas update. The main cursor uses elapsed-time smoothing during free motion; during dragging it follows the input point exactly so it does not lag behind the shape. A low-opacity, fixed-blur trail softens motion without replacing missing frames. Idle animation stops, and the overlay is removed when recording stops.

The recorder acknowledges Chrome frames independently of the encoder and produces the requested output frame rate by holding the latest available page frame. On macOS, MP4 encoding uses VideoToolbox; other platforms use libx264. Thus `60/1` in ffprobe is necessary but not sufficient evidence of smooth capture.

## Review and troubleshooting checklist

1. Confirm the logical viewport, native Chrome scale, emulated DPR, and actual raw screencast JPEG dimensions. A 2560×1600 initial screenshot can otherwise cause an MP4 container at that size while later 1280×800 frames are upscaled.
2. Review the video, especially long cursor-only moves immediately after creating/editing a shape. Check both directions; the earlier apparent leftward problem was an action-sequence effect, not a leftward curve bug.
3. Compare cursor positions frame by frame in suspect intervals. Exact whole-frame hashes are unreliable because compression noise can differ while the cursor is frozen. Also distinguish intentional target holds from in-flight freezes.
4. If investigating a stall, correlate three timelines: pointer input, requestAnimationFrame/overlay position, and raw screencast delivery. Smooth first two plus 100–267 ms capture gaps points to capture, not an LLM pause or FFmpeg playback.
5. Close diagnostic sessions and stop probe animation loops before the final take. Avoid recording while running builds or broad test suites. Rehearse to warm app code and UI, then use a fresh empty board in that already-running browser.
6. Start with the web app when its features cover the demonstration. Electron exhibited additional stalls and viewport mismatches in this investigation; that does not establish that Electron is fundamentally unrecordable. Validate its actual renderer target and physical content size separately.
7. Use focused checks for the changed recorder. The native regression below failed with the old DOM cursor and passed with the canvas overlay; metadata-only or endpoint-only tests would miss the bug.

```bash
cargo test --manifest-path cli/Cargo.toml e2e_recording_cursor_ -- --ignored --test-threads=1
ffprobe -v error -show_entries stream=width,height,r_frame_rate,nb_frames \
  -show_entries format=duration -of json /path/to/take.mp4
```

See the [capture-stall investigation](../../docs/solutions/performance-issues/cursor-stalls-native-recording-20260922.md) for failed approaches, evidence, and Chromium source references.
