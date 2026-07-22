export interface RuntimeFetcher {
  fetch(request: Request): Promise<Response>;
}

export interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  run(): Promise<unknown>;
  all<T = unknown>(): Promise<{ results?: T[] }>;
  first<T = unknown>(): Promise<T | null>;
}

export interface D1DatabaseLike {
  prepare(sql: string): D1PreparedStatementLike;
  batch(statements: D1PreparedStatementLike[]): Promise<unknown>;
}

export interface R2ObjectLike {
  body: BodyInit | null;
  httpEtag?: string;
  json<T = unknown>(): Promise<T>;
}

export interface R2BucketLike {
  put(key: string, value: unknown, options?: unknown): Promise<unknown>;
  get(key: string): Promise<R2ObjectLike | null>;
  delete(keys: string | string[]): Promise<unknown>;
}
