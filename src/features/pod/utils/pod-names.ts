// Generates memorable pod names like "swift-orca", "bold-reef", "calm-tide"
// Inspired by Docker's random name generator but ocean/orca themed

const ADJECTIVES = [
  'bold',
  'brave',
  'bright',
  'calm',
  'clear',
  'cool',
  'crisp',
  'dark',
  'deep',
  'fast',
  'fierce',
  'fleet',
  'fresh',
  'grand',
  'keen',
  'light',
  'live',
  'loud',
  'prime',
  'quick',
  'rapid',
  'sharp',
  'slick',
  'smooth',
  'sonic',
  'stark',
  'steady',
  'still',
  'strong',
  'sure',
  'swift',
  'tidal',
  'vast',
  'vivid',
  'warm',
  'wild',
  'wired',
  'zen',
]

const NOUNS = [
  'anchor',
  'arc',
  'bay',
  'beam',
  'bolt',
  'cape',
  'cove',
  'crest',
  'current',
  'dart',
  'dawn',
  'drift',
  'dune',
  'echo',
  'eddy',
  'flare',
  'floe',
  'flux',
  'foam',
  'gale',
  'gulf',
  'harbor',
  'isle',
  'jet',
  'kelp',
  'lagoon',
  'marsh',
  'mist',
  'narwhal',
  'nebula',
  'nova',
  'oasis',
  'orca',
  'pearl',
  'pier',
  'plume',
  'pulse',
  'quay',
  'reef',
  'ridge',
  'rift',
  'ripple',
  'rover',
  'sail',
  'seal',
  'shell',
  'shoal',
  'shore',
  'spark',
  'spray',
  'spur',
  'squid',
  'star',
  'stone',
  'storm',
  'strait',
  'stream',
  'surge',
  'swell',
  'tide',
  'trail',
  'trench',
  'tusk',
  'vale',
  'vault',
  'vortex',
  'wake',
  'wave',
  'wharf',
  'wind',
]

function pick<T>(arr: readonly T[]): T {
  const item = arr[Math.floor(Math.random() * arr.length)]
  if (item === undefined) throw new Error('pick called with empty array')
  return item
}

export function generatePodName(): string {
  return `${pick(ADJECTIVES)}-${pick(NOUNS)}`
}

/** Generate a name that doesn't collide with existing names */
export function generateUniquePodName(existingNames: string[]): string {
  const taken = new Set(existingNames)
  for (let i = 0; i < 50; i++) {
    const name = generatePodName()
    if (!taken.has(name)) return name
  }
  // Extremely unlikely fallback — append a digit
  return `${generatePodName()}-${Math.floor(Math.random() * 100)}`
}
