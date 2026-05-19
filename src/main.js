import { initAdmin } from './admin.js';
import { initGallery } from './gallery.js';

const app = document.getElementById('app');

if (location.pathname.startsWith('/admin')) {
  initAdmin(app).catch((error) => {
    console.error(error);
    app.innerHTML = '<main><div class="empty">Could not load control panel.</div></main>';
  });
} else {
  initGallery(app);
}
