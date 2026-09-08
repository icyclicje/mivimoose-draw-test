import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { FriendList, FriendState, FriendSummary, PublicUser } from '@mivimoose/shared';
import { ModeIcon } from '../components/ModeIcon';
import { RankBadge, RoleBadge } from '../components/RankBadge';
import { Avatar, EmptyState, Spinner } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { cx, relativeTime } from '../lib/format';
import { play, unlockAudio } from '../lib/sound';
import { useStore } from '../lib/store';

/* Every list here scrolls inside its own box. Three groups that each grow with
   their contents would push the search field off a 680px-tall window the first
   time someone has a dozen friends. */
const REQUESTS_MAX = 132;
const RESULTS_MAX = 152;

/**
 * The friends box takes whatever height the request groups leave behind.
 *
 * One fixed cap is wrong in both directions: with both request groups open it
 * overflows a short window, and with neither it stops early and wastes half the
 * page. `extra` is how many request groups are on screen.
 */
function friendsMax(extra: number): string {
  return `clamp(120px, calc(100vh - ${380 + extra * 170}px), 420px)`;
}

/** Click sound plus the audio unlock, since this can be the first screen touched. */
function tap(): void {
  unlockAudio();
  play('click');
}

/** Prefer what the server actually said; the fallback is for a dead connection. */
function messageFor(err: unknown, fallback: string): string {
  return err instanceof ApiError && err.message ? err.message : fallback;
}

/* ------------------------------------------------------------------ *
 * Pieces
 * ------------------------------------------------------------------ */

function GroupHead({ label, note }: { label: string; note?: string }) {
  return (
    <div className="row row--between" style={{ gap: 'var(--s2)' }}>
      <span className="eyebrow">{label}</span>
      {note && (
        <span className="faint" style={{ fontSize: 12 }}>
          {note}
        </span>
      )}
    </div>
  );
}

function ListBox({ max, children }: { max: number | string; children: ReactNode }) {
  return (
    <div className="panel" style={{ padding: '0 var(--s3)', maxHeight: max, overflowY: 'auto' }}>
      {children}
    </div>
  );
}

function PersonRow({
  user,
  online,
  detail,
  first,
  children,
}: {
  user: PublicUser;
  online?: boolean;
  detail: string;
  /** Rows are separated by a rule rather than a gap, so the first one skips it. */
  first: boolean;
  children?: ReactNode;
}) {
  return (
    <div
      className="row"
      style={{
        gap: 'var(--s3)',
        padding: 'var(--s2) 0',
        borderTop: first ? undefined : '1px solid var(--line)',
      }}
    >
      <div style={{ position: 'relative', flex: 'none', lineHeight: 0 }}>
        <Avatar user={user} size={30} />
        {online && (
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              right: -2,
              bottom: -2,
              width: 9,
              height: 9,
              borderRadius: '50%',
              background: 'var(--green)',
              boxShadow: '0 0 0 2px var(--surface)',
            }}
          />
        )}
      </div>

      <div className="grow col" style={{ gap: 1, minWidth: 0 }}>
        <div className="row" style={{ gap: 'var(--s2)', minWidth: 0 }}>
          <span className="truncate" style={{ fontSize: 14 }}>
            {user.displayName}
          </span>
          <RoleBadge user={user} />
          {/* No number on the badge: the tier name alone keeps the row to one
              line, and the badge's own tooltip still carries the Elo. */}
          <RankBadge rating={user.rating} size="sm" showRating={false} />
        </div>
        <span className="faint truncate" style={{ fontSize: 12 }}>
          {detail}
        </span>
      </div>

      <div className="row" style={{ gap: 'var(--s1)', flex: 'none' }}>
        {children}
      </div>
    </div>
  );
}

/** Online friends say what they are doing; offline ones say only that. */
function friendDetail(friend: FriendSummary): string {
  if (!friend.online) return 'Offline';
  return friend.activity ?? 'Online';
}

/* ------------------------------------------------------------------ *
 * Screen
 * ------------------------------------------------------------------ */

export function Friends() {
  const friendsVersion = useStore((s) => s.friendsVersion);
  const room = useStore((s) => s.room);
  const user = useStore((s) => s.user);
  const toast = useStore((s) => s.toast);

  const [list, setList] = useState<FriendList | null>(null);
  const [error, setError] = useState<string | null>(null);
  /* Friend changes go over HTTP, and the server only pushes friends:changed on
     presence moves, so our own accept, add or remove has to ask for the list
     again itself rather than waiting for a bump that never comes. */
  const [reload, setReload] = useState(0);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PublicUser[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [busyId, setBusyId] = useState<string | null>(null);
  /** The row whose remove button is armed. Removing costs a second click. */
  const [armedId, setArmedId] = useState<string | null>(null);

  const isGuest = user?.isGuest ?? false;

  useEffect(() => {
    let cancelled = false;
    api
      .friends()
      .then((data) => {
        if (cancelled) return;
        setList(data);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(messageFor(err, 'The server did not answer.'));
      });
    return () => {
      cancelled = true;
    };
  }, [friendsVersion, reload]);

  // Debounced search. Under two characters the server returns nothing, so the
  // request is not worth making.
  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setResults(null);
      setSearchError(null);
      setSearching(false);
      return;
    }

    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(() => {
      api
        .searchPlayers(term)
        .then((res) => {
          if (cancelled) return;
          setResults(res.results);
          setSearchError(null);
        })
        .catch((err: unknown) => {
          // A failed request is not an empty result. Saying "no players by that
          // name" here would be a lie the player then acts on.
          if (!cancelled) setSearchError(messageFor(err, 'Search did not go through.'));
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 260);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  /* Search does not exclude people you already know, so results are labelled
     from the list we already hold instead of offering a request that will 409. */
  const known = useMemo(() => {
    const map = new Map<string, FriendState>();
    if (list) {
      for (const f of list.friends) map.set(f.user.id, 'friend');
      for (const f of list.incoming) map.set(f.user.id, 'incoming');
      for (const f of list.outgoing) map.set(f.user.id, 'outgoing');
    }
    return map;
  }, [list]);

  /* Anyone already sitting in your room does not need an invite to it. Their
     presence line still reads "In a lobby", so without this the button is there
     and does nothing useful. */
  const inMyRoom = useMemo(() => {
    const ids = new Set<string>();
    if (room) {
      for (const player of room.players) ids.add(player.user.id);
      for (const spectator of room.spectators) ids.add(spectator.id);
    }
    return ids;
  }, [room]);

  async function act(id: string, run: () => Promise<unknown>) {
    tap();
    setBusyId(id);
    try {
      await run();
      setReload((n) => n + 1);
    } catch (err) {
      toast('warn', messageFor(err, 'That did not work'));
    } finally {
      setBusyId(null);
      setArmedId(null);
    }
  }

  // Invites and joins run through the socket, which reports its own outcome.
  async function invite(id: string) {
    tap();
    setBusyId(id);
    await useStore.getState().inviteFriend(id);
    setBusyId(null);
  }

  async function join(id: string, code: string) {
    tap();
    setBusyId(id);
    // acceptInvite switches the tab on success, so this screen is usually gone
    // by the time it resolves; clearing busy is harmless either way.
    await useStore.getState().acceptInvite(code);
    setBusyId(null);
  }

  const onlineCount = list?.friends.filter((f) => f.online).length ?? 0;
  const groupCount = list
    ? Number(list.incoming.length > 0) + Number(list.outgoing.length > 0)
    : 0;

  return (
    <div className="page" style={{ gap: 'var(--s4)' }}>
      <div className="row row--between">
        <h1 style={{ fontSize: 21 }}>Friends</h1>
        {list && list.friends.length > 0 && (
          <span className={cx('chip', onlineCount > 0 && 'chip--live')}>
            {onlineCount} of {list.friends.length} online
          </span>
        )}
      </div>

      {isGuest && (
        <div
          className="row"
          style={{
            gap: 'var(--s2)',
            padding: 'var(--s2) var(--s3)',
            borderRadius: 'var(--r-sm)',
            background: 'var(--surface-2)',
            color: 'var(--text-dim)',
            fontSize: 13,
          }}
        >
          <ModeIcon name="info" size={14} />
          <span>Friends need a Discord sign-in. Guest accounts cannot send or receive requests.</span>
        </div>
      )}

      {/* ------------------------------------------------------------- add */}
      <div className="col" style={{ gap: 'var(--s2)' }}>
        <div style={{ position: 'relative' }}>
          <span
            style={{
              position: 'absolute',
              left: 11,
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--text-faint)',
              pointerEvents: 'none',
              lineHeight: 0,
            }}
          >
            <ModeIcon name="search" size={15} />
          </span>
          <input
            className="input"
            style={{ paddingLeft: 34, paddingRight: 34 }}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setQuery('');
            }}
            placeholder="Find a player by name"
            aria-label="Find a player by name"
            spellCheck={false}
          />
          {/* The spinner sits inside the field. On its own line it would shift
              every result row down and back on each keystroke. */}
          {searching && (
            <span
              style={{
                position: 'absolute',
                right: 11,
                top: '50%',
                transform: 'translateY(-50%)',
                lineHeight: 0,
              }}
            >
              <Spinner size={13} />
            </span>
          )}
        </div>

        <div className="col" style={{ gap: 'var(--s2)' }} aria-live="polite">
          {query.trim().length === 1 && (
            <span className="faint" style={{ fontSize: 12 }}>
              Type at least two letters.
            </span>
          )}

          {searchError && <span style={{ fontSize: 12, color: 'var(--warn)' }}>{searchError}</span>}

          {!searching && !searchError && results && results.length === 0 && (
            <span className="faint" style={{ fontSize: 12 }}>
              No players by that name. Guests do not show up here.
            </span>
          )}

          {/* Old results stay put while the next request runs, so the list does
              not blink empty between keystrokes. */}
          {results && results.length > 0 && (
            <ListBox max={RESULTS_MAX}>
              {results.map((person, i) => {
                const state = known.get(person.id);
                return (
                  <PersonRow
                    key={person.id}
                    user={person}
                    detail={`@${person.username}`}
                    first={i === 0}
                  >
                    {state === 'friend' && <span className="chip">Friends</span>}
                    {state === 'outgoing' && <span className="chip">Requested</span>}
                    {state === 'incoming' && (
                      <button
                        className="btn btn--sm btn--primary"
                        disabled={busyId === person.id}
                        onClick={() =>
                          void act(person.id, () => api.respondToFriend(person.id, true))
                        }
                      >
                        Accept
                      </button>
                    )}
                    {!state && (
                      <button
                        className="btn btn--sm"
                        disabled={busyId === person.id || isGuest}
                        title={isGuest ? 'Sign in with Discord to add friends' : undefined}
                        onClick={() => void act(person.id, () => api.addFriend(person.id))}
                      >
                        Add
                      </button>
                    )}
                  </PersonRow>
                );
              })}
            </ListBox>
          )}
        </div>
      </div>

      {/* ----------------------------------------------------------- lists */}
      {!list && error && (
        <div className="col" style={{ gap: 'var(--s2)' }}>
          <EmptyState title="Could not load your friends" hint={error} />
          <div className="row" style={{ justifyContent: 'center' }}>
            <button
              className="btn btn--sm"
              onClick={() => {
                tap();
                // Clearing the error first puts the spinner back, so the retry
                // visibly does something even when it fails the same way.
                setError(null);
                setReload((n) => n + 1);
              }}
            >
              Try again
            </button>
          </div>
        </div>
      )}

      {!list && !error && (
        <div className="row" style={{ justifyContent: 'center', padding: 'var(--s6) 0' }}>
          <Spinner size={20} />
        </div>
      )}

      {list && (
        <>
          {/* A refetch that fails keeps the rows on screen; only the staleness
              is worth saying out loud. */}
          {error && (
            <span style={{ fontSize: 12, color: 'var(--warn)' }}>
              This list may be out of date. {error}
            </span>
          )}

          {list.incoming.length > 0 && (
            <div className="col" style={{ gap: 'var(--s2)' }}>
              <GroupHead
                label="Requests"
                note={list.incoming.length > 1 ? `${list.incoming.length} waiting` : undefined}
              />
              <ListBox max={REQUESTS_MAX}>
                {list.incoming.map((req, i) => (
                  <PersonRow
                    key={req.user.id}
                    user={req.user}
                    online={req.online}
                    detail={`Asked ${relativeTime(req.since)}`}
                    first={i === 0}
                  >
                    <button
                      className="btn btn--sm btn--primary"
                      disabled={busyId === req.user.id}
                      onClick={() =>
                        void act(req.user.id, () => api.respondToFriend(req.user.id, true))
                      }
                    >
                      Accept
                    </button>
                    <button
                      className="btn btn--ghost btn--sm"
                      disabled={busyId === req.user.id}
                      onClick={() =>
                        void act(req.user.id, () => api.respondToFriend(req.user.id, false))
                      }
                    >
                      Decline
                    </button>
                  </PersonRow>
                ))}
              </ListBox>
            </div>
          )}

          <div className="col" style={{ gap: 'var(--s2)' }}>
            <GroupHead label="Your friends" />
            {list.friends.length === 0 ? (
              <div className="panel">
                <EmptyState
                  icon={<ModeIcon name="users" size={22} />}
                  title="Nobody here yet"
                  hint={
                    isGuest
                      ? 'Sign in with Discord to add people.'
                      : 'Search for a player above and send a request.'
                  }
                />
              </div>
            ) : (
              <ListBox max={friendsMax(groupCount)}>
                {list.friends.map((friend, i) => {
                  const id = friend.user.id;
                  const busy = busyId === id;
                  const code = friend.roomCode;
                  const here = inMyRoom.has(id);
                  return (
                    <PersonRow
                      key={id}
                      user={friend.user}
                      online={friend.online}
                      detail={here ? 'In your room' : friendDetail(friend)}
                      first={i === 0}
                    >
                      {/* Only offer an invite when there is a room to invite them
                          to and they are not already in it. */}
                      {room && friend.online && !here && (
                        <button
                          className="btn btn--sm btn--primary"
                          disabled={busy}
                          onClick={() => void invite(id)}
                        >
                          Invite
                        </button>
                      )}
                      {/* Joining leaves whatever room you are in, so say so
                          rather than letting the click be a surprise. */}
                      {code && code !== room?.code && (
                        <button
                          className="btn btn--ghost btn--sm"
                          disabled={busy}
                          onClick={() => void join(id, code)}
                          title={room ? `Leave this room and join ${code}` : `Join room ${code}`}
                        >
                          Join
                        </button>
                      )}
                      {armedId === id ? (
                        <>
                          <button
                            className="btn btn--sm btn--danger"
                            disabled={busy}
                            onClick={() => void act(id, () => api.removeFriend(id))}
                          >
                            Remove
                          </button>
                          <button
                            className="btn btn--ghost btn--sm"
                            onClick={() => {
                              tap();
                              setArmedId(null);
                            }}
                          >
                            Keep
                          </button>
                        </>
                      ) : (
                        <button
                          className="btn btn--ghost btn--sm"
                          disabled={busy}
                          onClick={() => {
                            tap();
                            setArmedId(id);
                          }}
                          title={`Remove ${friend.user.displayName}`}
                          aria-label={`Remove ${friend.user.displayName}`}
                        >
                          ✕
                        </button>
                      )}
                    </PersonRow>
                  );
                })}
              </ListBox>
            )}
          </div>

          {list.outgoing.length > 0 && (
            <div className="col" style={{ gap: 'var(--s2)' }}>
              <GroupHead label="Sent" note="Waiting for an answer" />
              <ListBox max={REQUESTS_MAX}>
                {list.outgoing.map((req, i) => (
                  <PersonRow
                    key={req.user.id}
                    user={req.user}
                    detail={`Sent ${relativeTime(req.since)}`}
                    first={i === 0}
                  >
                    <button
                      className="btn btn--ghost btn--sm"
                      disabled={busyId === req.user.id}
                      onClick={() => void act(req.user.id, () => api.removeFriend(req.user.id))}
                    >
                      Cancel
                    </button>
                  </PersonRow>
                ))}
              </ListBox>
            </div>
          )}
        </>
      )}
    </div>
  );
}
