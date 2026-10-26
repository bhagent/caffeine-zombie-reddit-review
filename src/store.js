import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
export class Store {
  constructor(config) {
    const dir = path.join(config.artifacts, 'state');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path.join(dir, 'studio.db'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS drafts(id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tokens(platform TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ad_checks(provider TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY, at TEXT, kind TEXT, draft_id TEXT, detail TEXT);`);
    this.config = config;
  }
  close() { this.db.close(); }
  list() { return this.db.prepare('SELECT data FROM drafts ORDER BY rowid DESC').all().map(r => JSON.parse(r.data)); }
  get(id) { const r = this.db.prepare('SELECT data FROM drafts WHERE id=?').get(id); if (!r) throw new Error('Draft not found.'); return JSON.parse(r.data); }
  put(d) { this.db.prepare('INSERT OR REPLACE INTO drafts VALUES(?,?)').run(d.id, JSON.stringify(d)); return d; }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const r = fn(); this.db.exec('COMMIT'); return r; }
    catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  event(kind, id = '', detail = '') {
    // Callers pass fixed messages, IDs, or numeric status codes. Never pass provider bodies or tokens.
    this.db.prepare('INSERT INTO events(at,kind,draft_id,detail) VALUES(?,?,?,?)').run(new Date().toISOString(), kind, id, detail);
  }
  events() { return this.db.prepare('SELECT * FROM events ORDER BY id DESC LIMIT 100').all(); }
  key() {
    const raw = this.config.env.TOKEN_ENCRYPTION_KEY || '';
    const key = Buffer.from(raw, 'base64');
    if (key.length !== 32 || key.toString('base64') !== raw) throw new Error('Set a 32-byte base64 TOKEN_ENCRYPTION_KEY before OAuth.');
    return key;
  }
  saveToken(platform, token) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key(), iv);
    cipher.setAAD(Buffer.from(platform));
    const data = Buffer.concat([cipher.update(JSON.stringify(token)), cipher.final()]);
    this.db.prepare('INSERT OR REPLACE INTO tokens VALUES(?,?)').run(platform, JSON.stringify({ iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') }));
    this.event('oauth_connected', platform);
  }
  token(platform) {
    const r = this.db.prepare('SELECT data FROM tokens WHERE platform=?').get(platform);
    if (!r) return null;
    const box = JSON.parse(r.data);
    const decipher = createDecipheriv('aes-256-gcm', this.key(), Buffer.from(box.iv, 'base64'));
    decipher.setAAD(Buffer.from(platform));
    decipher.setAuthTag(Buffer.from(box.tag, 'base64'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(box.data, 'base64')), decipher.final()]).toString());
  }
  forget(platform) { this.db.prepare('DELETE FROM tokens WHERE platform=?').run(platform); this.event('oauth_disconnected', platform); }
}
