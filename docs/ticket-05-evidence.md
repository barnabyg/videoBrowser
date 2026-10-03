# Ticket 05: responsive large folders

Implements [issue #5](https://github.com/barnabyg/videoBrowser/issues/5) of [spec #1](https://github.com/barnabyg/videoBrowser/issues/1).

## Environment

Measured on 3 October 2026: Windows 11 Pro 10.0.26300, Intel Core i7-12700K, 20 logical processors, 128 GiB RAM. Fixtures and fresh isolated application state were on C:, a Force MP600 NVMe SSD (NTFS, fixed). Each run started with an empty thumbnail cache.

Fixtures are copies of one playable one-second 320×180 H.264/MP4 clip, under a disposable extension associated with a controlled player. Copies test entry count only; the varied decode set in `tests/thumbnail.spec.ts` covers formats.

Timing starts at the Playwright click on **Open folder** and includes enumeration, IPC and rendering of the real window. Thumbnail timings start at the scroll and end when the image is visible. Launch time ends when the controlled player records the path, so it includes polling granularity of up to one second.

## Results

From `tests/scale.spec.ts` (`SCALE_EVIDENCE` files under `.verify/`):

| Measurement                                     | 1,000 entries | 10,000 entries |
| ----------------------------------------------- | ------------- | -------------- |
| Grid of filenames/placeholders                  | 115 ms        | 609 ms         |
| Thumbnail of the last entry after scrolling     | 1,229 ms      | 896 ms         |
| Thumbnail of the middle entry after scrolling   | 1,148 ms      | 2,027 ms       |
| Launch while thumbnails load                    | 915 ms        | 928 ms         |
| Three rapid folder changes to a one-video grid  | 738 ms        | 1,505 ms       |
| Reopening the large folder                      | 112 ms        | 688 ms         |
| Stills stored when the last entry's image shown | 6             | 7              |
| Images held / stills stored                     | 15 / 204      | 15 / 200       |

The 1,000-entry grid meets the two-second SSD target; the test asserts it. The 10,000-entry workload is a stress check and is not held to that target. Source bytes and modification times were unchanged after both runs.

Removable-drive performance was not measured: no removable drive was attached. Run the opt-in workload with `VIDEO_BROWSER_REMOVABLE_ROOT` set to a folder on the drive.

## Investigation log

Target: scrolling, folder changes and launch stay usable at 10,000 entries while extraction runs.

| Hypothesis → change                                                                                     | Measurement (10,000 entries)                                                                             | Conclusion                                       |
| ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Baseline: visible-first queue, stills via `thumbnail://`, images attached only near the viewport        | Grid 639 ms, but frames took 80–150 ms, folder change 19.5 s, launch 4.6 s, last-entry thumbnail 6.1 s   | Not usable while extracting.                     |
| Offscreen rendering dominates → `content-visibility: auto` on grid items                                | A 1.5 s long task; no improvement                                                                        | Rejected and reverted.                           |
| Result updates to offscreen cards re-lay out the whole grid → isolate with all extraction stalled       | 4–8 ms frames with no results arriving                                                                   | Updates cause the cost.                          |
| → Update only cards near the viewport; apply stored results on scroll                                   | Scroll 5.0 → 2.9 s, last-entry thumbnail 9.4 → 3.8 s; frames still ~80 ms                                | Kept; a further cost remains.                    |
| Layout invalidation inside visible cards → strict containment on frame and detail                       | Frames still ~80 ms                                                                                      | No measurable effect; reverted.                  |
| The Electron main process, which also runs the window, is blocked → main event-loop lag and CPU profile | Lag 80 ms (16 ms when stalled); `spawn` was 3.9 s of a 4.7 s profile                                     | Starting Windows processes blocks the UI thread. |
| → Start tool processes from a worker thread; terminate from the main thread                             | Main idle, frames 2 ms; folder change 19.5 → 1.5 s, launch 4.6 → 0.9 s, last-entry thumbnail 6.1 → 0.9 s | Selected.                                        |

## Limits

- Every entry remains in the DOM, which keeps keyboard and screen-reader access unchanged; the grid's DOM grows linearly with the folder while images and result updates are bounded. 10,000 entries take about 0.6 s to show.
- Throughput with two concurrent jobs was about seven stills per second for these small clips. Real footage, long seeks and USB drives are slower.
- Stored stills accumulate per folder visit until cache reuse and limits arrive in issues #8 and #9.
- If a still cannot be stored, it is shown from memory as before; those images are not reloaded from disk.
