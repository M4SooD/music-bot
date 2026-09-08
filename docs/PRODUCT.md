# Product

## Vision

Build a Telegram-first music platform that lets users discover, identify, organize, and access music from multiple services through one simple interface.

The product should not depend on a single music provider.

## Core Inputs

Users should eventually be able to provide:

- Spotify links
- Deezer links
- Apple Music links
- YouTube links
- song names
- artist names
- album names

The bot should resolve those inputs into a common internal music representation.

## MVP

Users can:

- search for a song by name
- send a supported music link
- identify the corresponding track
- view track metadata
- handle individual tracks
- handle albums

Initial supported link sources should include:

- Spotify
- Deezer
- Apple Music
- YouTube

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
- eventually import external playlists

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

External music services are input and metadata sources, not the center of the product.

The bot should operate on its own normalized concepts such as:

- Track
- Artist
- Album
- Playlist
- User

## Core MVP Workflow

A user can:

1. Send a Spotify, Deezer, Apple Music, or YouTube link, or search by song name.
2. The bot identifies the intended music and resolves it into a provider-neutral track or album.
3. If the input is ambiguous, the bot shows matching results and lets the user choose.
4. The bot displays basic metadata such as title, artist, album, artwork, and duration.
5. The bot resolves an available media source for the selected track.
6. When the service is permitted to provide that media, the bot delivers the actual audio file to the user through Telegram.
7. For albums, the user can view the track list and request individual tracks or the supported album download workflow.

External playlist downloads are not part of the MVP.
