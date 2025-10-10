const THEME_STORAGE_KEY = 'jdtickets:theme';

const state = {
  user: null,
  projects: [],
  users: [],
  projectEditorId: null,
  theme: (() => {
    try {
      const saved = localStorage.getItem(THEME_STORAGE_KEY);
      if (saved === 'light' || saved === 'dark') return saved;
    } catch (_) {}
    return 'dark';
  })()
};

function $(id) {
  return document.getElementById(id);
}

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

function setMessage(id, message, type) {
  const el = $(id);
  if (!el) return;
  el.textContent = message || '';
  el.classList.remove('text-success', 'text-error');
  if (type === 'success') el.classList.add('text-success');
  if (type === 'error') el.classList.add('text-error');
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

function escapeHtml(str) {
  return (str ?? '').toString().replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[c]);
}

function canManageProjects() {
  return !!state.user;
}

function canManageUsers() {
  return !!(state.user && state.user.role === 'admin');
}

function canManageBackups() {
  return canManageUsers();
}

function canEditProject(project) {
  if (!state.user || !project) return false;
  if (state.user.role === 'admin') return true;
  return project.owner_user_id === state.user.id;
}

function canDeleteProject(project) {
  if (!state.user || !project) return false;
  if (project.id === 'project-default') return false;
  return canEditProject(project);
}

function renderIntro() {
  const meta = $('settingsIntroMeta');
  if (!meta) return;
  if (!state.user) {
    meta.textContent = '';
    return;
  }
  const area = state.user.area ? ` • ${state.user.area}` : '';
  meta.textContent = `Signed in as ${state.user.name} (${state.user.role}${area})`;
}

function renderProjectManager() {
  const restricted = $('projectsRestricted');
  const wrapper = $('projectsManager');
  if (!restricted || !wrapper) return;
  const canManage = canManageProjects();
  restricted.style.display = canManage ? 'none' : 'block';
  wrapper.style.display = canManage ? 'block' : 'none';
  if (!canManage) return;

  const editingId = state.projectEditorId;
  const editingProject = editingId ? state.projects.find(p => p.id === editingId) : null;
  const nameInput = $('projectFormName');
  const descInput = $('projectFormDesc');
  const idInput = $('projectFormId');
  const visibilitySelect = $('projectFormVisibility');
  const form = $('projectForm');
  const submitBtn = form ? form.querySelector('button[type="submit"]') : null;
  const cancelBtn = $('projectFormCancelBtn');

  if (idInput) idInput.value = editingProject ? editingProject.id : '';
  if (nameInput) nameInput.value = editingProject ? editingProject.name : '';
  if (descInput) descInput.value = editingProject ? (editingProject.description ?? '') : '';
  if (visibilitySelect) {
    if (editingProject) {
      visibilitySelect.value = editingProject.visibility === 'private' ? 'private' : 'public';
    } else if (state.user && state.user.role === 'admin') {
      visibilitySelect.value = 'public';
    } else {
      visibilitySelect.value = 'private';
    }
  }
  if (submitBtn) submitBtn.textContent = editingProject ? 'Update Project' : 'Create Project';
  if (cancelBtn) cancelBtn.textContent = editingProject ? 'Cancel' : 'Clear';

  const listHost = $('projectAdminList');
  if (!listHost) return;
  if (!state.projects.length) {
    listHost.innerHTML = '<div class="project-admin-empty">No projects yet.</div>';
    return;
  }
  listHost.innerHTML = state.projects.map(renderProjectAdminItem).join('');
}

function renderProjectVisibilityControl(project) {
  const isPrivate = project.visibility === 'private';
  const canEdit = canEditProject(project);
  const label = isPrivate ? 'Private' : 'Public';
  if (!canEdit) {
    return `<span class="project-visibility-badge ${isPrivate ? 'badge-private' : 'badge-public'}">${label}</span>`;
  }
  return `
    <div class="project-visibility-toggle" role="group" aria-label="Project visibility">
      <button type="button" class="visibility-toggle-btn ${!isPrivate ? 'visibility-toggle-btn-active' : ''}" onclick="setProjectVisibility('${project.id}','public', event)" aria-pressed="${!isPrivate}" aria-label="Set project public" title="Make project public">🌐</button>
      <button type="button" class="visibility-toggle-btn ${isPrivate ? 'visibility-toggle-btn-active' : ''}" onclick="setProjectVisibility('${project.id}','private', event)" aria-pressed="${isPrivate}" aria-label="Set project private" title="Make project private">🔒</button>
    </div>
  `;
}

function renderProjectAdminItem(project) {
  const desc = project.description ? `<div class="project-admin-desc">${escapeHtml(project.description)}</div>` : '';
  const isDefault = project.id === 'project-default';
  const canEdit = canEditProject(project);
  const canRemove = canDeleteProject(project) && !isDefault;
  const visibilityControls = renderProjectVisibilityControl(project);
  const editButton = canEdit ? `<button class="btn btn-compact" type="button" onclick="startProjectEdit('${project.id}')">Edit</button>` : '';
  const removeButton = canRemove ? `<button class="btn btn-compact btn-danger" type="button" onclick="deleteProject('${project.id}')">Remove</button>` : '';
  const readOnly = !canEdit && !canRemove ? '<span class="muted">Read only</span>' : '';
  return `
    <div class="project-admin-item">
      <div class="project-admin-info">
        <div class="project-admin-name">${escapeHtml(project.name)}</div>
        ${desc}
      </div>
      <div class="project-admin-actions">
        ${visibilityControls}
        ${editButton}
        ${removeButton}
        ${readOnly}
      </div>
    </div>
  `;
}

function renderUserManager() {
  const restricted = $('usersRestricted');
  const wrapper = $('userManager');
  if (!restricted || !wrapper) return;
  const canManage = canManageUsers();
  restricted.style.display = canManage ? 'none' : 'block';
  wrapper.style.display = canManage ? 'block' : 'none';
  if (!canManage) return;

  const list = $('userList');
  if (!list) return;
  if (!state.users.length) {
    list.innerHTML = '<div class="user-admin-empty">No users yet.</div>';
    return;
  }
  list.innerHTML = state.users.map(renderUserAdminItem).join('');
}

function renderUserAdminItem(user) {
  const roles = ['user', 'agent', 'admin'];
  const roleOptions = roles.map(role => `<option value="${role}" ${role === user.role ? 'selected' : ''}>${role}</option>`).join('');
  const deleteButton = user.id === state.user.id
    ? '<span class="muted">Current session</span>'
    : `<button class="btn btn-compact btn-danger" type="button" onclick="removeUser('${user.id}')">Delete</button>`;
  return `
    <div class="user-admin-item">
      <div class="user-admin-main">
        <div class="row">
          <div class="col">
            <label>Email</label>
            <input id="userEmail-${user.id}" value="${escapeHtml(user.email)}">
          </div>
          <div class="col">
            <label>Name</label>
            <input id="userName-${user.id}" value="${escapeHtml(user.name)}">
          </div>
        </div>
        <div class="row" style="margin-top:8px;">
          <div class="col">
            <label>Role</label>
            <select id="userRole-${user.id}">
              ${roleOptions}
            </select>
          </div>
          <div class="col">
            <label>Area</label>
            <input id="userArea-${user.id}" value="${escapeHtml(user.area ?? '')}">
          </div>
        </div>
        <div class="row" style="margin-top:8px;">
          <div class="col">
            <label>Avatar URL</label>
            <input id="userAvatar-${user.id}" value="${escapeHtml(user.avatar_url ?? '')}">
          </div>
          <div class="col">
            <label>New Password <span class="label-optional">(optional)</span></label>
            <input id="userPassword-${user.id}" type="password" placeholder="Leave blank to keep current">
          </div>
        </div>
      </div>
      <div class="user-admin-actions">
        <button class="btn btn-primary" type="button" onclick="saveUser('${user.id}')">Save</button>
        <button class="btn btn-compact" type="button" onclick="resetUser('${user.id}')">Reset</button>
        ${deleteButton}
      </div>
    </div>
  `;
}

function renderBackupManager() {
  const restricted = $('backupRestricted');
  const wrapper = $('backupManager');
  if (!restricted || !wrapper) return;
  const canManage = canManageBackups();
  restricted.style.display = canManage ? 'none' : 'block';
  wrapper.style.display = canManage ? 'block' : 'none';
}

function startProjectCreate() {
  state.projectEditorId = null;
  renderProjectManager();
  setMessage('projectAdminMsg', '');
  const nameInput = $('projectFormName');
  if (nameInput) nameInput.focus();
}

function startProjectEdit(id) {
  const project = state.projects.find(p => p.id === id);
  if (!project || !canEditProject(project)) {
    setMessage('projectAdminMsg', 'You do not have permission to edit that project.', 'error');
    return;
  }
  state.projectEditorId = id;
  renderProjectManager();
  setMessage('projectAdminMsg', '');
  const nameInput = $('projectFormName');
  if (nameInput) nameInput.focus();
}

async function submitProjectForm(event) {
  event.preventDefault();
  if (!canManageProjects()) return false;
  const id = $('projectFormId').value.trim();
  const name = $('projectFormName').value.trim();
  const description = $('projectFormDesc').value.trim();
  const visibilitySelect = $('projectFormVisibility');
  const visibility = visibilitySelect ? (visibilitySelect.value === 'private' ? 'private' : 'public') : 'public';
  if (!name) {
    setMessage('projectAdminMsg', 'Project name is required.', 'error');
    return false;
  }
  const payload = { name, description, visibility };
  try {
    if (id) {
      await api(`/projects/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload)
      });
      state.projectEditorId = null;
      setMessage('projectAdminMsg', 'Project updated.', 'success');
    } else {
      await api('/projects', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      setMessage('projectAdminMsg', 'Project created.', 'success');
    }
    await loadProjects();
  } catch (e) {
    setMessage('projectAdminMsg', e.message, 'error');
  }
  return false;
}

async function deleteProject(id) {
  if (!canManageProjects()) return;
  const project = state.projects.find(p => p.id === id);
  if (!project || !canDeleteProject(project)) {
    setMessage('projectAdminMsg', 'You do not have permission to remove that project.', 'error');
    return;
  }
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

async function setProjectVisibility(projectId, visibility, event) {
  if (event) event.stopPropagation();
  const project = state.projects.find(p => p.id === projectId);
  if (!project || !canEditProject(project)) {
    setMessage('projectAdminMsg', 'You do not have permission to change that project.', 'error');
    return;
  }
  try {
    await api(`/projects/${projectId}`, {
      method: 'PATCH',
      body: JSON.stringify({ visibility })
    });
    await loadProjects();
    setMessage('projectAdminMsg', 'Project updated.', 'success');
  } catch (e) {
    setMessage('projectAdminMsg', e.message, 'error');
  }
}

async function createUser(event) {
  event.preventDefault();
  if (!canManageUsers()) return false;
  const email = $('userCreateEmail').value.trim();
  const name = $('userCreateName').value.trim();
  const password = $('userCreatePassword').value;
  const role = $('userCreateRole').value;
  const area = $('userCreateArea').value.trim();
  const avatar_url = $('userCreateAvatar').value.trim();
  try {
    await api('/users', {
      method: 'POST',
      body: JSON.stringify({ email, name, password, role, area, avatar_url })
    });
    $('userCreateEmail').value = '';
    $('userCreateName').value = '';
    $('userCreatePassword').value = '';
    $('userCreateRole').value = 'user';
    $('userCreateArea').value = '';
    $('userCreateAvatar').value = '';
    setMessage('userCreateMsg', 'User created.', 'success');
    await loadUsers();
  } catch (e) {
    setMessage('userCreateMsg', e.message, 'error');
  }
  return false;
}

function resetUser(id) {
  const user = state.users.find(u => u.id === id);
  if (!user) return;
  const emailInput = $(`userEmail-${id}`);
  const nameInput = $(`userName-${id}`);
  const roleSelect = $(`userRole-${id}`);
  const areaInput = $(`userArea-${id}`);
  const avatarInput = $(`userAvatar-${id}`);
  const passwordInput = $(`userPassword-${id}`);
  if (emailInput) emailInput.value = user.email;
  if (nameInput) nameInput.value = user.name;
  if (roleSelect) roleSelect.value = user.role;
  if (areaInput) areaInput.value = user.area ?? '';
  if (avatarInput) avatarInput.value = user.avatar_url ?? '';
  if (passwordInput) passwordInput.value = '';
}

async function saveUser(id) {
  if (!canManageUsers()) return;
  const email = ($(`userEmail-${id}`)?.value ?? '').trim();
  const name = ($(`userName-${id}`)?.value ?? '').trim();
  const role = $(`userRole-${id}`)?.value;
  const area = ($(`userArea-${id}`)?.value ?? '').trim();
  const avatar_url = ($(`userAvatar-${id}`)?.value ?? '').trim();
  const password = $(`userPassword-${id}`)?.value ?? '';
  try {
    const payload = { email, name, role, area, avatar_url };
    if (password) payload.password = password;
    await api(`/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    });
    setMessage('userCreateMsg', 'User updated.', 'success');
    await loadUsers();
  } catch (e) {
    setMessage('userCreateMsg', e.message, 'error');
  }
}

async function removeUser(id) {
  if (!canManageUsers()) return;
  if (!confirm('Delete this user? This action cannot be undone.')) return;
  try {
    await api(`/users/${id}`, { method: 'DELETE' });
    setMessage('userCreateMsg', 'User deleted.', 'success');
    await loadUsers();
  } catch (e) {
    setMessage('userCreateMsg', e.message, 'error');
  }
}

async function downloadBackup() {
  if (!canManageBackups()) return;
  setMessage('backupMsg', 'Generating backup...');
  try {
    const { backup } = await api('/admin/backup');
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `jdtickets-backup-${ts}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setMessage('backupMsg', 'Backup downloaded.', 'success');
  } catch (e) {
    setMessage('backupMsg', e.message, 'error');
  }
}

async function handleRestoreFile(event) {
  if (!canManageBackups()) return;
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const backup = JSON.parse(text);
    setMessage('backupMsg', 'Restoring backup...');
    const result = await api('/admin/restore', {
      method: 'POST',
      body: JSON.stringify({ backup })
    });
    setMessage('backupMsg', result.warning ? result.warning : 'Backup restored.', 'success');
    await Promise.all([loadProjects(), loadUsers()]);
  } catch (e) {
    setMessage('backupMsg', e.message, 'error');
  } finally {
    event.target.value = '';
  }
}

async function logout() {
  try {
    await api('/auth/logout', { method: 'POST' });
  } catch (_) {}
  window.location.href = '/';
}

async function loadProjects() {
  if (!canManageProjects()) {
    renderProjectManager();
    return;
  }
  const { items } = await api('/projects');
  state.projects = items;
  if (state.projectEditorId && !state.projects.some(p => p.id === state.projectEditorId)) {
    state.projectEditorId = null;
  }
  renderProjectManager();
}

async function loadUsers() {
  if (!canManageUsers()) {
    renderUserManager();
    return;
  }
  const { items } = await api('/users');
  state.users = items;
  renderUserManager();
}

async function boot() {
  applyTheme();
  const themeBtn = $('themeToggleBtn');
  if (themeBtn) themeBtn.addEventListener('click', toggleTheme);
  const logoutBtn = $('logoutBtn');
  if (logoutBtn) logoutBtn.addEventListener('click', logout);
  const projectForm = $('projectForm');
  if (projectForm) projectForm.addEventListener('submit', submitProjectForm);
  const projectCancel = $('projectFormCancelBtn');
  if (projectCancel) projectCancel.addEventListener('click', startProjectCreate);
  const userForm = $('userCreateForm');
  if (userForm) userForm.addEventListener('submit', createUser);
  const downloadBtn = $('downloadBackupBtn');
  if (downloadBtn) downloadBtn.addEventListener('click', downloadBackup);
  const restoreInput = $('restoreFileInput');
  if (restoreInput) restoreInput.addEventListener('change', handleRestoreFile);

  try {
    const { user } = await api('/me');
    if (!user) {
      window.location.href = '/';
      return;
    }
    state.user = user;
    renderIntro();
    renderProjectManager();
    renderUserManager();
    renderBackupManager();
    await Promise.all([
      loadProjects(),
      loadUsers()
    ]);
  } catch (e) {
    console.error('Failed to load settings', e);
    window.location.href = '/';
  }
}

window.startProjectCreate = startProjectCreate;
window.startProjectEdit = startProjectEdit;
window.deleteProject = deleteProject;
window.setProjectVisibility = setProjectVisibility;
window.saveUser = saveUser;
window.resetUser = resetUser;
window.removeUser = removeUser;

boot();
