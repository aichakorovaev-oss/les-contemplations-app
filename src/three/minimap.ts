import * as THREE from 'three';
import { LAYOUT, ROOMS, WallLightItem } from './builder';
import { RoomKey } from '../types/gallery';

export function renderMinimap(
  canvas: HTMLCanvasElement,
  camera: THREE.PerspectiveCamera,
  yaw: number,
  wallLights: WallLightItem[]
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(15,12,10,0.92)';
  ctx.fillRect(0, 0, W, H);

  const pad = 10;
  const scale = (W - pad * 2) / 18;
  const wx = (x: number) => pad + (x + 9) * scale;
  const wz = (z: number) => pad + (z + 9) * scale;

  for (const k of Object.keys(LAYOUT.cells) as RoomKey[]) {
    const { cx, cz } = LAYOUT.cells[k];
    const half = LAYOUT.half;
    ctx.fillStyle = ROOMS[k].wallColor;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(wx(cx - half), wz(cz - half), half * 2 * scale, half * 2 * scale);
  }

  ctx.globalAlpha = 1;
  ctx.strokeStyle = 'rgba(255,235,200,0.9)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(wx(-LAYOUT.doorW / 2), wz(0));
  ctx.lineTo(wx(LAYOUT.doorW / 2), wz(0));
  ctx.moveTo(wx(0), wz(-LAYOUT.doorW / 2));
  ctx.lineTo(wx(0), wz(LAYOUT.doorW / 2));
  ctx.stroke();

  ctx.fillStyle = 'rgba(255,235,200,0.95)';
  for (const w of wallLights) {
    const cv = w.group;
    ctx.beginPath();
    ctx.arc(wx(cv.position.x), wz(cv.position.z), 1.8, 0, Math.PI * 2);
    ctx.fill();
  }

  const px = wx(camera.position.x);
  const py = wz(camera.position.z);
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(-yaw);

  ctx.fillStyle = 'rgba(255,235,200,0.18)';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, 26, -Math.PI / 2 - 0.6, -Math.PI / 2 + 0.6);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#ffe5b0';
  ctx.beginPath();
  ctx.moveTo(0, -7);
  ctx.lineTo(5, 5);
  ctx.lineTo(-5, 5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = '10px ui-monospace, monospace';
  ctx.fillText('PLAN', 8, 14);
}
