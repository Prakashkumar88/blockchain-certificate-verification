import { it, expect } from "vitest";
import { PassThrough } from "node:stream";
import type { Request } from "express";
import { UploadService } from "../../src/services/pdf.js";
import { config, pdf } from "../helpers/fixtures.js";
function stream() {
  const req = new PassThrough() as PassThrough & {
    headers: Record<string, string>;
  };
  req.headers = {
    "content-type": "multipart/form-data; boundary=cert-boundary",
  };
  return req;
}
const prefix = Buffer.from(
  '--cert-boundary\r\nContent-Disposition: form-data; name="pdf"; filename="a.pdf"\r\nContent-Type: application/pdf\r\n\r\n',
);
const suffix = Buffer.from("\r\n--cert-boundary--\r\n");
it("enforces PDF size without Content-Length on a chunked upload", async () => {
  const c = config();
  c.MAX_PDF_BYTES = 64;
  const service = new UploadService(c),
    req = stream();
  const promise = service.read(req as unknown as Request, "ip");
  req.write(prefix);
  req.write(Buffer.from("%PDF-"));
  req.write(Buffer.alloc(65, 32));
  req.end(suffix);
  await expect(promise).rejects.toMatchObject({ status: 413 });
});
it("times out a stalled upload and frees the client slot", async () => {
  const c = config();
  c.REQUEST_TIMEOUT_MS = 10;
  const service = new UploadService(c),
    req = stream();
  const pending = service.read(req as unknown as Request, "ip");
  await expect(pending).rejects.toThrow("UPLOAD_TIMEOUT");
  const next = stream(),
    result = service.read(next as unknown as Request, "ip");
  next.end(Buffer.concat([prefix, pdf, suffix]));
  expect((await result).size).toBe(pdf.length);
});
it("caps global/client concurrency and releases all slots on disconnect", async () => {
  const c = config(),
    service = new UploadService(c),
    streams = [stream(), stream(), stream(), stream()];
  const promises = streams.map((s, i) =>
    service.read(s as unknown as Request, i < 2 ? "a" : "b"),
  );
  const checked = promises.map((p) =>
    expect(p).rejects.toThrow("UPLOAD_ABORTED"),
  );
  await expect(
    service.read(stream() as unknown as Request, "a"),
  ).rejects.toThrow("UPLOAD_CONCURRENCY_LIMIT");
  await expect(
    service.read(stream() as unknown as Request, "c"),
  ).rejects.toThrow("UPLOAD_CONCURRENCY_LIMIT");
  streams.forEach((s) => s.emit("aborted"));
  await Promise.all(checked);
  const next = stream(),
    result = service.read(next as unknown as Request, "c");
  next.end(Buffer.concat([prefix, pdf, suffix]));
  expect((await result).documentHash).toMatch(/^0x[0-9a-f]{64}$/);
});
