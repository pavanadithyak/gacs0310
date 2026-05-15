import { jest } from '@jest/globals';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

const MIGRATIONS_DIR = join(process.cwd(), 'db', 'migrations');

function getMigrationPairs() {
  const files = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql'));
  const upFiles = files.filter(f => f.endsWith('_up.sql'));
  const pairs = [];

  for (const upFile of upFiles) {
    const downFile = upFile.replace('_up.sql', '_down.sql');
    pairs.push({
      number: upFile.split('_')[0],
      name: upFile.replace(/^\d+_/, '').replace('_up.sql', ''),
      up: upFile,
      down: downFile,
      upPath: join(MIGRATIONS_DIR, upFile),
      downPath: join(MIGRATIONS_DIR, downFile)
    });
  }

  return pairs.sort((a, b) => a.number.localeCompare(b.number));
}

function readSql(filePath) {
  return readFileSync(filePath, 'utf-8');
}

describe('Migration Reversibility Tests', () => {
  const pairs = getMigrationPairs();

  describe('SECTION 1: File Pairing', () => {
    it('1.1 All up migrations have corresponding down migrations', () => {
      for (const pair of pairs) {
        expect(existsSync(pair.downPath)).toBe(true);
      }
    });

    it('1.2 File naming follows NNN_description_up/down.sql pattern', () => {
      const nameRegex = /^\d{3}_[a-z_]+_(up|down)\.sql$/;
      const files = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql'));
      for (const file of files) {
        expect(file).toMatch(nameRegex);
      }
    });

    it('1.3 Migration numbers are sequential starting from 001', () => {
      const numbers = pairs.map(p => parseInt(p.number, 10));
      for (let i = 0; i < numbers.length; i++) {
        expect(numbers[i]).toBe(i + 1);
      }
    });
  });

  describe('SECTION 2: CREATE TABLE reversibility', () => {
    it('2.1 Each CREATE TABLE in up has DROP TABLE in down', () => {
      for (const pair of pairs) {
        const upSql = readSql(pair.upPath);
        const downSql = readSql(pair.downPath);

        const createMatches = upSql.match(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(\w+)/gi);
        if (createMatches) {
          for (const match of createMatches) {
            const tableName = match.match(/(\w+)$/i)[1];
            expect(downSql.toLowerCase()).toContain(`drop table`);
            expect(downSql.toLowerCase()).toContain(tableName.toLowerCase());
          }
        }
      }
    });

    it('2.2 DROP TABLE includes CASCADE for dependent objects', () => {
      for (const pair of pairs) {
        const upSql = readSql(pair.upPath);
        const downSql = readSql(pair.downPath);

        const createMatches = upSql.match(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(\w+)/gi);
        if (createMatches && !/FUNCTION|PROCEDURE/i.test(upSql)) {
          expect(downSql.toLowerCase()).toMatch(/drop table.*cascade/);
        }
      }
    });

    it('2.3 DROP TABLE uses IF EXISTS for safety', () => {
      for (const pair of pairs) {
        const upSql = readSql(pair.upPath);
        const downSql = readSql(pair.downPath);

        const createMatches = upSql.match(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(\w+)/gi);
        if (createMatches && !/FUNCTION|PROCEDURE/i.test(upSql)) {
          expect(downSql.toLowerCase()).toContain('drop table if exists');
        }
      }
    });
  });

  describe('SECTION 3: ALTER TABLE reversibility', () => {
    it('3.1 Each ADD COLUMN in up has DROP COLUMN in down', () => {
      for (const pair of pairs) {
        const upSql = readSql(pair.upPath);
        const downSql = readSql(pair.downPath);

        const addColumnMatches = upSql.match(/ALTER TABLE\s+\w+\s+ADD COLUMN\s+(\w+)/gi);
        if (addColumnMatches) {
          expect(downSql.toLowerCase()).toContain('drop column');
        }
      }
    });
  });

  describe('SECTION 4: Index reversibility', () => {
    it('4.1 Each CREATE INDEX in up has DROP INDEX in down or DROP TABLE CASCADE', () => {
      for (const pair of pairs) {
        const upSql = readSql(pair.upPath);
        const downSql = readSql(pair.downPath);

        const indexMatches = upSql.match(/CREATE INDEX\s+(?:IF NOT EXISTS\s+)?(\w+)\s+ON\s+(\w+)/gi);
        if (indexMatches) {
          const hasDropIndex = /drop index/i.test(downSql.toLowerCase());
          const hasDropTableCascade = /drop table.*cascade/i.test(downSql.toLowerCase());
          expect(hasDropIndex || hasDropTableCascade).toBe(true);
        }
      }
    });

    it('4.2 Standalone index migrations have explicit DROP INDEX', () => {
      for (const pair of pairs) {
        const upSql = readSql(pair.upPath);
        const downSql = readSql(pair.downPath);

        const hasCreateIndex = /CREATE INDEX/i.test(upSql);
        const hasCreateTable = /CREATE TABLE/i.test(upSql);

        if (hasCreateIndex && !hasCreateTable) {
          expect(downSql.toLowerCase()).toContain('drop index');
        }
      }
    });
  });

  describe('SECTION 5: FK reversibility', () => {
    it('5.1 Tables with FOREIGN KEY have CASCADE in DROP TABLE', () => {
      for (const pair of pairs) {
        const upSql = readSql(pair.upPath);
        const downSql = readSql(pair.downPath);

        const hasForeignKey = /REFERENCES\s+\w+/i.test(upSql);
        if (hasForeignKey && /CREATE TABLE/i.test(upSql)) {
          expect(downSql.toLowerCase()).toContain('cascade');
        }
      }
    });
  });

  describe('SECTION 6: Permissions reversibility', () => {
    it('6.1 GRANT statements handled by DROP TABLE CASCADE', () => {
      for (const pair of pairs) {
        const upSql = readSql(pair.upPath);
        const downSql = readSql(pair.downPath);

        const hasGrant = /GRANT\s+/i.test(upSql);
        const hasCreateTable = /CREATE TABLE/i.test(upSql);
        if (hasGrant && hasCreateTable) {
          const hasDropTable = /DROP TABLE.*CASCADE/i.test(downSql);
          expect(hasDropTable).toBe(true);
        }
      }
    });
  });

  describe('SECTION 7: Order of operations', () => {
    it('7.1 Down migrations drop indexes before tables', () => {
      for (const pair of pairs) {
        const downSql = readSql(pair.downPath);
        const upSql = readSql(pair.upPath);

        const hasIndex = /CREATE INDEX/i.test(upSql);
        const hasTable = /CREATE TABLE/i.test(upSql);

        if (hasIndex && hasTable) {
          const dropIndexPos = downSql.toLowerCase().indexOf('drop index');
          const dropTablePos = downSql.toLowerCase().indexOf('drop table');
          expect(dropIndexPos).toBeLessThan(dropTablePos);
        }
      }
    });

    it('7.2 Down migration files are not empty when up has changes', () => {
      for (const pair of pairs) {
        const upSql = readSql(pair.upPath);
        const downSql = readSql(pair.downPath);

        const hasChanges = /CREATE|ALTER|GRANT/i.test(upSql);
        if (hasChanges) {
          expect(downSql.trim().length).toBeGreaterThan(0);
        }
      }
    });
  });

  describe('SECTION 8: Specific migration checks', () => {
    it('8.1 did_sync_state migration is reversible', () => {
      const pair = pairs.find(p => p.name === 'create_did_sync_state');
      expect(pair).toBeDefined();
      const upSql = readSql(pair.upPath);
      const downSql = readSql(pair.downPath);
      expect(upSql).toContain('CREATE TABLE');
      expect(downSql).toContain('DROP TABLE');
      expect(downSql).toContain('CASCADE');
    });

    it('8.2 book_external_refs migration is reversible', () => {
      const pair = pairs.find(p => p.name === 'create_book_external_refs');
      expect(pair).toBeDefined();
      const upSql = readSql(pair.upPath);
      const downSql = readSql(pair.downPath);
      expect(upSql).toContain('CREATE TABLE');
      expect(downSql).toContain('DROP TABLE');
    });

    it('8.3 book_did_engagement migration is reversible', () => {
      const pair = pairs.find(p => p.name === 'create_book_did_engagement');
      expect(pair).toBeDefined();
      const upSql = readSql(pair.upPath);
      const downSql = readSql(pair.downPath);
      expect(upSql).toContain('CREATE TABLE');
      expect(downSql).toContain('DROP TABLE');
      expect(downSql).toContain('CASCADE');
    });

    it('8.4 book_did_engagement has UNIQUE constraint on book_id', () => {
      const pair = pairs.find(p => p.name === 'create_book_did_engagement');
      const upSql = readSql(pair.upPath);
      expect(upSql).toMatch(/UNIQUE.*book_id|book_id.*UNIQUE/i);
    });

    it('8.5 All FK columns use UUID type (not BIGINT)', () => {
      for (const pair of pairs) {
        const upSql = readSql(pair.upPath);
        const bookIdRefs = upSql.match(/^\s*book_id\s+(\w+)/gim);
        if (bookIdRefs) {
          for (const col of bookIdRefs) {
            const type = col.match(/book_id\s+(\w+)/i)[1];
            expect(type.toLowerCase()).toBe('uuid');
          }
        }
      }
    });
  });
});
