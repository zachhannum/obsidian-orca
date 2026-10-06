// The loop opens on the book note beside the navigator, and a click on
// a chapter opens it, empty, for the writing that follows.
(function () {
  const O = window.O, E = O.E;
  const CLICK = 14.2;
  const CHAPTER = O.mid('notes', 'chapter');

  O.cursorTracks.push({
    a: 12.9, b: 15.2,
    frames: [[12.9, [760, 560]], [13.9, CHAPTER], [CLICK + 0.15, CHAPTER], [15.2, [CHAPTER[0] + 220, CHAPTER[1] + 160]]],
    clicks: [CLICK],
  });

  O.sections.push({
    b: O.T.notes,
    frames: ['notes', 'write-empty'],
    show(t) {
      const k = E.outQuad(O.prog(t, CLICK + 0.06, CLICK + 0.25));
      return { notes: k < 1 ? 1 : 0, 'write-empty': k };
    },
  });
})();
