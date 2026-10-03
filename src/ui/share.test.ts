import assert from "node:assert/strict";
import { test } from "node:test";
import { sharer } from "@/ui/share";

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
      return true;
    },
    share(data: ShareData): Promise<void> {
      handed.push(data);
      return end();
    },
  };
}

function bytes(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer;
}

test("a device that can share a file hands it over under its name, as a PDF", async () => {
  const host = fake();
  const share = sharer(host, PDF);
  assert.ok(share !== undefined);
  assert.equal(host.asked[0]?.files?.[0]?.type, PDF);

  assert.equal(await share({ name: "Pride and Prejudice.pdf", bytes: bytes("%PDF-1.7") }), "shared");
  const file = host.handed[0]?.files?.[0];
  assert.ok(file !== undefined);
  assert.equal(file.name, "Pride and Prejudice.pdf");
  assert.equal(file.type, PDF);
  assert.equal(await file.text(), "%PDF-1.7");
});

test("the share is asked of the web view before the call waits on anything", () => {
  const host = fake();
  void sharer(host, PDF)?.({ name: "Book.pdf", bytes: bytes("") });
  assert.equal(host.handed.length, 1);
});

test("a share the author cancels is no error", async () => {
  const host = fake(() =>
    Promise.reject(new DOMException("Abort due to cancellation of share.", "AbortError")),
  );
  assert.equal(await sharer(host, PDF)?.({ name: "Book.pdf", bytes: bytes("") }), "cancelled");
});

test("a share that fails throws what the web view said", async () => {
  const host = fake(() => Promise.reject(new DOMException("No.", "NotAllowedError")));
  await assert.rejects(
    async () => sharer(host, PDF)?.({ name: "Book.pdf", bytes: bytes("") }),
    { name: "NotAllowedError" },
  );
});

test("a device that cannot share a file has no share call", () => {
  assert.equal(sharer(undefined, PDF), undefined);
  assert.equal(sharer({}, PDF), undefined);
  assert.equal(sharer({ share: () => Promise.resolve() }, PDF), undefined);
  assert.equal(sharer({ ...fake(), canShare: () => false }, PDF), undefined);
  assert.equal(
    sharer(
      {
        ...fake(),
        canShare: () => {
          throw new TypeError("files");
        },
      },
      PDF,
    ),
    undefined,
  );
});

// What this suite does not cover: the web view's own `navigator.share`
// and the share sheet, which only a device has, and the dialog's Share
// button, which the e2e suite taps.
