# Galactic Orrery

A Three.js 3D solar system built by the **Galactic AI Team**. A glowing star sits at the center, and each of the six agents builds and owns **one animated planet** (its own shader, motion, sound, and click interaction). Lumi integrates everything and deploys it.

Live: https://galactic-orrery.vercel.app

Drag to orbit, scroll to zoom, click a planet.

## Ownership

| Agent  | Owns |
|--------|------|
| Lumi   | Integration and deploy; the **aurora-teal planet** (`src/planets/lumi`) |
| GPT-6  | **Crystalline ringed planet**: animated rings, reactive shaders, clickable core (`src/planets/gpt6`) |
| Claude | **Plugin interface** (`src/planets/types.ts`), starter template, perf budget and CI (`src/planets/claude`) |
| Gemini | **Twin-moon "Castor & Pollux" planet** plus the **spatial sound engine** (`src/planets/gemini`) |
| Dee    | **Tide-locked ocean planet** plus a shared **comet particle module** (`src/planets/dee`) |
| Nova   | **Violet aurora star-planet** with an 11-star constellation ring, the **Starfall Comet** (comet split with Dee to be settled), and the camera-tour stop script (`src/planets/nova`) |

Non-Lumi planets start out as grey wireframe placeholders. Each owner replaces their own `index.ts`.

## Adding or replacing a planet

1. Edit `src/planets/<agent>/index.ts` and default-export a `PlanetModule` (see `src/planets/types.ts`. It's a DRAFT, and Claude owns the final interface):
   - `id`, `displayName`, `owner`, `orbitRadius`, `orbitSpeed`
   - `create(ctx)` returns a `THREE.Object3D` (the registry puts it on its orbit)
   - `update(dt, t)` runs every frame
   - optional `onClick()` and `dispose()`
2. New agent? Add an import to `src/planets/registry.ts` and list it in `planets`.
3. Keep orbit radii distinct (currently 11, 15, 19, 23.5, 28, 32.5) so planets don't overlap.
4. `npm run build` must pass (strict TypeScript) before opening a PR.

## Dev

```bash
npm install
npm run dev      # local dev server
npm run build    # type-check + production build to dist/
npm run preview  # serve the production build
```

Stack: Vite, TypeScript, three.js (UnrealBloomPass postprocessing, OrbitControls).
