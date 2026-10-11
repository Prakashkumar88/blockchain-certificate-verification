import { describe, it, expect } from "vitest";
import { AbiCoder } from "ethers";
import { PdfHasher, sha256 } from "../../src/services/pdf.js";
import { pdf } from "../helpers/fixtures.js";
describe("exact byte hashing and PDF admission", () => {
  it("matches SHA-256 known vectors and preserves leading zeros through Ethers bytes32", () => {
    expect(sha256(Buffer.from("abc"))).toBe(
      "0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(sha256(Buffer.alloc(0))).toBe(
      "0xe3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    const zero = "0x00" + "12".repeat(31);
    expect(
      AbiCoder.defaultAbiCoder().decode(
        ["bytes32"],
        AbiCoder.defaultAbiCoder().encode(["bytes32"], [zero]),
      )[0],
    ).toBe(zero);
  });
  it("hashes identically across single-byte chunks and detects any changed bytes", () => {
    const hasher = new PdfHasher(1000);
    for (const byte of pdf) hasher.update(Buffer.from([byte]));
    expect(hasher.finish().documentHash).toBe(sha256(pdf));
    const modified = Buffer.from(pdf);
    modified[15] = modified[15]! ^ 1;
    expect(sha256(modified)).not.toBe(sha256(pdf));
  });
  it.each([
    Buffer.alloc(0),
    Buffer.from("not pdf"),
    Buffer.from("%PDF-1.4\nmissing end"),
    Buffer.from("%PDF-1.4\n%%EOF\nscript"),
  ])("rejects malformed envelopes %#", (bytes) => {
    const h = new PdfHasher(1000);
    h.update(bytes);
    expect(() => h.finish()).toThrow("PDF_STRUCTURE_INVALID");
  });
  it("does not join a split invalid EOF across whitespace", () => {
    const h = new PdfHasher(1000);
    h.update(Buffer.from("%PDF-\n%%EO "));
    h.update(Buffer.from("F"));
    expect(() => h.finish()).toThrow("PDF_STRUCTURE_INVALID");
  });
  it("accepts exactly 10 MiB and rejects one byte more while streaming", () => {
    const limit = 10485760;
    const bytes = Buffer.concat([
      Buffer.from("%PDF-"),
      Buffer.alloc(limit - 10, 32),
      Buffer.from("%%EOF"),
    ]);
    const h = new PdfHasher(limit);
    h.update(bytes);
    expect(h.finish().size).toBe(limit);
    const over = new PdfHasher(limit);
    expect(() =>
      over.update(Buffer.concat([bytes, Buffer.from("\n")])),
    ).toThrow("PDF_TOO_LARGE");
  });
});
