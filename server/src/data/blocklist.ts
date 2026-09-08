/**
 * Words the game will never choose as an answer, never offer as a hint or a
 * near-miss on the reveal, and never accept as a guess.
 *
 * GloVe 6B is trained on Wikipedia and Gigaword, so its 200,000-word vocabulary
 * carries plenty of obscenity and every common slur. Nothing upstream filters
 * them: `en.dic` is a spellchecker and spells them all correctly, and they sit
 * at frequency ranks well inside the answer window. So the list has to be
 * explicit.
 *
 * Base forms only. The matcher in engine/wordFilter.ts strips regular English
 * suffixes before it looks a word up, so `bitches`, `wanker` and `shitty` are
 * all caught by their stems. Matching is whole-word — never substring — because
 * substring matching is how `Scunthorpe`, `assess`, `cockpit` and `analysis`
 * end up banned.
 *
 * Where a word is a slur in one sense and an ordinary word in another, the
 * ordinary sense wins if it is the one people actually mean: `cracker`,
 * `paddy`, `spade`, `slant`, `nip` and `vegetable` are not on the list, because
 * a round that ends "the word was cracker" reads as a biscuit to everyone.
 * The reverse call is made just as deliberately — `cock` and `ass` have
 * innocent senses that nobody reaches for first, so they stay.
 *
 * Operators can extend the list at runtime with one word per line in
 * `data/blocked.txt`, which lives on the deployment's volume next to the word
 * data — no redeploy needed.
 */

/** Obscenity, vulgarity and crude sexual terms. */
export const PROFANITY = [
  'anal', 'anus', 'arse', 'arsehole', 'ass', 'asshole', 'asswipe',
  'ballsack', 'bastard', 'bellend', 'bitch', 'blowjob', 'bollock', 'bollocks',
  'boner', 'bugger', 'bukkake', 'bullshit', 'butthole', 'buttplug',
  'clit', 'clitoris', 'cock', 'cocksucker', 'coochie', 'crap', 'cum',
  'cunnilingus', 'cunt',
  'deepthroat', 'dick', 'dickhead', 'dildo', 'dipshit', 'douche', 'douchebag',
  'dumbass',
  'ejaculate', 'erection',
  'felch', 'fellatio', 'fisting', 'fuck', 'fucker', 'fuckwit',
  'gangbang', 'genitalia', 'gonads', 'gooch',
  'handjob', 'hentai', 'hooker', 'horny', 'humping',
  'incest',
  'jackass', 'jerkoff', 'jism', 'jizz', 'knobhead',
  'labia',
  'masturbate', 'masturbation', 'milf', 'minge', 'molest', 'motherfucker',
  'nads', 'nutsack', 'nympho',
  'orgasm', 'orgy',
  'pedo', 'pedophile', 'penis', 'pervert', 'phallus', 'piss', 'pissed',
  'porn', 'porno', 'pornography', 'prick', 'prostitute', 'pube', 'pubes',
  'pussy',
  'queef',
  'rape', 'rapist', 'rimjob',
  'scrotum', 'semen', 'sex', 'shag', 'shit', 'skank', 'slut', 'smegma',
  'sodomy', 'sperm', 'spunk', 'strapon',
  'testicle', 'testicles', 'tit', 'tits', 'titties', 'titty', 'turd', 'twat',
  'vagina', 'vulva',
  'wank', 'wanker', 'whore',
];

/**
 * Slurs. Grouped only so the list stays auditable; the matcher treats them all
 * the same. They are here to be filtered out, and they are the whole reason the
 * file exists — an answer pool that can serve one of these to a player, or a
 * reveal that prints one as a near-miss, is not shippable.
 */
export const SLURS = [
  // Racial and ethnic
  'abbo', 'beaner', 'chink', 'chinaman', 'coolie', 'coon', 'darkie', 'darky',
  'gook', 'goy', 'greaser', 'gringo', 'gyp', 'gypsy', 'halfbreed', 'hebe',
  'honky', 'injun', 'jap', 'jigaboo', 'kaffir', 'kike', 'kraut', 'mick',
  'mulatto', 'negress', 'negro', 'nigga', 'nigger', 'octoroon', 'paki',
  'pickaninny', 'polack', 'quadroon', 'raghead', 'redskin', 'sambo', 'shylock',
  'spic', 'squaw', 'towelhead', 'wetback', 'whitey', 'wigger', 'wog', 'wop',
  'yid', 'zipperhead',
  // Religious
  'kafir', 'papist', 'shiksa',
  // Sexuality and gender
  'bulldyke', 'dyke', 'fag', 'faggot', 'ladyboy', 'poof', 'poofter', 'shemale',
  'sissy', 'tranny', 'trannie', 'transvestite',
  // Disability and mental health
  'cretin', 'crip', 'gimp', 'imbecile', 'lunatic', 'mongoloid', 'moron',
  'retard', 'retarded', 'spastic', 'spaz',
];

/**
 * Spelling variants that suffix-stripping cannot reach: whole families built on
 * a vulgar stem, and stretched or doubled spellings. Anchored at both ends — a
 * pattern that can match mid-word is a false-positive generator.
 *
 * The tails are deliberately short and the stretched forms take no tail at all.
 * An earlier `^s+h+i+t+[a-z]{0,4}$` matched `shiitake`; scripts/check-words.ts
 * keeps that case, plus `nigeria`, `retardant`, `assess` and `cockpit`, honest.
 */
export const BLOCKED_PATTERNS: RegExp[] = [
  // Every English word built on these stems is vulgar, so take the family.
  /^(?:fuck|cunt|bitch|bastard|wank|twat|slut|whore|faggot|shit)[a-z]{0,6}$/,
  // Stretched or doubled spellings, exact: fuuuck, shiiit, biiitch.
  /^f+u+c+k+$/,
  /^s+h+i+t+$/,
  /^b+i+t+c+h+$/,
  // The n-word and its variants, without catching Niger or Nigeria.
  /^n+i+g+(?:g+(?:e+r+|a+h?|uh)|a+h?)s?$/,
  // f-slur variants.
  /^f+a+g+(?:g+[aeiou]*t*)?s?$/,
  // r-slur variants, without catching "retardant".
  /^r+e+t+a+r+d+(?:ed|s|o)?$/,
];

/**
 * Innocent words that a blocked stem plus a regular suffix happens to spell.
 * Checked before anything else, so these always win.
 *
 * Every entry was found by running the filter over the full 370,000-word
 * english-words list and reading the hits; scripts/check-words.ts keeps them
 * from regressing. `spicy` and `spices` off `spic` are the pair that would
 * actually have been noticed in play — the food category is full of them.
 */
export const EXEMPT = new Set([
  'spice', 'spices', 'spiced', 'spicy', 'spicier', 'spiciest', 'spiciness',
  'spicing', 'spicer', 'spicers',
  'pub', 'pubs', 'rap', 'raps', 'rapper', 'rappers', 'rapping',
  'shaggy', 'shaggier', 'shaggiest', 'shagginess',
  'cocky', 'cockier', 'cockiest', 'cockiness', 'cocker', 'cockers',
  'titter', 'titters', 'tittering', 'titer', 'titers',
  'prickly', 'pricklier', 'prickliest', 'prickle', 'prickles',
  'crappie', 'crappies', 'beanery', 'beaneries',
  'jape', 'japes', 'japed', 'japing',
  'mingy', 'dicky', 'dickie', 'dickies', 'micky', 'mickey',
  'retarder', 'retarders', 'retarding', 'retardant', 'retardants',
  'cripes', 'clitter', 'shittim', 'shittah',
]);

export const BLOCKLIST = [...PROFANITY, ...SLURS];
