/**
 * Plays the hero's loop of the window in the scheme on screen, over
 * the picture it starts from. The other scheme's clip is never
 * fetched, and a reader who asks for less motion, or reads on a phone,
 * keeps the picture.
 */
export function startLoop(clips: HTMLVideoElement[]): void {
  const still = matchMedia('(prefers-reduced-motion: reduce), (max-width: 639px)');
  let seen = true;

  const update = (): void => {
    for (const clip of clips) {
      // The clip of the other scheme sits in a box the page hides.
      const shown = clip.offsetParent !== null;
      if (shown && seen && !still.matches) {
        void clip.play().catch(() => undefined);
      } else {
        clip.pause();
      }
    }
  };

  for (const clip of clips) {
    clip.addEventListener('playing', () => clip.classList.add('playing'));
  }
  still.addEventListener('change', update);
  new MutationObserver(update).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
  const hero = clips[0]?.closest('figure');
  if (hero !== null && hero !== undefined && typeof IntersectionObserver === 'function') {
    new IntersectionObserver((entries) => {
      seen = entries.some((entry) => entry.isIntersecting);
      update();
    }).observe(hero);
  }
  update();
}
