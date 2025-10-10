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
(id, title, description, status, priority, tags, due_date, assignee_id, parent_ticket_id, blocked_by_ticket_id, project_id, created_by, created_at, updated_at)
VALUES (@id,@title,@description,@status,@priority,@tags,@due_date,@assignee_id,@parent_ticket_id,@blocked_by_ticket_id,@project_id,@created_by,@created_at,@updated_at)`);

const listTickets = db.prepare(`
SELECT
  t.*,
  u1.name AS assignee_name,
  u2.name AS created_by_name,
  p.name AS project_name,
  pt.title AS parent_title,
  pt.status AS parent_status,
  bt.title AS blocked_by_title,
  bt.status AS blocked_by_status
FROM tickets t
LEFT JOIN users u1 ON u1.id = t.assignee_id
LEFT JOIN users u2 ON u2.id = t.created_by
LEFT JOIN projects p ON p.id = t.project_id
LEFT JOIN tickets pt ON pt.id = t.parent_ticket_id
LEFT JOIN tickets bt ON bt.id = t.blocked_by_ticket_id
ORDER BY t.updated_at DESC
`);

const getTicket = db.prepare(`
SELECT
  t.*,
  u1.name AS assignee_name,
  u2.name AS created_by_name,
  p.name AS project_name,
  pt.title AS parent_title,
  pt.status AS parent_status,
  bt.title AS blocked_by_title,
  bt.status AS blocked_by_status
FROM tickets t
LEFT JOIN users u1 ON u1.id = t.assignee_id
LEFT JOIN users u2 ON u2.id = t.created_by
LEFT JOIN projects p ON p.id = t.project_id
LEFT JOIN tickets pt ON pt.id = t.parent_ticket_id
LEFT JOIN tickets bt ON bt.id = t.blocked_by_ticket_id
WHERE t.id = ?`);

const getTicketMeta = db.prepare(`
SELECT id, status, parent_ticket_id, blocked_by_ticket_id, project_id
FROM tickets
WHERE id = ?
`);

function updateTicketRecord(id, fields = {}) {
  const entries = Object.entries(fields).filter(([, value]) => value !== undefined);
  if (!entries.length) return { changes: 0 };
  const assignments = entries.map(([key]) => `${key} = @${key}`);
  const stmt = db.prepare(`
    UPDATE tickets
    SET ${assignments.join(', ')}, updated_at = @updated_at
    WHERE id = @id
  `);
  const params = Object.fromEntries(entries);
  params.id = id;
  params.updated_at = dayjs().toISOString();
  return stmt.run(params);
}

function wouldCreateParentCycle(ticketId, proposedParentId) {
  let current = proposedParentId;
  while (current) {
    if (current === ticketId) return true;
    const next = getTicketMeta.get(current);
    if (!next) break;
    current = next.parent_ticket_id;
  }
  return false;
}

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
  let parentId = req.body.parent_ticket_id ?? null;
  if (parentId === '') parentId = null;
  let blockedById = req.body.blocked_by_ticket_id ?? null;
  if (blockedById === '') blockedById = null;

  const parentTicket = parentId ? getTicketMeta.get(parentId) : null;
  if (parentId && !parentTicket) {
    return res.status(400).json({ error: 'Parent ticket not found' });
  }

  const blockingTicket = blockedById ? getTicketMeta.get(blockedById) : null;
  if (blockedById && !blockingTicket) {
    return res.status(400).json({ error: 'Blocking ticket not found' });
  }

  let project_id = req.body.project_id ?? parentTicket?.project_id ?? 'project-default';
  if (project_id === '') project_id = null;
  const project = project_id ? getProject.get(project_id) : null;
  if (!project) return res.status(400).json({ error: 'Invalid project' });
  if (parentTicket && parentTicket.project_id !== project_id) {
    return res.status(400).json({ error: 'Parent ticket belongs to a different project' });
  }

  if (blockedById && blockedById === parentId) {
    return res.status(400).json({ error: 'Blocking ticket cannot be the parent ticket' });
  }

  const t = {
    id: uuid(),
    title: req.body.title?.trim() ?? 'Untitled',
    description: req.body.description ?? '',
    status: req.body.status ?? 'open',
    priority: req.body.priority ?? 'medium',
    tags: Array.isArray(req.body.tags) ? req.body.tags.join(',') : (req.body.tags ?? ''),
    due_date: req.body.due_date ?? null,
    assignee_id: req.body.assignee_id === '' ? null : (req.body.assignee_id ?? null),
    parent_ticket_id: parentId,
    blocked_by_ticket_id: blockedById,
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
  const ticketId = req.params.id;
  const existingMeta = getTicketMeta.get(ticketId);
  if (!existingMeta) return res.status(404).json({ error: 'Not found' });

  const body = req.body ?? {};
  const updates = {};

  let finalParentId = existingMeta.parent_ticket_id;
  let parentMeta = finalParentId ? getTicketMeta.get(finalParentId) : null;

  let finalBlockedById = existingMeta.blocked_by_ticket_id;
  let blockedMeta = finalBlockedById ? getTicketMeta.get(finalBlockedById) : null;

  let finalProjectId = existingMeta.project_id;

  if (body.title !== undefined) {
    const title = (body.title ?? '').trim();
    if (!title) return res.status(400).json({ error: 'Title is required' });
    updates.title = title;
  }

  if (body.description !== undefined) {
    updates.description = body.description ?? '';
  }

  if (body.status !== undefined) {
    const allowedStatuses = new Set(['open', 'in_progress', 'resolved', 'closed']);
    if (!allowedStatuses.has(body.status)) {
      return res.status(400).json({ error: 'Invalid status value' });
    }
    updates.status = body.status;
  }

  if (body.priority !== undefined) {
    const allowedPriorities = new Set(['low', 'medium', 'high', 'urgent']);
    if (!allowedPriorities.has(body.priority)) {
      return res.status(400).json({ error: 'Invalid priority value' });
    }
    updates.priority = body.priority;
  }

  if (body.tags !== undefined) {
    updates.tags = Array.isArray(body.tags) ? body.tags.join(',') : (body.tags ?? '');
  }

  if (body.due_date !== undefined) {
    updates.due_date = body.due_date === '' ? null : (body.due_date ?? null);
  }

  if (body.assignee_id !== undefined) {
    updates.assignee_id = body.assignee_id === '' ? null : body.assignee_id;
  }

  if (body.parent_ticket_id !== undefined) {
    let newParentId = body.parent_ticket_id;
    if (newParentId === '' || newParentId === null) {
      finalParentId = null;
      parentMeta = null;
      updates.parent_ticket_id = null;
    } else {
      if (newParentId === ticketId) return res.status(400).json({ error: 'Ticket cannot be its own parent' });
      if (wouldCreateParentCycle(ticketId, newParentId)) {
        return res.status(400).json({ error: 'Parent assignment would create a cycle' });
      }
      const newParent = getTicketMeta.get(newParentId);
      if (!newParent) return res.status(400).json({ error: 'Parent ticket not found' });
      finalParentId = newParentId;
      parentMeta = newParent;
      updates.parent_ticket_id = newParentId;
    }
  }

  if (body.blocked_by_ticket_id !== undefined) {
    let newBlockedId = body.blocked_by_ticket_id;
    if (newBlockedId === '' || newBlockedId === null) {
      finalBlockedById = null;
      blockedMeta = null;
      updates.blocked_by_ticket_id = null;
    } else {
      if (newBlockedId === ticketId) return res.status(400).json({ error: 'Ticket cannot be blocked by itself' });
      const newBlocking = getTicketMeta.get(newBlockedId);
      if (!newBlocking) return res.status(400).json({ error: 'Blocking ticket not found' });
      finalBlockedById = newBlockedId;
      blockedMeta = newBlocking;
      updates.blocked_by_ticket_id = newBlockedId;
    }
  }

  if (finalParentId && finalBlockedById && finalParentId === finalBlockedById) {
    return res.status(400).json({ error: 'Blocking ticket cannot be the parent ticket' });
  }

  if (body.project_id !== undefined) {
    const newProjectId = body.project_id;
    if (!newProjectId) return res.status(400).json({ error: 'Invalid project' });
    const project = getProject.get(newProjectId);
    if (!project) return res.status(400).json({ error: 'Invalid project' });
    finalProjectId = newProjectId;
    updates.project_id = newProjectId;
  }

  if (parentMeta && parentMeta.project_id !== finalProjectId) {
    return res.status(400).json({ error: 'Parent ticket belongs to a different project' });
  }

  const finalStatus = updates.status ?? existingMeta.status;
  const blockingTicket = finalBlockedById ? (blockedMeta ?? getTicketMeta.get(finalBlockedById)) : null;
  if (['resolved', 'closed'].includes(finalStatus) && finalBlockedById) {
    if (!blockingTicket) return res.status(400).json({ error: 'Blocking ticket not found' });
    if (!['resolved', 'closed'].includes(blockingTicket.status)) {
      return res.status(400).json({ error: 'Blocking ticket must be resolved or closed first' });
    }
  }

  if (!Object.keys(updates).length) {
    const ticket = getTicket.get(ticketId);
    if (!ticket) return res.status(404).json({ error: 'Not found' });
    return res.json({ ticket });
  }

  const info = updateTicketRecord(ticketId, updates);
  if (!info.changes) return res.status(404).json({ error: 'Not found' });

  const ticket = getTicket.get(ticketId);
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
  const info = updateTicketRecord(req.params.id, { assignee_id: req.params.userId });
  if (!info.changes) return res.status(404).json({ error: 'Not found' });
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
