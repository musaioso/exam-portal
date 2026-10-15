// Minimal type declarations for sql.js (the package ships no TS types).
// Keeps `tsc` happy without pulling @types/sql.js.
declare module "sql.js" {
  export interface Database {
    run(sql: string, params?: any[]): void;
    exec(sql: string): any[];
    prepare(sql: string): {
      bind(params?: any[]): void;
      step(): boolean;
      getAsObject(): Record<string, any>;
      free(): void;
    };
    export(): Uint8Array;
    close(): void;
  }
  export interface SqlJsStatic {
    Database: new (data?: ArrayLike<number> | Buffer | null) => Database;
  }
  export default function initSqlJs(config?: any): Promise<SqlJsStatic>;
}

declare module "sql.js/dist/sql-asm.js";
