/**
 * Loading placeholder for the heart panel. The image is the model's own
 * silhouette, projected with the same camera, pose and normalisation as the scene
 * (see `scripts/heart/build-silhouette.mjs`), so the real render fades in over it
 * without anything moving or resizing.
 *
 * It is deliberately near-black — a shape that hints at what is coming without
 * competing with the live scene — and it is inert: no pointer events, no
 * accessibility node, no animation of its own.
 *
 * `h-[84.8%]` and `top-[49%]` are what the generator prints; re-run it after any
 * camera, pose or height change rather than adjusting them by hand.
 */
const SILHOUETTE_SRC = '/models/heart/silhouette.png';

export function HeartSilhouette({ visible }: { visible: boolean }) {
  return (
    <img
      src={SILHOUETTE_SRC}
      alt=""
      aria-hidden
      draggable={false}
      className={`pointer-events-none absolute left-1/2 top-[49%] h-[84.8%] w-auto -translate-x-1/2 -translate-y-1/2 select-none transition-opacity duration-700 ease-out motion-reduce:transition-none ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
    />
  );
}
