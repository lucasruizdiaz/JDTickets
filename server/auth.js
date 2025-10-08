import bcrypt from 'bcryptjs';
import { v4 as uuid } from 'uuid';
import { db, dayjs } from './db.js';

const insertUser = db.prepare(`
  INSERT INTO users (id, email, name, password_hash, role, avatar_url, area, created_at)
  VALUES (@id, @email, @name, @password_hash, @role, @avatar_url, @area, @created_at)
`);
const getUserByEmail = db.prepare(`SELECT * FROM users WHERE email = ?`);
const getUserById = db.prepare(`SELECT * FROM users WHERE id = ?`);
const listUsersStmt = db.prepare(`SELECT id, name, email, role, avatar_url, area FROM users ORDER BY name COLLATE NOCASE`);
const updateProfileStmt = db.prepare(`
  UPDATE users SET
    name = COALESCE(@name, name),
    role = COALESCE(@role, role),
    avatar_url = COALESCE(@avatar_url, avatar_url),
    area = COALESCE(@area, area)
  WHERE id = @id
`);
const updatePasswordStmt = db.prepare(`UPDATE users SET password_hash = @password_hash WHERE id = @id`);

export async function register({ email, name, password, role = 'user' }) {
  const exists = getUserByEmail.get(email);
  if (exists) throw new Error('Email already registered');

  const password_hash = await bcrypt.hash(password, 10);
  const user = {
    id: uuid(),
    email, name, password_hash,
    role,
    avatar_url: '',
    area: '',
    created_at: dayjs().toISOString()
  };
  insertUser.run(user);
  return user;
}

export async function login({ email, password }) {
  const user = getUserByEmail.get(email);
  if (!user) throw new Error('Invalid credentials');
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) throw new Error('Invalid credentials');
  return user;
}

export function me(userId) {
  return getUserById.get(userId);
}

export function listUsers() {
  return listUsersStmt.all();
}

const ROLES = new Set(['admin', 'agent', 'user']);

export function updateProfile(userId, { name, role, avatar_url, area }) {
  if (role && !ROLES.has(role)) throw new Error('Invalid role');
  updateProfileStmt.run({
    id: userId,
    name: name?.trim() || null,
    role: role || null,
    avatar_url: avatar_url?.trim() ?? null,
    area: area?.trim() ?? null
  });
  return me(userId);
}

export async function changePassword(userId, currentPassword, newPassword) {
  if (!newPassword || newPassword.length < 6) throw new Error('Password too short');
  const user = getUserById.get(userId);
  if (!user) throw new Error('User not found');
  const ok = await bcrypt.compare(currentPassword, user.password_hash);
  if (!ok) throw new Error('Current password incorrect');
  const password_hash = await bcrypt.hash(newPassword, 10);
  updatePasswordStmt.run({ id: userId, password_hash });
  return true;
}

// Express middlewares
export function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthenticated' });
  next();
}
export function requireRole(...roles) {
  return (req, res, next) => {
    const role = req.session.role;
    if (!role || !roles.includes(role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}
