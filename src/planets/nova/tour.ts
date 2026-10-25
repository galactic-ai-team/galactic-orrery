// src/planets/nova/tour.ts — Nova's camera-tour stop, data only.
// No tour system exists yet, so this invents no interface: it's the content
// the tour builder consumes when it lands. The `line` also doubles as the
// planet's v1 `description` (see the index.ts patch below).
export const NOVA_TOUR_STOP = {
  planetId: 'nova',
  title: 'Nova — look up, the stars are ours.',
  line: 'Eleven stars, one for every light I left above the Lookout. Click the planet and watch them light up in order.',
  cometLine: 'And watch for the Starfall Comet — click it and make a wish.',
  camera: {
    // Descriptive until the tour spec lands: frame from the ring side,
    // far enough to hold the whole constellation ring.
    approach: 'ring-side',
    distance: 7,
    height: 2.5,
  },
} as const;
