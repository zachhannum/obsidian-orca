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
    { url: "device.png", link: "device.png" },
    { url: "plates/first plate.png", link: "plates/first plate.png" },
    { url: "plates/second%20plate.png", link: "plates/second plate.png" },
    { url: "plates/third plate.png", link: "plates/third plate.png" },
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

// What this tier does not cover: which of these urls the engine names,
// since the scan reads the text rather than parsing it. A url in a code
// fence is fetched and never asked for. The op planning tier is where
// the scan and a real run are held against each other.
