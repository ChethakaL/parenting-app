declare module "pg" {
  export type QueryResult<Row = Record<string, unknown>> = {
    rowCount: number;
    rows: Row[];
  };

  export class PoolClient {
    query<Row = Record<string, unknown>>(text: string, values?: unknown[]): Promise<QueryResult<Row>>;
    release(destroy?: boolean): void;
  }

  export class Pool {
    constructor(config?: Record<string, unknown>);
    connect(): Promise<PoolClient>;
    on(event: "error", listener: (error: Error) => void): this;
  }
}
