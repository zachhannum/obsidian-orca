import assert from "node:assert/strict";
import { test } from "node:test";
import type { Setting } from "obsidian";
import { settingDefinitions, type Limited } from "@/ui/definitions";
import { LIMITS, type Limits } from "@/ui/limits";

/** A plugin that keeps the limits it is handed. */
function plugin(): Limited {
  const orca = {
    limits: LIMITS,
    limit(limits: Limits) {
      orca.limits = limits;
    },
  };
  return orca;
}

/**
 * A `Setting` row that takes any call and keeps the handler its
 * control is given, and whether the row was last disabled.
 */
function row(): { setting: Setting; changed: (value: unknown) => void; disabled: () => boolean } {
  let handler: ((value: unknown) => void) | undefined;
  let off = false;
  const chain: object = new Proxy(
    {},
    {
      get: (_, key) => (...args: unknown[]) => {
        const [first] = args;
        if (key === "onChange" && typeof first === "function") {
          handler = first as (value: unknown) => void;
        } else if (key === "setDisabled") {
          off = first === true;
        } else if (typeof first === "function" && String(key).startsWith("add")) {
          (first as (control: object) => void)(chain);
        }
        return chain;
      },
    },
  );
  return {
    setting: chain as Setting,
    changed: (value) => {
      assert.ok(handler, "the row's control took no handler");
      handler(value);
    },
    disabled: () => off,
  };
}

test("each of orca's settings has a definition settings search can find", () => {
  const definitions = settingDefinitions(plugin());
  assert.deepEqual(
    definitions.map((definition) => definition.name),
    [
      "Page measurements",
      "Headings in the navigator",
      "Heading levels in the navigator",
      "Max concurrent preview sessions",
    ],
  );
  for (const definition of definitions) assert.notEqual(definition.desc, "");
});

test("each definition's row writes the limit it names", () => {
  const orca = plugin();
  const [unit, headings, levels, sessions] = settingDefinitions(orca).map((definition) => {
    const drawn = row();
    definition.render(drawn.setting);
    return drawn;
  });
  unit?.changed("mm");
  headings?.changed(!LIMITS.headings);
  levels?.changed(LIMITS.deepest - 1);
  sessions?.changed(LIMITS.sessions + 1);
  assert.deepEqual(orca.limits, {
    ...LIMITS,
    unit: "mm",
    headings: !LIMITS.headings,
    deepest: LIMITS.deepest - 1,
    sessions: LIMITS.sessions + 1,
  });
});

test("the row that sets heading levels is disabled while headings are off", () => {
  const [, headings, levels] = settingDefinitions(plugin()).map((definition) => {
    const drawn = row();
    definition.render(drawn.setting);
    return drawn;
  });
  assert.equal(levels?.disabled(), true);
  headings?.changed(true);
  assert.equal(levels?.disabled(), false);
  headings?.changed(false);
  assert.equal(levels?.disabled(), true);
});

// What this tier does not cover: Obsidian drawing the rows from these
// definitions, the settings search that finds them on 1.13, and the
// `display` fallback on an older Obsidian, which all need the app.
