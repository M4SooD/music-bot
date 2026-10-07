# Music Bot

A Telegram-first music platform for discovering, identifying, organizing, and accessing music from multiple sources through one simple interface.

## Project Status

🚧 Early development

The project is currently focused on defining the product and building the first MVP.

## MVP

The first version should allow users to:

- search for music by song name
- send supported music links
- identify tracks from those links
- view track information
- handle individual tracks
- handle albums

Initial link sources should include:

- Spotify
- Deezer
- Apple Music
- YouTube

Playlist downloads are intentionally excluded from the first version.

## Long-Term Vision

The bot should eventually become more than a downloader.

Future features may include:

- liked songs
- personal playlists
- listening and download history
- playlist imports
- shared playlists
- similar-song discovery
- artist and music discovery
- personalized recommendations
- premium features

The product should remain independent from any single music service.

External platforms such as Spotify, Deezer, Apple Music, and YouTube should be treated as sources that can be resolved into the bot's own internal music representation.

## Development Goal

This project is also being used to learn professional AI-assisted software development.

The development process will progressively introduce:

- AI coding agents
- context engineering
- automated verification
- local AI models and agents
- workflow automation
- MCP and agent tools
- multi-agent development
- CI/CD
- observability
- agent orchestration

These tools will be introduced when the project creates a real reason to use them rather than adding unnecessary complexity from the beginning.

## Documentation

Detailed product requirements are maintained in:

`docs/PRODUCT.md`

## Spotify metadata resolution

`createSpotifyTrackResolver()` from `src/providers/spotify.ts` returns a resolver
with `resolve(url, { market? })`. `parseSpotifyTrackUrl(url, market?)` validates
references without making requests. Accepted URLs use HTTPS on `open.spotify.com`
with `/track/<22-character base62 ID>` or `/intl-xx/track/<ID>`, optionally with a
trailing slash and share/query parameters. Short links and other entity paths are
not supported. Locale prefixes do not select a market.

The resolver reads `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` by default, or
accepts credentials explicitly. It uses built-in fetch and Client Credentials;
each resolver instance caches its token and shares pending token acquisition.
Reuse the instance to reuse tokens. Tests inject fetch and a millisecond clock.
Requests time out after 15 seconds, reject redirects, and never retry automatically.
A rejected bearer token is invalidated for the next caller.

Pass an explicit uppercase two-letter market when availability matters: Spotify
documents content as unavailable without a market or user country for app tokens.
Provider references retain this context and any different returned track ID.
`ResolvedTrackMetadata` contains resolution evidence, not a persistent Track or
SongDrop identity. Album/release data is context. Spotify's `explicit: false` means
clean **or unknown**, so only `true` is normalized; otherwise the field is omitted.

`SpotifyResolutionError` exposes a stable `code`, fixed safe message, and optional
`retryAfterSeconds` for rate limits; response bodies and underlying exceptions
are not attached. The resolver is not connected to Telegram: Spotify input remains
recognized-only, and direct-media delivery is unchanged.

API semantics: [Client Credentials](https://developer.spotify.com/documentation/web-api/tutorials/client-credentials-flow)
and [Get Track](https://developer.spotify.com/documentation/web-api/reference/get-track).
