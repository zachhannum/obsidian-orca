import assert from "node:assert/strict";
import { test } from "node:test";
import { addGroup, groups, moveGroup, readOrder, renameGroup, writeOrder } from "@/book/order";

const BODY = `
# Front matter

- \`title-page\`
- [[Copyright]] \`copyright\`
- [[A note on the text]] \`epigraph\`
- \`contents\`

# Body

- [[Volume the First]] \`part\`
- [[Chapter Twelve]]
- [[Chapter Four]]

# Back matter

- [[Acknowledgements]] \`back-matter\`

# The book's css

\`\`\`css
.chapter-opening h1 {
  letter-spacing: 0.02em;
}
\`\`\`
`;

test("probe", () => {
  let order = readOrder(BODY);
  order = addGroup(order, "New section");
  order = renameGroup(order, "Front matter", "Prelims");
  console.log("A:", groups(order).map((g) => g.heading));
  order = moveGroup(order, "Back matter", 0);
  console.log("B:", groups(order).map((g) => g.heading));
  order = moveGroup(order, "Back matter", 4);
  console.log("C:", groups(order).map((g) => g.heading));
  console.log(JSON.stringify(writeOrder(order)));
  assert.ok(true);
});

// What this tier does not cover: nothing; it is a scratch probe.
