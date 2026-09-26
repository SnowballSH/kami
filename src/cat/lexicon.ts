import type { ActiveNature } from "./natures";

export type WordTable = Readonly<Record<ActiveNature, readonly string[]>>;

const list = (csv: string): readonly string[] =>
  csv
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

export const NATURE_THINGS: WordTable = {
  bouncy: list(`
    mushroom, toadstool, spring, trampoline, jelly, jello, bed, mattress, ball, rubber,
    rubber ball, bouncy ball, beach ball, basketball, bouncy castle, pogo stick, pogo, slinky,
    cushion, pillow, sofa, couch, drum, springboard, diving board, marshmallow, flubber, jump pad,
    launch pad, bumper, coil, bounce, boing
  `),
  climbable: list(`
    ladder, stepladder, step ladder, vine, rope, stairs, staircase, stairway, steps, tree, net,
    beanstalk, ivy, chain, pole, trellis, scaffold, scaffolding, rung, climbing wall,
    climbing frame, monkey bars, cobweb, web, spider web, escalator, lattice, fence, fire escape,
    braid, cable, cord, stalk, trunk, branch, bamboo, handhold, foothold, creeper, rigging, climb
  `),
  floaty: list(`
    balloon, hot air balloon, cloud, bubble, kite, airship, blimp, zeppelin, parachute, smoke,
    steam, helium, sky lantern, magic carpet, flying carpet, broomstick, float
  `),
  heavy: list(`
    rock, anvil, safe, boulder, stone, weight, dumbbell, barbell, kettlebell, iron, lead,
    whale, piano, cannonball, bowling ball, anchor, mountain, meteor, asteroid, statue,
    gold, gold bar, ingot, steel, metal, concrete, cement,
    hammer, fridge, paperweight, log, vault, pebble, planet, ton, tonne, lump, sandbag
  `),
  light: list(`
    feather, leaf, leaves, paper, paper plane, paper airplane, paper aeroplane, paper bag,
    plastic bag, tissue, tissue paper, petal, fluff, dust, cotton, cotton wool, cotton ball,
    snowflake, foam, styrofoam, polystyrene, confetti, ash, straw, hay, dandelion, lint, napkin,
    ribbon, silk, plume, ping pong ball, cork, tumbleweed, pollen, sponge, origami, wisp
  `),
  slippery: list(`
    ice, ice cube, ice rink, icicle, glacier, soap, bar of soap, butter, oil, olive oil, grease,
    banana, banana peel, banana skin, slide, water slide, slime, eel, fish, wax, margarine, lard,
    puddle, frozen lake, sled, sledge, sleigh, ski, skate, teflon, slip, block of ice
  `),
  sticky: list(`
    glue, superglue, super glue, nail, tape, duct tape, sellotape, scotch tape, honey, gum,
    chewing gum, bubblegum, bubble gum, velcro, magnet, syrup, jam, tar, sap, resin, staple, pin,
    screw, bolt, rivet, hook, sticker, sticky note, post it, plaster, bandage, band aid, paste,
    toffee, caramel, treacle, molasses, peanut butter, burr, suction cup, sucker, limpet, barnacle,
    mud, clay, putty, blu tack, thumbtack, tack, peg, adhesive, marmalade, nutella
  `),
  grow: list(`
    cake, cupcake, biscuit, cookie, bread, loaf, pie, muffin, pastry, scone, sandwich, toast,
    pizza, burger, hamburger, donut, doughnut, brownie, candy, chocolate, apple, fruit, cheese,
    snack, food, meal, dinner, lunch, breakfast, crumpet, pancake, waffle, croissant, bun,
    pudding, ice cream, lollipop, carrot, tart, crumb, cracker, egg, pasta, noodle, fries, chips,
    crisps, bean, growth potion, growing potion, grow potion
  `),
  shrink: list(`
    bottle, potion, shrinking potion, shrink potion, shrink ray, drink, tea, cup of tea, teacup,
    teapot, cup, mug, glass, flask, vial, phial, elixir, juice, water, milk, soda, cola, lemonade,
    wine, beer, coffee, medicine, tonic, brew, soup, jug, pitcher, kettle, smoothie, milkshake,
    cocktail, pill, fan, soda can, tin can
  `),
  walker: list(`
    cat, kitten, dog, puppy, caterpillar, turtle, tortoise, snail, mouse, rat, hamster, pig,
    cow, sheep, goat, horse, pony, donkey, hedgehog, duck, chicken, hen, penguin, crab, beetle,
    ant, spider, lizard, dodo, walrus, gryphon, elephant, hippo, rhino, bull, bear, dinosaur,
    lion, tiger, wolf, fox, deer, monkey, robot, soldier, knight, person, man, woman, boy, child,
    baby, girl, kid, hero, heroine, character, player, princess, prince, queen, king, wizard,
    witch, pirate, cheshire cat, creature, monster, animal, pet, beast, worm, slug, lobster, crocodile,
    alligator, camel, zebra, giraffe, gorilla, panda, koala, glowworm, glow worm
  `),
  hopper: list(`
    rabbit, bunny, hare, white rabbit, march hare, frog, toad, kangaroo, grasshopper, cricket,
    flea, wallaby, jackrabbit, springbok, gazelle, impala, jumping bean, hopper
  `),
  flier: list(`
    bird, butterfly, bee, bumblebee, wasp, bat, moth, owl, eagle, pigeon, dove, seagull, gull,
    parrot, firefly, dragonfly, fly, mosquito, hummingbird, sparrow, robin, crow, raven, swan,
    goose, flamingo, pelican, stork, hawk, falcon, vulture, ghost, angel, fairy, dragon, pegasus,
    phoenix, griffin, bluebird, ladybird, ladybug, jubjub bird, lightning bug, flier
  `),
  vehicle: list(`
    car, cart, wagon, truck, lorry, bus, van, train, tram, trolley, boat, ship, raft, canoe,
    bicycle, bike, tricycle, scooter, skateboard, motorbike, motorcycle, tractor, bulldozer,
    kart, go kart, jeep, taxi, cab, carriage, chariot, wheelbarrow, pram, buggy, tank, vehicle,
    minecart, mine cart, rickshaw, ambulance, fire truck, firetruck, police car, race car,
    racecar, sports car, limo, limousine, pickup, pickup truck, rocket sled, hoverboard
  `),
  attractor: list(`
    black hole, blackhole, sun, vortex, whirlpool, singularity, gravity well,
    attractor, tractor beam
  `),
  lantern: list(`
    lantern, lamp, candle, torch, lightbulb, light bulb, bulb, streetlight, street lamp, lamppost,
    flashlight, star, campfire light, nightlight, night light
  `),
  portal: list(`
    portal, wormhole, warp, warp gate, warp pad, gateway, gate, teleporter, teleport pad, rift,
    magic door, magic mirror, mirror, looking glass, doorway, stargate, hole in the world, tear,
    secret passage, tunnel
  `),
  solid: list(`
    ground, floor, wall, platform, block, brick, shelf, ledge, pavement, road, terrain, island,
    cliff, hill
  `),
  goal: list(`
    goal, finish, finish line, flag, exit, rabbit hole, home, win, trophy, destination
  `),
  hazard: list(`
    lava, magma, spike, fire, campfire, bonfire, flame, danger, acid, trap, poison, thorn, skull,
    floor is lava, lava floor
  `),
  spawn: list(`
    start, spawn, alice starts here, start here, start point, starting point, spawn point,
    respawn, checkpoint, beginning
  `),
};

export const NATURE_DESCRIPTIONS: WordTable = {
  bouncy: list("bouncy, bouncey, bouncing, springy, rubbery, jumpy, boingy, elastic, stretchy"),
  climbable: list("climbable, climby, climbing, scalable"),
  floaty: list("floaty, floating, hovering, airborne, rising, levitating"),
  heavy: list("heavy, weighty, dense, hefty, leaden"),
  light: list("light, lightweight, weightless, airy, feathery, flimsy"),
  slippery: list(`
    slippery, slippy, slick, icy, greasy, oily, soapy, buttery, frictionless, slidey, slimy,
    frozen, waxy
  `),
  sticky: list("sticky, gluey, gooey, tacky, stuck, glued, nailed, pinned, taped, gummy"),
  grow: list("eat me, eat, edible, yummy, tasty, delicious, grow, growing, growth"),
  shrink: list("drink me, drinkable, shrink, shrinking, shrinky, sip"),
  walker: list("walking, walks, walker, crawling, crawls, pacing, prowling, alive, living"),
  hopper: list("hopping, hops, hoppy, jumping, leaping, leaps, bounding"),
  flier: list("flying, flapping, flaps, flutters, fluttering, soaring, winged"),
  vehicle: list("drivable, driveable, rideable, ridable, wheeled, motorised, motorized, driving"),
  attractor: list("magnetic, attracting, attractive, pulling, gravitational"),
  lantern: list("glowing, glows, lit, shining, shines, luminous, radiant"),
  portal: list("teleporting, warping"),
  solid: list("solid, static, fixed, immovable, unmovable, rigid"),
  goal: [],
  hazard: list("deadly, dangerous, lethal, poisonous, spiky, burning"),
  spawn: [],
};

export const NEAR_ENOUGH_THINGS: Readonly<Partial<WordTable>> = {
  floaty: list(`
    helicopter, chopper, plane, airplane, aeroplane, aircraft, jet, rocket, drone, ufo, spaceship,
    space ship, spacecraft, flying saucer, flying machine, glider, hovercraft,
    elevator, lift, satellite
  `),
};

/** Creatures that carry their own light by name: a firefly glows without being told to. */
export const GLOWING_CREATURES = list("firefly, glowworm, glow worm, lightning bug");

export const TAG_WORDS = ["rose", "tart", "queen"] as const;
export type Tag = (typeof TAG_WORDS)[number];

export const BOOSTERS = list(`
  very, super, really, huge, giant, extra, extremely, mega, ultra, massive, enormous, gigantic,
  big, incredibly, mighty
`);

export const DAMPERS = list(`
  slightly, bit, little, tiny, weak, small, mini, barely, kinda, somewhat, gentle, mildly
`);

export const SPINNING_WORDS = list(`
  spinning, spins, spin, rotating, rotates, revolving, revolves, whirling, whirls, twirling, twirls,
  turning, wheel, wheels, gear, gears, cog, cogs, windmill, propeller, pinwheel, turbine, rotor
`);

export const WIDDERSHINS_WORDS = list("counterclockwise, anticlockwise, widdershins, backwards");

export const PROPELLED_WORDS = list(`
  accelerating, propelled, powered, motorised, motorized, thrusting, boosted, zooming, jetpack,
  thruster, thrusters
`);

export const FOLLOWING_WORDS = list(`
  follows, following, follow, followed, loyal, faithful, friendly, tame, obedient, devoted,
  clingy, trusty, heel, heels, sidekick, companion, guardian, bodyguard, escort, chases, chasing,
  haunts, haunting
`);

export const FLEEING_WORDS = list(`
  flees, fleeing, flee, runs away, run away, running away, shy, timid, scared, skittish, nervous,
  wild, cowardly, fearful, frightened, afraid, elusive, escaping, escapes, hides, hiding, evasive
`);

/** Creatures whose name alone says how they take to Alice. */
export const FOLLOWERS = list(`
  dog, puppy, kitten, pet, duck, duckling, cheshire cat, robot, knight, soldier, sidekick,
  companion, ghost, pony, gryphon, dodo, penguin, monkey, bodyguard
`);

export const FLEERS = list(`
  mouse, rat, hare, white rabbit, march hare, deer, gazelle, impala, springbok, squirrel,
  butterfly, moth, sparrow, pigeon, dove, seagull, gull, crab, lizard, chicken, hen, hedgehog,
  cockroach, grasshopper, cricket, flea, mosquito, fly, worm
`);

export const KEY_WORDS = list("key");

export const WEAPON_WORDS = list(`
  sword, knife, gun, pistol, rifle, shotgun, bomb, grenade, dynamite, tnt, axe, spear, dagger,
  cannon, weapon, blade, missile, laser, bullet, arrow, crossbow, flamethrower, kill, stab, shoot,
  hurt, attack, murder, punch, explode
`);

export const ALICE_NAMES = list("alice, her, she, herself, the girl");
export const ALICE_SUBJECTS = list("alice, she");
export const ALICE_REWRITE_VERBS = list("make, makes, let, lets, turn, turns, teach, change, help");
export const ALICE_ABILITIES = list(`
  can, could, should, will, must, jump, jumps, fly, flies, grow, grows, shrink, shrinks, float,
  floats, bounce, bounces
`);
export const ALICE_GADGETS = list(
  "jetpack, jetpacks, jet pack, jet packs, superpower, superpowers",
);

export const ROOM_VERBS = list(`
  make, remove, delete, open, unlock, move, break, destroy, erase, lower, raise, widen, smash,
  close, shrink, grow, enlarge, lift
`);
export const ROOM_NOUNS = list(`
  door, wall, floor, table, ledge, shelf, bookcase, ceiling, room, page, level, exit, ditch, gap,
  bank, river, ground
`);

export const DETERMINERS = list(`
  a, an, the, some, my, your, his, her, our, their, this, that, these, those, one, two, three,
  four, five, six, seven, eight, nine, ten, many, several, no, another, something, anything,
  nothing, everything
`);

export const PREPOSITIONS = list("of, to, for, with, in, on, from, under, over, at, by");

export const MASS_NOUNS = list(`
  ice, soap, butter, glue, tape, honey, jelly, bread, tea, water, paper, oil, grease, jam, syrup,
  gum, mud, slime, tar, medicine, food, toast, cheese, chocolate, milk, juice, coffee, wine, beer,
  soup, smoke, steam, fluff, dust, foam, cotton, confetti, ink, velcro, wax, gold, lead, iron,
  steel, metal, concrete, cement, helium, sap, resin, toffee, caramel, treacle, clay, putty, sand,
  snow, candy, pasta, hay, lint, pollen, silk, lard, margarine, marmalade, nutella, lava, magma,
  fire, acid, poison, danger, ground, terrain, pavement
`);

export const SELF_STANDING_ENDINGS = list("me, here");
