import assert from "node:assert/strict";
import { test } from "node:test";
import { sharer, type Shareable } from "@/ui/share";

const PDF = "application/pdf";

/** A `navigator` that shares files, and keeps what it was handed. */
function fake(end: () => Promise<void> = () => Promise.resolve()) {
  const handed: ShareData[] = [];
  const asked: ShareData[] = [];
  return {
    handed,
    asked,
    canShare(data: ShareData): boolean {
      asked.push(data);
      return data.files?.every((file) => file.type !== "text/x-refused") ?? false;
    },
    share(data: ShareData): Promise<void> {
      handed.push(data);
      return end();
    },
  };
}

function file(name: string, text = ""): Shareable {
  return { name, type: PDF, bytes: new TextEncoder().encode(text) };
}

test("a device that can share a file hands each one over under its name and type", async () => {
  const host = fake();
  const sheet = sharer(host);
  assert.ok(sheet !== undefined);

  const epub = { ...file("Pride and Prejudice.epub", "PK"), type: "application/epub+zip" };
  assert.equal(await sheet.share([file("Pride and Prejudice.pdf", "%PDF-1.7"), epub]), "shared");
  const files = host.handed[0]?.files ?? [];
  assert.deepEqual(
    files.map(({ name, type }) => ({ name, type })),
    [
      { name: "Pride and Prejudice.pdf", type: PDF },
      { name: "Pride and Prejudice.epub", type: "application/epub+zip" },
    ],
  );
  assert.equal(await files[0]?.text(), "%PDF-1.7");
  assert.equal(await files[1]?.text(), "PK");
});

test("the share is asked of the web view before the call waits on anything", () => {
  const host = fake();
  void sharer(host)?.share([file("Book.pdf")]);
  assert.equal(host.handed.length, 1);
});

test("a share the author cancels is no error", async () => {
  const host = fake(() =>
    Promise.reject(new DOMException("Abort due to cancellation of share.", "AbortError")),
  );
  assert.equal(await sharer(host)?.share([file("Book.pdf")]), "cancelled");
});

test("a share the web view will not start without a tap is refused, and is no error", async () => {
  const host = fake(() => Promise.reject(new DOMException("No.", "NotAllowedError")));
  assert.equal(await sharer(host)?.share([file("Book.pdf")]), "refused");
});

test("a share that fails throws what the web view said", async () => {
  const host = fake(() => Promise.reject(new DOMException("No.", "DataError")));
  await assert.rejects(async () => sharer(host)?.share([file("Book.pdf")]), {
    name: "DataError",
  });
});

test("a device takes the media types its web view says it shares", () => {
  const sheet = sharer(fake());
  assert.equal(sheet?.takes(PDF), true);
  assert.equal(sheet?.takes("text/x-refused"), false);
  const throwing = sharer({
    ...fake(),
    canShare: () => {
      throw new TypeError("files");
    },
  });
  assert.equal(throwing?.takes(PDF), false);
});

test("a device with no share call for files has no sharer", () => {
  assert.equal(sharer(undefined), undefined);
  assert.equal(sharer({}), undefined);
  assert.equal(sharer({ share: () => Promise.resolve() }), undefined);
});

// What this suite does not cover: the web view's own `navigator.share`
// and the share sheet, which only a device has; how long a tap stays
// good for a share on a device; and the dialog's Share button, which
// the e2e suite taps.
