import bcrypt from 'bcryptjs';
import { v4 as uuid } from 'uuid';
import { db, dayjs } from './db.js';

const insertUser = db.prepare(`
  INSERT INTO users (id, email, name, password_hash, role, created_at)
  VALUES (@id, @email, @name, @password_hash, @role, @created_at)
`);
const getUserByEmail = db.prepare(`SELECT * FROM users WHERE email = ?`);
const getUserById = db.prepare(`SELECT * FROM users WHERE id = ?`);

export async function register({ email, name, password, role = 'user' }) {
  const exists = getUserByEmail.get(email);
  if (exists) throw new Error('Email already registered');

  const password_hash = await bcrypt.hash(password, 10);
  const user = {
    id: uuid(),
    email, name, password_hash,
    role,
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
