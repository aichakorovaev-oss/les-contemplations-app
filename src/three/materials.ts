import * as THREE from 'three';

export function makeWoodFloor(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d')!;
  g.fillStyle = '#2c1f15';
  g.fillRect(0, 0, 512, 512);

  for (let y = 0; y < 512; y += 64) {
    g.fillStyle = `rgb(${48 + Math.random() * 20}, ${32 + Math.random() * 12}, ${22 + Math.random() * 10})`;
    g.fillRect(0, y, 512, 60);
    for (let i = 0; i < 80; i++) {
      g.strokeStyle = `rgba(20,10,5,${0.05 + Math.random() * 0.15})`;
      g.beginPath();
      const yy = y + Math.random() * 60;
      g.moveTo(0, yy);
      g.bezierCurveTo(170, yy + (Math.random() - 0.5) * 4, 340, yy + (Math.random() - 0.5) * 4, 512, yy);
      g.stroke();
    }
    g.fillStyle = 'rgba(0,0,0,0.6)';
    g.fillRect(0, y, 512, 2);
  }

  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(8, 8);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function makeWallTexture(hex: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = hex;
  g.fillRect(0, 0, 256, 256);

  const img = g.getImageData(0, 0, 256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 16;
    img.data[i]     = Math.max(0, Math.min(255, img.data[i] + n));
    img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] + n));
    img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] + n));
  }
  g.putImageData(img, 0, 0);

  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, 'rgba(0,0,0,0.10)');
  grad.addColorStop(0.5, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.12)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
