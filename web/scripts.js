const state = { user: null, tickets: [] };

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
function $(id) { return document.getElementById(id); }
function showLogin() {
  $('loginView').style.display = 'block';
  $('appView').style.display = 'none';
}
function showApp() {
  $('loginView').style.display = 'none';
  $('appView').style.display = 'block';
}
function setUserArea() {
  const el = $('userArea');
  if (!state.user) {
    el.innerHTML = `<button class="btn" onclick="showLogin()">Login</button>`;
  } else {
    el.innerHTML = `
      <span>Hi, ${state.user.name} (${state.user.role})</span>
      <button class="btn" onclick="logout()" style="margin-left:8px;">Logout</button>`;
  }
}

async function boot() {
  try {
    const { user } = await api('/me');
    state.user = user;
    setUserArea();
    if (!user) showLogin(); else { showApp(); await loadTickets(); startSSE(); }
  } catch { showLogin(); }
}
boot();

// Auth
async function doLogin() {
  const email = $('loginEmail').value.trim();
  const password = $('loginPassword').value;
  try {
    const { user } = await api('/auth/login', { method:'POST', body: JSON.stringify({ email, password }) });
    state.user = user;
    setUserArea();
    $('loginMsg').textContent = '';
    showApp();
    await loadTickets(); startSSE();
  } catch (e) { $('loginMsg').textContent = e.message; }
}
async function doRegister() {
  const email = $('loginEmail').value.trim();
  const password = $('loginPassword').value;
  const name = email.split('@')[0] || 'User';
  try {
    await api('/auth/register', { method:'POST', body: JSON.stringify({ email, password, name }) });
    await doLogin();
  } catch (e) { $('loginMsg').textContent = e.message; }
}
async function logout() {
  await api('/auth/logout', { method:'POST' });
  state.user = null;
  setUserArea();
  showLogin();
}

// Tickets
async function loadTickets() {
  const data = await api('/tickets');
  state.tickets = data.items;
  renderList();
}

function renderList() {
  const root = $('list');
  root.innerHTML = '';
  for (const t of state.tickets) {
    const div = document.createElement('div');
    div.className = 'card';
    div.innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;">
        <div>
          <div style="font-weight:600">${t.title}</div>
          <div style="font-size:12px;color:#a5acb5;margin-top:4px;">
            #${t.id.slice(0,8)} • by ${t.created_by_name ?? 'unknown'} • updated ${new Date(t.updated_at).toLocaleString()}
          </div>
        </div>
        <div>
          // In renderList(), keep as-is; classes already map to CSS above:
          <span class="pill status-${t.status.replaceAll(' ', '_')}">${t.status}</span>
          <span class="pill priority-${t.priority}">${t.priority}</span>
          ${t.tags ? t.tags.split(',').map(s=>`<span class="pill">${s.trim()}</span>`).join('') : ''}
        </div>
      </div>

      <p style="margin-top:12px; white-space:pre-wrap">${t.description}</p>

      <div class="row" style="margin-top:12px">
        <div class="col">
          <label>Change status</label>
          <select onchange="changeStatus('${t.id}', this.value)">
            ${['open','in_progress','resolved','closed'].map(s=>`<option ${s===t.status?'selected':''}>${s}</option>`).join('')}
          </select>
        </div>
        <div class="col">
          <label>Add comment</label>
          <div style="display:flex; gap:8px;">
            <input id="c-${t.id}" placeholder="Type comment...">
            <button class="btn" onclick="addComment('${t.id}')">Send</button>
          </div>
        </div>
      </div>

      <div id="comments-${t.id}" style="margin-top:8px; font-size:14px; color:#cbd3dc;"></div>
    `;
    root.appendChild(div);
    loadComments(t.id);
  }
}

async function createTicket() {
  const payload = {
    title: $('tTitle').value.trim(),
    description: $('tDesc').value.trim(),
    priority: $('tPriority').value,
    tags: $('tTags').value.trim()
  };
  if (!payload.title) return alert('Title required');
  await api('/tickets', { method:'POST', body: JSON.stringify(payload) });
  $('tTitle').value = ''; $('tDesc').value = ''; $('tTags').value = '';
  await loadTickets();
}

async function loadComments(id) {
  const { comments } = await api(`/tickets/${id}`);
  const host = $(`comments-${id}`);
  host.innerHTML = comments.map(c => `
    <div style="margin-top:6px;">
      <strong>${c.author_name}</strong> <span style="color:#8ea0b3; font-size:12px;">${new Date(c.created_at).toLocaleString()}</span>
      <div style="white-space:pre-wrap">${c.body}</div>
    </div>
  `).join('');
}

async function addComment(ticketId) {
  const input = $(`c-${ticketId}`);
  const body = input.value.trim();
  if (!body) return;
  await api(`/tickets/${ticketId}/comments`, { method:'POST', body: JSON.stringify({ body }) });
  input.value = '';
  await loadComments(ticketId);
}

async function changeStatus(id, status) {
  await api(`/tickets/${id}`, { method:'PATCH', body: JSON.stringify({ status }) });
  // local refresh happens via SSE; do a light fallback:
  setTimeout(loadTickets, 200);
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
