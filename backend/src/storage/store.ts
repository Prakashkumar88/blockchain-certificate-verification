import type { Intent, ChainEvent, TxResult } from "../services/chain.js";
export interface Session {
  key: string;
  deploymentId: string;
  wallet?: string;
  expiresAt: Date;
}
export interface Challenge {
  key: string;
  deploymentId: string;
  sessionKey: string;
  wallet: string;
  message: string;
  expiresAt: Date;
}
export interface Draft {
  key: string;
  deploymentId: string;
  owner: string;
  certificateId: string;
  documentHash: string;
  createdAt: Date;
  expiresAt: Date;
}
export interface Metadata {
  key: string;
  deploymentId: string;
  certificateId: string;
  issuer: string;
  documentHash: string;
  issuanceTransactionHash?: string;
  revocationTransactionHash?: string;
  displayLabel?: string;
  updatedAt: Date;
}
export interface Transaction {
  key: string;
  deploymentId: string;
  owner: string;
  intent: Intent;
  transactionHash: string;
  result: TxResult;
  updatedAt: Date;
}
export interface IndexedEvent extends ChainEvent {
  key: string;
  deploymentId: string;
}
export interface Checkpoint {
  key: string;
  deploymentId: string;
  blockNumber: number;
  blockHash: string;
}
export interface IssuerProfile {
  key: string;
  deploymentId: string;
  wallet: string;
  institutionName: string;
  updatedAt: Date;
}
export interface Documents {
  sessions: Session;
  challenges: Challenge;
  drafts: Draft;
  metadata: Metadata;
  transactions: Transaction;
  events: IndexedEvent;
  checkpoints: Checkpoint;
  profiles: IssuerProfile;
}
export type Table = keyof Documents;
// Filters are constructed exclusively by services, never passed through from request bodies.
export type Filter = Record<string, unknown>;
export interface Store {
  ready(): Promise<boolean>;
  insert<K extends Table>(table: K, doc: Documents[K]): Promise<void>;
  one<K extends Table>(table: K, filter: Filter): Promise<Documents[K] | null>;
  take<K extends Table>(table: K, filter: Filter): Promise<Documents[K] | null>;
  list<K extends Table>(
    table: K,
    filter: Filter,
    sort: Record<string, 1 | -1>,
    limit: number,
    skip?: number,
  ): Promise<Documents[K][]>;
  upsert<K extends Table>(
    table: K,
    filter: Filter,
    patch: Partial<Documents[K]>,
  ): Promise<void>;
  remove(table: Table, filter: Filter): Promise<void>;
}
