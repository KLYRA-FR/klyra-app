/**
 * Types du module `node:sqlite` intégré à Node (Electron 44 : Node 24, SQLite 3.53).
 * `@types/node` 20 du dépôt ne le décrit pas : seul ce qu'utilise `electron/superagent/` est déclaré.
 * À retirer le jour où `@types/node` passe en 22 ou plus (il le déclare lui-même).
 */
declare module "node:sqlite" {
  type ValeurSqlite = null | number | bigint | string | Uint8Array;

  interface StatementSync {
    run(...parametres: ValeurSqlite[]): { changes: number | bigint; lastInsertRowid: number | bigint };
    get(...parametres: ValeurSqlite[]): Record<string, ValeurSqlite> | undefined;
    all(...parametres: ValeurSqlite[]): Record<string, ValeurSqlite>[];
  }

  class DatabaseSync {
    constructor(chemin: string, options?: { open?: boolean; readOnly?: boolean; enableForeignKeyConstraints?: boolean });
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
