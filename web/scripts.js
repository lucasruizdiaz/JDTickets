const VIEW_STORAGE_KEY = 'jdtickets:view-mode';
const THEME_STORAGE_KEY = 'jdtickets:theme';

const state = {
  user: null,
  tickets: [],
  projects: [],
  users: [],
  profileOpen: false,
  selectedTicketId: null,
  projectEditorId: null,
  projectManagerVisible: false,
  theme: (() => {
    try {
      const saved = localStorage.getItem(THEME_STORAGE_KEY);
      if (saved === 'light' || saved === 'dark') return saved;
    } catch (_) {}
    return 'dark';
  })(),
  createTicketVisible: false,
  viewMode: (() => {
    try {
      const saved = localStorage.getItem(VIEW_STORAGE_KEY);
      if (saved === 'rows' || saved === 'columns') return saved;
    } catch (_) {}
    return 'columns';
  })()
};

// Simple fetch wrapper with credentials
async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

// UI helpers
function $(id) {
  return document.getElementById(id);
}

function setMessage(id, message, type) {
  const el = $(id);
  if (!el) return;
  el.textContent = message || '';
  el.classList.remove('text-success', 'text-error');
  if (type === 'success') el.classList.add('text-success');
  if (type === 'error') el.classList.add('text-error');
}

function formatStatusLabel(status = '') {
  return status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function ticketOptionLabel(ticket) {
  const status = formatStatusLabel(ticket.status ?? '');
  const shortId = ticket.id ? ticket.id.slice(0, 8) : '';
  return `${ticket.title} (#${shortId}) • ${status}`;
}

function getTicketById(id) {
  if (!id) return null;
  return state.tickets.find(ticket => ticket.id === id) || null;
}

function collectDescendantIds(ticketId, acc = new Set()) {
  for (const ticket of state.tickets) {
    if (ticket.parent_ticket_id === ticketId && !acc.has(ticket.id)) {
      acc.add(ticket.id);
      collectDescendantIds(ticket.id, acc);
    }
  }
  return acc;
}

function userCanManageProjects() {
  return !!(state.user && (state.user.role === 'admin' || state.user.role === 'agent'));
}

function updateProjectManagerButton() {
  const btn = $('toggleProjectManagerBtn');
  if (!btn) return;
  if (!userCanManageProjects()) {
    btn.style.display = 'none';
    btn.setAttribute('aria-pressed', 'false');
    return;
  }
  btn.style.display = 'inline-flex';
  const label = state.projectManagerVisible ? 'Hide Projects' : 'Edit Projects';
  btn.textContent = label;
  btn.setAttribute('aria-pressed', state.projectManagerVisible ? 'true' : 'false');
}

function updateThemeToggleUI() {
  const btn = $('themeToggleBtn');
  if (!btn) return;
  const nextLabel = state.theme === 'dark' ? 'Light Mode' : 'Dark Mode';
  btn.textContent = nextLabel;
  btn.setAttribute('aria-pressed', state.theme === 'light' ? 'true' : 'false');
}

function applyTheme() {
  const theme = state.theme === 'light' ? 'light' : 'dark';
  document.body.dataset.theme = theme;
  try { localStorage.setItem(THEME_STORAGE_KEY, theme); } catch (_) {}
  updateThemeToggleUI();
}

function toggleTheme() {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  applyTheme();
}

function updateCreateTicketUI() {
  const card = $('createTicketCard');
  const btn = $('toggleCreateBtn');
  const loggedIn = !!state.user;
  if (!loggedIn) state.createTicketVisible = false;
  const visible = loggedIn && state.createTicketVisible;
  if (card) card.style.display = visible ? 'block' : 'none';
  if (btn) {
    btn.style.display = loggedIn ? 'inline-flex' : 'none';
    btn.setAttribute('aria-expanded', visible ? 'true' : 'false');
    btn.textContent = visible ? 'Close Form' : 'Create Ticket';
  }
  if (visible) {
    populateCreateTicketRelationships();
  }
}

function toggleCreateTicket() {
  if (!state.user) return;
  state.createTicketVisible = !state.createTicketVisible;
  updateCreateTicketUI();
  if (state.createTicketVisible) {
    const titleInput = $('tTitle');
    if (titleInput) {
      titleInput.focus();
      if (titleInput.select) titleInput.select();
    }
    populateCreateTicketRelationships();
  }
}

function populateCreateTicketRelationships() {
  const parentSelect = $('tParent');
  const blockingSelect = $('tBlocking');
  if (!parentSelect && !blockingSelect) return;
  const projectSelect = $('tProject');
  const projectId = projectSelect ? projectSelect.value : '';
  const parentValue = parentSelect ? parentSelect.value : '';
  const blockingValue = blockingSelect ? blockingSelect.value : '';
  const ticketsSorted = [...state.tickets].sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));

  if (parentSelect) {
    const eligibleParents = ticketsSorted.filter(ticket => {
      if (!projectId) return true;
      return ticket.project_id === projectId;
    });
    const options = ['<option value="">No parent</option>']
      .concat(eligibleParents.map(ticket => `<option value="${ticket.id}">${escapeHtml(ticketOptionLabel(ticket))}</option>`));
    parentSelect.innerHTML = options.join('');
    if (parentValue && eligibleParents.some(ticket => ticket.id === parentValue)) {
      parentSelect.value = parentValue;
    } else {
      parentSelect.value = '';
    }
  }

  if (blockingSelect) {
    const parentSelection = parentSelect ? parentSelect.value : '';
    const eligibleBlocking = ticketsSorted.filter(ticket => ticket.id !== parentSelection);
    const options = ['<option value="">No blocking dependency</option>']
      .concat(eligibleBlocking.map(ticket => `<option value="${ticket.id}">${escapeHtml(ticketOptionLabel(ticket))}</option>`));
    blockingSelect.innerHTML = options.join('');
    if (blockingValue && eligibleBlocking.some(ticket => ticket.id === blockingValue)) {
      blockingSelect.value = blockingValue;
    } else {
      blockingSelect.value = '';
    }
  }
}

function handleCreateParentChange() {
  const parentSelect = $('tParent');
  const projectSelect = $('tProject');
  const blockingSelect = $('tBlocking');
  if (!parentSelect || !projectSelect) return;
  const parentId = parentSelect.value;
  if (!parentId) {
    populateCreateTicketRelationships();
    return;
  }
  const parentTicket = getTicketById(parentId);
  if (parentTicket) {
    projectSelect.value = parentTicket.project_id ?? '';
    if (blockingSelect && blockingSelect.value === parentId) {
      blockingSelect.value = '';
    }
  }
  populateCreateTicketRelationships();
}

function handleCreateProjectChange() {
  const projectSelect = $('tProject');
  const parentSelect = $('tParent');
  if (!projectSelect || !parentSelect) return;
  const projectId = projectSelect.value;
  const parentId = parentSelect.value;
  if (parentId) {
    const parentTicket = getTicketById(parentId);
    if (!parentTicket || parentTicket.project_id !== projectId) {
      parentSelect.value = '';
    }
  }
  populateCreateTicketRelationships();
}

function toggleProjectManager() {
  if (!userCanManageProjects()) return;
  state.projectManagerVisible = !state.projectManagerVisible;
  if (!state.projectManagerVisible) {
    state.projectEditorId = null;
  }
  renderProjectManager();
  updateProjectManagerButton();
  if (state.projectManagerVisible) {
    const host = $('projectManager');
    if (host && host.scrollIntoView) {
      host.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }
}

function showLogin() {
  $('loginView').style.display = 'block';
  $('appView').style.display = 'none';
  state.createTicketVisible = false;
  updateCreateTicketUI();
}

function showApp() {
  $('loginView').style.display = 'none';
  $('appView').style.display = 'block';
}

function setUserArea() {
  const el = $('userArea');
  if (!el) return;
  if (!state.user) {
    state.profileOpen = false;
    el.innerHTML = `<button class="btn" onclick="showLogin()">Login</button>`;
  } else {
    const initialSource = state.user.name?.trim() || state.user.email || '?';
    const initial = initialSource ? initialSource[0].toUpperCase() : '?';
    const area = state.user.area ? ` • ${state.user.area}` : '';
    const avatar = state.user.avatar_url
      ? `<img src="${state.user.avatar_url}" alt="Profile" class="avatar-image">`
      : `<span class="avatar-initial">${initial}</span>`;
    const expanded = state.profileOpen ? 'true' : 'false';
    const activeClass = state.profileOpen ? ' avatar-button-active' : '';
    el.innerHTML = `
      <div class="user-shell">
        <button class="avatar-button${activeClass}" onclick="toggleProfile(event)" aria-label="Open profile options" aria-expanded="${expanded}">
          ${avatar}
        </button>
        <div class="user-info">
          <div class="user-name">${state.user.name}</div>
          <div class="user-meta">${state.user.role}${area}</div>
        </div>
        <button class="btn btn-compact logout-btn" onclick="logout()">Logout</button>
      </div>
    `;
  }
  updateCreateTicketUI();
  updateProjectManagerButton();
}

function populateProfileForm() {
  const popover = $('profilePopover');
  const card = $('profileCard');
  if (!popover || !card) return;
  if (!state.user) {
    state.profileOpen = false;
    popover.style.display = 'none';
    return;
  }
  popover.style.display = state.profileOpen ? 'block' : 'none';
  $('profileName').value = state.user.name ?? '';
  $('profileRole').value = state.user.role ?? 'user';
  $('profileArea').value = state.user.area ?? '';
  $('profileAvatar').value = state.user.avatar_url ?? '';
  $('profileCurrentPassword').value = '';
  $('profileNewPassword').value = '';
  setMessage('profileMsg', '');
  setMessage('passwordMsg', '');
}

async function boot() {
  try {
    const { user } = await api('/me');
    if (user) {
      await handleAuthenticated(user);
    } else {
      showLogin();
    }
  } catch {
    showLogin();
  }
}
applyTheme();
boot();

async function handleAuthenticated(user) {
  state.user = user;
  state.profileOpen = false;
  state.createTicketVisible = false;
  state.projectManagerVisible = false;
  setUserArea();
  populateProfileForm();
  renderProjectManager();
  $('loginMsg').textContent = '';
  showApp();
  try {
    await loadInitialData();
  } catch (e) {
    console.error('Failed to load initial data', e);
    alert(`Failed to load data: ${e.message}`);
  }
  startSSE();
}

// Auth
async function doLogin() {
  const email = $('loginEmail').value.trim();
  const password = $('loginPassword').value;
  try {
    const { user } = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
    await handleAuthenticated(user);
  } catch (e) {
    $('loginMsg').textContent = e.message;
  }
}

async function doRegister() {
  const email = $('loginEmail').value.trim();
  const password = $('loginPassword').value;
  const name = email.split('@')[0] || 'User';
  try {
    await api('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, name })
    });
    await doLogin();
  } catch (e) {
    $('loginMsg').textContent = e.message;
  }
}

async function logout() {
  await api('/auth/logout', { method: 'POST' });
  if (es) {
    es.close();
    es = null;
  }
  state.user = null;
  state.tickets = [];
  state.projects = [];
  state.users = [];
  state.profileOpen = false;
  state.selectedTicketId = null;
  state.projectEditorId = null;
  state.createTicketVisible = false;
  state.projectManagerVisible = false;
  closeProfile();
  setUserArea();
  populateProfileForm();
  $('dashboard').innerHTML = '';
  $('list').innerHTML = '';
  $('dashboardSection').style.display = 'none';
  $('projectManager').style.display = 'none';
  $('list').style.display = 'none';
  showLogin();
}

async function loadInitialData() {
  await Promise.all([loadProjects(), loadUsers(), loadTickets()]);
}

// Data fetchers
async function loadProjects() {
  const { items } = await api('/projects');
  state.projects = items;
  if (state.projectEditorId && !state.projects.some(p => p.id === state.projectEditorId)) {
    state.projectEditorId = null;
  }
  populateProjectSelect();
  renderDashboard();
  renderTickets();
  renderProjectManager();
}

async function loadUsers() {
  const { items } = await api('/users');
  state.users = items;
  populateAssigneeSelect();
  renderTickets();
}

async function loadTickets() {
  const data = await api('/tickets');
  state.tickets = data.items;
  if (state.selectedTicketId && !state.tickets.some(t => t.id === state.selectedTicketId)) {
    state.selectedTicketId = null;
  }
  populateCreateTicketRelationships();
  renderDashboard();
  renderTickets();
}

function populateProjectSelect() {
  const select = $('tProject');
  if (!select) return;
  if (!state.projects.length) {
    select.innerHTML = '<option value="">Select a project</option>';
    select.value = '';
    return;
  }
  const current = select.value;
  const hasCurrent = state.projects.some(p => p.id === current);
  const placeholder = `<option value="" disabled${hasCurrent ? '' : ' selected'}>Select a project</option>`;
  const options = [placeholder]
    .concat(state.projects.map(p => `<option value="${p.id}">${p.name}</option>`));
  select.innerHTML = options.join('');
  if (hasCurrent) {
    select.value = current;
  } else {
    select.value = '';
  }
  populateCreateTicketRelationships();
}

function populateAssigneeSelect() {
  const select = $('tAssignee');
  if (!select) return;
  const options = ['<option value="">Unassigned</option>']
    .concat(state.users.map(u => `<option value="${u.id}">${u.name} (${u.role})</option>`));
  select.innerHTML = options.join('');
  select.value = '';
}

// Dashboard
function setViewMode(mode) {
  if (mode !== 'columns' && mode !== 'rows') return;
  if (state.viewMode === mode) return;
  state.viewMode = mode;
  try { localStorage.setItem(VIEW_STORAGE_KEY, mode); } catch (_) {}
  renderDashboard();
}

function renderDashboard() {
  const section = $('dashboardSection');
  if (!section || !state.user) return;
  if (!state.projects.length) {
    section.style.display = 'none';
    return;
  }
  section.style.display = 'block';
  const toggleColumns = $('viewColumnsBtn');
  const toggleRows = $('viewRowsBtn');
  if (toggleColumns) toggleColumns.classList.toggle('btn-active', state.viewMode === 'columns');
  if (toggleRows) toggleRows.classList.toggle('btn-active', state.viewMode === 'rows');

  const dashboard = $('dashboard');
  const visibleTickets = state.tickets.filter(t => t.status !== 'closed');
  $('dashboardEmpty').style.display = visibleTickets.length ? 'none' : 'block';

  dashboard.className = `board board-${state.viewMode}`;
  dashboard.innerHTML = state.projects.map(project => {
    const tickets = visibleTickets.filter(t => t.project_id === project.id);
    const ticketHtml = tickets.length
      ? tickets.map(renderTicketChip).join('')
      : `<div class="ticket-chip empty">No tickets</div>`;
    const desc = project.description ? `<div class="project-description">${project.description}</div>` : '';
    return `
      <div class="project-block">
        <div class="project-header">
          <div>
            <div class="project-name">${project.name}</div>
            ${desc}
          </div>
          <span class="project-count">${tickets.length}</span>
        </div>
        <div class="project-body">${ticketHtml}</div>
      </div>
    `;
  }).join('');
  updateProjectManagerButton();
}

function renderTicketChip(ticket) {
  const statusClass = `status-${ticket.status.replaceAll(' ', '_')}`;
  const selectedClass = state.selectedTicketId === ticket.id ? ' ticket-chip-selected' : '';
  return `
    <button type="button" class="ticket-chip${selectedClass}" onclick="selectTicket('${ticket.id}')">
      <span class="ticket-chip-title">${ticket.title}</span>
      <span class="ticket-chip-meta">
        <span class="pill priority-${ticket.priority}">${ticket.priority}</span>
        <span class="pill ${statusClass}">${ticket.status}</span>
      </span>
    </button>
  `;
}

function buildParentOptionsHTML(ticket) {
  const options = ['<option value="">No parent</option>'];
  const disallowed = collectDescendantIds(ticket.id);
  disallowed.add(ticket.id);
  const eligible = state.tickets
    .filter(t => !disallowed.has(t.id) && t.project_id === ticket.project_id)
    .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
  for (const candidate of eligible) {
    const selected = candidate.id === ticket.parent_ticket_id ? ' selected' : '';
    options.push(`<option value="${candidate.id}"${selected}>${escapeHtml(ticketOptionLabel(candidate))}</option>`);
  }
  return options.join('');
}

function buildBlockingOptionsHTML(ticket) {
  const options = ['<option value="">No blocking dependency</option>'];
  const eligible = state.tickets
    .filter(t => t.id !== ticket.id)
    .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
  for (const candidate of eligible) {
    const selected = candidate.id === ticket.blocked_by_ticket_id ? ' selected' : '';
    options.push(`<option value="${candidate.id}"${selected}>${escapeHtml(ticketOptionLabel(candidate))}</option>`);
  }
  return options.join('');
}

function renderBlockingNotice(ticket) {
  if (!ticket.blocked_by_ticket_id) return '';
  const blocking = getTicketById(ticket.blocked_by_ticket_id);
  if (!blocking) {
    return `<div class="blocking-note text-error">Blocking ticket was not found.</div>`;
  }
  const statusClass = ['resolved', 'closed'].includes(blocking.status) ? 'text-success' : 'text-error';
  const statusLabel = formatStatusLabel(blocking.status);
  return `
    <div class="blocking-note ${statusClass}">
      Blocked by <button type="button" class="link-button" onclick="selectTicket('${blocking.id}')">${escapeHtml(blocking.title)} (#${blocking.id.slice(0, 8)})</button>
      • ${statusLabel}
    </div>
  `;
}

function renderSubtaskList(ticket) {
  const children = state.tickets
    .filter(t => t.parent_ticket_id === ticket.id)
    .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
  if (!children.length) {
    return '<div class="muted">No subtasks yet.</div>';
  }
  const items = children.map(child => {
    const statusLabel = formatStatusLabel(child.status);
    return `
      <li>
        <button type="button" class="link-button" onclick="selectTicket('${child.id}')">${escapeHtml(child.title)} (#${child.id.slice(0, 8)})</button>
        <span class="subtask-status">${statusLabel}</span>
      </li>
    `;
  });
  return `<ul class="subtask-list">${items.join('')}</ul>`;
}

function selectTicket(ticketId) {
  if (state.selectedTicketId === ticketId) {
    state.selectedTicketId = null;
  } else {
    state.selectedTicketId = ticketId;
  }
  renderDashboard();
  renderTickets();
}

// Tickets list
function renderTickets() {
  const root = $('list');
  if (!root) return;
  const ticketId = state.selectedTicketId;
  if (!ticketId) {
    root.innerHTML = '';
    root.style.display = 'none';
    return;
  }
  const t = state.tickets.find(ticket => ticket.id === ticketId);
  if (!t) {
    state.selectedTicketId = null;
    root.innerHTML = '';
    root.style.display = 'none';
    return;
  }
  root.style.display = 'block';
  const assigneeName = t.assignee_name || 'Unassigned';
  const parentOptions = buildParentOptionsHTML(t);
  const blockingOptions = buildBlockingOptionsHTML(t);
  const blockingNote = renderBlockingNotice(t);
  const subtaskCount = state.tickets.filter(child => child.parent_ticket_id === t.id).length;
  const subtasksHtml = renderSubtaskList(t);
  const projectOptions = state.projects.length
    ? state.projects.map(p => `<option value="${p.id}" ${p.id === t.project_id ? 'selected' : ''}>${p.name}</option>`).join('')
    : '<option value="">No projects</option>';
  const assigneeOptions = ['<option value="">Unassigned</option>']
    .concat(state.users.map(u => `<option value="${u.id}" ${u.id === t.assignee_id ? 'selected' : ''}>${u.name} (${u.role})</option>`))
    .join('');
  root.innerHTML = '';
  const div = document.createElement('div');
  div.className = 'card';
  div.innerHTML = `
      <div class="ticket-head">
        <div>
          <div class="ticket-title">${t.title}</div>
          <div class="ticket-meta">
            #${t.id.slice(0, 8)} • ${t.project_name ?? 'Unknown project'} • by ${t.created_by_name ?? 'unknown'}
            • updated ${new Date(t.updated_at).toLocaleString()}
          </div>
        </div>
        <div class="ticket-pills">
          <span class="pill status-${t.status.replaceAll(' ', '_')}">${t.status}</span>
          <span class="pill priority-${t.priority}">${t.priority}</span>
          ${t.tags ? t.tags.split(',').filter(Boolean).map(s => `<span class="pill">${s.trim()}</span>`).join('') : ''}
        </div>
      </div>

      <p style="margin-top:12px; white-space:pre-wrap">${t.description}</p>

      <div class="row" style="margin-top:12px">
        <div class="col">
          <label>Project</label>
          <select onchange="changeProject('${t.id}', this.value)">
            ${projectOptions}
          </select>
        </div>
        <div class="col">
          <label>Assignee (${assigneeName})</label>
          <select onchange="changeAssignee('${t.id}', this.value)">
            ${assigneeOptions}
          </select>
        </div>
      </div>

      <div class="row" style="margin-top:12px">
        <div class="col">
          <label>Parent ticket <span class="label-optional">(optional)</span></label>
          <select onchange="changeParent('${t.id}', this.value)">
            ${parentOptions}
          </select>
        </div>
        <div class="col">
          <label>Blocking dependency <span class="label-optional">(optional)</span></label>
          <select onchange="changeBlocking('${t.id}', this.value)">
            ${blockingOptions}
          </select>
        </div>
      </div>

      ${blockingNote}

      <div class="row" style="margin-top:12px">
        <div class="col">
          <label>Change status</label>
          <div class="status-control">
            <select id="status-${t.id}">
              ${['open', 'in_progress', 'resolved', 'closed'].map(s => `<option value="${s}" ${s === t.status ? 'selected' : ''}>${s}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="col">
          <label>Message & update</label>
          <div style="display:flex; gap:8px;">
            <input id="c-${t.id}" placeholder="Type comment...">
            <button class="btn" onclick="sendTicketUpdate('${t.id}')">Send</button>
          </div>
        </div>
      </div>

      <div class="subtask-section">
        <div class="subtask-head">Subtasks (${subtaskCount})</div>
        ${subtasksHtml}
      </div>

      <div id="comments-${t.id}" class="ticket-comments"></div>
    `;
  root.appendChild(div);
  loadComments(t.id);
}

async function createTicket() {
  const payload = {
    title: $('tTitle').value.trim(),
    description: $('tDesc').value.trim(),
    priority: $('tPriority').value,
    tags: $('tTags').value.trim(),
    project_id: $('tProject').value,
    assignee_id: $('tAssignee').value,
    parent_ticket_id: $('tParent').value || null,
    blocked_by_ticket_id: $('tBlocking').value || null
  };
  if (!payload.title) return alert('Title required');
  if (!payload.project_id) return alert('Select a project');
  try {
    await api('/tickets', { method: 'POST', body: JSON.stringify(payload) });
    $('tTitle').value = '';
    $('tDesc').value = '';
    $('tTags').value = '';
    $('tAssignee').value = '';
    $('tPriority').value = 'medium';
    $('tParent').value = '';
    $('tBlocking').value = '';
    populateCreateTicketRelationships();
    await loadTickets();
  } catch (e) {
    alert(e.message);
  }
}

async function loadComments(id) {
  if (state.selectedTicketId !== id) return;
  const host = $(`comments-${id}`);
  if (!host) return;
  const { comments } = await api(`/tickets/${id}`);
  if (state.selectedTicketId !== id) return;
  host.innerHTML = comments.map(c => `
    <div class="ticket-comment">
      <strong>${c.author_name}</strong>
      <span>${new Date(c.created_at).toLocaleString()}</span>
      <div>${c.body}</div>
    </div>
  `).join('');
}

async function sendTicketUpdate(ticketId) {
  const input = $(`c-${ticketId}`);
  const select = $(`status-${ticketId}`);
  const body = input ? input.value.trim() : '';
  const status = select ? select.value : undefined;
  const ticket = state.tickets.find(t => t.id === ticketId);
  const shouldUpdateStatus = typeof status !== 'undefined' && (!ticket || status !== ticket.status);

  try {
    if (shouldUpdateStatus) {
      await api(`/tickets/${ticketId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status })
      });
    }

    if (body) {
      await api(`/tickets/${ticketId}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body })
      });
    }
  } catch (e) {
    alert(e.message);
    return;
  }

  if (input) input.value = '';
  if (body) await loadComments(ticketId);
  setTimeout(loadTickets, 200);
}

async function changeAssignee(id, assignee_id) {
  try {
    await api(`/tickets/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ assignee_id: assignee_id || null })
    });
  } catch (e) {
    alert(e.message);
  } finally {
    setTimeout(loadTickets, 200);
  }
}

async function changeProject(id, project_id) {
  try {
    if (!project_id) throw new Error('Project is required');
    await api(`/tickets/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ project_id })
    });
  } catch (e) {
    alert(e.message);
  } finally {
    setTimeout(loadTickets, 200);
  }
}

async function changeParent(id, parentId) {
  const parentTicketId = parentId || null;
  const ticket = getTicketById(id);
  if (parentTicketId && ticket && ticket.blocked_by_ticket_id === parentTicketId) {
    alert('Blocking ticket cannot be the parent ticket.');
    setTimeout(loadTickets, 0);
    return;
  }
  try {
    await api(`/tickets/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ parent_ticket_id: parentTicketId })
    });
  } catch (e) {
    alert(e.message);
  } finally {
    setTimeout(loadTickets, 200);
  }
}

async function changeBlocking(id, blockingId) {
  const blockingTicketId = blockingId || null;
  const ticket = getTicketById(id);
  if (blockingTicketId && ticket && ticket.parent_ticket_id === blockingTicketId) {
    alert('Blocking ticket cannot be the parent ticket.');
    setTimeout(loadTickets, 0);
    return;
  }
  try {
    await api(`/tickets/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ blocked_by_ticket_id: blockingTicketId })
    });
  } catch (e) {
    alert(e.message);
  } finally {
    setTimeout(loadTickets, 200);
  }
}

function renderProjectManager() {
  const host = $('projectManager');
  if (!host) return;
  const canManage = userCanManageProjects();
  if (!canManage) {
    state.projectManagerVisible = false;
    host.style.display = 'none';
    host.innerHTML = '';
    updateProjectManagerButton();
    return;
  }
  if (!state.projectManagerVisible) {
    host.style.display = 'none';
    updateProjectManagerButton();
    return;
  }
  host.style.display = 'block';
  const editingId = state.projectEditorId;
  const editingProject = editingId ? state.projects.find(p => p.id === editingId) : null;
  const nameValue = editingProject ? escapeHtml(editingProject.name) : '';
  const descValue = editingProject ? escapeHtml(editingProject.description ?? '') : '';
  const listHtml = state.projects.length
    ? state.projects.map(renderProjectAdminItem).join('')
    : '<div class="project-admin-empty">No projects yet.</div>';
  host.innerHTML = `
    <div class="project-admin-head">
      <h3 style="margin:0">Manage Projects</h3>
      <div class="project-admin-head-actions">
        ${editingProject ? `<button class="btn btn-compact" type="button" onclick="startProjectCreate()">Cancel</button>` : ''}
      </div>
    </div>
    <form class="project-admin-form" onsubmit="return submitProjectForm(event)">
      <input type="hidden" id="projectFormId" value="${editingProject ? editingProject.id : ''}">
      <div class="row" style="margin-top:8px">
        <div class="col">
          <label>Name</label>
          <input id="projectFormName" placeholder="Project name" required value="${nameValue}">
        </div>
        <div class="col">
          <label>Description</label>
          <textarea id="projectFormDesc" rows="2" placeholder="Describe this project">${descValue}</textarea>
        </div>
      </div>
      <div style="margin-top:12px; display:flex; gap:8px; flex-wrap:wrap;">
        <button class="btn btn-primary" type="submit">${editingProject ? 'Update project' : 'Create project'}</button>
        ${editingProject ? '' : '<button class="btn btn-compact" type="button" onclick="startProjectCreate()">Clear</button>'}
      </div>
    </form>
    <div id="projectAdminMsg" class="muted" style="margin-top:8px;"></div>
    <div style="margin-top:16px">
      <h4 style="margin:0 0 8px">Existing projects</h4>
      <div class="project-admin-list">
        ${listHtml}
      </div>
    </div>
  `;
  updateProjectManagerButton();
}

function renderProjectAdminItem(project) {
  const desc = project.description ? `<div class="project-admin-desc">${escapeHtml(project.description)}</div>` : '';
  const isDefault = project.id === 'project-default';
  const removeButton = isDefault ? '' : `<button class="btn btn-compact" type="button" onclick="deleteProject('${project.id}')">Remove</button>`;
  return `
    <div class="project-admin-item">
      <div class="project-admin-info">
        <div class="project-admin-name">${escapeHtml(project.name)}</div>
        ${desc}
      </div>
      <div class="project-admin-actions">
        <button class="btn btn-compact" type="button" onclick="startProjectEdit('${project.id}')">Edit</button>
        ${removeButton}
      </div>
    </div>
  `;
}

function startProjectCreate() {
  state.projectEditorId = null;
  renderProjectManager();
  setMessage('projectAdminMsg', '');
  const name = $('projectFormName');
  if (name) name.focus();
}

function startProjectEdit(id) {
  state.projectEditorId = id;
  renderProjectManager();
  setMessage('projectAdminMsg', '');
  const name = $('projectFormName');
  if (name) name.focus();
}

async function submitProjectForm(event) {
  event.preventDefault();
  const id = $('projectFormId').value.trim();
  const name = $('projectFormName').value.trim();
  const description = $('projectFormDesc').value.trim();
  if (!name) {
    setMessage('projectAdminMsg', 'Project name is required.', 'error');
    return false;
  }
  const payload = { name, description };
  try {
    if (id) {
      await api(`/projects/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload)
      });
      state.projectEditorId = null;
      await loadProjects();
      setMessage('projectAdminMsg', 'Project updated.', 'success');
    } else {
      await api('/projects', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      await loadProjects();
      setMessage('projectAdminMsg', 'Project created.', 'success');
    }
  } catch (e) {
    setMessage('projectAdminMsg', e.message, 'error');
  }
  return false;
}

async function deleteProject(id) {
  if (!confirm('Remove this project? Tickets assigned to it must be moved first.')) return;
  try {
    await api(`/projects/${id}`, { method: 'DELETE' });
    if (state.projectEditorId === id) state.projectEditorId = null;
    await loadProjects();
    setMessage('projectAdminMsg', 'Project removed.', 'success');
  } catch (e) {
    setMessage('projectAdminMsg', e.message, 'error');
  }
}

function escapeHtml(str) {
  return (str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[c]);
}

async function saveProfile() {
  if (!state.user) return;
  try {
    const payload = {
      name: $('profileName').value.trim(),
      role: $('profileRole').value,
      area: $('profileArea').value.trim(),
      avatar_url: $('profileAvatar').value.trim()
    };
    const { user } = await api('/users/me', {
      method: 'PATCH',
      body: JSON.stringify(payload)
    });
    state.user = user;
    setUserArea();
    populateProfileForm();
    renderProjectManager();
    setMessage('profileMsg', 'Profile updated successfully.', 'success');
  } catch (e) {
    setMessage('profileMsg', e.message, 'error');
  }
}

async function changePassword() {
  try {
    const currentPassword = $('profileCurrentPassword').value;
    const newPassword = $('profileNewPassword').value;
    await api('/users/me/password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword })
    });
    $('profileCurrentPassword').value = '';
    $('profileNewPassword').value = '';
    setMessage('passwordMsg', 'Password updated.', 'success');
  } catch (e) {
    setMessage('passwordMsg', e.message, 'error');
  }
}

// SSE live updates
let es;
function startSSE() {
  if (es) es.close();
  es = new EventSource('/api/events', { withCredentials: true });
  es.addEventListener('ticket:created', () => loadTickets());
  es.addEventListener('ticket:updated', () => loadTickets());
  es.addEventListener('comment:created', () => loadTickets());
}

let suppressProfileClose = false;
function toggleProfile(event) {
  if (!state.user) return;
  if (event) {
    event.stopPropagation();
    suppressProfileClose = true;
    setTimeout(() => { suppressProfileClose = false; }, 0);
  }
  state.profileOpen = !state.profileOpen;
  setUserArea();
  populateProfileForm();
}

function closeProfile() {
  if (!state.profileOpen) return;
  state.profileOpen = false;
  setUserArea();
  populateProfileForm();
}

function handleGlobalClick(event) {
  if (suppressProfileClose) return;
  if (!state.profileOpen) return;
  const popover = $('profilePopover');
  if (!popover) return;
  const button = document.querySelector('.avatar-button');
  const target = event.target;
  if (popover.contains(target)) return;
  if (button && button.contains(target)) return;
  closeProfile();
}

function handleKey(event) {
  if (event.key === 'Escape') {
    closeProfile();
  }
}

document.addEventListener('click', handleGlobalClick);
document.addEventListener('keydown', handleKey);
