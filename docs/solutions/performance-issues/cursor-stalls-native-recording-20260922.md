---
module: Native video recording
date: "2026-09-22"
problem_type: performance_issue
component: tooling
symptoms:
  - "Cursor freezes for 100-267 ms after canvas drags despite 60 fps output"
  - "DPR 2 video is blurry because raw screencast frames are 1280x800"
root_cause: async_timing
resolution_type: code_fix
severity: high
tags: [cdp, recording, cursor, retina, chromium, frame-pacing]
---

# Cursor capture stalls and misleading Retina resolution

## Problem and environment

A deterministic Decode web-board demonstration looked smooth while creating rectangles but chugged when returning to the toolbar. The MP4 reported 60 fps. Raising resolution or adding motion blur did not reliably fix it. This investigation used the native Rust agent-browser recorder, Chrome on macOS, ffmpeg, a custom SVG pointer, and a local Decode web app. The fix was verified after implementation on 2026-09-22.

## Observable symptoms and evidence

- One reported interval held the cursor at approximately `(792,432)` CSS pixels for 250 ms, then jumped roughly 265 px. Similar holds recurred at the same path locations on subsequent takes.
- Pointer events and the actual overlay's requestAnimationFrame positions continued around 60 Hz during those freezes. Measuring only the app's JavaScript timing would have missed the defect.
- An independent CDP screencast observer saw 100–267 ms frame-delivery gaps before encoding. FFmpeg was holding the latest available image, not creating the original gaps.
- A diagnostic full-viewport repaint produced 984 raw frames over 16.4 seconds with no gaps over 70 ms. A 4×4-pixel repaint indicator did not help.
- Emulated DPR 2 produced a 2560×1600 initial screenshot, but raw screencast JPEGs remained 1280×800. The resulting high-resolution MP4 was mostly upscaled. Launching Chrome with native scale 2 made the JPEGs themselves 2560×1600.

## What did not work

- **Trusting the 60 fps container or counting whole-frame differences:** a constant-rate encoder can repeat the last image, and compression noise can make otherwise frozen frames differ. Inspect cursor positions and raw delivery timing.
- **Requesting more mouse steps:** the dispatch loop awaits CDP acknowledgements. Nominal 120 Hz sampling often became approximately 60 Hz delivery and stretched movement duration; it did not fix skipped screencast frames.
- **Adding a DOM motion trail:** softened normal motion, but could not fill missing captured frames.
- **Replacing transforms with `left`/`top` and removing layer hints:** did not remove the recurring stalls. That experimental implementation was discarded.
- **A tiny repaint indicator:** the changed area was too small to stabilize capture sampling after the larger canvas updates.
- **Blaming direction or encoding load from appearance alone:** simple left/right movement was smooth. The failure depended on the preceding page animation and appeared in raw Chrome frame delivery.
- **Increasing emulated DPR alone:** changed screenshot dimensions without necessarily changing the compositor surface used by screencasting.

## Root cause

Chromium's [AnimatedContentSampler](https://github.com/chromium/chromium/blob/main/media/capture/content/animated_content_sampler.cc) detects a dominant animated damage rectangle. While locked onto it, the sampler can decline events whose damage rectangle differs. [VideoCaptureOracle](https://github.com/chromium/chromium/blob/main/media/capture/content/video_capture_oracle.cc) uses this proposal and includes a 250 ms animation-halt interval in its refresh logic. The large repaint region during drawing followed by smaller moving DOM cursor regions exposed this behavior. The leftward appearance was a coincidence of returning to controls after drawing to the right.

The separate softness problem was configuration: emulated CSS/DPR metrics did not imply a matching native compositor surface size. Seeding the encoder with a large screenshot obscured the later source-resolution mismatch.

## Verified solution

`cli/src/native/recording-cursor.js` now renders the cursor and ripple on a viewport-sized, DPR-aware canvas. Clearing and repainting this one recording-only surface stabilizes the damage region while preserving page/cursor synchronization. It is not a permanent app animation or a post-processing pointer. The loop stops when idle, the host is inert and hidden from accessibility, and cleanup removes it on recording stop.

```js
canvas.width = Math.ceil(innerWidth * devicePixelRatio);
canvas.height = Math.ceil(innerHeight * devicePixelRatio);
context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
context.clearRect(0, 0, innerWidth, innerHeight);
// Draw the cursor using CSS-coordinate positions and the scaled hotspot.
```

Free-pointer smoothing uses elapsed time. Pressed dragging tracks the current input directly; easing the pressed pointer introduced a measurable separation from the dragged page control. The motion trail uses a small fixed blur and variable opacity, rather than expensive continuously changing blur radius.

For real Retina capture:

```bash
agent-browser --session fresh-retina --args '--force-device-scale-factor=2' open https://example.com
agent-browser --session fresh-retina set viewport 1280 800 2
```

The confirmed final Decode take was approximately 16.1 seconds, with 2560×1600 actual source frames and 60 fps encoded output. Frame-position inspection no longer showed the reported in-flight holds. Six focused cursor E2E checks passed. The new `e2e_recording_cursor_capture_continues_after_large_repaint` check failed against the previous DOM overlay (`cursor-only return captured only 43 frames`) and passed with the canvas renderer. The fix is in commit `540cfca`.

## Prevention and boundaries

- Keep a real-browser regression spanning large page repaints followed by cursor-only movement; a final-position assertion alone is insufficient.
- Probe actual screencast source dimensions and record them in the take manifest.
- Do not claim requested input sample rate, output FPS, and delivered distinct-frame rate are interchangeable.
- Distinguish a deterministic action list and seeded geometry from hard real-time timing: CDP acknowledgements and app rendering still affect elapsed duration.
- Retain the failing scenario and discarded experiments in this note so future changes do not reintroduce moving DOM damage regions as an unverified optimization.
- Do not diagnose all Electron stalls as this same issue. Its earlier target/viewport and command-response problems need separate evidence.

## Related guidance

- [Repeatable recording recipe and color-grid script](../../../examples/recordings/README.md)
- [Recording command reference](../../../skill-data/core/references/video-recording.md)
- [Native cursor implementation](../../../cli/src/native/recording-cursor.js)
