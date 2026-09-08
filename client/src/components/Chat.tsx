import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { FeedEntry, RoomState } from '@mivimoose/shared';
import { useStore } from '../lib/store';
import { play, unlockAudio } from '../lib/sound';
import { ModeIcon } from './ModeIcon';

/* ------------------------------------------------------------------ *
 * Chat
 *
 * Two things share this log: people talking, and the game reporting itself.
 * They are drawn differently on purpose. Conversation sits left in full
 * contrast; everything the room did (joins, guesses, hints) is one quiet
 * centred line. Without that split, the three or four lines a person actually
 * wrote get lost in fifty lines of guess traffic.
 * ------------------------------------------------------------------ */

/** Enough to react with, few enough to stay one row in a narrow panel. */
const EMOTES = ['🔥', '🥶', '😭', '🤝', '👀', '🧠', '💀', '🎉'];

/** A run breaks after this long, so a reply much later gets its name back. */
const RUN_GAP_MS = 4 * 60_000;

/** Within this many pixels of the bottom counts as still following along. */
const STICK_PX = 72;

/**
 * The drawer this sits in gives 260px, 236 of it inside its own padding. The
 * composer (34), the emote row (30) and the two gaps (16) are fixed, so the log
 * takes what is left. Capped rather than left to flex, because the drawer sizes
 * to its content: with no cap the log grows and pushes the composer out of it.
 */
const LOG_MAX_PX = 156;

/** Room.chat() truncates at the same length, so the limit is not a surprise. */
const MAX_CHARS = 240;

interface Line {
  entry: FeedEntry;
  /** False on the second and later message of a run by the same person. */
  showName: boolean;
}

/** Feed entries can carry a name with no id, so fall back to it for grouping. */
function speaker(entry: FeedEntry): string {
  return entry.playerId ?? `name:${entry.displayName ?? ''}`;
}

export function Chat({ room }: { room: RoomState }) {
  const meId = useStore((s) => s.user?.id ?? null);
  const connected = useStore((s) => s.connected);
  const [draft, setDraft] = useState('');
  const [behind, setBehind] = useState(false);

  const scroller = useRef<HTMLDivElement>(null);
  /**
   * Whether the reader is parked at the bottom. A ref rather than state: the
   * scroll effect has to read it without re-running each time it flips, or
   * scrolling up would re-trigger the jump it is there to prevent.
   */
  const stick = useRef(true);

  const lines = useMemo<Line[]>(() => {
    let prev: FeedEntry | null = null;
    return room.feed.map((entry) => {
      const social = entry.kind === 'chat' || entry.kind === 'emote';
      const showName =
        !social ||
        !prev ||
        speaker(prev) !== speaker(entry) ||
        // Chat and emotes render so differently that carrying a run across the
        // two would read as a message that lost its name.
        prev.kind !== entry.kind ||
        entry.at - prev.at > RUN_GAP_MS;
      // A system line ends whatever run was in progress.
      prev = social ? entry : null;
      return { entry, showName };
    });
  }, [room.feed]);

  // The store caps the feed at 80 entries, so its length stops changing once a
  // busy room fills it. Key the effect on the newest id instead.
  const newestId = room.feed.length ? room.feed[room.feed.length - 1].id : null;

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (stick.current) {
      el.scrollTop = el.scrollHeight;
      setBehind(false);
    } else {
      setBehind(true);
    }
  }, [newestId]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX;
    stick.current = near;
    if (near) setBehind(false);
  };

  const toBottom = () => {
    stick.current = true;
    setBehind(false);
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  };

  /**
   * play() stays silent until a gesture has unlocked WebAudio, so the unlock
   * rides along on the same click rather than waiting for a later one.
   */
  const click = () => {
    unlockAudio();
    play('click');
  };

  const send = (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !connected) return;
    click();
    useStore.getState().sendChat(text);
    setDraft('');
    // Saying something commits you to the bottom of the log. Without this,
    // reading history and then replying hides your own line behind the pill.
    toBottom();
  };

  const emote = (glyph: string) => {
    if (!connected) return;
    click();
    useStore.getState().sendEmote(glyph);
    toBottom();
  };

  const offNotice = room.settings.emotesEnabled
    ? 'Chat is off in this room.'
    : 'Chat and emotes are off in this room.';

  return (
    <div className="col" style={{ gap: 'var(--s2)', height: '100%', minHeight: 0 }}>
      <div className="col" style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <div
          ref={scroller}
          onScroll={onScroll}
          className="col"
          role="log"
          aria-label="Room chat"
          // 2px rather than a spacing token: consecutive lines from one person
          // should read as a paragraph, and --s1 already breaks the run apart.
          style={{
            gap: 2,
            flex: 1,
            minHeight: 0,
            maxHeight: LOG_MAX_PX,
            overflowY: 'auto',
            paddingRight: 'var(--s1)',
          }}
        >
          {lines.length === 0 && (
            <div className="faint" style={{ fontSize: 13, padding: 'var(--s4)', textAlign: 'center' }}>
              Nothing said yet.
            </div>
          )}

          {lines.map(({ entry, showName }) => (
            <ChatLine
              key={entry.id}
              entry={entry}
              showName={showName}
              mine={meId !== null && entry.playerId === meId}
            />
          ))}
        </div>

        {behind && (
          <button
            type="button"
            className="chip"
            onClick={toBottom}
            // The log carries game events too, so this cannot promise messages.
            aria-label="Jump to the latest line"
            style={{
              position: 'absolute',
              left: '50%',
              bottom: 'var(--s1)',
              transform: 'translateX(-50%)',
              // Opaque, not one of the translucent chip tints: this sits on top
              // of text, and a soft tint lets the line behind bleed through it.
              background: 'var(--surface-3)',
              border: '1px solid var(--line-strong)',
              color: 'var(--accent)',
            }}
          >
            Jump to latest
          </button>
        )}
      </div>

      {room.settings.emotesEnabled && (
        <div className="row row--wrap" style={{ gap: 'var(--s1)', flex: 'none' }}>
          {EMOTES.map((glyph) => (
            <button
              key={glyph}
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => emote(glyph)}
              disabled={!connected}
              aria-label={`Send ${glyph}`}
              style={{ padding: '0 var(--s1)', minWidth: 28, fontSize: 16 }}
            >
              {glyph}
            </button>
          ))}
        </div>
      )}

      {room.settings.chatEnabled ? (
        <form className="row" onSubmit={send} style={{ gap: 'var(--s2)', flex: 'none' }}>
          <input
            className="input grow"
            style={{ height: 34 }}
            placeholder={connected ? 'Say something' : 'Reconnecting'}
            value={draft}
            maxLength={MAX_CHARS}
            autoComplete="off"
            enterKeyHint="send"
            aria-label="Message"
            onChange={(e) => setDraft(e.target.value)}
          />
          <button
            className="btn btn--sm"
            type="submit"
            disabled={!draft.trim() || !connected}
            aria-label="Send message"
            style={{ height: 34 }}
          >
            <ModeIcon name="send" size={14} />
          </button>
        </form>
      ) : (
        <div className="faint" style={{ fontSize: 12, flex: 'none' }}>
          {offNotice}
        </div>
      )}

      {/* The socket drops what it cannot send and says nothing about it, so say
          it here rather than let someone type into a room that is not there. */}
      {!connected && (room.settings.chatEnabled || room.settings.emotesEnabled) && (
        <div className="faint" style={{ fontSize: 12, flex: 'none' }}>
          You are offline. Nothing will send until you are back.
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function ChatLine({
  entry,
  showName,
  mine,
}: {
  entry: FeedEntry;
  showName: boolean;
  mine: boolean;
}) {
  const name = entry.displayName ?? 'Someone';

  if (entry.kind === 'emote') {
    return (
      <div className="row" style={{ gap: 'var(--s2)', paddingTop: showName ? 2 : 0 }}>
        {showName && (
          <span
            className="truncate"
            style={{
              fontSize: 12,
              maxWidth: 110,
              color: mine ? 'var(--accent)' : 'var(--text-faint)',
            }}
          >
            {name}
          </span>
        )}
        <span style={{ fontSize: 22, lineHeight: 1.1 }}>{entry.text}</span>
      </div>
    );
  }

  if (entry.kind === 'chat') {
    return (
      <div style={{ fontSize: 13.5, wordBreak: 'break-word', paddingTop: showName ? 4 : 0 }}>
        {showName && (
          <span className="bold" style={{ color: mine ? 'var(--accent)' : 'var(--text)' }}>
            {name}{' '}
          </span>
        )}
        <span className="dim">{entry.text}</span>
      </div>
    );
  }

  // Everything else is the game narrating itself: one line, centred, quiet.
  // There if you look for it, out of the way if you are reading the room.
  return (
    <div
      className="truncate"
      style={{
        fontSize: 12,
        color: 'var(--text-faint)',
        textAlign: 'center',
        padding: '2px var(--s2)',
      }}
      title={entry.text}
    >
      {entry.text}
      {entry.rank !== null && <span className="mono"> · {entry.rank.toLocaleString()}</span>}
    </div>
  );
}
