import { expect, test } from "./harness/test";

test("a spec that writes to the vault asks for it", async ({ vault }) => {
  await vault.write("Chapter Thirteen.md", "# Chapter Thirteen\n");

  expect(await vault.notes()).toContain("Chapter Thirteen.md");
});

test("and the next one opens on the vault as it is checked in", async ({
  vault,
}) => {
  expect(await vault.notes()).toEqual(["Chapter Twelve.md"]);
});
