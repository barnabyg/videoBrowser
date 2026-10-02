# Video Browser — preliminary Windows x64 package

Extract the entire zip, then double-click `VideoBrowser.exe`. Windows 11 x64 is the target. No Node.js, developer SDK, codec pack, FFmpeg installation, account or network connection is needed to browse. An installed default player is required to play videos.

Choose a folder, or enter its absolute path and select **Open folder**. Recognised files directly inside it appear with filenames and then thumbnails. Click any entry to open its source video through Windows. Preview failure leaves that action available. The browser stays open.

Images fit their frames without cropping. This first slice has a fixed layout. Adjustable size, sorting, preferences, cache reuse/limits, Refresh, USB recovery and complete accessibility/large-folder guarantees belong to subsequent tickets.

Generated thumbnails and Electron state live in `%LOCALAPPDATA%\video-browser`, outside the source and application folders. This slice does not yet evict accumulated thumbnails; remove its `thumbnails` directory while the app is closed if required. Persistent reuse and managed cache clearing come later.

Recognised extensions: `.mp4`, `.m4v`, `.mkv`, `.webm`, `.mov`, `.avi`, `.wmv`, `.mpg`, `.mpeg`, `.ts`, `.mts`, `.m2ts`, `.3gp`, `.h264`. An extension being listed does not guarantee decoding or external playback for every codec inside that container.

See `THIRD-PARTY-NOTICES.md` and the included license files. This preliminary package is for private local validation; public distribution is outside scope.
