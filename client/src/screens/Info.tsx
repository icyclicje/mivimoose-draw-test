import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { BASE_RATING, RANK_TIERS } from '@mivimoose/shared';
import { ModeIcon } from '../components/ModeIcon';
import { RankBadge } from '../components/RankBadge';
import { Panel, Segmented } from '../components/ui';
import { cx } from '../lib/format';
import { play, unlockAudio } from '../lib/sound';

type DocTab = 'faq' | 'terms' | 'privacy';

/* Everything on this screen is text, and there is a lot of it. The page itself
   must not grow — the tab strip has to stay reachable in a 680px-tall frame —
   so the reading area is capped and scrolls inside the panel. */
const READER_MAX = 'clamp(220px, calc(100vh - 250px), 540px)';

const UPDATED = '7 September 2026';

const TABS: { value: DocTab; label: string }[] = [
  { value: 'faq', label: 'FAQ' },
  { value: 'terms', label: 'Terms' },
  { value: 'privacy', label: 'Privacy' },
];

/** Audio cannot start before a gesture, so every real click here opens the gate. */
function tap(): void {
  unlockAudio();
  play('click');
}

/* ------------------------------------------------------------------ *
 * Prose furniture
 * ------------------------------------------------------------------ */

const paragraph: CSSProperties = {
  margin: 0,
  fontSize: 13.5,
  lineHeight: 1.55,
  color: 'var(--text-dim)',
  maxWidth: 640,
};

function P({ children }: { children: ReactNode }) {
  return <p style={paragraph}>{children}</p>;
}

/** A word the answer is defining, not emphasis for its own sake. */
function Word({ children }: { children: string }) {
  return <span style={{ color: 'var(--text)', fontWeight: 'var(--w-bold)' }}>{children}</span>;
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul style={{ ...paragraph, paddingLeft: 18, display: 'grid', gap: 2 }}>
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ *
 * FAQ
 * ------------------------------------------------------------------ */

/* The three bands are the ones in shared/scoring.ts. Spelled out here rather
   than imported because this is the one place that explains them in words, and
   the words are what the answer is for. */
const BANDS: { color: string; label: string; text: string }[] = [
  { color: 'var(--band-hot)', label: 'Green', text: 'rank 1 to 300. Close.' },
  { color: 'var(--band-warm)', label: 'Orange', text: 'up to 1,500. The right area.' },
  { color: 'var(--band-cold)', label: 'Pink', text: 'past 1,500. Somewhere else entirely.' },
];

/**
 * A tier's band, read off the next tier's floor rather than typed out, so the
 * numbers here can never drift from shared/ranks.ts.
 */
function tierBand(index: number): string {
  const tier = RANK_TIERS[index];
  const next: (typeof RANK_TIERS)[number] | undefined = RANK_TIERS[index + 1];
  if (!next) return `${tier.minRating.toLocaleString()} and up`;
  if (tier.minRating <= 0) return `under ${next.minRating.toLocaleString()}`;
  return `${tier.minRating.toLocaleString()}–${(next.minRating - 1).toLocaleString()}`;
}

interface Question {
  id: string;
  q: string;
  a: ReactNode;
}

const FAQ: Question[] = [
  {
    id: 'ranking',
    q: 'How does the ranking work?',
    a: (
      <>
        <P>
          When a round starts, every word in a 200,000-word GloVe model is sorted by how close it
          sits to the secret word. Rank 1 is the answer. Rank 2 is the word used most like it, and
          so on down the list.
        </P>
        <P>
          The model measures usage, not meaning. It learned from how words turn up beside each
          other in ordinary text, so <Word>bank</Word> sits near both <Word>river</Word> and{' '}
          <Word>money</Word> — that is how the word is used. Spelling, length and rhyme count for
          nothing.
        </P>
      </>
    ),
  },
  {
    id: 'rejected',
    q: 'Why was my word rejected?',
    a: (
      <>
        <P>One of these. None of them costs you a guess.</P>
        <Bullets
          items={[
            'It is not in the 200,000-word list. The list is single words only, and it stops well short of the rarest technical and invented ones.',
            'It is in the list but sits in the unranked tail for this round, so there is no number to give you.',
            'It is shorter than two letters, or longer than thirty-two.',
            'It is a function word — the, of, was — which ranks middling against everything and would only mislead you.',
            'It is on the blocklist.',
          ]}
        />
      </>
    ),
  },
  {
    id: 'colours',
    q: 'What do the colours mean?',
    a: (
      <>
        <div className="col" style={{ gap: 'var(--s1)' }}>
          {BANDS.map((band) => (
            <div key={band.label} className="row" style={{ gap: 'var(--s2)' }}>
              <span
                aria-hidden="true"
                style={{
                  width: 26,
                  height: 8,
                  flex: 'none',
                  borderRadius: 'var(--r-pill)',
                  background: band.color,
                }}
              />
              <span style={{ fontSize: 13.5 }}>
                <Word>{band.label}</Word>
                <span className="dim"> — {band.text}</span>
              </span>
            </div>
          ))}
        </div>
        <P>
          The bar behind each row is finer than the three bands. It grows exponentially as the rank
          falls, so it stays nearly empty across the long cold tail and only starts moving once you
          are genuinely near.
        </P>
      </>
    ),
  },
  {
    id: 'plurals',
    q: 'Do plurals count as a different word?',
    a: (
      <>
        <P>
          Not when the base form is in the list. <Word>cats</Word> is scored as <Word>cat</Word>,{' '}
          <Word>running</Word> as <Word>run</Word>. The row shows the form that was actually ranked,
          so you can always see what the game read.
        </P>
        <P>If the base form is not in the list either, the word is rejected.</P>
      </>
    ),
  },
  {
    id: 'quick-vs-custom',
    q: 'Quick match or custom game?',
    a: (
      <>
        <P>
          Quick match is one fixed setup with no knobs: a full lobby — ten players in classic, two
          in a duel — ranked, and the round ends the moment somebody lands the word. It starts
          itself, so you join and wait.
        </P>
        <P>
          A custom game is where every setting lives: mode, rounds, round length, difficulty, hints,
          guess limits, chat, even your own list of words. A setup you like can be saved and shared
          by code.
        </P>
      </>
    ),
  },
  {
    id: 'elo',
    q: 'How do Elo and the tiers work?',
    a: (
      <>
        <P>
          Only the head-to-head ladders move Elo: classic and duel, and only when the match is
          ranked. Everything else is for fun.
        </P>
        <P>
          Everyone starts at {BASE_RATING.toLocaleString()}. At the end of a match you are compared
          with every other player one pair at a time, so finishing above a strong lobby is worth
          more than finishing above a weak one. New accounts move in bigger steps until the number
          settles. Each mode keeps its own rating.
        </P>
        <P>Tiers are names for bands of that number.</P>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
            gap: 'var(--s1) var(--s3)',
            maxWidth: 640,
          }}
        >
          {RANK_TIERS.map((tier, i) => (
            <div key={tier.id} className="row" style={{ gap: 'var(--s2)' }}>
              {/* Rendered from the tier's own floor, so the badge and the
                  number beside it can never drift apart. */}
              <RankBadge rating={tier.minRating} size="sm" showRating={false} />
              <span className="mono faint grow" style={{ fontSize: 12, textAlign: 'right' }}>
                {tierBand(i)}
              </span>
            </div>
          ))}
        </div>
      </>
    ),
  },
  {
    id: 'daily',
    q: 'What is the daily?',
    a: (
      <>
        <P>
          One word for everyone, everywhere, until midnight UTC. It is drawn from the most everyday
          slice of the answer list, so it is meant to be gentler than a match.
        </P>
        <P>
          Guesses are unlimited, your progress is saved as you go, and the board sorts by how few
          guesses you needed.
        </P>
      </>
    ),
  },
  {
    id: 'guests',
    q: 'What is a guest account?',
    a: (
      <>
        <P>
          A guest is a real account with no Discord identity behind it. It keeps your stats, matches
          and daily entries, and it can host or join anything. It cannot use friends, and it is left
          off the leaderboards.
        </P>
        <P>
          Every guest sign-in makes a new account, so there is nothing to log back into later. A
          guest that never played a match is deleted after two days. Sign in with Discord if you
          want the history to stay.
        </P>
      </>
    ),
  },
];

/* ------------------------------------------------------------------ *
 * Terms and privacy
 * ------------------------------------------------------------------ */

interface DocSection {
  heading: string;
  body: string[];
}

const TERMS: DocSection[] = [
  {
    heading: 'The short version',
    body: [
      'Mivimoose Guess is a game, run by one operator, provided as it is. There is no promise that it works, that it stays up, or that anything you did in it survives. Servers restart and rounds get interrupted.',
      'This page describes how the game is run, in plain words. It is not legal advice and no lawyer wrote it.',
    ],
  },
  {
    heading: 'Be decent to other players',
    body: [
      'Play against people the way you would want to be played against. No harassment, slurs or hate, in chat, in a display name, or anywhere else.',
      'Do not hand the daily answer to somebody who has not played it yet.',
    ],
  },
  {
    heading: 'No cheating',
    body: [
      'No bots, scripts or automation of any kind, and no querying a word list or a language model on the side while a round is running.',
      'Do not run several accounts in the same ranked match, and do not pass the answer between players.',
    ],
  },
  {
    heading: 'Accounts',
    body: [
      'An account can be removed, reset, or kept off the leaderboards for abuse, and results can be rolled back if a match was manipulated.',
      'There is no formal appeal process. There is one operator; ask them.',
    ],
  },
  {
    heading: 'Changes',
    body: [
      'Modes, settings, ratings and the game itself can change or stop at any time, with no notice.',
      'Ratings, XP and stats are part of the game rather than property. They can be reset if a ladder needs it.',
    ],
  },
  {
    heading: 'What you type',
    body: [
      'Custom word lists and chat stay yours, and you are responsible for what you put in them.',
    ],
  },
];

const PRIVACY: DocSection[] = [
  {
    heading: 'If you sign in with Discord',
    body: [
      'Stored: your Discord user id, username, display name and avatar hash, which is enough to draw you in a lobby, plus your locale if Discord sends one.',
      'If you are playing inside a Discord server, that server id, name and icon are stored too, so the per-server leaderboard can exist.',
    ],
  },
  {
    heading: 'If you play as a guest',
    body: [
      'Stored: a generated display name and an id. Nothing connects it to you, and there is no password to lose.',
      'Guest accounts that never played a match are deleted after 48 hours.',
    ],
  },
  {
    heading: 'What the game records as you play',
    body: [
      'Matches and when they ran. Every guess with its rank and how far into the round it landed. Scores, placements, Elo per mode, XP, achievements, daily entries, saved game presets and friend links.',
      'That history is what your profile, the replays and the leaderboards are made of.',
    ],
  },
  {
    heading: 'Headcounts',
    body: [
      'On a timer the server writes down how many people are connected, how many are inside a round, and how many rooms exist. Three numbers and a timestamp, not a list of people.',
    ],
  },
  {
    heading: 'What is not collected',
    body: [
      'No email address, no password, no ads, no third-party analytics, no trackers.',
      'Chat is relayed between the people in the room and never written to the database. When the room closes it is gone.',
    ],
  },
  {
    heading: 'Where it lives',
    body: [
      'One database on the operator’s own server. Nothing is sold, shared or handed to a third party. The only thing loaded from anywhere else is your avatar image, which comes from Discord.',
    ],
  },
  {
    heading: 'Deleting it',
    body: [
      'Ask the operator and the account goes, along with everything attached to it: matches, guesses, ratings, friends and presets. It is a delete, not a hide.',
    ],
  },
];

function Prose({ sections }: { sections: DocSection[] }) {
  return (
    <div className="col" style={{ gap: 'var(--s4)' }}>
      {sections.map((section) => (
        <section key={section.heading} className="col" style={{ gap: 'var(--s1)' }}>
          <h3>{section.heading}</h3>
          {section.body.map((line, i) => (
            <P key={i}>{line}</P>
          ))}
        </section>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Screen
 * ------------------------------------------------------------------ */

export function Info() {
  const [tab, setTab] = useState<DocTab>('faq');
  /* One answer open at a time. Eight questions expanded at once is the wall of
     text this screen is trying not to be. */
  const [openId, setOpenId] = useState<string | null>(FAQ[0].id);
  const reader = useRef<HTMLDivElement>(null);

  /* The three documents share one scroll container. Without this, switching to
     Terms while halfway down the FAQ drops you into the middle of a document
     you have not started reading. */
  useEffect(() => {
    if (reader.current) reader.current.scrollTop = 0;
  }, [tab]);

  function pickTab(next: DocTab) {
    tap();
    setTab(next);
  }

  function toggle(id: string) {
    tap();
    setOpenId((current) => (current === id ? null : id));
  }

  return (
    <div className="page">
      <div className="row row--between row--wrap" style={{ gap: 'var(--s3)' }}>
        <div className="col" style={{ gap: 2 }}>
          <h1>Help</h1>
          <span className="faint" style={{ fontSize: 13 }}>
            How the game works, and what it keeps.
          </span>
        </div>
        <div style={{ width: 'min(300px, 100%)' }}>
          <Segmented value={tab} options={TABS} onChange={pickTab} />
        </div>
      </div>

      <Panel>
        <div
          ref={reader}
          style={{ maxHeight: READER_MAX, overflowY: 'auto', paddingRight: 'var(--s2)' }}
        >
          {tab === 'faq' && (
            <div className="col">
              {FAQ.map((item, i) => {
                const open = openId === item.id;
                return (
                  <div
                    key={item.id}
                    style={{ borderTop: i === 0 ? undefined : '1px solid var(--line)' }}
                  >
                    <button
                      type="button"
                      className="row"
                      id={`faq-q-${item.id}`}
                      aria-expanded={open}
                      aria-controls={`faq-a-${item.id}`}
                      onClick={() => toggle(item.id)}
                      style={{
                        width: '100%',
                        gap: 'var(--s2)',
                        padding: 'var(--s3) 0',
                        textAlign: 'left',
                      }}
                    >
                      <span className={cx('grow', open && 'bold')} style={{ fontSize: 14 }}>
                        {item.q}
                      </span>
                      <span
                        style={{
                          display: 'flex',
                          color: 'var(--text-faint)',
                          transform: open ? 'rotate(90deg)' : undefined,
                          transition: 'transform 0.16s var(--ease)',
                        }}
                      >
                        <ModeIcon name="chevron" size={14} />
                      </span>
                    </button>
                    {open && (
                      <div
                        id={`faq-a-${item.id}`}
                        role="region"
                        aria-labelledby={`faq-q-${item.id}`}
                        className="col"
                        style={{ gap: 'var(--s2)', paddingBottom: 'var(--s4)' }}
                      >
                        {item.a}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {tab === 'terms' && <Prose sections={TERMS} />}
          {tab === 'privacy' && <Prose sections={PRIVACY} />}
        </div>
      </Panel>

      <div className="row row--between row--wrap faint" style={{ fontSize: 12 }}>
        <span>Last updated {UPDATED}.</span>
        <span>Anything not answered here, ask the operator.</span>
      </div>
    </div>
  );
}
