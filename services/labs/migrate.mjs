import { readFileSync } from 'node:fs';
export function migrate(db) {
 db.exec('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY,applied INTEGER NOT NULL)');
 if(!db.prepare('SELECT version FROM schema_migrations WHERE version=2').get()) {
  db.exec('BEGIN IMMEDIATE');
  try { db.exec(readFileSync(new URL('./migrations/002-profiles.sql',import.meta.url),'utf8'));db.prepare('INSERT INTO schema_migrations VALUES(2,?)').run(Date.now());db.exec('COMMIT'); }
  catch(e){db.exec('ROLLBACK');throw e;}
 }
}
