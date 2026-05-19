import * as pc from 'playcanvas';

const START_DIST = 1.2;
const VR_DIST = 0.6;
const DESKTOP_RIG = new pc.Vec3(0, 0, -1);
const VR_RIG = new pc.Vec3(0, 0, -VR_DIST);
const DOLLY_SPEED = 1.4;
const LIFT_SPEED = 1.0;
const YAW_SPEED = 60;
const STICK_DEADZONE = 0.15;

export class PcSplatViewer {
  constructor(rootEl, onStatus) {
    this.rootEl = rootEl;
    this.onStatus = onStatus || (() => {});
    this.splat = null;
    this.splatAsset = null;
    this.onNext = null;
    this.onPrevious = null;
    this.buttonLatch = new Set();
    this.orbit = { yaw: 0, pitch: 0, dist: START_DIST, target: DESKTOP_RIG.clone() };
    this.rigYaw = 0;

    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'width:100%;height:100%;display:block;touch-action:none';
    rootEl.appendChild(this.canvas);

    this.app = new pc.Application(this.canvas, {
      graphicsDeviceOptions: { antialias: true, alpha: false },
    });
    this.app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
    this.app.setCanvasResolution(pc.RESOLUTION_AUTO);

    this.camera = new pc.Entity('camera');
    this.camera.addComponent('camera', {
      clearColor: new pc.Color(0.025, 0.025, 0.03),
      fov: 50,
      nearClip: 0.01,
      farClip: 1000,
    });
    this.app.root.addChild(this.camera);

    this.rig = new pc.Entity('rig');
    this.app.root.addChild(this.rig);

    if (this.app.xr) {
      this.app.xr.on('end', () => this._resetRig(DESKTOP_RIG));
    }

    this._wireOrbit();
    this.app.on('update', (dt) => {
      this._updateXrInput(dt);
      this._updateCamera();
    });
    this.app.start();
  }

  get vrSupported() {
    return !!(this.app.xr && this.app.xr.supported);
  }

  load(assetUrl) {
    this.onStatus('Loading splat scene...');
    return new Promise((resolve, reject) => {
      this.app.assets.loadFromUrl(assetUrl, 'gsplat', (err, asset) => {
        if (err) {
          this.onStatus('Failed to load scene.');
          reject(new Error(err));
          return;
        }

        const splat = new pc.Entity('splat');
        splat.setLocalEulerAngles(180, 0, 0);
        splat.setLocalPosition(0, 0, 1);
        splat.addComponent('gsplat', { asset });
        this._clearSplat();
        this.rig.addChild(splat);
        this.splat = splat;
        this.splatAsset = asset;
        if (!this.app.xr?.active) this._resetRig(DESKTOP_RIG);
        this.onStatus(this.vrSupported
          ? 'Drag to orbit. Scroll to zoom. VR is available. In VR, use controller face buttons to swap scenes.'
          : 'Drag to orbit. Scroll to zoom.');
        resolve();
      });
    });
  }

  setSceneControls({ onPrevious, onNext } = {}) {
    this.onPrevious = onPrevious || null;
    this.onNext = onNext || null;
  }

  enterVR() {
    if (!this.vrSupported || !this.splat) return;
    this._resetRig(VR_RIG);
    this.app.xr.start(this.camera.camera, pc.XRTYPE_VR, pc.XRSPACE_LOCAL);
  }

  _resetRig(pos) {
    this.rigYaw = 0;
    this.rig.setPosition(pos);
    this.rig.setEulerAngles(0, 0, 0);
    this.orbit.target.copy(pos);
  }

  _updateXrInput(dt) {
    const xr = this.app.xr;
    if (!xr || !xr.active || !xr.input) return;

    const pressedOnce = (key, pressed) => {
      if (!pressed) {
        this.buttonLatch.delete(key);
        return false;
      }
      if (this.buttonLatch.has(key)) return false;
      this.buttonLatch.add(key);
      return true;
    };
    const dz = (v) => (Math.abs(v) < STICK_DEADZONE ? 0 : v);
    let dolly = 0;
    let lift = 0;
    let spin = 0;
    let recenter = false;
    let exit = false;

    for (const src of xr.input.inputSources) {
      const gp = src.gamepad;
      if (!gp) continue;
      const ax = gp.axes || [];
      const b = gp.buttons || [];
      const sx = dz(ax[2] ?? ax[0] ?? 0);
      const sy = dz(ax[3] ?? ax[1] ?? 0);
      const grip = !!(b[1] && b[1].pressed);
      spin += sx;
      if (grip) lift -= sy;
      else dolly += sy;
      if (pressedOnce(`${src.id || src.handedness || 'hand'}-prev`, !!(b[4] && b[4].pressed))) {
        if (grip) recenter = true;
        else this.onPrevious?.();
      }
      if (pressedOnce(`${src.id || src.handedness || 'hand'}-next`, !!(b[5] && b[5].pressed))) {
        if (grip) exit = true;
        else this.onNext?.();
      }
    }

    if (recenter) {
      this._resetRig(VR_RIG);
      return;
    }
    if (exit) {
      try { xr.end(); } catch {}
      return;
    }

    if (spin) {
      this.rigYaw -= spin * YAW_SPEED * dt;
      this.rig.setEulerAngles(0, this.rigYaw, 0);
    }
    if (dolly || lift) {
      const f = this.camera.forward;
      const len = Math.hypot(f.x, f.z) || 1;
      const p = this.rig.getPosition();
      this.rig.setPosition(
        p.x + (f.x / len) * dolly * DOLLY_SPEED * dt,
        p.y + lift * LIFT_SPEED * dt,
        p.z + (f.z / len) * dolly * DOLLY_SPEED * dt,
      );
      this.orbit.target.copy(this.rig.getPosition());
    }
  }

  _wireOrbit() {
    let lx = 0;
    let ly = 0;
    let down = false;
    this.canvas.addEventListener('pointerdown', (e) => {
      down = true;
      lx = e.clientX;
      ly = e.clientY;
      this.canvas.setPointerCapture(e.pointerId);
    });
    const end = () => { down = false; };
    this.canvas.addEventListener('pointerup', end);
    this.canvas.addEventListener('pointercancel', end);
    this.canvas.addEventListener('pointermove', (e) => {
      if (!down) return;
      this.orbit.yaw -= (e.clientX - lx) * 0.3;
      this.orbit.pitch = Math.max(-89, Math.min(89, this.orbit.pitch - (e.clientY - ly) * 0.3));
      lx = e.clientX;
      ly = e.clientY;
    });
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.orbit.dist = Math.max(0.1, this.orbit.dist * (1 + Math.sign(e.deltaY) * 0.12));
    }, { passive: false });
  }

  _updateCamera() {
    if (this.app.xr && this.app.xr.active) return;
    const o = this.orbit;
    const py = o.pitch * pc.math.DEG_TO_RAD;
    const yw = o.yaw * pc.math.DEG_TO_RAD;
    this.camera.setPosition(
      o.target.x + o.dist * Math.cos(py) * Math.sin(yw),
      o.target.y + o.dist * Math.sin(py),
      o.target.z + o.dist * Math.cos(py) * Math.cos(yw),
    );
    this.camera.lookAt(o.target);
  }

  dispose() {
    try { if (this.app.xr && this.app.xr.active) this.app.xr.end(); } catch {}
    this._clearSplat();
    try { this.app.destroy(); } catch {}
    if (this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
  }

  _clearSplat() {
    if (this.splat) {
      try { this.splat.destroy(); } catch {}
      this.splat = null;
    }
    if (this.splatAsset) {
      try { this.app.assets.remove(this.splatAsset); } catch {}
      try { this.splatAsset.unload(); } catch {}
      this.splatAsset = null;
    }
  }
}
