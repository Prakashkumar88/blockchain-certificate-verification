import { createHash } from "node:crypto";
import { Transform } from "node:stream";
import Busboy from "busboy";
import type { Request } from "express";
import { ApiError, fail } from "../errors.js";
import type { Config } from "../config/index.js";
export const sha256 = (bytes: Uint8Array) =>
  "0x" + createHash("sha256").update(bytes).digest("hex");
export class PdfHasher {
  private hash = createHash("sha256");
  private header = Buffer.alloc(0);
  private tail = "";
  private whitespace = false;
  size = 0;
  constructor(private maximum: number) {}
  update(bytes: Buffer) {
    this.size += bytes.length;
    if (this.size > this.maximum) fail(413, "PDF_TOO_LARGE");
    this.hash.update(bytes);
    if (this.header.length < 5)
      this.header = Buffer.concat([
        this.header,
        bytes.subarray(0, 5 - this.header.length),
      ]);
    const end =
      this.tail + (this.whitespace ? " " : "") + bytes.toString("latin1");
    let last = end.length;
    while (
      last > 0 &&
      [0, 9, 10, 12, 13, 32].includes(end.charCodeAt(last - 1))
    )
      last--;
    this.whitespace = last !== end.length;
    this.tail = end.slice(Math.max(0, last - 16), last);
  }
  finish() {
    if (
      !this.header.equals(Buffer.from("%PDF-")) ||
      !this.tail.endsWith("%%EOF")
    )
      fail(422, "PDF_STRUCTURE_INVALID");
    return { documentHash: "0x" + this.hash.digest("hex"), size: this.size };
  }
}
export class UploadService {
  private total = 0;
  private clients = new Map<string, number>();
  constructor(private config: Config) {}
  async read(
    req: Request,
    client: string,
    allowId = false,
  ): Promise<{ documentHash: string; size: number; certificateId?: string }> {
    if (
      this.total >= this.config.MAX_CONCURRENT_UPLOADS ||
      (this.clients.get(client) ?? 0) >= 2
    )
      fail(429, "UPLOAD_CONCURRENCY_LIMIT");
    const maximum = this.config.MAX_PDF_BYTES;
    const declared = Number(req.headers["content-length"]);
    if (declared > maximum + 65536) fail(413, "REQUEST_TOO_LARGE");
    this.total++;
    this.clients.set(client, (this.clients.get(client) ?? 0) + 1);
    try {
      return await new Promise((resolve, reject) => {
        let parser: ReturnType<typeof Busboy>;
        try {
          parser = Busboy({
            headers: req.headers,
            limits: {
              files: 1,
              fileSize: maximum + 1,
              fields: allowId ? 1 : 0,
              fieldSize: 256,
              parts: allowId ? 3 : 2,
              headerPairs: 32,
            },
          });
        } catch {
          reject(new ApiError(400, "MULTIPART_INVALID"));
          return;
        }
        let count = 0,
          bytes = 0,
          finished = false,
          result: { documentHash: string; size: number } | undefined,
          certificateId: string | undefined;
        const meter = new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            bytes += chunk.length;
            if (bytes > maximum + 65536)
              callback(new ApiError(413, "REQUEST_TOO_LARGE"));
            else callback(null, chunk);
          },
        });
        const cleanup = () => {
          clearTimeout(timer);
          req.off("aborted", abort);
          req.off("error", abort);
          req.unpipe(meter);
          meter.unpipe(parser);
        };
        const error = (e: unknown) => {
          if (finished) return;
          finished = true;
          cleanup();
          meter.destroy();
          queueMicrotask(() => parser.destroy());
          req.resume();
          reject(
            e instanceof ApiError ? e : new ApiError(400, "MULTIPART_INVALID"),
          );
        };
        const abort = () => error(new ApiError(400, "UPLOAD_ABORTED"));
        const timer = setTimeout(
          () => error(new ApiError(408, "UPLOAD_TIMEOUT")),
          this.config.REQUEST_TIMEOUT_MS,
        );
        req.once("aborted", abort);
        req.once("error", abort);
        meter.on("error", error);
        parser.on("error", error);
        parser.on("filesLimit", () =>
          error(new ApiError(400, "ONE_PDF_REQUIRED")),
        );
        parser.on("fieldsLimit", () =>
          error(new ApiError(400, "UNEXPECTED_FIELD")),
        );
        parser.on("partsLimit", () =>
          error(new ApiError(400, "UNEXPECTED_PART")),
        );
        parser.on("field", (name, value, info) => {
          if (
            name !== "certificateId" ||
            !allowId ||
            info.valueTruncated ||
            certificateId !== undefined
          )
            error(new ApiError(400, "UNEXPECTED_FIELD"));
          else certificateId = value;
        });
        parser.on("file", (name, file, info) => {
          count++;
          file.on("error", error);
          if (
            name !== "pdf" ||
            !info.filename ||
            info.filename.length > 255 ||
            !info.filename.toLowerCase().endsWith(".pdf") ||
            info.mimeType !== "application/pdf"
          ) {
            file.resume();
            error(new ApiError(415, "PDF_TYPE_REQUIRED"));
            return;
          }
          const hash = new PdfHasher(maximum);
          file.on("limit", () => error(new ApiError(413, "PDF_TOO_LARGE")));
          file.on("data", (chunk: Buffer) => {
            try {
              hash.update(chunk);
            } catch (e) {
              error(e);
            }
          });
          file.on("end", () => {
            if (finished) return;
            try {
              result = hash.finish();
            } catch (e) {
              error(e);
            }
          });
        });
        parser.on("close", () => {
          if (finished) return;
          if (count !== 1 || !result) {
            error(new ApiError(400, "ONE_PDF_REQUIRED"));
            return;
          }
          finished = true;
          cleanup();
          resolve({ ...result, certificateId });
        });
        req.pipe(meter).pipe(parser);
      });
    } finally {
      this.total--;
      const left = (this.clients.get(client) ?? 1) - 1;
      if (left === 0) this.clients.delete(client);
      else this.clients.set(client, left);
    }
  }
}
