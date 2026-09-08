/**
 * Two tiers of "too common", because generating and guessing want different
 * answers to that question.
 *
 * FUNCTION_WORDS are barred from both. They carry no meaning to guess at, and
 * their vectors sit so near the centre of the space that they rank middling
 * against almost any secret — which reads to a player as a signal and is pure
 * noise.
 *
 * COMMON_WORDS are barred from being answers only. `time`, `people` and `thing`
 * are real words with real vectors, and probing with one is a perfectly good
 * move; they just make thin, vague answers. Rejecting them as guesses would
 * take a legitimate strategy away, so guessing them stays open.
 *
 * The frequency floor in engine/lexicon.ts catches the very top of the
 * vocabulary; these lists catch what that floor is too shallow to reach.
 */

/** Barred as answers and as guesses. */
export const FUNCTION_WORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'her', 'was', 'one', 'our',
  'out', 'his', 'has', 'had', 'him', 'she', 'they', 'this', 'that', 'with', 'from', 'have',
  'were', 'been', 'their', 'there', 'what', 'when', 'which', 'them', 'then', 'than', 'into',
  'some', 'more', 'very', 'just', 'also', 'about', 'would', 'could', 'should', 'these', 'those',
  'its', 'it', 'an', 'of', 'to', 'in', 'on', 'at', 'by', 'as', 'is', 'be', 'or', 'if',
  'do', 'does', 'did', 'so', 'we', 'he', 'me', 'my', 'no', 'up', 'us', 'am', 'who', 'whom',
  'whose', 'will', 'shall', 'may', 'might', 'must', 'being', 'such', 'each', 'other',
  'any', 'both', 'few', 'most', 'own', 'same', 'too', 'only', 'here', 'why', 'how', 'because',
  'while', 'after', 'before', 'above', 'below', 'over', 'under', 'again', 'once', 'during',
  'through', 'between', 'against', 'among', 'per', 'via', 'upon', 'onto', 'off', 'yet',
  'ever', 'never', 'always', 'often', 'still', 'even', 'much', 'many', 'like', 'well',
  'where', 'come', 'came', 'went', 'said', 'says', 'get', 'got', 'make', 'made', 'take',
  'took', 'know', 'knew', 'think', 'thought', 'want', 'used', 'using', 'able', 'another',
  'instead', 'actually', 'though', 'although', 'however', 'therefore', 'thus', 'hence',
  'something', 'anything', 'everything', 'nothing', 'someone', 'anyone', 'everyone',

  // Contractions and auxiliaries GloVe keeps as their own tokens.
  'nt', 'll', 've', 're', 'don', 'doesn', 'didn', 'isn', 'wasn', 'aren', 'weren',
  'hasn', 'haven', 'hadn', 'wouldn', 'couldn', 'shouldn', 'cannot',
  'im', 'ive', 'youre', 'youve', 'theyre', 'theyve', 'weve', 'thats',

  // Reflexives, quantifiers and discourse glue the list above stopped short of.
  'himself', 'herself', 'itself', 'myself', 'yourself', 'themselves', 'ourselves',
  'anywhere', 'everywhere', 'somewhere', 'nowhere', 'somehow', 'anyhow',
  'whatever', 'whenever', 'wherever', 'whoever', 'whichever',
  'else', 'etc', 'ie', 'eg', 'vs', 'okay', 'yeah', 'nope',
  'least', 'quite', 'rather', 'really', 'almost', 'nearly', 'perhaps', 'maybe',
  'probably', 'possibly', 'certainly', 'indeed', 'simply', 'merely', 'basically',
  'essentially', 'generally', 'usually', 'sometimes', 'meanwhile', 'anyway',
  'besides', 'moreover', 'furthermore', 'nonetheless', 'nevertheless', 'regarding',
  'according', 'including', 'towards', 'toward', 'within', 'without', 'throughout',
  'along', 'across', 'beyond', 'beside', 'around',
]);

/**
 * Barred as answers, still fine to guess. High-frequency words with too little
 * meaning of their own to be worth hunting for.
 */
export const COMMON_WORDS = new Set([
  'thing', 'things', 'stuff', 'way', 'ways', 'lot', 'lots', 'bit', 'kind', 'sort', 'type',
  'case', 'point', 'part', 'piece', 'number', 'amount', 'level', 'form', 'item',
  'people', 'person', 'guy', 'man', 'woman', 'someone', 'thingy',
  'time', 'times', 'day', 'days', 'year', 'years', 'today', 'tomorrow', 'yesterday',
  'first', 'second', 'third', 'next', 'last', 'previous', 'former', 'latter',
  'new', 'old', 'good', 'bad', 'great', 'best', 'better', 'worse', 'worst', 'nice', 'fine',
  'sure', 'true', 'real', 'main', 'general', 'common', 'various', 'certain', 'particular',
  'go', 'goes', 'going', 'gone', 'give', 'gave', 'given', 'put', 'let', 'say', 'saying',
  'see', 'saw', 'seen', 'seem', 'seems', 'seemed', 'look', 'looked', 'looking',
  'find', 'found', 'need', 'needed', 'try', 'tried', 'call', 'called', 'keep', 'kept',
  'become', 'became', 'begin', 'began', 'begun', 'set', 'show', 'showed', 'shown',
  'use', 'uses', 'work', 'works', 'help', 'want', 'wanted', 'mean', 'means', 'meant',
]);

/** Everything the answer pool refuses. */
export const STOPWORDS = new Set([...FUNCTION_WORDS, ...COMMON_WORDS]);
