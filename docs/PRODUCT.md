# Product

## Vision

Build a Telegram-first music platform that lets users discover, identify, organize, and access music from multiple sources through one simple interface.

SongDrop should not depend on a single music provider or a fixed list of platforms.

## Core Inputs

Users should eventually be able to provide:

- Spotify links
- Deezer links
- Apple Music links
- YouTube links
- SoundCloud links
- other supported music or media URLs
- song names
- artist names
- album names

The bot should resolve those inputs into a common internal music representation whenever possible.

Known providers may receive provider-specific handling, while other URLs can be passed to a generic media-resolution layer to determine whether SongDrop can process them.

## MVP

Users can:

- search for a song by name
- send a music or media link
- identify the corresponding track
- view track metadata
- download supported individual tracks
- browse and download supported albums

Initial first-class link sources should include:

- Spotify
- Deezer
- Apple Music
- YouTube
- SoundCloud

Other valid URLs may also be processed when supported by SongDrop's media-resolution and acquisition tools.

## Future Features

### Personal Library

- liked songs
- listening/download history
- recently accessed tracks

### Playlists

- create playlists inside the bot
- add/remove tracks
- rename playlists
- share playlists
- import external playlists
- download supported playlists

### Discovery

- find similar songs
- artist discovery
- related tracks
- personalized recommendations

### Accounts and Monetization

Potential future features:

- premium accounts
- higher limits
- priority processing
- additional convenience features

## Product Principle

External music services are sources of links, metadata, discovery, and media capabilities, but they are not the center of the product.

SongDrop should operate on its own normalized concepts such as:

- Track
- Artist
- Album
- Playlist
- User

The product should remain extensible so additional providers and media sources can be supported without redesigning the core domain model.

## Core MVP Workflow

A user can:

1. Send a Spotify, Deezer, Apple Music, YouTube, SoundCloud, or other supported media link, or search by song name.
2. SongDrop classifies the input and determines which resolver should handle it.
3. The bot identifies the intended music and resolves it into a provider-neutral track or album when possible.
4. If the input is ambiguous, the bot shows matching results and lets the user choose.
5. The bot displays basic metadata such as title, artist, album, artwork, and duration.
6. The bot resolves an available media source for the selected track.
7. If SongDrop can acquire the requested media, it processes the audio and delivers the file through Telegram.
8. For albums, the user can view the track list and request individual tracks or the supported album download workflow.

External playlist downloads are not part of the MVP.
