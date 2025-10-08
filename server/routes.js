import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { db, dayjs } from './db.js';
import { register, login, me, listUsers, updateProfile, changePassword, requireAuth, requireRole } from './auth.js';
import { broadcast } from './sse.js';

const r = Router();

// Auth
r.post('/auth/register', async (req, res) => {
  try {
    const user = await register(req.body);
    res.json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        avatar_url: user.avatar_url,
        area: user.area
      }
    });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

r.post('/auth/login', async (req, res) => {
  try {
    const user = await login(req.body);
    req.session.userId = user.id;
    req.session.role = user.role;
    res.json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        avatar_url: user.avatar_url,
        area: user.area
      }
    });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

r.post('/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

r.get('/me', (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  const user = me(req.session.userId);
  res.json({
    user: user && {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      avatar_url: user.avatar_url,
      area: user.area
    }
  });
});

// Tickets
const insertTicket = db.prepare(`INSERT INTO tickets
(id, title, description, status, priority, tags, due_date, assignee_id, project_id, created_by, created_at, updated_at)
VALUES (@id,@title,@description,@status,@priority,@tags,@due_date,@assignee_id,@project_id,@created_by,@created_at,@updated_at)`);

const listTickets = db.prepare(`
SELECT t.*, u1.name as assignee_name, u2.name as created_by_name, p.name as project_name
FROM tickets t
LEFT JOIN users u1 ON u1.id = t.assignee_id
LEFT JOIN users u2 ON u2.id = t.created_by
LEFT JOIN projects p ON p.id = t.project_id
ORDER BY t.updated_at DESC
`);

const getTicket = db.prepare(`
SELECT t.*, u1.name as assignee_name, u2.name as created_by_name, p.name as project_name
FROM tickets t
LEFT JOIN users u1 ON u1.id = t.assignee_id
LEFT JOIN users u2 ON u2.id = t.created_by
LEFT JOIN projects p ON p.id = t.project_id
WHERE t.id = ?`);

const updateTicketStmt = db.prepare(`
UPDATE tickets SET
  title = COALESCE(@title, title),
  description = COALESCE(@description, description),
  status = COALESCE(@status, status),
  priority = COALESCE(@priority, priority),
  tags = COALESCE(@tags, tags),
  due_date = COALESCE(@due_date, due_date),
  assignee_id = COALESCE(@assignee_id, assignee_id),
  project_id = COALESCE(@project_id, project_id),
  updated_at = @updated_at
WHERE id = @id
`);

const insertComment = db.prepare(`
INSERT INTO comments (id, ticket_id, user_id, body, created_at)
VALUES (@id, @ticket_id, @user_id, @body, @created_at)
`);
const getComments = db.prepare(`
SELECT c.*, u.name as author_name
FROM comments c
JOIN users u ON u.id = c.user_id
WHERE c.ticket_id = ?
ORDER BY c.created_at ASC
`);

const listProjects = db.prepare(`SELECT id, name, description FROM projects ORDER BY name COLLATE NOCASE`);
const getProject = db.prepare(`SELECT id FROM projects WHERE id = ?`);
const getProjectDetails = db.prepare(`SELECT id, name, description FROM projects WHERE id = ?`);
const insertProjectStmt = db.prepare(`
INSERT INTO projects (id, name, description, created_at)
VALUES (@id, @name, @description, @created_at)
`);
const updateProjectDetailsStmt = db.prepare(`
UPDATE projects SET
  name = COALESCE(@name, name),
  description = COALESCE(@description, description)
WHERE id = @id
`);
const deleteProjectStmt = db.prepare(`DELETE FROM projects WHERE id = ?`);
const countTicketsForProject = db.prepare(`SELECT COUNT(*) AS count FROM tickets WHERE project_id = ?`);

r.get('/tickets', requireAuth, (req, res) => {
  res.json({ items: listTickets.all() });
});

r.get('/tickets/:id', requireAuth, (req, res) => {
  const t = getTicket.get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  const comments = getComments.all(t.id);
  res.json({ ticket: t, comments });
});

r.post('/tickets', requireAuth, (req, res) => {
  const now = dayjs().toISOString();
  const project_id = req.body.project_id ?? 'project-default';
  const project = getProject.get(project_id);
  if (!project) return res.status(400).json({ error: 'Invalid project' });
  const t = {
    id: uuid(),
    title: req.body.title?.trim() ?? 'Untitled',
    description: req.body.description ?? '',
    status: req.body.status ?? 'open',
    priority: req.body.priority ?? 'medium',
    tags: Array.isArray(req.body.tags) ? req.body.tags.join(',') : (req.body.tags ?? ''),
    due_date: req.body.due_date ?? null,
    assignee_id: req.body.assignee_id || null,
    project_id,
    created_by: req.session.userId,
    created_at: now,
    updated_at: now
  };
  insertTicket.run(t);
  const ticket = getTicket.get(t.id);
  broadcast('ticket:created', ticket);
  res.status(201).json({ ticket });
});

r.patch('/tickets/:id', requireAuth, (req, res) => {
  const now = dayjs().toISOString();
  let projectId = req.body.project_id;
  if (projectId === '') projectId = null;
  if (projectId) {
    const project = getProject.get(projectId);
    if (!project) return res.status(400).json({ error: 'Invalid project' });
  }
  if (req.body.assignee_id === '') req.body.assignee_id = null;
  const payload = {
    id: req.params.id,
    title: req.body.title ?? null,
    description: req.body.description ?? null,
    status: req.body.status ?? null,
    priority: req.body.priority ?? null,
    tags: req.body.tags ?? null,
    due_date: req.body.due_date ?? null,
    assignee_id: req.body.assignee_id ?? null,
    project_id: projectId ?? null,
    updated_at: now
  };
  const info = updateTicketStmt.run(payload);
  if (!info.changes) return res.status(404).json({ error: 'Not found' });
  const ticket = getTicket.get(req.params.id);
  broadcast('ticket:updated', ticket);
  res.json({ ticket });
});

r.post('/tickets/:id/comments', requireAuth, (req, res) => {
  const t = getTicket.get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  const c = {
    id: uuid(),
    ticket_id: t.id,
    user_id: req.session.userId,
    body: (req.body.body ?? '').trim(),
    created_at: dayjs().toISOString()
  };
  if (!c.body) return res.status(400).json({ error: 'Empty comment' });
  insertComment.run(c);
  const comments = getComments.all(t.id);
  broadcast('comment:created', { ticket_id: t.id });
  res.status(201).json({ comments });
});

// Agents & admins can reassign
r.post('/tickets/:id/assign/:userId', requireAuth, requireRole('agent','admin'), (req, res) => {
  const now = dayjs().toISOString();
  updateTicketStmt.run({ id: req.params.id, assignee_id: req.params.userId, updated_at: now });
  const ticket = getTicket.get(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Not found' });
  broadcast('ticket:updated', ticket);
  res.json({ ticket });
});

// Projects & users
r.get('/projects', requireAuth, (req, res) => {
  res.json({ items: listProjects.all() });
});

r.post('/projects', requireAuth, requireRole('admin','agent'), (req, res) => {
  const name = (req.body.name ?? '').trim();
  if (!name) return res.status(400).json({ error: 'Name is required' });
  const description = (req.body.description ?? '').trim();
  const project = {
    id: uuid(),
    name,
    description,
    created_at: dayjs().toISOString()
  };
  insertProjectStmt.run(project);
  res.status(201).json({ project: { id: project.id, name: project.name, description: project.description } });
});

r.patch('/projects/:id', requireAuth, requireRole('admin','agent'), (req, res) => {
  const project = getProjectDetails.get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Not found' });
  let nameParam = null;
  let descriptionParam = null;
  if (req.body.name !== undefined) {
    const name = (req.body.name ?? '').trim();
    if (!name) return res.status(400).json({ error: 'Name is required' });
    nameParam = name;
  }
  if (req.body.description !== undefined) {
    descriptionParam = (req.body.description ?? '').trim();
  }
  if (nameParam === null && descriptionParam === null) {
    return res.json({ project });
  }
  updateProjectDetailsStmt.run({
    id: req.params.id,
    name: nameParam,
    description: descriptionParam
  });
  const updated = getProjectDetails.get(req.params.id);
  res.json({ project: updated });
});

r.delete('/projects/:id', requireAuth, requireRole('admin','agent'), (req, res) => {
  const id = req.params.id;
  if (id === 'project-default') return res.status(400).json({ error: 'Default project cannot be removed' });
  const project = getProjectDetails.get(id);
  if (!project) return res.status(404).json({ error: 'Not found' });
  const info = countTicketsForProject.get(id);
  if (Number(info?.count ?? 0) > 0) return res.status(400).json({ error: 'Project has assigned tickets' });
  deleteProjectStmt.run(id);
  res.json({ ok: true });
});

r.get('/users', requireAuth, (req, res) => {
  res.json({ items: listUsers() });
});

r.patch('/users/me', requireAuth, (req, res) => {
  try {
    const user = updateProfile(req.session.userId, req.body ?? {});
    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        avatar_url: user.avatar_url,
        area: user.area
      }
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

r.post('/users/me/password', requireAuth, async (req, res) => {
  try {
    await changePassword(req.session.userId, req.body.currentPassword ?? '', req.body.newPassword ?? '');
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

export default r;
