import assert from "node:assert/strict";
import { test } from "node:test";
import { imagesIn } from "@/book/images";

test("an embed is read as the url the engine names it by", () => {
  const found = imagesIn(
    [
      "# One",
      "",
      "![[device.png]]",
      "",
      "![[plates/first plate.png|300]]",
      "",
      "![a device](plates/second%20plate.png)",
      "",
      "![](<plates/third plate.png>)",
      "",
    ].join("\n"),
  );

  assert.deepEqual(found, [
    { url: "device.png", link: "device.png", line: 2 },
    { url: "plates/first plate.png", link: "plates/first plate.png", line: 4 },
    { url: "plates/second%20plate.png", link: "plates/second plate.png", line: 6 },
    { url: "plates/third plate.png", link: "plates/third plate.png", line: 8 },
  ]);
});

test("a url outside the vault is left out, and an embed named twice is read once", () => {
  const found = imagesIn(
    [
      "---",
      "cover: ![[properties are not the body.png]]",
      "---",
      "",
      "![[device.png]] and ![[device.png]] again",
      "",
      "![](https://example.com/remote.png)",
      "",
      "![](data:image/png;base64,AAAA)",
      "",
    ].join("\n"),
  );

  assert.deepEqual(
    found.map((embed) => embed.url),
    ["device.png"],
  );
});

test("an embed carries the line it is written on, frontmatter counted", () => {
  const found = imagesIn(
    [
      "---",
      "title: One",
      "---",
      "# One",
      "",
      "Text, then ![](plates/plate.png)",
      "![[device.png]]",
      "",
    ].join("\n"),
  );

  assert.deepEqual(
    found.map(({ url, line }) => ({ url, line })),
    [
      { url: "device.png", line: 6 },
      { url: "plates/plate.png", line: 5 },
    ],
  );
});

// What this tier does not cover: which of these urls the engine names,
// since the scan reads the text rather than parsing it. A url in a code
// fence is fetched and never asked for. The op planning tier is where
// the scan and a real run are held against each other.
