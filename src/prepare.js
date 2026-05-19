const API = 'http://127.0.0.1:5199';

const state = {
  files: [],
  jobs: [],
  healthy: false,
};

function htmlEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function renderShell(app) {
  app.innerHTML = `
    <header class="topbar admin-topbar">
      <div>
        <h1>Prepare Scenes</h1>
        <p id="prepare-status">Checking local processor...</p>
      </div>
      <div class="top-actions">
        <a class="nav-link" href="/admin">Control Panel</a>
        <a class="nav-link" href="/">View Gallery</a>
      </div>
    </header>

    <main class="admin-main">
      <section class="admin-card prepare-card">
        <div class="card-head">
          <h2>SHARP to SOG</h2>
          <span>Local workstation processor</span>
        </div>
        <div class="prepare-form">
          <label>Album
            <input id="prepare-album" value="demo" />
          </label>
          <label>Scene title
            <input id="prepare-title" placeholder="blank = image filename" />
          </label>
          <label>Focal length
            <input id="prepare-focal" type="number" min="1" max="2000" placeholder="optional, 35mm-equiv" />
          </label>
          <label>Max splats
            <input id="prepare-max" type="number" min="10000" step="10000" placeholder="optional" />
          </label>
        </div>
        <div id="prepare-drop" class="prepare-drop">
          <strong>Drop images here</strong>
          <span>JPG, PNG, WEBP, HEIC. Each image becomes one SHARP scene and one SOG asset.</span>
          <button id="prepare-browse" type="button">Browse Images</button>
          <input id="prepare-input" type="file" accept="image/*,.heic,.heif" multiple hidden />
        </div>
        <div id="prepare-files" class="prepare-files"></div>
        <div class="prepare-actions">
          <button id="prepare-start" type="button" disabled>Prepare Selected</button>
        </div>
      </section>

      <section class="admin-card">
        <div class="card-head">
          <h2>Jobs</h2>
          <span id="job-count">0 total</span>
        </div>
        <div id="prepare-jobs" class="job-list"></div>
      </section>
    </main>
  `;
}

function renderFiles() {
  const wrap = document.getElementById('prepare-files');
  if (!state.files.length) {
    wrap.innerHTML = '<p class="hint">No images selected yet.</p>';
  } else {
    wrap.innerHTML = state.files.map((file, index) => `
      <div class="file-row">
        <span>${htmlEscape(file.name)}</span>
        <strong>${(file.size / 1024 / 1024).toFixed(1)} MB</strong>
        <button type="button" data-remove="${index}">Remove</button>
      </div>
    `).join('');
  }
  document.getElementById('prepare-start').disabled = !state.files.length || !state.healthy;
  for (const btn of wrap.querySelectorAll('[data-remove]')) {
    btn.addEventListener('click', () => {
      state.files.splice(Number(btn.dataset.remove), 1);
      renderFiles();
    });
  }
}

function addFiles(files) {
  const existing = new Set(state.files.map((file) => `${file.name}:${file.size}`));
  for (const file of files) {
    const key = `${file.name}:${file.size}`;
    if (!existing.has(key)) state.files.push(file);
  }
  renderFiles();
}

function renderJobs() {
  document.getElementById('job-count').textContent = `${state.jobs.length} total`;
  const list = document.getElementById('prepare-jobs');
  if (!state.jobs.length) {
    list.innerHTML = '<p class="hint">Prepared scenes will appear here.</p>';
    return;
  }
  list.innerHTML = state.jobs.map((job) => `
    <div class="job-row ${htmlEscape(job.state)}">
      <div>
        <strong>${htmlEscape(job.title || job.sceneId)}</strong>
        <span>${htmlEscape(job.albumId)} / ${htmlEscape(job.sceneId)}</span>
      </div>
      <div>
        <span class="status-pill">${htmlEscape(job.state)}</span>
        <p>${htmlEscape(job.error || job.progress || '')}</p>
        ${job.scene?.sog ? `<p><a class="inline-link" href="/admin">Manage in Control Panel</a></p>` : ''}
      </div>
    </div>
  `).join('');
}

async function pollJobs() {
  try {
    const res = await fetch(`${API}/prepare/jobs`, { cache: 'no-store' });
    const data = await res.json();
    state.jobs = data.jobs || [];
    renderJobs();
  } catch {
    // Health check covers offline state.
  }
}

async function checkHealth() {
  try {
    const res = await fetch(`${API}/health`, { cache: 'no-store' });
    const data = await res.json();
    state.healthy = !!data.ok;
    document.getElementById('prepare-status').textContent = state.healthy
      ? `Processor ready · ${data.pythonExe}`
      : 'Processor unavailable';
  } catch {
    state.healthy = false;
    document.getElementById('prepare-status').textContent =
      'Start the local processor with npm run prepare:dev';
  }
  renderFiles();
}

async function startPrepare() {
  const albumId = document.getElementById('prepare-album').value.trim() || 'demo';
  const title = document.getElementById('prepare-title').value.trim();
  const focal = document.getElementById('prepare-focal').value.trim();
  const maxGaussians = document.getElementById('prepare-max').value.trim();

  const files = [...state.files];
  state.files = [];
  renderFiles();

  for (const file of files) {
    const params = new URLSearchParams({
      albumId,
      title: title || file.name,
      ...(focal ? { focal } : {}),
      ...(maxGaussians ? { maxGaussians } : {}),
    });
    const res = await fetch(`${API}/prepare/upload?${params}`, {
      method: 'POST',
      headers: { 'X-Filename': encodeURIComponent(file.name) },
      body: file,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text);
    }
  }
  await pollJobs();
}

function wire() {
  const drop = document.getElementById('prepare-drop');
  const input = document.getElementById('prepare-input');
  document.getElementById('prepare-browse').addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    addFiles(input.files || []);
    input.value = '';
  });
  drop.addEventListener('dragover', (event) => {
    event.preventDefault();
    drop.classList.add('drag');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
  drop.addEventListener('drop', (event) => {
    event.preventDefault();
    drop.classList.remove('drag');
    addFiles(event.dataTransfer?.files || []);
  });
  document.getElementById('prepare-start').addEventListener('click', () => {
    startPrepare().catch((error) => {
      console.error(error);
      document.getElementById('prepare-status').textContent = `Prepare failed: ${error.message}`;
    });
  });
}

export async function initPrepare(app) {
  renderShell(app);
  wire();
  renderFiles();
  renderJobs();
  await checkHealth();
  await pollJobs();
  setInterval(checkHealth, 5000);
  setInterval(pollJobs, 2000);
}
