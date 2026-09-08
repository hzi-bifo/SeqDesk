declare module "tar-stream" {
  import { Readable, Writable } from "node:stream";
  interface Header { name: string; size: number; type: string; }
  interface Extract extends Writable {
    on(event: "entry", listener: (header: Header, stream: Readable, next: (error?: Error) => void) => void): this;
    on(event: string, listener: (...args: any[]) => void): this;
  }
  export function extract(): Extract;
  export function pack(): Readable & {
    entry(header: { name: string; type?: string; linkname?: string }, body: Buffer): void;
    finalize(): void;
  };
}
