import type { Config } from "../config/index.js";
import { chainError } from "../errors.js";
import type { Chain } from "./chain.js";
export class VerificationService {
  constructor(
    private config: Config,
    private chain: Chain,
  ) {}
  async verify(id: string, digest?: string) {
    const base = {
      certificateId: id,
      mode: digest ? "pdf" : "id",
      chainId: this.config.CHAIN_ID,
      contractAddress: this.config.manifest.contractAddress,
      deploymentId: this.config.manifest.deploymentId,
    };
    try {
      const s = await this.chain.inspect(id, digest);
      const context = {
        ...base,
        checkedBlock: {
          number: s.block.number,
          hash: s.block.hash,
          timestamp: s.block.timestamp,
        },
      };
      if (!s.exists)
        return {
          ...context,
          status: "UNKNOWN",
          documentMatch: null,
          confirmations: 0,
        };
      const confirmations = s.block.number - s.record.issuedBlock + 1;
      if (confirmations < 1)
        return {
          ...context,
          status: "UNAVAILABLE",
          reason: "CONTRACT_CALL_FAILED",
          documentMatch: null,
        };
      const documentMatch = digest ? s.record.documentHash === digest : null;
      const result = {
        ...context,
        record: s.record,
        documentMatch,
        confirmations,
      };
      if (s.record.revoked) return { ...result, status: "REVOKED" };
      if (confirmations < this.config.MIN_ISSUANCE_CONFIRMATIONS)
        return {
          ...result,
          status: "UNAVAILABLE",
          reason: "CONFIRMATION_PENDING",
          transactionStatus: "CONFIRMATION_PENDING",
        };
      return {
        ...result,
        status: documentMatch === false ? "MODIFIED" : "VALID",
      };
    } catch (error) {
      return {
        ...base,
        status: "UNAVAILABLE",
        reason: chainError(error).code,
        documentMatch: null,
      };
    }
  }
}
