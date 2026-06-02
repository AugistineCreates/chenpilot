declare module "ioredis" {
  interface Pipeline {
    get(key: string): Pipeline;
    ttl(key: string): Pipeline;
    exec(): Promise<Array<[Error | null, unknown]>>;
  }

  export default class Redis {
    constructor(options?: Record<string, unknown>);
    on(event: string, handler: (...args: unknown[]) => void): void;

    get(key: string): Promise<string | null>;
    set(
      key: string,
      value: string,
      mode: string,
      duration: number,
      nx: string
    ): Promise<string | null>;
    setex(key: string, seconds: number, value: string): Promise<"OK">;
    mget(...keys: string[]): Promise<(string | null)[]>;
    del(...keys: string[]): Promise<number>;
    exists(key: string): Promise<number>;
    ttl(key: string): Promise<number>;
    keys(pattern: string): Promise<string[]>;
    scan(
      cursor: string,
      type: string,
      pattern: string,
      count: string,
      countValue: number
    ): Promise<[string, string[]]>;
    eval(
      script: string,
      numKeys: number,
      ...args: (string | number)[]
    ): Promise<unknown>;
    info(section?: string): Promise<string>;
    ping(): Promise<string>;
    quit(): Promise<void>;
    pipeline(): Pipeline;
  }
}
