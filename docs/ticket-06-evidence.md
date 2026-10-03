# Ticket 06: thumbnail size, names and keyboard

Implements [issue #6](https://github.com/barnabyg/videoBrowser/issues/6) of [spec #1](https://github.com/barnabyg/videoBrowser/issues/1).

## Automated desktop checks

[`tests/presentation.spec.ts`](../tests/presentation.spec.ts) drives the real window:

- The default is 320 pixels and the endpoints are 160 and 640, set from the keyboard. Generated 320×180 landscape and 180×320 portrait stills stay inside equal, aligned frames with `object-fit: contain` at each size.
- The size changes while a stalled probe holds one extraction slot and a real thumbnail has already been stored. The grid updates within a second of each key press. The stalled job is not restarted, the stored thumbnail is neither rewritten nor joined by another, and a deep entry still launches.
- A filename of more than 200 characters is shortened to two lines. Hover and keyboard focus show it in full and in view, and the accessible name holds the full filename.
- Folder selection, the size slider, arrow/Home/End grid navigation and Enter playback work with the keyboard only, and each stop shows a focus outline of at least 2 pixels. Navigation alone starts no playback. After a resize, the current entry stays in view and Tab returns to it.
- Accessible descriptions: loading, spoken duration, and the failure reason. At 160 pixels, hovering shows the full reason.

The existing duration expectation changed from `120:00` to `2:00:00` for the two-hour fixture.

## Display scaling

Measured on 3 October 2026 (Windows 11 Home 10.0.26300) by launching the development build with `--force-device-scale-factor` 1.5 and 2, a 160-pixel size, a long filename and an unrecognised file:

| Scale | Device pixel ratio | Frame width (logical px) | Observation                                                                                                                                                                |
| ----- | ------------------ | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 150%  | 1.5                | 159                      | Controls, names and reasons readable; layout unchanged in logical pixels.                                                                                                  |
| 200%  | 2                  | 158                      | Readable. Before the fix, a long failure reason was cut off at both the top and bottom of a 160-pixel frame; it now starts at the top and focus or hover shows it in full. |

At 200% in the default 1120×800 window, the header takes most of the height. Keyboard focus scrolls the grid so the focused entry's full filename and reason are in view where it fits. A mouse click leaves the browsing position unchanged.

## Manual checks still to perform

A person needs to do these. Record the result, date and machine here:

| Check                | Procedure                                                                                                                  | Expected                                                                                                                                                                               | Result  |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Thumbnail comfort    | Open a folder of your own videos at a normal viewing distance. Try 160, 320 and 640.                                       | 320 is comfortable to recognise from, 160 gives an overview, 640 shows detail. Portrait clips are not cropped.                                                                         | Pending |
| Display scaling      | Set Windows **Settings › Display › Scale** to 100%, 150% and 200%. Restart the app each time.                              | Text is crisp and readable, nothing overlaps at rest, and the grid scrolls only vertically.                                                                                            | Pending |
| Screen-reader naming | With Narrator (Ctrl+Win+Enter), Tab to the slider, change it, then Tab into the grid and use the arrow keys.               | The slider is announced as "Thumbnail size" with "N pixels wide". Each entry is announced as "Open «full filename», button" followed by its loading state, duration or failure reason. | Pending |
| Recognising content  | Use the generated media in `.verify/media-*` from `tests/thumbnail.spec.ts`, or a folder of real recordings, at each size. | Each still is a representative frame from which the video can be recognised. Dark openings are skipped.                                                                                | Pending |
