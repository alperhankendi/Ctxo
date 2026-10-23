import type { SqlToken } from './types.js';

/** ASCII-uppercased value of a word token, '' for any other token or none. */
export function keywordOf(token: SqlToken | undefined): string {
  if (token === undefined || token.kind !== 'word') return '';
  return token.value.replace(/[a-z]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 32));
}

/**
 * The T-SQL reserved keywords. Unquoted, they are never a table, procedure or column name,
 * and they end an alias position.
 */
export const RESERVED_WORDS: ReadonlySet<string> = new Set([
  'ADD', 'ALL', 'ALTER', 'AND', 'ANY', 'AS', 'ASC', 'AUTHORIZATION', 'BACKUP', 'BEGIN', 'BETWEEN',
  'BREAK', 'BROWSE', 'BULK', 'BY', 'CASCADE', 'CASE', 'CHECK', 'CHECKPOINT', 'CLOSE', 'CLUSTERED',
  'COALESCE', 'COLLATE', 'COLUMN', 'COMMIT', 'COMPUTE', 'CONSTRAINT', 'CONTAINS', 'CONTAINSTABLE',
  'CONTINUE', 'CONVERT', 'CREATE', 'CROSS', 'CURRENT', 'CURRENT_DATE', 'CURRENT_TIME',
  'CURRENT_TIMESTAMP', 'CURRENT_USER', 'CURSOR', 'DATABASE', 'DBCC', 'DEALLOCATE', 'DECLARE',
  'DEFAULT', 'DELETE', 'DENY', 'DESC', 'DISK', 'DISTINCT', 'DISTRIBUTED', 'DOUBLE', 'DROP', 'DUMP',
  'ELSE', 'END', 'ERRLVL', 'ESCAPE', 'EXCEPT', 'EXEC', 'EXECUTE', 'EXISTS', 'EXIT', 'EXTERNAL',
  'FETCH', 'FILE', 'FILLFACTOR', 'FOR', 'FOREIGN', 'FREETEXT', 'FREETEXTTABLE', 'FROM', 'FULL',
  'FUNCTION', 'GOTO', 'GRANT', 'GROUP', 'HAVING', 'HOLDLOCK', 'IDENTITY', 'IDENTITY_INSERT',
  'IDENTITYCOL', 'IF', 'IN', 'INDEX', 'INNER', 'INSERT', 'INTERSECT', 'INTO', 'IS', 'JOIN', 'KEY',
  'KILL', 'LEFT', 'LIKE', 'LINENO', 'LOAD', 'MERGE', 'NATIONAL', 'NOCHECK', 'NONCLUSTERED', 'NOT',
  'NULL', 'NULLIF', 'OF', 'OFF', 'OFFSETS', 'ON', 'OPEN', 'OPENDATASOURCE', 'OPENQUERY',
  'OPENROWSET', 'OPENXML', 'OPTION', 'OR', 'ORDER', 'OUTER', 'OVER', 'PERCENT', 'PIVOT', 'PLAN',
  'PRECISION', 'PRIMARY', 'PRINT', 'PROC', 'PROCEDURE', 'PUBLIC', 'RAISERROR', 'READ', 'READTEXT',
  'RECONFIGURE', 'REFERENCES', 'REPLICATION', 'RESTORE', 'RESTRICT', 'RETURN', 'REVERT', 'REVOKE',
  'RIGHT', 'ROLLBACK', 'ROWCOUNT', 'ROWGUIDCOL', 'RULE', 'SAVE', 'SCHEMA', 'SECURITYAUDIT', 'SELECT',
  'SEMANTICKEYPHRASETABLE', 'SEMANTICSIMILARITYDETAILSTABLE', 'SEMANTICSIMILARITYTABLE',
  'SESSION_USER', 'SET', 'SETUSER', 'SHUTDOWN', 'SOME', 'STATISTICS', 'SYSTEM_USER', 'TABLE',
  'TABLESAMPLE', 'TEXTSIZE', 'THEN', 'TO', 'TOP', 'TRAN', 'TRANSACTION', 'TRIGGER', 'TRUNCATE',
  'TRY_CONVERT', 'TSEQUAL', 'UNION', 'UNIQUE', 'UNPIVOT', 'UPDATE', 'UPDATETEXT', 'USE', 'USER',
  'VALUES', 'VARYING', 'VIEW', 'WAITFOR', 'WHEN', 'WHERE', 'WHILE', 'WITH', 'WITHIN', 'WRITETEXT',
]);

/**
 * Words that end an alias position: the reserved words plus clause words that are not reserved
 * but can follow a table name (`MERGE t USING`, `INNER HASH JOIN`, `OUTPUT`, `THROW`).
 */
export const ALIAS_END_WORDS: ReadonlySet<string> = new Set([
  ...RESERVED_WORDS,
  'APPLY', 'HASH', 'LOOP', 'OFFSET', 'OUTPUT', 'REMOTE', 'THROW', 'USING', 'WINDOW',
]);

/** A parenthesis after a table name that starts with one of these holds legacy table hints. */
export const TABLE_HINTS: ReadonlySet<string> = new Set([
  'NOLOCK', 'READUNCOMMITTED', 'UPDLOCK', 'HOLDLOCK', 'ROWLOCK', 'TABLOCK', 'TABLOCKX', 'PAGLOCK',
  'NOWAIT', 'READPAST', 'XLOCK', 'SERIALIZABLE', 'REPEATABLEREAD', 'READCOMMITTED', 'NOEXPAND',
  'INDEX', 'FORCESEEK', 'FORCESCAN',
]);

/**
 * INSERT, UPDATE and DELETE after these words are trigger actions, cursor options or MERGE actions.
 * ON is not here: it blocks only a foreign key action (see isForeignKeyAction), so the DML after
 * `SET NOCOUNT ON` without a semicolon stays DML.
 */
export const NOT_DML_AFTER: ReadonlySet<string> = new Set(['FOR', 'AFTER', 'OF', 'THEN']);

/** Words after `ON DELETE` or `ON UPDATE` in a foreign key action: CASCADE, NO ACTION, SET NULL, SET DEFAULT. */
const FOREIGN_KEY_ACTION_WORDS: ReadonlySet<string> = new Set(['CASCADE', 'NO', 'SET']);

/**
 * True for `ON DELETE | UPDATE` followed by CASCADE, NO or SET, given the keywords before, at and
 * after the word: a foreign key action, not DML.
 */
export function isForeignKeyAction(before: string, word: string, after: string): boolean {
  return before === 'ON' && (word === 'DELETE' || word === 'UPDATE') && FOREIGN_KEY_ACTION_WORDS.has(after);
}

/** Column-list elements starting with these are constraints, indexes or periods, not columns. */
export const NOT_COLUMN_WORDS: ReadonlySet<string> = new Set([
  'CONSTRAINT', 'PRIMARY', 'UNIQUE', 'FOREIGN', 'CHECK', 'INDEX', 'PERIOD',
]);

/**
 * Words that start a new statement (besides the DML, EXEC, TRUNCATE, FETCH and CTE forms the
 * recognizers handle themselves). SET, ELSE and END are absent: they also occur inside an
 * UPDATE (SET) and inside CASE expressions.
 */
export const STATEMENT_START_WORDS: ReadonlySet<string> = new Set([
  'SELECT', 'DECLARE', 'IF', 'WHILE', 'BEGIN', 'RETURN', 'PRINT', 'RAISERROR', 'THROW', 'CREATE',
  'ALTER', 'DROP', 'GOTO', 'WAITFOR', 'BREAK', 'CONTINUE', 'USE', 'COMMIT', 'ROLLBACK', 'SAVE',
  'OPEN', 'CLOSE', 'DEALLOCATE', 'GRANT', 'DENY', 'REVOKE', 'REVERT', 'KILL', 'DBCC', 'BACKUP',
  'RESTORE', 'CHECKPOINT', 'RECONFIGURE', 'SHUTDOWN', 'SETUSER', 'READTEXT', 'WRITETEXT',
  'UPDATETEXT',
]);

/** Clause words that end the comma list of a FROM clause. */
export const FROM_LIST_END_WORDS: ReadonlySet<string> = new Set([
  'WHERE', 'GROUP', 'HAVING', 'ORDER', 'UNION', 'EXCEPT', 'INTERSECT', 'OPTION', 'FOR', 'SET',
  'VALUES', 'OUTPUT', 'WHEN', 'THEN', 'ELSE', 'END', 'WINDOW',
]);
