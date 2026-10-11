export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly contractError?: string,
  ) {
    super(code);
  }
}
export function fail(status: number, code: string): never {
  throw new ApiError(status, code);
}
export function chainError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  const code = (error as { code?: string })?.code;
  return new ApiError(
    503,
    [
      "CALL_EXCEPTION",
      "BAD_DATA",
      "BUFFER_OVERRUN",
      "INVALID_ARGUMENT",
    ].includes(code ?? "")
      ? "CONTRACT_CALL_FAILED"
      : "RPC_UNAVAILABLE",
  );
}
