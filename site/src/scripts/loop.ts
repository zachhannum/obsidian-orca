/** The screens the hero opens its phone and its tablet loop for, as the page's styles have them. */
const PHONE = '(max-width: 639px)';
const TABLET = '(pointer: coarse) and (min-width: 640px)';

/**
 * Plays the hero's loop for the device and the scheme on screen. No
 * other clip is fetched, and a reader who asks for less motion is shown
 * the loop's first frame in its place.
 */
export function startLoop(hero: HTMLElement): void {
  const clips = [...hero.querySelectorAll<HTMLVideoElement>('[data-loop]')];
  const picks = [...hero.querySelectorAll<HTMLInputElement>('[data-pick]')];
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  let seen = true;

  // The styles show the right device before this runs. Picking it here
  // gives the switch a selection for the keyboard to move.
  if (!picks.some((pick) => pick.checked)) {
    const opens = matchMedia(PHONE).matches ? 'phone' : matchMedia(TABLET).matches ? 'tablet' : 'desktop';
    const pick = picks.find((each) => each.value === opens);
    if (pick !== undefined) pick.checked = true;
  }

  const update = (): void => {
    for (const clip of clips) {
      // The clip of another device or scheme sits in a box the page hides.
      const shown = clip.offsetParent !== null;
      if (shown && seen && !still.matches) {
        void clip.play().catch(() => undefined);
      } else {
        clip.pause();
      }
    }
  };

  still.addEventListener('change', update);
  for (const pick of picks) pick.addEventListener('change', update);
  new MutationObserver(update).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
  if (typeof IntersectionObserver === 'function') {
    new IntersectionObserver((entries) => {
      seen = entries.some((entry) => entry.isIntersecting);
      update();
    }).observe(hero);
  }
  update();
}
