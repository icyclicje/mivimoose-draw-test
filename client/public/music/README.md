# Soundtrack

Drop audio files here and the game picks them up on the next load. No code
change, no rebuild of anything but the client.

```
client/public/music/menu.mp3   plays in the menus
client/public/music/game.mp3   plays during a round
```

`.ogg` and `.m4a` also work; the game tries each extension in that order.

Either file is optional. Whichever is missing falls back to the synthesised bed
that ships in `client/src/lib/sound.ts`, so the game always has music even with
this folder empty.

## What plays where

`menu` runs everywhere outside a live round. `game` runs from the countdown
through to the end of the last round. Switching between them crossfades over
about a second, so they should sit at a similar loudness and ideally share a
key.

Both are looped, so pick tracks that loop cleanly. A track that ends on a
cadence will click every time it wraps.

## Levels

Recorded tracks play at 35% of the master volume, well under the sound effects,
because a real mix is far louder than a few oscillators. If yours still sits too
high, turn it down in the file rather than here: `TRACK_LEVEL` in
`client/src/lib/sound.ts` applies to every track equally.

## Licensing

Nothing is bundled with this repo, deliberately. Whatever you put here is your
choice and your licence to comply with. If you use anything under CC-BY you owe
the attribution somewhere visible; the FAQ page in `client/src/screens/Info.tsx`
is a reasonable home for it.

Public-domain and CC0 sources worth knowing: Musopen (public-domain classical
recordings), the Free Music Archive's CC0 filter, and Wikimedia Commons. Avoid
anything labelled "royalty free" without a named licence, which usually means
"paid licence required".
