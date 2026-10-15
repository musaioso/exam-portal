// Minimal type declarations for sql.js (the package ships no TS types).
// Keeps `tsc` happy without pulling @types/sql.js.
declare module "sql.js" {
  export interface Database {
    run(sql: string, params?: any[]): void;
    exec(sql: string): any[];
    prepare(sql: string): any;
    export(): Uint8Array;
    close(): void;
  }

  export interface SqlJsStatic {
    Database: new (data?: ArrayLike<number> | Buffer | null) => Database;
  }

  export default function initSqlJs(config?: any): Promise<SqlJsStatic>;
}

// Pure-JS build used on serverless (no .wasm binary required).
declare module "sql.js/dist/sql-asm.js";
