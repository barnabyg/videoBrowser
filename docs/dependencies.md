# Bundled dependencies

This private preliminary package launches FFmpeg executables as separate processes; it does not link FFmpeg libraries into Electron. Public distribution is outside ticket 01.

Electron 44.5.1 is MIT licensed and includes Chromium, Node.js and additional dependencies. Its complete `LICENSE` and `LICENSES.chromium.html` files are retained at the package root. Electron downloads are validated against the checksums supplied by the pinned npm package; npm dependency integrity is recorded in `package-lock.json`.

The selected Windows x64 thumbnail tools are Gyan's **FFmpeg 9.0.2 essentials build**, including `ffmpeg.exe` and `ffprobe.exe`. Archive: <https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-9.0.2-essentials_build.zip>. SHA-256: `60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba`. The bootstrap verifies that archive before extraction. No installed FFmpeg or system codec pack is used.

Gyan identifies these builds as static **GPLv3** builds, including GPL components such as x264/x265. The complete build LICENSE and README are included in `licenses/ffmpeg`. This is not an LGPL-only build. The upstream source revision linked by the build publisher is <https://github.com/FFmpeg/FFmpeg/commit/946fcce07b>. Build information and external library inventory: <https://www.gyan.dev/ffmpeg/builds/>. FFmpeg's own licensing explanation: <https://ffmpeg.org/legal.html>.

The current deliverable is a local, private engineering package. Before redistributing copies beyond that scope, provide the complete corresponding source for the exact FFmpeg build, including linked libraries, build scripts and configuration, under the applicable GPL terms; an upstream source link alone is not asserted to satisfy that obligation. Review the combined distribution's obligations and preserve all runtime and tool notices. Revisit this review when dependency builds or the distribution scope change.
