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
const updateUserAdminStmt = db.prepare(`
  UPDATE users SET
    email = @email,
    name = @name,
    role = @role,
    avatar_url = @avatar_url,
    area = @area
  WHERE id = @id
`);
const deleteUserStmt = db.prepare(`DELETE FROM users WHERE id = ?`);

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

function sanitizeUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    avatar_url: user.avatar_url,
    area: user.area
  };
}

function safeTrim(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

export async function adminCreateUser({ email, name, password, role = 'user', avatar_url = '', area = '' }) {
  const trimmedEmail = (email ?? '').trim().toLowerCase();
  if (!trimmedEmail) throw new Error('Email is required');
  if (!name || !name.trim()) throw new Error('Name is required');
  if (!password || password.length < 6) throw new Error('Password must be at least 6 characters');
  if (!ROLES.has(role)) throw new Error('Invalid role');
  const exists = getUserByEmail.get(trimmedEmail);
  if (exists) throw new Error('Email already registered');
  const password_hash = await bcrypt.hash(password, 10);
  const user = {
    id: uuid(),
    email: trimmedEmail,
    name: name.trim(),
    password_hash,
    role,
    avatar_url: safeTrim(avatar_url),
    area: safeTrim(area),
    created_at: dayjs().toISOString()
  };
  insertUser.run(user);
  return sanitizeUser(user);
}

export async function adminUpdateUser(id, { email, name, role, avatar_url, area, password }) {
  const user = getUserById.get(id);
  if (!user) throw new Error('User not found');

  let nextEmail = user.email;
  if (email !== undefined) {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) throw new Error('Email is required');
    if (trimmed !== user.email) {
      const exists = getUserByEmail.get(trimmed);
      if (exists && exists.id !== id) throw new Error('Email already registered');
    }
    nextEmail = trimmed;
  }

  let nextName = user.name;
  if (name !== undefined) {
    if (!name.trim()) throw new Error('Name is required');
    nextName = name.trim();
  }

  let nextRole = user.role;
  if (role !== undefined) {
    if (!ROLES.has(role)) throw new Error('Invalid role');
    nextRole = role;
  }

  const nextAvatar = avatar_url !== undefined ? safeTrim(avatar_url) : safeTrim(user.avatar_url);
  const nextArea = area !== undefined ? safeTrim(area) : safeTrim(user.area);

  updateUserAdminStmt.run({
    id,
    email: nextEmail,
    name: nextName,
    role: nextRole,
    avatar_url: nextAvatar,
    area: nextArea
  });

  if (password !== undefined && password !== '') {
    if (password.length < 6) throw new Error('Password must be at least 6 characters');
    const password_hash = await bcrypt.hash(password, 10);
    updatePasswordStmt.run({ id, password_hash });
  }

  const updated = getUserById.get(id);
  return sanitizeUser(updated);
}

export function adminDeleteUser(id) {
  const info = deleteUserStmt.run(id);
  if (!info.changes) throw new Error('User not found');
  return true;
}

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
