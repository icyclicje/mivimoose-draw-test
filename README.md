<div align="center">

<img src="client/public/mivimoose.svg" width="96" alt="Mivi, the Mivimoose Guess mascot" />

# Mivimoose Guess

**A multiplayer semantic word-guessing game that runs as a Discord Activity.**

One hidden word. Every guess comes back with a rank saying how close you landed.
Get there before the other nine people in the voice channel do.

</div>

---

## What it is

Contexto's core idea, made competitive. You guess a word, the server tells you its
rank against the secret — `1` is the answer, `150,000` is a different universe.
Ranking is by *context*, not meaning: words that show up in the same places as the
secret score well, which is why `bank` sits near `river` and near `money` at the
same time.

**200,000 guessable words. 17,821 possible answers**, all real dictionary lemmas
with no proper nouns.

The multiplayer layer is where it stops being solitaire:

- **Word stealing.** Play a word an opponent already burned and your row comes
  back tagged **"guessed by Alex"**. You still get the rank; they still got there
  first. The input warns you before you spend the guess.
- **Live pressure.** A shared clock, a standings rail that updates on every guess,
  and a visibility setting that decides how much of your board opponents see.
- **Eight modes**, from a two-player rated Duel to a ten-player Elimination bracket.

## Modes

| Mode | Players | The idea |
| --- | --- | --- |
| **Classic Race** | 1–10 | Everyone hunts the same word at once. First find wins; on the buzzer, closest rank takes it. |
| **Duel** | 2 | Rated head-to-head, best of three. Every word your opponent burns is one you cannot claim clean. |
| **Blitz** | 1–10 | Sixty seconds a word, five words. Scored on how close you land, so a decent rank beats an answer you never reach. |
| **Elimination** | 3–10 | Coldest player goes home each round. Last one standing wins. |
| **Marathon** | 1–10 | Ten words, one running score. Consistency beats a lucky round. |
| **Co-op** | 2–10 | One team, one shared guess budget, one shared board. Duplicates hurt everybody. |
| **Sudden Death** | 2–8 | Turn based. Beat the best rank on the board or take a strike. Three strikes and you are out. |
| **Daily** | everyone | One word for the whole world until midnight UTC, ranked by fewest guesses. |

Every mode is a preset over the same settings object, so a host can bend any of
them: round length, round count, guess caps, hints, difficulty band, word
category, opponent visibility, cold-guess freeze penalties, spectators, chat,
emotes, a deterministic seed, or a hand-written word list. Save a configuration
as a **preset** and it gets a share code anyone can paste.

## Playing without Discord

The Activity handshake only works inside Discord, so opening the site in a
browser drops you on a guest sign-in instead. Pick a name, play. Every call to
`POST /api/guest` mints a fresh throwaway account, so two browser tabs are
genuinely two players and you can test multiplayer on one machine.

Guest accounts are real rows: they keep stats, earn XP and show up on the
leaderboard. They just have no Discord identity attached.

## Quick match

Quick match is deliberately not configurable. It drops you into a shared
ten-player lobby and starts on its own — thirty seconds once a second player
arrives, five once the lobby is full. Nobody is the host and nobody can change
the settings, which is what keeps it a one-click front door.

Everything adjustable lives in **Custom game** instead: eight modes, round
count and length, guess caps, hints, four difficulty bands, eight categories,
how much of your board opponents can see, a cold-guess freeze penalty, and your
own word list. Save any of it as a preset and share it by code.

## Themes

Seven of them, cycled from the button in the header (right-click for the full
list): Midnight, Daylight, Ember, Moss, Paper, Neon and Mono.

Each one redefines the same fifteen colour tokens and nothing else, so a theme
can repaint the app but never relayout it. The heat bands are tokens too —
`--band-hot/warm/cold` map onto each theme's own palette, which is what lets
Mono stay genuinely hueless and the three light themes keep their contrast.

## Sharing the daily

Solved or not, the daily has a **Share** button that copies a Wordle-style
summary:

```
Mivimoose Guess · 2026-09-07
Found it in 19 guesses · #4 today

🟩🟩🟩
🟧🟧
🟥🟥🟥🟥🟥🟥🟥🟥🟥🟥 +4
```

It reports how many guesses landed in each heat band and nothing else, so
pasting it into a group chat spoils nothing for anyone who has not played.

## Getting it running

```bash
npm install
npm run setup:words   # downloads the vectors + dictionaries, builds the index (~400MB, a few minutes)
npm run db:push
npm run seed          # optional: demo players so the leaderboard is not empty
npm run dev           # server on :3001, client on :3000
```

Open <http://localhost:3000> and hit **Play as guest** — no account, no Discord.
Open a second tab (or send someone the room code) and you are two players online
against each other. Guests are real accounts for the length of a session: they
host rooms, hold sockets, reconnect mid-match. They just stay off the ladders.

Then check it actually works:

```bash
npm run smoke        # three integration tests against a running server
```

Node 20+. No Redis, no Postgres required.

## Wiring it into Discord

1. Create an application at <https://discord.com/developers/applications>.
2. **OAuth2** → copy the **Client ID** and **Client Secret** into `.env`
   (`DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `VITE_DISCORD_CLIENT_ID`).
3. **Activities → Settings** → enable Activities.
4. Expose the dev server publicly: `npx cloudflared tunnel --url http://localhost:3000`
5. **Activities → URL Mappings** → map `/` to your tunnel host. The client already
   speaks the `/.proxy` prefix Discord requires and the Vite dev server mirrors
   those paths, so one build works in both places.
6. Launch the Activity from a voice channel.

Everyone who opens the Activity in the same voice channel lands in the same room
automatically — the client passes Discord's `instanceId` on the socket handshake
and the server keys a room off it. Nobody reads a code out loud.

## The ranking engine

Given a secret word, rank the entire vocabulary by how near each word sits to it.

### Vectors

`npm run setup:words` pulls GloVe 6B (400k words × 200 dimensions) from the
gensim-data mirror — 252MB rather than Stanford's 822MB bundle — and compiles the
top 200,000 usable words into a compact binary index of L2-normalised float32
vectors. Ranking is then a dot product against every row followed by a sort:
**~95ms for a full 200,000-word ranking**, cached per secret as an `Int32Array`
keyed by vocabulary index (1.6MB, versus tens of megabytes for a `Map`), with the
next round's table precomputed off the request path.

```
ocean  → sea 2, sailor 3520, shark 240, piano 18949
money  → dollar 214, bank 255, sailor 24368, lettuce 23620
guitar → piano 7, bass 4, bank 37443, rocket 12888
winter → january 95, sea 128, summer 2, piano 9524
```

### Which words can be the answer

Guessing is open to all 200,000 words. Answers are not, and getting that pool
right took four filters:

1. **A Hunspell dictionary**, restricted to its lowercase stems. This is the
   load-bearing one. GloVe 6B is lowercased, so `rome`, `mohammed` and `kiev` are
   shaped exactly like common nouns and no regex will tell them apart. Hunspell
   still carries the case — proper nouns are spelled `Jimmy/M`, common words
   `rookie/SM` — so keeping only lowercase stems drops every proper noun at once.
2. **Base-form preference.** `hospitals`, `reporting` and `immensely` are rejected
   because a shorter dictionary form of each already exists. Answers are lemmas;
   the inflections stay guessable. The length floors matter here — without them
   `thing` reduces to `the` and `ring` to `re`.
3. **A first-names list**, as a second guard.
4. **A frequency window**, so answers are words people have actually met.

The result is 17,821 answers, banded by corpus frequency into four difficulties:

```
easy    remain cargo constant standard involvement transportation church panel
normal  summary quell outsider universe scary archaeological cardiac gravel
hard    spooky pancreas parameter thoroughbred mermaid tulip vibrant whopping
insane  precocious ovulation cagey paleontologist cirrhosis axon deduct reticence
```

**Categories** work by max-similarity to a seed word, not similarity to the seed
centroid. That distinction is the whole feature: averaging a few hundred nature
words produces a vector pointing at "generic frequent English", and every
category came back as `well, even, another, kind`. Asking instead whether a word
is close to *something* in the category — `otter` is close to `animal`, and that
is enough — gives eight genuinely distinct pools of ~4,000 words each.

### Without the download

If `data/index.bin` is absent the server falls back to a bundled topic model:
220 hand-written word clusters in `server/src/data/topics.ts`, turned into vectors
by membership, smoothed so that topics sharing vocabulary drift together, with a
damped noise tail to break ties stably. 1,808 words, builds in 50ms, and the game
is fully playable. It exists so a fresh clone runs before anything is downloaded.

## Design

The interface follows contexto.me deliberately, and the details were measured off
the real site rather than eyeballed: Nunito at weights 400/600/800, a slate
palette (`#0f172a` ground, `#1e293b` surfaces), 5px radii on anything holding a
word, and the green → orange → pink heat scale at rank thresholds 300 and 1500.

The guess row is the centrepiece: a flat track, a colour bar, the word left and
the rank right. Sampling Contexto's rendered bar widths against their ranks fits

```
width = exp(-rank / 800)     floored at 1%
```

with the constant landing on 800.3 across every sampled point. An exponential is
the right shape — the bar stays empty across the whole cold tail and only starts
moving when you are genuinely close, which is exactly the feedback the game wants
to give. Our τ is nudged to 1000 for a vocabulary 2.5× the size.

Everything is flat: no gradients on surfaces, no glows, no stacked translucency.
Chrome stays quiet so the rows are the loudest thing on the page.

## Architecture

```
shared/     wire protocol, mode descriptors, settings sanitiser, scoring, Elo
server/     express + socket.io + prisma
  engine/   vectors, ranking, lexicon, morphology
  game/     Room state machine, RoomManager
client/     react + vite, the Discord Activity
scripts/    integration smoke tests
```

**`shared/`** is the contract. `sanitizeSettings()` lives here and runs on the
server for every settings change, so a hand-crafted socket payload cannot produce
a 900-player room or unlock a setting the mode pins.

**`Room`** is a plain state machine that knows nothing about sockets. It talks to
a `RoomBus` interface that the socket layer implements. State is serialised *per
viewer* — your guesses are always yours, opponents' boards are redacted according
to the room's visibility setting, everything is revealed when the round ends.

**Persistence** is best-effort by design. A database hiccup logs and returns the
unaugmented result rather than stopping ten people from seeing their scores.

### Data model

`User` (Discord-linked or guest, with denormalised aggregates so the leaderboard
is one indexed read) · `Rating` (per-mode Elo) · `Match` / `Round` / `MatchPlayer`
/ `Guess` (full replayable history) · `DailyWord` / `DailyEntry` · `GamePreset`
(shareable custom-game configs) · `Guild` / `GuildMember` (per-server
leaderboards) · `UserAchievement`.

SQLite by default. Change the provider in `prisma/schema.prisma` to `postgresql`
and point `DATABASE_URL` at your instance — every model is provider agnostic.

## Tests

```bash
npm run smoke            # all four suites
npm run smoke:duel       # two players: stealing, morphology, hints, chat filter, Elo
npm run smoke:lobby      # ten players + spectator overflow, full standings
npm run smoke:modes      # elimination, sudden death turn order and strikes, co-op budget
npm run smoke:features   # guests, quick-match auto-start, replayed guesses, daily share
```

They run against a live server and use deterministic single-word matches
(`customWords: ['ocean']`) so assertions can check exact ranks. 68 checks total.

## Configuration

One `.env` at the repo root feeds both workspaces; `.env.example` documents every
key.

| Key | Default | Notes |
| --- | --- | --- |
| `DISCORD_CLIENT_ID` / `_SECRET` | — | From your Discord application. Only needed for the Activity; guest play works without them. |
| `SESSION_SECRET` | — | Signs the session JWT. 16+ characters. |
| `DATABASE_URL` | `file:./arena.db` | Swap for a `postgresql://` URL in production. |
| `EMBEDDING_PROVIDER` | `auto` | `auto` \| `vectors` \| `topic`. |
| `RANK_DEPTH` | `200000` | How deep the rank table goes. |

## Deploying

```bash
npm run build        # shared -> server -> client
npm start            # serves the API, the sockets, and the built client
```

The server serves `client/dist` from the same origin when it exists, which keeps
the Discord URL mapping to a single entry. The vector index needs roughly 350MB
of resident memory, so size the instance accordingly.

### Railway

The repo ships a [`railway.toml`](railway.toml) that wires up the build and
start commands, so connecting the repo is most of the work. The rest is four
things to set up once.

1. **New project → Deploy from GitHub repo**, pick this repo.
2. **Attach a Volume** (Settings → Volumes), mount path `/data`. This is where
   the SQLite database and the built vector index live, so they survive a
   redeploy instead of resetting every time.
3. **Generate a domain** (Settings → Networking → Generate Domain) so
   `RAILWAY_PUBLIC_DOMAIN` exists for the variable reference below.
4. **Set variables** (Variables tab):

   | Key | Value |
   | --- | --- |
   | `SESSION_SECRET` | a random 32+ character string |
   | `DATABASE_URL` | `file:${{RAILWAY_VOLUME_MOUNT_PATH}}/db/arena.db` |
   | `CORS_ORIGINS` | `https://${{RAILWAY_PUBLIC_DOMAIN}}` |
   | `NODE_ENV` | `production` |
   | `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` | real values if wiring up the Activity, otherwise any placeholder — guest play doesn't need them |
   | `EMBEDDING_PROVIDER` | `vectors` (200k-word index) or `topic` (bundled 1,808-word model, no download) |

   `${{...}}` is Railway's variable-reference syntax — paste it literally and
   Railway fills in the real value.

Deploy. The start command (`server/scripts/railway-start.mjs`) restores
`data/index.bin` from the volume if it's there, otherwise downloads GloVe and
builds it fresh (a few minutes, first boot only — every later deploy reads the
cached copy off the volume), then runs `prisma db push` and starts the server.
`PORT` is set by Railway automatically; the server already listens on
`process.env.PORT`.

Set `EMBEDDING_PROVIDER=topic` instead if you'd rather skip the download
entirely and don't need the full 200,000-word vocabulary — it also means the
volume only needs to hold the database.
