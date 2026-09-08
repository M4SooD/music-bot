# Architecture

This document records the current high-level architecture decisions for the Music Bot.

It should describe decisions that are already agreed upon, not speculative future architecture.

---

## 1. Provider-Neutral Music Identity

### Decision

The core application must not use Spotify, Deezer, Apple Music, YouTube, or any other external provider as the identity of music.

The application owns its own internal music entities.

### Track

A `Track` represents one distinct audio recording, performance, mix, or version that a user recognizes as a specific piece of audio.

A Track is:

- not an abstract musical composition
- not a Spotify/Deezer/Apple Music item
- not a YouTube video
- not an audio file
- not a downloadable URL

Examples that may be separate Tracks:

- studio recording
- live performance
- acoustic version
- remix
- radio edit
- materially different remaster
- cover version

### Minimum Track information

A Track should eventually support:

- internal ID
- canonical title
- version label
- artists
- representative duration
- optional ISRC
- optional explicit flag
- created/updated timestamps

The internal Track ID is the authoritative identity.

Metadata such as title, duration, artist names, and ISRC may help determine identity but must not individually define identity.

---

## 2. Provider References

External provider records are represented separately from Track.

A Track may have multiple `ProviderReference` records.

Examples:

- Spotify track ID
- Deezer track ID
- Apple Music song ID
- YouTube video ID

A ProviderReference may contain:

- provider
- provider item ID
- provider entity type
- provider URL
- storefront or region when relevant
- original provider metadata
- availability information
- retrieval timestamp
- matching confidence and method

Multiple references from the same provider may point to one Track.

ProviderReferences must be movable between Tracks because automated matching can be wrong.

---

## 3. Media Is Separate From Music Identity

A downloadable or playable media source does not define Track identity.

Media acquisition should therefore be represented separately.

Conceptually:

`Provider Input → Track Resolution → Media Resolution → Media Processing → Delivery`

A `MediaCandidate` may represent a potential source for obtaining the media associated with a Track.

Examples may include:

- YouTube media
- provider-specific media
- cached media
- another supported acquisition source

The same Track may have multiple MediaCandidates.

---

## 4. Albums

Album should be its own internal entity rather than embedded into Track.

A Track may appear on multiple albums, compilations, deluxe editions, or regional releases.

The long-term model should therefore support an Album–Track relationship containing information such as:

- album ID
- track ID
- disc number
- track number

Album membership does not define Track identity.

---

## Current Architecture Principle

External services provide references, metadata, discovery, or media capabilities.

They do not own the application's internal identity model.

The application should remain capable of adding or removing providers without changing the identity of users' liked songs, playlists, history, or recommendations.
