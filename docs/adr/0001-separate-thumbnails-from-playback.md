# Separate thumbnail extraction from playback

Video Browser generates thumbnails for browsing and opens source videos through the Windows default application for their file type. The collection spans varied formats, resolutions, and durations, so an installed player may be able to play a video that the thumbnail engine cannot preview. Thumbnail failure therefore leaves the video available for playback. This keeps the two capabilities independent and lets the first version focus on browsing rather than implementing an embedded player.
