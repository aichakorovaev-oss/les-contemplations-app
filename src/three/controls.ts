import * as THREE from 'three';
import { ColliderAABB } from './builder';

export class FirstPersonRig {
  camera: THREE.PerspectiveCamera;
  dom: HTMLElement;
  colliders: ColliderAABB[];

  keys: Record<string, boolean> = {};
  maxSpeed = 3.0;
  accel = 22;
  friction = 16;
  radius = 0.32;
  eyeY = 1.55;
  velocity = new THREE.Vector3();

  yaw = 0;
  pitch = 0;
  lookSensitivity = 0.0022;

  isPointerDown = false;
  dragDistance = 0;
  downPos = { x: 0, y: 0 };
  lastPos = { x: 0, y: 0 };
  pointerId: number | null = null;

  teleport: {
    from: THREE.Vector3;
    to: THREE.Vector3;
    t: number;
    dur: number;
    onArrive?: (success: boolean) => void;
  } | null = null;

  bobPhase = 0;
  bobAmount = 0;

  onMove: ((dist: number) => void) | null = null;
  onClick: ((e: PointerEvent) => void) | null = null;

  enabled = true;

  constructor(camera: THREE.PerspectiveCamera, domElement: HTMLElement, colliders: ColliderAABB[]) {
    this.camera = camera;
    this.dom = domElement;
    this.colliders = colliders;
    this._bind();
  }

  setYawPitchFromCamera(): void {
    const e = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
    this.yaw = e.y;
    this.pitch = e.x;
    this._applyRotation();
  }

  private _bind(): void {
    const dom = this.dom;
    const isMod = (e: Event) => ['INPUT', 'TEXTAREA', 'BUTTON', 'SELECT'].includes((e.target as HTMLElement)?.tagName);

    window.addEventListener('keydown', (e: KeyboardEvent) => {
      if (isMod(e)) return;
      const k = e.key.toLowerCase();
      this.keys[k] = true;
      if (e.key === 'ArrowUp') this.keys.w = true;
      if (e.key === 'ArrowDown') this.keys.s = true;
      if (e.key === 'ArrowLeft') this.keys.a = true;
      if (e.key === 'ArrowRight') this.keys.d = true;
      if (['w', 'a', 's', 'd', ' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
        e.preventDefault();
      }
    });

    window.addEventListener('keyup', (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      this.keys[k] = false;
      if (e.key === 'ArrowUp') this.keys.w = false;
      if (e.key === 'ArrowDown') this.keys.s = false;
      if (e.key === 'ArrowLeft') this.keys.a = false;
      if (e.key === 'ArrowRight') this.keys.d = false;
    });

    dom.addEventListener('pointerdown', (e: PointerEvent) => {
      if (!this.enabled || e.button !== 0) return;
      this.isPointerDown = true;
      this.dragDistance = 0;
      this.downPos = { x: e.clientX, y: e.clientY };
      this.lastPos = { x: e.clientX, y: e.clientY };
      this.pointerId = e.pointerId;
      try {
        dom.setPointerCapture(e.pointerId);
      } catch (_) {}
      dom.style.cursor = 'grabbing';
    });

    dom.addEventListener('pointermove', (e: PointerEvent) => {
      if (!this.enabled || !this.isPointerDown) return;
      let dx = e.movementX;
      let dy = e.movementY;
      if (dx === undefined || dy === undefined) {
        dx = e.clientX - this.lastPos.x;
        dy = e.clientY - this.lastPos.y;
      }
      this.lastPos.x = e.clientX;
      this.lastPos.y = e.clientY;
      this.dragDistance += Math.abs(dx) + Math.abs(dy);
      if (this.dragDistance > 3) {
        this.yaw -= dx * this.lookSensitivity;
        this.pitch -= dy * this.lookSensitivity;
        this.pitch = Math.max(-Math.PI / 2.4, Math.min(Math.PI / 2.4, this.pitch));
        this._applyRotation();
      }
    });

    const finish = (e: PointerEvent) => {
      if (!this.enabled) return;
      const wasClick = this.dragDistance < 6;
      this.isPointerDown = false;
      if (this.pointerId !== null) {
        try {
          dom.releasePointerCapture(this.pointerId);
        } catch (_) {}
        this.pointerId = null;
      }
      dom.style.cursor = 'grab';
      if (wasClick && this.onClick) this.onClick(e);
    };

    dom.addEventListener('pointerup', finish);
    dom.addEventListener('pointercancel', finish);

    dom.style.cursor = 'grab';
    dom.style.touchAction = 'none';
  }

  private _applyRotation(): void {
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
    this.camera.rotation.z = 0;
  }

  private _attemptMove(dx: number, dz: number): void {
    const pos = this.camera.position;
    const r = this.radius;
    const tryAxis = (nx: number, nz: number) => {
      for (const c of this.colliders) {
        if (nx > c.minX - r && nx < c.maxX + r && nz > c.minZ - r && nz < c.maxZ + r) return false;
      }
      return true;
    };
    if (tryAxis(pos.x + dx, pos.z)) pos.x += dx;
    if (tryAxis(pos.x, pos.z + dz)) pos.z += dz;
  }

  walkTo(target: THREE.Vector3, opts: { duration?: number; onArrive?: (s: boolean) => void } = {}): void {
    const { duration = 0.0, onArrive } = opts;
    const from = this.camera.position.clone();
    const dist = Math.hypot(target.x - from.x, target.z - from.z);
    const dur = duration || Math.max(0.45, Math.min(1.6, dist / 2.8));
    this.teleport = {
      from,
      to: new THREE.Vector3(target.x, this.eyeY, target.z),
      t: 0,
      dur,
      onArrive,
    };
  }

  cancelTeleport(): void {
    if (this.teleport && this.teleport.onArrive) this.teleport.onArrive(false);
    this.teleport = null;
  }

  update(dt: number): void {
    if (!this.enabled) return;

    if (this.teleport) {
      const tp = this.teleport;
      tp.t += dt;
      const u = Math.min(1, tp.t / tp.dur);
      const e = u * u * (3 - 2 * u);
      const x = tp.from.x + (tp.to.x - tp.from.x) * e;
      const z = tp.from.z + (tp.to.z - tp.from.z) * e;
      this.bobAmount += (1 - this.bobAmount) * Math.min(1, dt * 6);
      this.bobPhase += dt * 7.5;
      const bobY = Math.sin(this.bobPhase) * 0.025 * this.bobAmount;
      this.camera.position.set(x, this.eyeY + bobY, z);
      if (u >= 1) {
        this.camera.position.y = this.eyeY;
        if (tp.onArrive) tp.onArrive(true);
        this.teleport = null;
      }
      if (this.onMove) this.onMove(0.05);
      return;
    }

    let fx = 0, fz = 0;
    if (this.keys.w) fz -= 1;
    if (this.keys.s) fz += 1;
    if (this.keys.a) fx -= 1;
    if (this.keys.d) fx += 1;
    const len = Math.hypot(fx, fz);
    let targetVel: THREE.Vector3;
    if (len > 0) {
      fx /= len;
      fz /= len;
      const sprint = this.keys.shift ? 1.7 : 1;
      const tgt = this.maxSpeed * sprint;
      const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
      const worldX = fx * cos + fz * sin;
      const worldZ = -fx * sin + fz * cos;
      targetVel = new THREE.Vector3(worldX * tgt, 0, worldZ * tgt);
    } else {
      targetVel = new THREE.Vector3();
    }

    const blendK = len > 0 ? this.accel : this.friction;
    const blend = 1 - Math.exp(-dt * blendK);
    this.velocity.lerp(targetVel, blend);

    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    const walkRatio = Math.min(1, speed / this.maxSpeed);
    this.bobAmount += (walkRatio - this.bobAmount) * Math.min(1, dt * 6);
    this.bobPhase += dt * (5 + walkRatio * 3.5);
    const bobY = Math.sin(this.bobPhase) * 0.028 * this.bobAmount;

    const dx = this.velocity.x * dt;
    const dz = this.velocity.z * dt;
    const before = this.camera.position.clone();
    this._attemptMove(dx, dz);
    this.camera.position.y = this.eyeY + bobY;

    const moved = Math.hypot(this.camera.position.x - before.x, this.camera.position.z - before.z);
    if (moved > 0.003 && this.onMove) this.onMove(moved);
  }
}
