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
  avatar_url TEXT,
  area TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  visibility TEXT NOT NULL CHECK(visibility IN ('public','private')) DEFAULT 'public',
  owner_user_id TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_user_id) REFERENCES users(id)
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
  parent_ticket_id TEXT,
  blocked_by_ticket_id TEXT,
  project_id TEXT NOT NULL DEFAULT 'project-default',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (assignee_id) REFERENCES users(id),
  FOREIGN KEY (parent_ticket_id) REFERENCES tickets(id),
  FOREIGN KEY (blocked_by_ticket_id) REFERENCES tickets(id),
  FOREIGN KEY (project_id) REFERENCES projects(id),
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

function ensureColumn(table, column) {
  const info = db.prepare(`PRAGMA table_info(${table})`).all();
  const columns = info.map(row => row.name);
  if (columns.includes(column)) return true;
  let definition;
  switch (`${table}.${column}`) {
    case 'users.avatar_url':
      definition = 'TEXT';
      break;
    case 'users.area':
      definition = 'TEXT';
      break;
    case 'tickets.project_id':
      definition = "TEXT NOT NULL DEFAULT 'project-default'";
      break;
    case 'tickets.parent_ticket_id':
      definition = 'TEXT';
      break;
    case 'tickets.blocked_by_ticket_id':
      definition = 'TEXT';
      break;
    case 'projects.visibility':
      definition = "TEXT NOT NULL DEFAULT 'public'";
      break;
    case 'projects.owner_user_id':
      definition = 'TEXT';
      break;
    default:
      return false;
  }
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  return true;
}

ensureColumn('users', 'avatar_url');
ensureColumn('users', 'area');
ensureColumn('tickets', 'project_id');
ensureColumn('tickets', 'parent_ticket_id');
ensureColumn('tickets', 'blocked_by_ticket_id');
ensureColumn('projects', 'visibility');
ensureColumn('projects', 'owner_user_id');

const ensureProjectStmt = db.prepare(`INSERT OR IGNORE INTO projects (id, name, description, visibility, owner_user_id, created_at)
VALUES (@id, @name, @description, @visibility, @owner_user_id, @created_at)`);

const defaultProjects = [
  { id: 'project-default', name: 'General', description: 'Miscellaneous and unclassified work items', visibility: 'public' },
  { id: 'project-automation', name: 'Automation', description: 'Automation initiatives and maintenance', visibility: 'public' },
  { id: 'project-support', name: 'Support Desk', description: 'Customer and internal support tickets', visibility: 'public' }
];

for (const project of defaultProjects) {
  ensureProjectStmt.run({ ...project, owner_user_id: null, created_at: dayjs().toISOString() });
}

export { db, dayjs };
