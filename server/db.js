import Database from 'better-sqlite3';
import dayjs from 'dayjs';

const db = new Database('tickets.db');
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','agent','user')),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('open','in_progress','resolved','closed')) DEFAULT 'open',
  priority TEXT NOT NULL CHECK(priority IN ('low','medium','high','urgent')) DEFAULT 'medium',
  tags TEXT DEFAULT '',
  due_date TEXT,
  assignee_id TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (assignee_id) REFERENCES users(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (ticket_id) REFERENCES tickets(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
`);

export { db, dayjs };
