# Pointer Lab

A standalone Dialkit workbench for cursor feedback and deterministic mouse event timing. It does not change the native recorder defaults. The built page contains its own JavaScript, CSS, Dialkit and three cursor SVGs, so it works offline and can be shared as one HTML file.

## Build and open

From this directory, install the isolated example dependency with pnpm. Do not run a workspace-wide install just for this example.

```bash
pnpm install --ignore-workspace
node build.mjs --assets-dir /absolute/path/to/cursors
node --test model.test.mjs
node browser-check.mjs
open dist/index.html
```

The folder must contain `left_ptr.svg`, `hand2.svg` and `xterm.svg` from [the user-provided cursor collection](https://github.com/seflless/seflless.com/tree/main/public/cursors). A `seflless-` filename prefix is also accepted. SVGs and generated `dist/` are not committed. The build emits Dialkit's MIT license beside the page; preserve asset provenance/license when redistributing.

## Use

Choose Click, Select text, or Drag & drop. Play, pause, replay, slow to ½× or ¼×, or scrub to a precise frame. Select a timeline clip to edit its start time and, for moves, duration, coordinates and seed in Dialkit's Selected event panel. The expandable event list allows adding moves, adding press/release pairs, deleting events and restoring the scenario. Invalid overlapping moves or unmatched presses block playback/export until repaired.

Tune the feedback panels or choose Soft disk, Presentation, or Subtle. A filled translucent disk is drawn behind the cursor artwork. Press expands from 16 to 30 px radius over 90 ms; hold stays at 30 px / 20% opacity; release pulses to 48 px and fades over 200 ms. Release starts from the actual current press state, including quick clicks. Scale changes are anchored at each SVG's hotspot. Playback uses elapsed time; paused scrubbing evaluates a pure model. Playback stops when hidden or the preview leaves the viewport. There is no idle animation loop. Presets now use format version 2 and a new Dialkit persistence key so previous ring settings do not override these defaults; old saved settings are not deleted.

Appearance → Filled toggles between a filled disk and a hollow outline, with identical timing/size and both behind the cursor. Hold → Width only affects the outline. Filled defaults to true and is included in saved presets and apply instructions.

Save preset + events creates portable JSON. Load preset restores it. Copy apply instructions produces a concise natural-language handoff that calls out non-default settings. Dialkit also supports local versions and value copying. Nothing is uploaded or silently applied to production code.

## Contracts and limits

Event times/durations are milliseconds. Coordinates are integer CSS pixels in the fixed 720×400 preview scene. Move events are `{at,type:'move',x,y,duration,seed}`; button events are `{at,type:'down'|'up'}`. Events must be ordered and nonoverlapping; button events must alternate and finish released. `model.mjs` validates and compiles these into the existing CLI's actual mouse move/down/up/wait command arrays. Initial positioning uses one 1 ms step. Subsequent absolute timeline gaps become relative waits after the preceding command's intended duration.

CLI export is gestures only: set up your browser, target viewport/page and native recording outside this batch, and retarget the scene's coordinates to your real UI before replaying. The native dispatcher can overrun intended timing while awaiting CDP acknowledgements. This preview uses the same geometric seed mixer and cubic ease-out but does not simulate capture latency, sample quantization, visual smoothing or motion blur. Simulated text selection/drop and simple preview cursor zones are not E2E assertions or the production CSS hit-testing implementation. Use `../cursor-theme-demo.mjs` for actual browser gestures and assertions.

The recommended **Soft disk preset is now the native recorder default**, implemented in `cli/src/native/recording-cursor.js`: filled feedback behind the icon, smooth press to 0.94× icon scale, static held disk, and expanding/fading release. `test/recording-cursor-feedback.test.mjs` checks the native injected overlay against this workbench's default model, including drawing order, timing, quick release continuity and idle cleanup. Native capture/lifecycle regressions also cover the new default. Further workbench edits and exported feedback presets are not a new recorder option and are not automatically applied.

The page's Field guide contains the dense function/parameter/file/asset inventory. Its source is `reference.mjs`. Keep it aligned when changing these scripts or the native implementations.
