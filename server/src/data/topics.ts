/**
 * Offline semantic model.
 *
 * Contexto ranks words by how near they sit in a large embedding space trained
 * on web text. The real thing needs GloVe or word2vec (see
 * `npm run build:index`). This file is the fallback that ships in the repo so
 * the game is playable the moment you clone it.
 *
 * Each entry is a topic: a bag of words that co-occur in the same contexts.
 * Words deliberately appear in several topics — "bank" sits in both finance and
 * rivers, "star" in both astronomy and celebrity — and that overlap is what
 * gives the derived vectors their structure. The builder in `topicModel.ts`
 * turns membership into vectors and then smooths them so two topics that share
 * vocabulary end up genuinely near each other rather than orthogonal.
 *
 * The category tag drives the "category" room setting and nothing else.
 */

import type { Category } from '@mivimoose/shared';

export type TopicDef = readonly [id: string, category: Category, words: string];

export const TOPICS: TopicDef[] = [
  // ---------------------------------------------------------------- nature
  ['space', 'nature', 'space star planet galaxy universe cosmos orbit astronaut rocket telescope moon sun solar comet asteroid nebula satellite launch spacecraft gravity eclipse meteor'],
  ['weather', 'nature', 'weather rain storm cloud thunder lightning wind snow hail fog sunshine drizzle forecast humid temperature climate breeze hurricane tornado frost'],
  ['ocean', 'nature', 'ocean sea wave tide beach shore coral reef island shark whale dolphin salt current deep dive sailor harbor seaweed shell'],
  ['mountain', 'nature', 'mountain peak summit cliff valley slope ridge climb altitude rock avalanche glacier trail hike range canyon boulder'],
  ['forest', 'nature', 'forest tree wood branch leaf trunk root bark canopy pine oak moss shade grove timber jungle undergrowth'],
  ['river', 'nature', 'river stream bank current flow water bridge lake pond delta flood waterfall creek canal shore fish reed'],
  ['desert', 'nature', 'desert sand dune camel oasis heat drought cactus dry barren mirage nomad sandstorm arid'],
  ['arctic', 'nature', 'arctic ice snow cold freeze polar glacier penguin frost tundra winter blizzard chill frozen iceberg'],
  ['fire', 'nature', 'fire flame burn smoke heat ash ember blaze spark wildfire torch candle furnace scorch'],
  ['flowers', 'nature', 'flower rose petal bloom garden tulip lily daisy stem pollen bouquet blossom orchid sunflower fragrance'],
  ['garden', 'nature', 'garden plant soil seed grow water shovel hedge lawn greenhouse harvest weed sprout gardener fertilizer'],
  ['mammals', 'nature', 'animal dog cat horse cow lion tiger bear elephant wolf rabbit deer monkey fox mouse sheep goat pig'],
  ['birds', 'nature', 'bird wing feather nest fly eagle owl sparrow parrot crow duck swan chicken beak flock migration'],
  ['insects', 'nature', 'insect bug bee ant spider butterfly fly mosquito beetle wasp moth larva swarm hive sting'],
  ['reptiles', 'nature', 'snake lizard turtle crocodile frog scale venom reptile tortoise gecko amphibian slither'],
  ['fish', 'nature', 'fish salmon tuna trout shark scale fin gill aquarium bait hook net fishing pond swim'],
  ['pets', 'nature', 'pet dog cat puppy kitten leash collar vet adopt fetch bark purr owner groom hamster'],
  ['farm', 'nature', 'farm field crop harvest tractor barn cow chicken wheat corn soil plow ranch livestock silo farmer'],
  ['environment', 'science', 'environment climate pollution recycle carbon emission sustainable green waste plastic conservation ecosystem habitat extinction renewable'],
  ['earth', 'nature', 'earth ground soil dirt land rock stone clay mud terrain surface continent crust erosion'],
  ['water', 'nature', 'water liquid drink flow wet drop pour thirst ice steam splash fountain rain bottle'],
  ['air', 'nature', 'air wind breath oxygen breeze atmosphere gas blow float sky altitude ventilate'],

  // ---------------------------------------------------------------- food
  ['food', 'concrete', 'food meal eat hungry taste dish plate cook recipe flavor delicious feast snack appetite nutrition'],
  ['cooking', 'action', 'cook boil fry bake grill roast simmer chop stir recipe kitchen chef oven pan seasoning'],
  ['baking', 'concrete', 'bake cake bread flour sugar dough oven pastry cookie pie yeast frosting muffin batter'],
  ['dessert', 'concrete', 'dessert cake chocolate ice cream sweet candy sugar pudding cookie caramel honey syrup'],
  ['fruit', 'concrete', 'fruit apple banana orange grape berry lemon peach pear cherry mango melon juice ripe strawberry'],
  ['vegetable', 'concrete', 'vegetable carrot potato tomato onion lettuce pepper broccoli spinach cabbage garlic salad cucumber'],
  ['meat', 'concrete', 'meat beef chicken pork steak bacon sausage grill butcher protein lamb roast'],
  ['drinks', 'concrete', 'drink water juice soda beer wine coffee tea milk glass bottle thirsty cocktail sip'],
  ['coffee', 'concrete', 'coffee espresso latte caffeine brew bean cup mug morning barista roast cafe'],
  ['bar', 'culture', 'bar beer wine cocktail whiskey drink pub bartender alcohol toast glass night party'],
  ['restaurant', 'culture', 'restaurant menu waiter table order tip chef dinner reservation bill cuisine dining'],
  ['kitchen', 'concrete', 'kitchen knife pan pot spoon fork plate bowl stove sink fridge counter cupboard blender'],
  ['spice', 'concrete', 'spice salt pepper herb cinnamon garlic ginger flavor season chili basil taste'],
  ['breakfast', 'concrete', 'breakfast egg toast cereal bacon pancake morning juice coffee oatmeal brunch'],

  // ---------------------------------------------------------------- home
  ['house', 'concrete', 'house home room door window wall roof floor kitchen garage yard address neighbor apartment'],
  ['furniture', 'concrete', 'furniture chair table sofa bed desk shelf cabinet drawer lamp couch cushion wardrobe'],
  ['sleep', 'action', 'sleep bed dream pillow blanket night rest tired nap wake snore mattress bedroom insomnia'],
  ['bathroom', 'concrete', 'bathroom shower bath soap towel toilet sink mirror toothbrush wash hygiene shampoo'],
  ['cleaning', 'action', 'clean wash scrub dust vacuum mop soap laundry tidy sweep stain rinse chore'],
  ['keys', 'concrete', 'key lock door open close handle latch unlock secure chain bolt entrance'],
  ['light', 'concrete', 'light lamp bulb bright dark shadow glow shine candle switch beam illuminate lantern'],

  // ---------------------------------------------------------------- body
  ['body', 'concrete', 'body head arm leg hand foot finger shoulder knee chest back skin muscle bone'],
  ['face', 'concrete', 'face eye nose mouth ear lip cheek chin smile forehead jaw expression'],
  ['hair', 'concrete', 'hair cut style brush comb salon barber shampoo curl braid blonde bald'],
  ['health', 'science', 'health doctor medicine hospital illness pain cure treatment nurse patient healthy sick diagnosis clinic'],
  ['hospital', 'science', 'hospital doctor nurse patient surgery ward emergency ambulance operation ward bed medicine'],
  ['illness', 'science', 'sick illness disease fever cough infection virus flu pain symptom cold headache injury'],
  ['exercise', 'action', 'exercise gym workout fitness muscle strength train run lift stretch cardio sweat healthy'],

  // ---------------------------------------------------------------- emotion
  ['happy', 'emotion', 'happy joy smile laugh cheerful glad delight pleasure content excited bliss grin celebrate'],
  ['sad', 'emotion', 'sad cry tear sorrow grief lonely depressed unhappy misery mourn upset heartbreak'],
  ['anger', 'emotion', 'angry rage fury mad annoyed furious temper shout hate resentment irritated frustration'],
  ['fear', 'emotion', 'fear afraid scared terror panic anxiety nervous fright horror dread worry phobia'],
  ['love', 'emotion', 'love heart romance kiss affection passion adore darling relationship devotion crush'],
  ['calm', 'emotion', 'calm peace quiet relax serene tranquil still gentle soothe patience meditation'],
  ['surprise', 'emotion', 'surprise shock amazed sudden unexpected astonish wonder startle gasp'],
  ['pride', 'emotion', 'pride proud confidence achievement honor dignity boast ego respect esteem'],
  ['shame', 'emotion', 'shame guilt embarrassed regret blush apology humiliate remorse'],
  ['hope', 'emotion', 'hope wish dream optimism faith future desire aspire longing believe'],

  // ---------------------------------------------------------------- people
  ['family', 'culture', 'family mother father sister brother parent child son daughter grandmother uncle aunt cousin relative'],
  ['baby', 'culture', 'baby infant born birth cradle diaper toddler crawl newborn mother nursery'],
  ['childhood', 'culture', 'child kid childhood toy play school playground innocent grow youth cartoon'],
  ['friendship', 'culture', 'friend friendship buddy companion trust loyal together hang chat pal support'],
  ['wedding', 'culture', 'wedding marriage bride groom ring vow ceremony honeymoon guest cake love engagement'],
  ['death', 'culture', 'death die funeral grave grief bury mourn coffin memorial loss cemetery obituary'],
  ['party', 'culture', 'party celebrate dance music guest invite balloon drink birthday festival fun night'],
  ['birthday', 'culture', 'birthday cake candle present gift party wish age celebrate card surprise'],

  // ---------------------------------------------------------------- school
  ['school', 'culture', 'school student teacher class lesson homework exam grade desk classroom study pupil principal'],
  ['university', 'culture', 'university college degree student professor lecture campus thesis graduate tuition semester'],
  ['reading', 'action', 'read book page chapter novel story library author text literature paperback bookshelf'],
  ['writing', 'action', 'write pen paper letter word text author draft note journal ink handwriting essay'],
  ['language', 'abstract', 'language word speak grammar sentence vocabulary translate accent dialect meaning phrase fluent'],
  ['math', 'science', 'math number count add subtract multiply divide equation algebra geometry calculate sum formula'],
  ['science', 'science', 'science experiment research theory laboratory hypothesis discovery scientist evidence data method'],
  ['physics', 'science', 'physics energy force gravity motion particle atom quantum mass velocity electron relativity'],
  ['chemistry', 'science', 'chemistry chemical element compound reaction molecule acid lab formula atom solution mixture'],
  ['biology', 'science', 'biology cell organism dna gene evolution species tissue bacteria protein anatomy microscope'],
  ['history', 'culture', 'history past ancient century empire war king civilization era archive record medieval'],

  // ---------------------------------------------------------------- tech
  ['computer', 'science', 'computer laptop screen keyboard mouse software hardware file folder monitor processor memory'],
  ['internet', 'science', 'internet website online browser search link download upload network server wifi email'],
  ['social', 'culture', 'social media post share follow like comment feed profile viral hashtag influencer'],
  ['programming', 'science', 'code program developer software bug debug function variable syntax compile script algorithm'],
  ['phone', 'concrete', 'phone call text message ring mobile screen app charge contact voicemail smartphone'],
  ['ai', 'science', 'artificial intelligence robot machine learning algorithm data model neural automation android'],
  ['game', 'culture', 'game play video console controller level player score win multiplayer arcade quest'],
  ['boardgame', 'culture', 'board game card dice chess piece move turn player rule strategy puzzle deck'],

  // ---------------------------------------------------------------- work
  ['work', 'action', 'work job career office employee boss salary hire task profession colleague shift'],
  ['office', 'concrete', 'office desk meeting email printer chair colleague cubicle report deadline manager'],
  ['money', 'abstract', 'money cash coin dollar price cost pay wealth rich poor budget income expense currency'],
  ['bank', 'abstract', 'bank account loan credit debit interest savings deposit withdraw teller mortgage finance'],
  ['business', 'abstract', 'business company market profit customer product startup investor strategy revenue contract'],
  ['shopping', 'action', 'shop store buy sell price customer cart mall sale discount receipt purchase checkout'],
  ['advertising', 'culture', 'advertise brand campaign slogan commercial market logo promote audience billboard'],
  ['jobs', 'culture', 'doctor teacher lawyer engineer nurse chef driver farmer artist pilot plumber carpenter'],

  // ---------------------------------------------------------------- society
  ['law', 'abstract', 'law legal court judge lawyer justice trial verdict rule contract evidence attorney'],
  ['crime', 'abstract', 'crime criminal steal theft murder robbery prison guilty arrest suspect fraud violence'],
  ['police', 'culture', 'police officer arrest patrol badge crime siren investigate detective handcuff station'],
  ['politics', 'abstract', 'politics government election vote president party campaign policy senate democracy candidate'],
  ['government', 'abstract', 'government state nation citizen public policy law minister parliament official authority'],
  ['war', 'abstract', 'war battle soldier army weapon enemy fight victory defeat troop invasion conflict'],
  ['peace', 'abstract', 'peace treaty agreement diplomacy truce harmony negotiation alliance ceasefire'],
  ['religion', 'culture', 'religion god church prayer faith bible temple priest holy worship spirit soul ritual'],
  ['mythology', 'culture', 'myth legend god hero dragon monster ancient tale gods oracle prophecy titan'],
  ['philosophy', 'abstract', 'philosophy thought idea truth reason logic ethics existence meaning wisdom theory mind'],
  ['news', 'culture', 'news report journalist headline media broadcast article press story coverage editor'],

  // ---------------------------------------------------------------- arts
  ['art', 'culture', 'art painting artist gallery museum canvas sculpture creative exhibit style masterpiece'],
  ['painting', 'action', 'paint brush color canvas easel portrait landscape palette artist stroke watercolor'],
  ['music', 'culture', 'music song sound melody rhythm band album artist listen concert lyrics tune beat'],
  ['instrument', 'concrete', 'guitar piano drum violin flute trumpet bass keyboard string chord orchestra instrument'],
  ['singing', 'action', 'sing voice song choir vocal lyrics melody note pitch chorus karaoke hum'],
  ['dance', 'action', 'dance move rhythm ballet step floor partner music choreography spin waltz'],
  ['theatre', 'culture', 'theater stage play actor drama script audience curtain scene performance rehearsal'],
  ['film', 'culture', 'film movie cinema actor director scene camera screen script premiere plot trailer'],
  ['tv', 'culture', 'television show series episode channel broadcast screen watch remote season sitcom'],
  ['photo', 'action', 'photo camera lens picture shot image flash album portrait snapshot photographer'],
  ['fantasy', 'culture', 'magic wizard spell dragon fantasy witch potion sword quest kingdom enchant curse'],
  ['scifi', 'culture', 'future alien spaceship robot laser dystopia clone time travel cyborg galaxy technology'],
  ['horror', 'culture', 'horror ghost monster scary haunted zombie vampire nightmare blood creepy scream'],

  // ---------------------------------------------------------------- sport
  ['sport', 'action', 'sport game team player match score win lose coach league champion tournament athlete'],
  ['football', 'action', 'football soccer goal kick pitch striker referee penalty team match stadium ball'],
  ['basketball', 'action', 'basketball hoop dunk court dribble shoot player team nba rebound basket'],
  ['baseball', 'action', 'baseball bat pitch catch inning home run diamond glove umpire strike'],
  ['tennis', 'action', 'tennis racket serve court net ball match set volley ace wimbledon'],
  ['swim', 'action', 'swim pool water stroke dive lane float lifeguard goggles freestyle'],
  ['running', 'action', 'run race track sprint marathon finish pace jog speed athlete stamina'],
  ['cycling', 'action', 'bike bicycle ride pedal wheel cycle helmet tour chain gear'],
  ['martial', 'action', 'fight punch kick boxing karate judo belt opponent ring defense wrestle'],
  ['olympics', 'culture', 'olympic medal gold athlete competition ceremony record games torch nation'],

  // ---------------------------------------------------------------- travel
  ['travel', 'action', 'travel trip journey visit tourist destination passport luggage abroad explore vacation itinerary'],
  ['vacation', 'culture', 'vacation holiday beach resort relax sunshine hotel trip tourist summer souvenir'],
  ['hotel', 'concrete', 'hotel room booking reception key suite guest lobby checkout stay concierge'],
  ['airplane', 'concrete', 'plane airport flight pilot ticket luggage runway takeoff landing airline gate'],
  ['car', 'concrete', 'car drive road wheel engine tire fuel traffic license garage brake steering'],
  ['train', 'concrete', 'train rail station track platform ticket carriage conductor subway journey'],
  ['boat', 'concrete', 'boat ship sail harbor deck anchor crew voyage yacht ferry captain'],
  ['road', 'concrete', 'road street highway lane traffic sign junction bridge path route drive'],
  ['navigation', 'abstract', 'map direction north south east west compass route location gps navigate distance'],

  // ---------------------------------------------------------------- places
  ['city', 'concrete', 'city urban street building downtown crowd traffic skyline metro district population'],
  ['village', 'concrete', 'village rural countryside small quiet cottage farm community local field'],
  ['building', 'concrete', 'building tower floor wall roof construction architect concrete elevator stairs foundation'],
  ['construction', 'action', 'build construct hammer nail brick cement crane site worker scaffold repair'],
  ['tools', 'concrete', 'tool hammer screwdriver wrench drill saw nail toolbox repair fix blade'],

  // ---------------------------------------------------------------- objects
  ['clothes', 'concrete', 'clothes shirt pants dress jacket coat sock hat sweater wear wardrobe outfit'],
  ['shoes', 'concrete', 'shoe boot sneaker sandal heel lace sole foot pair wear leather'],
  ['fashion', 'culture', 'fashion style trend model runway designer brand outfit chic wardrobe elegant'],
  ['jewelry', 'concrete', 'jewelry ring necklace gold silver diamond bracelet earring gem precious pearl'],
  ['metal', 'concrete', 'metal iron steel gold silver copper alloy rust forge weld ore'],
  ['paper', 'concrete', 'paper page sheet note print write envelope card notebook document'],
  ['glass', 'concrete', 'glass window mirror bottle transparent break shard crystal lens'],
  ['textile', 'concrete', 'cloth fabric cotton wool silk thread sew stitch needle weave tailor'],

  // ---------------------------------------------------------------- abstract
  ['time', 'abstract', 'time hour minute second clock day week month year late early moment duration'],
  ['season', 'abstract', 'season spring summer autumn winter month weather change cycle harvest bloom'],
  ['holiday', 'culture', 'holiday christmas easter halloween thanksgiving celebration tradition gift festive vacation'],
  ['color', 'abstract', 'color red blue green yellow black white purple orange pink shade bright'],
  ['shape', 'abstract', 'shape circle square triangle round line curve angle edge corner symmetry'],
  ['size', 'abstract', 'size big small large tiny huge giant little wide narrow tall short'],
  ['speed', 'abstract', 'speed fast slow quick rapid rush hurry pace accelerate velocity swift'],
  ['sound', 'abstract', 'sound noise loud quiet echo voice hear volume silence ring vibration'],
  ['vision', 'abstract', 'see look watch eye vision sight view glance stare observe blind focus'],
  ['smell', 'abstract', 'smell scent odor fragrance perfume aroma nose stink sniff'],
  ['taste', 'abstract', 'taste sweet sour bitter salty flavor tongue delicious spicy bland'],
  ['touch', 'abstract', 'touch feel soft hard rough smooth texture press hold skin warm'],
  ['luck', 'abstract', 'luck chance fortune random gamble fate destiny coincidence odds lottery'],
  ['success', 'abstract', 'success achieve win victory goal accomplish triumph reward progress ambition'],
  ['failure', 'abstract', 'fail failure mistake error lose defeat wrong flaw setback disappoint'],
  ['truth', 'abstract', 'truth lie honest fact false real fake deceive trust proof genuine'],
  ['secret', 'abstract', 'secret hidden mystery conceal private confidential reveal whisper clue unknown'],
  ['memory', 'abstract', 'memory remember forget recall past nostalgia mind reminisce moment'],
  ['dream', 'abstract', 'dream sleep nightmare imagine vision fantasy wish subconscious wake'],
  ['idea', 'abstract', 'idea thought concept think mind creative invention insight brainstorm plan'],
  ['question', 'abstract', 'question answer ask wonder curious doubt inquiry reply riddle puzzle'],
  ['change', 'abstract', 'change transform shift alter grow evolve adapt replace difference progress'],
  ['power', 'abstract', 'power strength control authority force influence dominate energy might rule'],
  ['freedom', 'abstract', 'freedom liberty free escape independence choice rights release liberate'],
  ['danger', 'abstract', 'danger risk threat unsafe hazard warning peril caution emergency escape'],
  ['energy', 'science', 'energy electricity power battery current voltage solar fuel charge generator wire'],
  // ------------------------------------------------------------- bridges
  // Topics above are tight clusters. These deliberately span two or three of
  // them so the smoothing pass can learn that money and banking belong
  // together, or that a sailor belongs with ships rather than with salaries.
  // Without them, any two disjoint clusters sit at zero similarity and the
  // ordering between them is decided by jitter, which players read as broken.
  ['x-finance', 'abstract', 'money bank cash account pay salary price cost loan credit wealth income tax budget currency coin finance'],
  ['x-commerce', 'abstract', 'shop store buy sell price customer money market product sale business retail cash purchase'],
  ['x-seafaring', 'concrete', 'sailor ship boat sea ocean harbor voyage captain crew sail anchor island port deck'],
  ['x-sky', 'nature', 'sky cloud sun moon star bird plane fly air blue weather horizon wind'],
  ['x-homelife', 'concrete', 'house home family room kitchen bed door neighbor apartment live comfort'],
  ['x-routine', 'action', 'morning wake breakfast work lunch evening dinner sleep night routine day'],
  ['x-media', 'culture', 'music film television radio news show media audience broadcast entertainment channel'],
  ['x-performance', 'culture', 'stage concert audience music dance theater perform show applause band tour'],
  ['x-publishing', 'culture', 'write book author story article journalist page publish read editor print'],
  ['x-study', 'culture', 'study school learn read book exam student teacher class knowledge library'],
  ['x-deskwork', 'science', 'computer office work email file document laptop screen software print report'],
  ['x-lab', 'science', 'science laboratory experiment research chemical test measure data discovery theory'],
  ['x-medicine', 'science', 'doctor medicine hospital patient nurse health illness treatment pain cure drug'],
  ['x-justice', 'abstract', 'crime police law court judge prison criminal arrest lawyer trial evidence'],
  ['x-empire', 'abstract', 'war history empire battle soldier king century ancient nation army'],
  ['x-nation', 'abstract', 'government nation country election president citizen policy state law vote'],
  ['x-trip', 'action', 'travel trip journey flight hotel passport airport tourist vacation abroad map'],
  ['x-vehicle', 'concrete', 'car bus train plane bike drive ride transport engine wheel road travel'],
  ['x-citylife', 'concrete', 'city street building traffic crowd shop restaurant apartment downtown metro'],
  ['x-country', 'nature', 'farm village field countryside animal crop tractor barn rural quiet'],
  ['x-outdoors', 'nature', 'forest mountain river lake trail hike camp nature outdoor wildlife'],
  ['x-seasonal', 'nature', 'weather season summer winter rain snow sun cold hot spring autumn'],
  ['x-creatures', 'nature', 'animal dog cat bird fish wild pet species creature tail'],
  ['x-flora', 'nature', 'plant tree flower grass leaf seed grow garden forest root'],
  ['x-mealtime', 'concrete', 'food cook kitchen recipe meal eat chef restaurant dinner taste'],
  ['x-drinksocial', 'culture', 'drink coffee tea beer wine bar cafe friend talk night'],
  ['x-competition', 'action', 'sport game team match win lose score player competition champion tournament'],
  ['x-fitness', 'action', 'body muscle exercise health run strong train fit weight energy'],
  ['x-feeling', 'emotion', 'feel emotion mind heart think mood happy sad love fear'],
  ['x-bonds', 'emotion', 'friend family love partner relationship trust marriage together care'],
  ['x-time', 'abstract', 'time year day life age moment future past present memory'],
  ['x-employment', 'action', 'work job salary career money employee boss office hire pay'],
  ['x-making', 'culture', 'art craft design create draw paint build make style beauty'],
  ['x-appearance', 'culture', 'fashion clothes style wear dress look beauty hair model outfit'],
  ['x-digital', 'science', 'technology future robot computer internet digital machine data online'],
  ['x-playtime', 'culture', 'game play fun player win rule score toy puzzle challenge'],
  ['x-belief', 'culture', 'god religion faith belief prayer soul spirit church holy sacred'],
  ['x-mortality', 'abstract', 'death life born die grave soul funeral memory loss end'],
  ['x-brightness', 'abstract', 'light dark night day shadow bright sun lamp black white'],
  ['x-audio', 'abstract', 'sound music noise voice song hear listen loud quiet ear'],
  ['x-liquid', 'nature', 'water river sea rain drink liquid wet ocean lake flow'],
  ['x-heat', 'nature', 'fire heat burn hot flame warm smoke sun summer light'],
  ['x-chill', 'nature', 'cold ice snow winter freeze chill frost coat warm'],
];
