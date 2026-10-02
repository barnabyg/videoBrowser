# Video Browser — App Proposal

## Purpose

Create a simple Windows 11 desktop app for browsing a folder of videos using large, clear thumbnails. The app should make it easy to recognise a video visually and play it with a single click.

The first version should focus on this workflow: **choose a folder → browse large thumbnails → click a video to play it**.

## Proposed experience

The user opens the app and chooses a folder. The app displays the videos directly within that folder in a scrollable grid, with a thumbnail and filename for each video. A thumbnail-size control lets the user adjust the grid from a compact overview to very large previews.

Clicking a thumbnail or its filename opens that video in the user's default video player. The browser remains open so the user can return to the same folder and continue browsing.

The interface should stay simple: a folder selector and current-folder path at the top, a thumbnail-size control and sorting options nearby, and the video grid taking up most of the window.

## Initial scope

- **Folder selection:** Browse for a local folder and list its video files. Initially, include only files directly in the selected folder; scanning subfolders can be considered later.
- **Large thumbnails:** Generate a preview image from each video, preserve its aspect ratio, and offer adjustable thumbnail sizes with a large default.
- **Useful labels:** Show filenames, with a way to read long names in full. Display duration where it can be obtained reliably.
- **One-click playback:** Launch the selected file in the default video player. Include a clear error message if playback cannot be started.
- **Basic sorting:** Offer filename and modification-date sorting, including ascending and descending order.
- **Refresh and preferences:** Provide a refresh action for folders whose contents change. Remember the last folder and thumbnail size between sessions.

## Design and technical direction

Build a desktop app that processes videos locally. No account, cloud upload, or internet connection should be required for the core workflow.

Use a thumbnail-generation component with a defined list of supported video formats. Thumbnail extraction and playback are separate capabilities: a file that cannot be previewed may still be playable through the user's installed player. Show a placeholder when a preview is unavailable and keep the file accessible.

Generate thumbnails in the background and prioritise videos currently visible in the grid. Cache thumbnails on disk so revisiting a folder is quicker, regenerate them when the source file changes, and provide a way to clear the cache. The app should remain responsive while previews load and handle individual unreadable files without abandoning the whole folder.

The app should open source videos without changing them. Choose the UI framework, thumbnail engine, packaging approach, and supported formats during detailed requirements and a small technical prototype.

## Outside the first version

- An embedded video player, video editing, or conversion.
- A searchable library spanning multiple folders.
- Tags, ratings, playlists, or automatic content recognition.
- File-management actions such as renaming, moving, or deleting videos.
- Cloud storage integration or synchronisation.

## Decisions for detailed requirements

- What thumbnail sizes and default window layout feel comfortable on the user's display?
- Which video formats and typical folder sizes must be supported?
- Should thumbnails use a fixed point in each video, a representative frame, or a user-selected frame?
- Is opening the default video player sufficient, or should a particular player be selectable?
- Should subfolders, network folders, and removable drives be supported?
- What installation method, keyboard navigation, and accessibility features are needed?

## First-version success criteria

The user can select a folder, recognise its videos from comfortably large previews, and launch any listed video with one click. The app remains usable as thumbnails load, reports preview failures clearly, and makes repeated visits faster through caching.

A small prototype should validate thumbnail readability, generation speed on representative videos, and the default-player workflow before the requirements are expanded.
