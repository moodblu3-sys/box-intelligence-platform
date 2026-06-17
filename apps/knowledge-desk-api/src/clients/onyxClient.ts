import type { OnyxQueryInput, OnyxQueryResult } from "../types.ts";

export interface OnyxClient {
  query(input: OnyxQueryInput): Promise<OnyxQueryResult>;
}
