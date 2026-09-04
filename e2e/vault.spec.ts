import { expect, test } from "./harness/test";

test("a write through the vault fixture lands in the vault", async ({
  vault,
}) => {
  await vault.write("Chapter Thirteen.md", "# Chapter Thirteen\n");

  expect(await vault.notes()).toContain("Chapter Thirteen.md");
});

test("and the next spec opens on the vault as it is checked in", async ({
  vault,
}) => {
  expect(await vault.notes()).toEqual(["Chapter Twelve.md"]);
});
