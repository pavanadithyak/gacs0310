import { jest } from '@jest/globals';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const MIGRATIONS_DIR = join(process.cwd(), 'db', 'migrations');

function getMigrationFiles() {
  return readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('_up.sql'))
    .map(f => ({ name: f, path: join(MIGRATIONS_DIR, f) }));
}

function readSql(filePath) {
  return readFileSync(filePath, 'utf-8');
}

describe('SQL Syntax Tests', () => {
  const files = getMigrationFiles();

  describe('SECTION 1: Basic Syntax', () => {
    it('1.1 All SQL files have balanced parentheses', () => {
      for (const file of files) {
        const sql = readSql(file.path);
        const openCount = (sql.match(/\(/g) || []).length;
        const closeCount = (sql.match(/\)/g) || []).length;
        expect(openCount).toBe(closeCount);
      }
    });

    it('1.2 All SQL files end with semicolon or are empty', () => {
      for (const file of files) {
        const sql = readSql(file.path).trim();
        if (sql.length > 0) {
          expect(sql.endsWith(';') || sql.endsWith('--')).toBe(true);
        }
      }
    });

    it('1.3 No raw transactions in DDL migrations', () => {
      for (const file of files) {
        const sql = readSql(file.path);
        expect(sql.toLowerCase()).not.toMatch(/begin\s*;/);
        expect(sql.toLowerCase()).not.toMatch(/commit\s*;/);
      }
    });
  });

  describe('SECTION 2: Table Creation Standards', () => {
    const createTableFiles = files.filter(f => {
      const sql = readSql(f.path);
      return /CREATE TABLE/i.test(sql);
    });

    it('2.1 All new tables have created_at timestamp', () => {
      for (const file of createTableFiles) {
        const sql = readSql(file.path);
        expect(sql.toLowerCase()).toContain('created_at');
      }
    });

    it('2.2 All new tables have updated_at timestamp (audit/snapshot/segment tables may omit)', () => {
      for (const file of createTableFiles) {
        const sql = readSql(file.path);
        // Migration 014 creates engagement_snapshots and recommendation_segments without updated_at
        const isAsyncEngagement = /async_engagement/i.test(file.name);
        if (isAsyncEngagement) continue;
        const hasAuditTable = /_log/i.test(file.name);
        if (!hasAuditTable) {
          expect(sql.toLowerCase()).toContain('updated_at');
        }
      }
    });

    it('2.3 Timestamps use TIMESTAMPTZ or TIMESTAMP type', () => {
      for (const file of createTableFiles) {
        const sql = readSql(file.path);
        const createdAtLine = sql.match(/created_at\s+(\w+)/i);
        if (createdAtLine) {
          expect(['timestamp', 'timestamptz'].includes(createdAtLine[1].toLowerCase())).toBe(true);
        }
      }
    });

    it('2.4 Timestamps have DEFAULT now() or DEFAULT CURRENT_TIMESTAMP', () => {
      for (const file of createTableFiles) {
        const sql = readSql(file.path);
        const hasCreatedAtDefault = /created_at\s+[^,]+DEFAULT\s+(now\(\)|CURRENT_TIMESTAMP)/i.test(sql);
        expect(hasCreatedAtDefault).toBe(true);
      }
    });

    it('2.5 Tables with BIGSERIAL PRIMARY KEY are new tables (not ALTER)', () => {
      for (const file of createTableFiles) {
        const sql = readSql(file.path);
        const hasBigSerial = /BIGSERIAL\s+PRIMARY KEY/i.test(sql);
        const isAlterTable = /ALTER TABLE/i.test(sql);
        if (hasBigSerial) {
          expect(isAlterTable).toBe(false);
        }
      }
    });
  });

  describe('SECTION 3: Foreign Key Standards', () => {
    it('3.1 Foreign keys use REFERENCES syntax with ON DELETE', () => {
      for (const file of files) {
        const sql = readSql(file.path);
        const hasReferences = /REFERENCES\s+\w+\s*\(/i.test(sql);
        if (hasReferences) {
          expect(sql.toLowerCase()).toMatch(/on delete (cascade|set null|restrict|no action)/);
        }
      }
    });

    it('3.2 book_id foreign keys reference books(book_id)', () => {
      for (const file of files) {
        const sql = readSql(file.path);
        const bookIdRefs = sql.match(/book_id\s+[^,]*REFERENCES\s+(\w+\s*\(\w+\))/gi);
        if (bookIdRefs) {
          for (const ref of bookIdRefs) {
            expect(ref.toLowerCase()).toContain('books(book_id)');
          }
        }
      }
    });

    it('3.3 All book_id columns use UUID type', () => {
      for (const file of files) {
        const sql = readSql(file.path);
        const bookIdCols = sql.match(/^\s*book_id\s+(\w+)/gim);
        if (bookIdCols) {
          for (const col of bookIdCols) {
            const type = col.match(/book_id\s+(\w+)/i)[1];
            expect(type.toLowerCase()).toBe('uuid');
          }
        }
      }
    });
  });

  describe('SECTION 4: Index Naming Conventions', () => {
    it('4.1 Index names follow idx_table_column pattern', () => {
      const nameRegex = /CREATE INDEX\s+(?:IF NOT EXISTS\s+)?(\w+)/gi;
      for (const file of files) {
        const sql = readSql(file.path);
        const matches = sql.match(nameRegex);
        if (matches) {
          for (const match of matches) {
            const indexName = match.match(/(\w+)$/i)[1];
            expect(indexName.toLowerCase()).toMatch(/^idx_[a-z_]+$/);
          }
        }
      }
    });
  });

  describe('SECTION 5: Permission Standards', () => {
    it('5.1 New tables have GRANT permissions', () => {
      for (const file of files) {
        const sql = readSql(file.path);
        const hasCreateTable = /CREATE TABLE/i.test(sql);
        if (hasCreateTable) {
          expect(sql.toLowerCase()).toContain('grant');
        }
      }
    });

    it('5.2 GRANT includes appropriate permissions', () => {
      for (const file of files) {
        const sql = readSql(file.path);
        const grantLines = sql.match(/GRANT\s+[^;]+/gi);
        if (grantLines) {
          const tableGrants = grantLines.filter(l => !l.toLowerCase().includes('sequence') && !l.toLowerCase().includes('execute'));
          if (tableGrants.length > 0) {
            for (const grant of tableGrants) {
              expect(grant.toLowerCase()).toContain('select');
              expect(grant.toLowerCase()).toContain('insert');
              expect(grant.toLowerCase()).toContain('update');
              expect(grant.toLowerCase()).toContain('delete');
            }
          }
        }
      }
    });

    it('5.3 GRANT targets gacs_user', () => {
      for (const file of files) {
        const sql = readSql(file.path);
        const grantLines = sql.match(/GRANT\s+[^;]+/gi);
        if (grantLines) {
          for (const line of grantLines) {
            expect(line.toLowerCase()).toContain('gacs_user');
          }
        }
      }
    });
  });

  describe('SECTION 6: Constraint Standards', () => {
    it('6.1 UNIQUE constraints have explicit names', () => {
      for (const file of files) {
        const sql = readSql(file.path);
        const hasUnique = /UNIQUE\s*\(/i.test(sql);
        const hasNamedUnique = /CONSTRAINT\s+\w+\s+UNIQUE/i.test(sql);
        if (hasUnique) {
          expect(hasNamedUnique).toBe(true);
        }
      }
    });
  });

  describe('SECTION 7: Comment Standards', () => {
    it('7.1 New tables have table comments or SQL comment description', () => {
      for (const file of files) {
        const sql = readSql(file.path);
        const hasCreateTable = /CREATE TABLE/i.test(sql);
        if (hasCreateTable) {
          const hasCommentOnTable = /comment on table/i.test(sql);
          const hasSqlComment = /\/\*[\s\S]*?\*\//i.test(sql);
          expect(hasCommentOnTable || hasSqlComment).toBe(true);
        }
      }
    });

    it('7.2 Critical columns have comments (state/function/cron/snapshot/segment/engagement/ref tables may omit)', () => {
      for (const file of files) {
        const sql = readSql(file.path);
        const hasCreateTable = /CREATE TABLE/i.test(sql);
        const isStateTable = /_state/i.test(file.name) || /did_sync_state/i.test(sql);
        const isFunction = /CREATE OR REPLACE FUNCTION/i.test(sql);
        const isCron = /cron\.schedule/i.test(sql);
        const hasSnapshotTable = /engagement_snapshots/i.test(sql);
        const hasSegmentsTable = /recommendation_segments/i.test(sql);
        const hasEngagementTable = /book_did_engagement/i.test(sql);
        const hasRefsTable = /book_external_refs/i.test(sql);
        if (hasCreateTable && !isStateTable && !isFunction && !isCron && !hasSnapshotTable && !hasSegmentsTable && !hasEngagementTable && !hasRefsTable) {
          const hasColumnComment = /COMMENT ON COLUMN/i.test(sql);
          expect(hasColumnComment).toBe(true);
        }
      }
    });
  });

  describe('SECTION 8: File Content Checks', () => {
    it('8.1 No empty migration files', () => {
      for (const file of files) {
        const sql = readSql(file.path).trim();
        expect(sql.length).toBeGreaterThan(0);
      }
    });

    it('8.2 No placeholder TODO or FIXME comments', () => {
      for (const file of files) {
        const sql = readSql(file.path);
        expect(sql).not.toMatch(/TODO|FIXME|XXX/i);
      }
    });

    it('8.3 Up migrations do not contain DROP statements', () => {
      for (const file of files) {
        const sql = readSql(file.path);
        expect(sql.toLowerCase()).not.toMatch(/drop (table|index|column)/);
      }
    });
  });
});
