/**
 * Guards the word filter against the two ways it can go wrong: letting an
 * obscenity or a slur through, and banning an innocent word that merely looks
 * like one. The second list is the one that matters — substring matching and
 * over-eager regexes are why `Scunthorpe`, `assess` and `cockpit` are famous.
 *
 *   npm run check:words -w @mivimoose/server
 */
import { isBlocked, isTooCommon } from '../src/engine/wordFilter.js';

/** Must be blocked. Inflections included, since the matcher strips suffixes. */
const BLOCKED = [
  'fuck', 'fucking', 'fucked', 'fucker', 'motherfucker', 'fuuuck',
  'shit', 'shits', 'shitty', 'shithead', 'bullshit', 'shiiit',
  'bitch', 'bitches', 'bitching', 'biiitch',
  'ass', 'asses', 'asshole', 'assholes', 'jackass', 'dumbass',
  'cunt', 'cunts', 'twat', 'wank', 'wanker', 'wanking', 'bastard', 'bastards',
  'piss', 'pissed', 'pissing', 'crap', 'crappy', 'turd', 'slut', 'slutty',
  'whore', 'whores', 'cock', 'cocks', 'dick', 'dickhead', 'prick',
  'tit', 'tits', 'titty', 'titties', 'boner', 'porn', 'porno',
  'sex', 'sexes', 'rape', 'raping', 'rapist', 'penis', 'vagina', 'orgasm',
  'nigger', 'niggers', 'nigga', 'niggas', 'niggah',
  'fag', 'fags', 'faggot', 'faggots', 'dyke', 'dykes', 'tranny', 'shemale',
  'retard', 'retards', 'retarded', 'spastic', 'spaz', 'moron', 'morons',
  'chink', 'chinks', 'gook', 'kike', 'spic', 'wetback', 'redskin', 'paki',
  'negro', 'negroes', 'coon', 'coons', 'wop', 'wog', 'yid', 'kraut', 'gypsy',
  'spic', 'spics', 'shittiest', 'whoring', 'prostitutes',
];

/** Must NOT be blocked. Every one of these is a fine answer or guess. */
const ALLOWED = [
  // The classics: innocent words that live inside a rude one.
  'scunthorpe', 'assess', 'assessment', 'assassin', 'assist', 'assign', 'asset',
  'assault', 'assemble', 'class', 'classes', 'bass', 'pass', 'passed', 'passes',
  'grass', 'glass', 'mass', 'brass', 'compass', 'embassy', 'massive',
  'cockpit', 'cockpits', 'cocktail', 'peacock', 'cockroach', 'cockatoo',
  'analysis', 'analyst', 'analyse', 'analog', 'canal', 'banal',
  'shiitake', 'titanium', 'titan', 'title', 'titles', 'competition', 'constitution',
  'nigeria', 'nigerian', 'niger', 'night', 'nigh', 'diligent',
  'retardant', 'flame', 'sexton', 'essex', 'middlesex',
  'therapist', 'grape', 'grapes', 'drape', 'scrape', 'rapid', 'rapport', 'rap',
  'hump', 'humpback', 'button', 'butter', 'buttress', 'shuttle', 'debut',
  'knob', 'doorknob', 'flick', 'clock', 'block', 'stock', 'shock',
  'spade', 'slant', 'slanted', 'cracker', 'crackers', 'paddy', 'nip', 'vegetable',
  'raccoon', 'cocoon', 'tycoon', 'lagoon', 'monsoon',
  // Found by running the filter over the whole english-words list; every one
  // of these is a blocked stem plus a regular suffix that spells a real word.
  'spice', 'spices', 'spiced', 'spicy', 'spiciest', 'spicing',
  'rap', 'raps', 'rapper', 'rapping', 'pub', 'pubs',
  'shaggy', 'shaggiest', 'cocky', 'cockiness', 'cocker',
  'titter', 'titters', 'titer', 'prickly', 'prickle', 'crappie', 'beanery',
  'jape', 'japes', 'mingy', 'dicky', 'micky', 'retarder', 'retardants', 'cripes',
  'banker', 'bankers', 'hanker', 'anchor',
  // Ordinary answers, to be sure nothing sweeping got in.
  'otter', 'harbour', 'lantern', 'meadow', 'violin', 'glacier', 'trumpet',
];

/** Barred everywhere, guesses included. */
const FUNCTION = ['the', 'and', 'about', 'however', 'themselves', 'toward'];
/** Barred as an answer, still guessable. */
const THIN = ['time', 'people', 'thing', 'good', 'first'];

let failures = 0;
const fail = (msg: string) => {
  failures += 1;
  console.error(`  FAIL  ${msg}`);
};

for (const w of BLOCKED) if (!isBlocked(w)) fail(`"${w}" should be blocked`);
for (const w of ALLOWED) if (isBlocked(w)) fail(`"${w}" is innocent and must not be blocked`);
for (const w of ALLOWED) if (isTooCommon(w, true)) fail(`"${w}" should be guessable`);
for (const w of FUNCTION) {
  if (!isTooCommon(w)) fail(`"${w}" should not be an answer`);
  if (!isTooCommon(w, true)) fail(`"${w}" should not be guessable`);
}
for (const w of THIN) {
  if (!isTooCommon(w)) fail(`"${w}" should not be an answer`);
  if (isTooCommon(w, true)) fail(`"${w}" should stay guessable`);
}

const checks = BLOCKED.length + ALLOWED.length * 2 + FUNCTION.length * 2 + THIN.length * 2;
if (failures) {
  console.error(`\nword filter: ${failures} of ${checks} checks failed\n`);
  process.exit(1);
}
console.log(`word filter: ${checks} checks passed`);
