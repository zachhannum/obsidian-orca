/**
 * The marks a note draws: the chip that names an attribute run, and
 * the rule a break command draws. One drawing serves both of a note's
 * views, so a chapter reads the same whichever it is open in.
 */

import type { Form, Names } from "@/book/marks";

/**
 * The chip's markup: the id, then each class in written order. A run
 * that names neither is one the engine read and cannot use, and it is
 * drawn as it was written.
 */
export function chipElement(names: Names, form: Form): HTMLElement {
  const chip = document.createElement("span");
  chip.className = "orca-run";
  chip.dataset["testid"] = "orca-run";
  chip.dataset["form"] = form;
  if (names.id === undefined && names.classes.length === 0) {
    chip.createEl("em").setText(names.said);
    return chip;
  }
  if (names.id !== undefined) chip.createEl("b").setText(`#${names.id}`);
  for (const found of names.classes) chip.createEl("i").setText(`.${found}`);
  return chip;
}

/**
 * The rule a break draws across the measure, named for the command it
 * was written as.
 */
export function breakElement(form: Form): HTMLElement {
  const rule = document.createElement("span");
  rule.className = "orca-break";
  rule.dataset["testid"] = "orca-break";
  rule.dataset["form"] = form;
  rule.createEl("i").setText(form === "pagebreak" ? "page break" : "column break");
  return rule;
}
