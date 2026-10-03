# Video Browser — Windows x64 package

Extract the entire zip to a local folder, then double-click `VideoBrowser.exe`. The target is Windows 11 x64. The package contains its own runtime and its thumbnail tools (FFmpeg and ffprobe), so no Node.js, developer SDK, codec pack, FFmpeg installation, account or network connection is needed. Playing a video needs a default player installed for its file type.

## Using it

- **Choose a folder:** select **Choose folder…**, or type a full path such as `C:\Videos` and select **Open folder**. Video files directly inside the folder are listed with their filenames, then thumbnails appear, visible ones first. Subfolders and network paths (`\\server\share`) are not browsed. A folder on a USB drive works like any other folder.
- **Open a video:** click its thumbnail or filename, or press Enter on the focused entry. Windows opens it in the default player for its file type, and the browser stays open where you were. A video without a thumbnail can still be opened.
- **Thumbnail size and order:** the **Thumbnail size** slider sets the width from 160 to 640 pixels. **Sort by** chooses filename or date modified, and **Order** chooses the direction.
- **Refresh:** lists the selected folder again, showing added, removed and changed videos. Unchanged thumbnails are kept. After you reconnect a drive, Refresh lists its folder again.
- **Clear cache:** removes every stored thumbnail and makes the current folder's thumbnails again. Your preferences and videos are untouched.
- **Keyboard:** Tab moves between the controls and the grid, the arrow keys, Home and End move within the grid, and Enter or Space opens the focused video.

## Where data is kept

Preferences (the last folder, the thumbnail size and the sort order) and stored thumbnails are kept in `%LOCALAPPDATA%\video-browser`. Nothing is written beside the application or your videos, and the videos themselves are only read. Stored thumbnails are limited to 1 GB in total; the least recently shown are removed first. To start over, close the app and delete that folder.

A stored thumbnail is reused while its video keeps the same path, size and modification time. If a video is replaced by different content with the same path, size and modification time, its old thumbnail remains until you select **Clear cache**.

## Recognised files

Files with these extensions are listed: `.mp4`, `.m4v`, `.mkv`, `.webm`, `.mov`, `.avi`, `.wmv`, `.mpg`, `.mpeg`, `.ts`, `.mts`, `.m2ts`, `.3gp`, `.h264`. A listed extension does not guarantee a thumbnail or playback for every codec inside it. Thumbnails were tested with MP4/H.264, AVI/MPEG-4 Part 2, WebM/VP9, MKV/HEVC and raw H.264. A video that cannot be previewed, or takes longer than 30 seconds, shows a placeholder with the reason and can still be opened.

## Licences

See `THIRD-PARTY-NOTICES.md` and the included licence files. This package is for private use; public distribution is out of scope.
