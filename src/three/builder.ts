import * as THREE from 'three';
import { RoomKey, Painting } from '../types/gallery';
import { makeWoodFloor, makeWallTexture } from './materials';
import { fetchImageUrl, makeBlurredTexture } from '../services/imageResolver';

export interface RoomDef {
  name: string;
  subtitle: string;
  wallColor: string;
  trimColor: string;
  floorColor: string;
  accentLight: string;
}

export const ROOMS: Record<RoomKey, RoomDef> = {
  peach: {
    name: 'Salon Pêche',
    subtitle: 'Portraits & Interiors',
    wallColor: '#e6b89c',
    trimColor: '#cf9c7f',
    floorColor: '#3a2a1f',
    accentLight: '#ffdfc6',
  },
  blue: {
    name: 'Salle Bleue',
    subtitle: 'Ukiyo-e & Northern Seas',
    wallColor: '#5d7d9a',
    trimColor: '#3f5b76',
    floorColor: '#2a2620',
    accentLight: '#bcd6ef',
  },
  green: {
    name: 'Cabinet Vert',
    subtitle: 'Gardens & Landscape',
    wallColor: '#6f8a6d',
    trimColor: '#4f6a4d',
    floorColor: '#2b2722',
    accentLight: '#cee5cb',
  },
  yellow: {
    name: 'Salon Jaune',
    subtitle: 'Symbolism & Myth',
    wallColor: '#d6b462',
    trimColor: '#b1944a',
    floorColor: '#3a2c1c',
    accentLight: '#ffe9b0',
  },
};

export const LAYOUT = {
  wallThick: 0.3,
  ceilingH: 4,
  doorW: 2.0,
  cells: {
    peach:  { cx: -5, cz: -5 },
    blue:   { cx:  5, cz: -5 },
    green:  { cx: -5, cz:  5 },
    yellow: { cx:  5, cz:  5 },
  },
  half: 4,
};

export interface ColliderAABB {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface RoomVolume {
  key: RoomKey;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface WallLightItem {
  painting: Painting;
  spot: THREE.SpotLight;
  group: THREE.Group;
  halo: THREE.Mesh;
}

export interface GalleryBuildResult {
  colliders: ColliderAABB[];
  paintingObjects: THREE.Mesh[];
  roomVolumes: RoomVolume[];
  roomFills: Record<string, THREE.PointLight>;
  wallLights: WallLightItem[];
  hemi: THREE.HemisphereLight;
  amb: THREE.AmbientLight;
  floor: THREE.Mesh;
}

const tex = new THREE.TextureLoader();

export function loadSerially(
  url: string,
  onTexture: (t: THREE.Texture) => void,
  onFail?: () => void,
  attempt = 0
): Promise<void> {
  return new Promise(resolve => {
    tex.load(
      url,
      t => {
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 8;
        try {
          onTexture(t);
        } catch (e) {
          console.warn('[gallery]', e);
        }
        resolve();
      },
      undefined,
      () => {
        if (attempt < 2) {
          const delay = 400 * Math.pow(2, attempt);
          setTimeout(() => {
            loadSerially(url, onTexture, onFail, attempt + 1).then(resolve);
          }, delay);
        } else {
          onFail && onFail();
          resolve();
        }
      }
    );
  });
}

export function buildGallery(scene: THREE.Scene): GalleryBuildResult {
  const colliders: ColliderAABB[] = [];
  const paintingObjects: THREE.Mesh[] = [];
  const roomVolumes: RoomVolume[] = [];
  const wallLights: WallLightItem[] = [];

  const H = LAYOUT.ceilingH;
  const T = LAYOUT.wallThick;
  const doorH = 2.6;
  const doorW = LAYOUT.doorW;

  const outerMin = -9, outerMax = 9;

  // Floor
  const floorMat = new THREE.MeshStandardMaterial({
    map: makeWoodFloor(),
    roughness: 0.7,
    metalness: 0.05,
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // Ceiling
  const ceil = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 20),
    new THREE.MeshStandardMaterial({ color: 0x3a322a, roughness: 0.95 })
  );
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = H;
  scene.add(ceil);

  function box(
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    mat: THREE.Material | THREE.Material[],
    opts: { cast?: boolean; collide?: boolean } = {}
  ) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = opts.cast ?? false;
    m.receiveShadow = true;
    scene.add(m);
    if (opts.collide !== false) {
      colliders.push({
        minX: x - w / 2,
        maxX: x + w / 2,
        minZ: z - d / 2,
        maxZ: z + d / 2,
      });
    }
    return m;
  }

  function buildOuterWall(axis: 'x' | 'z', sign: number) {
    for (const which of ['low', 'high']) {
      let cx = 0, cz = 0, w = 0, d = 0;
      let roomKey: RoomKey;
      if (axis === 'x') {
        cz = sign * (outerMax + T / 2);
        d = T;
        w = (outerMax - outerMin) / 2;
        cx = which === 'low' ? -w / 2 : w / 2;
        if (sign < 0) roomKey = which === 'low' ? 'peach' : 'blue';
        else roomKey = which === 'low' ? 'green' : 'yellow';
      } else {
        cx = sign * (outerMax + T / 2);
        w = T;
        d = (outerMax - outerMin) / 2;
        cz = which === 'low' ? -d / 2 : d / 2;
        if (sign < 0) roomKey = which === 'low' ? 'peach' : 'green';
        else roomKey = which === 'low' ? 'blue' : 'yellow';
      }
      const tone = ROOMS[roomKey].wallColor;
      const mat = new THREE.MeshStandardMaterial({
        map: makeWallTexture(tone),
        roughness: 0.85,
      });
      box(cx, H / 2, cz, w, H, d, mat);

      const skirt = new THREE.MeshStandardMaterial({ color: ROOMS[roomKey].trimColor, roughness: 0.5 });
      box(
        cx,
        0.08,
        cz + (axis === 'x' ? -sign * (T / 2 + 0.005) : 0),
        axis === 'x' ? w : 0.01,
        0.16,
        axis === 'x' ? 0.01 : d,
        skirt,
        { collide: false }
      );
      box(
        cx + (axis === 'z' ? -sign * (T / 2 + 0.005) : 0),
        0.08,
        cz,
        axis === 'z' ? 0.01 : w,
        0.16,
        axis === 'z' ? d : 0.01,
        skirt,
        { collide: false }
      );
    }
  }

  buildOuterWall('x', -1);
  buildOuterWall('x', 1);
  buildOuterWall('z', -1);
  buildOuterWall('z', 1);

  function innerWall(axis: 'v' | 'h') {
    const mk = (hex: string) =>
      new THREE.MeshStandardMaterial({ map: makeWallTexture(hex), roughness: 0.85 });
    const peachMat = mk(ROOMS.peach.wallColor);
    const blueMat = mk(ROOMS.blue.wallColor);
    const greenMat = mk(ROOMS.green.wallColor);
    const yellowMat = mk(ROOMS.yellow.wallColor);

    if (axis === 'v') {
      const northZ = (-outerMax + -doorW / 2) / 2;
      const northLen = outerMax - doorW / 2;
      const southZ = (outerMax + doorW / 2) / 2;
      const southLen = outerMax - doorW / 2;
      const matsNorth = [blueMat, peachMat, peachMat, peachMat, peachMat, peachMat];
      const matsSouth = [yellowMat, greenMat, greenMat, greenMat, greenMat, greenMat];
      box(0, H / 2, northZ, T, H, northLen, matsNorth);
      box(0, H / 2, southZ, T, H, southLen, matsSouth);
      box(0, doorH + (H - doorH) / 2, 0, T, H - doorH, doorW, new THREE.MeshStandardMaterial({ color: 0x1a1410, roughness: 0.9 }), { collide: false });
    } else {
      const westX = (-outerMax + -doorW / 2) / 2;
      const westLen = outerMax - doorW / 2;
      const eastX = (outerMax + doorW / 2) / 2;
      const eastLen = outerMax - doorW / 2;
      const matsWest = [peachMat, peachMat, peachMat, peachMat, greenMat, peachMat];
      const matsEast = [blueMat, blueMat, blueMat, blueMat, yellowMat, blueMat];
      box(westX, H / 2, 0, westLen, H, T, matsWest);
      box(eastX, H / 2, 0, eastLen, H, T, matsEast);
      box(0, doorH + (H - doorH) / 2, 0, doorW, H - doorH, T, new THREE.MeshStandardMaterial({ color: 0x1a1410, roughness: 0.9 }), { collide: false });
    }
  }

  innerWall('v');
  innerWall('h');

  for (const key of Object.keys(LAYOUT.cells) as RoomKey[]) {
    const { cx, cz } = LAYOUT.cells[key];
    roomVolumes.push({
      key,
      minX: cx - LAYOUT.half,
      maxX: cx + LAYOUT.half,
      minZ: cz - LAYOUT.half,
      maxZ: cz + LAYOUT.half,
    });
  }

  const hemi = new THREE.HemisphereLight(0xffeacc, 0x2a2520, 0.85);
  scene.add(hemi);
  const amb = new THREE.AmbientLight(0xfff0d8, 0.25);
  scene.add(amb);

  const roomFills: Record<string, THREE.PointLight> = {};
  for (const key of Object.keys(LAYOUT.cells) as RoomKey[]) {
    const { cx, cz } = LAYOUT.cells[key];
    const colour = new THREE.Color(ROOMS[key].accentLight);
    const pt = new THREE.PointLight(colour, 1.8, 18, 1.4);
    pt.position.set(cx, H - 0.4, cz);
    scene.add(pt);

    const pend = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 16, 12),
      new THREE.MeshStandardMaterial({
        color: colour,
        emissive: colour,
        emissiveIntensity: 1.2,
      })
    );
    pend.position.set(cx, H - 0.18, cz);
    scene.add(pend);

    const cord = new THREE.Mesh(
      new THREE.CylinderGeometry(0.01, 0.01, 0.2),
      new THREE.MeshStandardMaterial({ color: 0x111111 })
    );
    cord.position.set(cx, H - 0.08, cz);
    scene.add(cord);
    roomFills[key] = pt;
  }

  scene.fog = new THREE.FogExp2(0x1a1612, 0.018);

  return { colliders, paintingObjects, roomVolumes, roomFills, wallLights, hemi, amb, floor };
}

export function populatePaintings(
  scene: THREE.Scene,
  paintings: Painting[],
  wallLights: WallLightItem[],
  paintingObjects: THREE.Mesh[],
  nudityConsent: boolean | null
): Record<RoomKey, number> {
  // Clear previous
  for (const w of wallLights.slice()) {
    scene.remove(w.group);
    w.group.traverse(child => {
      if ((child as THREE.Mesh).geometry) (child as THREE.Mesh).geometry.dispose();
      if ((child as THREE.Mesh).material) {
        const mat = (child as THREE.Mesh).material;
        if (Array.isArray(mat)) {
          mat.forEach(m => {
            if ((m as any).map) (m as any).map.dispose();
            m.dispose();
          });
        } else {
          if ((mat as any).map) (mat as any).map.dispose();
          mat.dispose();
        }
      }
    });
    wallLights.splice(wallLights.indexOf(w), 1);
  }

  for (const m of paintingObjects.slice()) {
    scene.remove(m.parent || m);
  }
  paintingObjects.length = 0;

  const roomPaintingCounts: Record<RoomKey, number> = { peach: 0, blue: 0, green: 0, yellow: 0 };
  const _half = LAYOUT.half;
  const _T = LAYOUT.wallThick;
  const _H = LAYOUT.ceilingH;

  for (const p of paintings) {
    const _room = (p.room_hint || p.room || 'peach') as RoomKey;
    roomPaintingCounts[_room] = (roomPaintingCounts[_room] || 0) + 1;
    const { cx, cz } = LAYOUT.cells[_room] || LAYOUT.cells.peach;
    const wallInset = _half - _T / 2 - 0.01;
    let x = 0, z = 0, rotY = 0, normal = [0, 0, 1];
    const offset = (p.pos ?? 0) * (_half - 1.2);

    if (p.wall === 'N') {
      x = cx + offset; z = cz - wallInset; rotY = 0; normal = [0, 0, 1];
    } else if (p.wall === 'S') {
      x = cx + offset; z = cz + wallInset; rotY = Math.PI; normal = [0, 0, -1];
    } else if (p.wall === 'E') {
      x = cx + wallInset; z = cz + offset; rotY = -Math.PI / 2; normal = [-1, 0, 0];
    } else {
      x = cx - wallInset; z = cz + offset; rotY = Math.PI / 2; normal = [1, 0, 0];
    }

    const y = 1.65;
    const grp = new THREE.Group();
    grp.position.set(x, y, z);
    grp.rotation.y = rotY;
    scene.add(grp);

    const fThick = 0.06;
    const fDepth = 0.08;
    const frameMat = new THREE.MeshStandardMaterial({
      color: 0x2a1a10, roughness: 0.55, metalness: 0.2,
    });
    const fW = p.width + fThick * 2;
    const fH = p.height + fThick * 2;
    const frame = new THREE.Mesh(new THREE.BoxGeometry(fW, fH, fDepth), frameMat);
    frame.position.z = fDepth / 2;
    frame.castShadow = true;
    grp.add(frame);

    const mat = new THREE.Mesh(
      new THREE.PlaneGeometry(p.width + 0.01, p.height + 0.01),
      new THREE.MeshStandardMaterial({ color: 0x0a0806, roughness: 0.9 })
    );
    mat.position.z = fDepth + 0.001;
    grp.add(mat);

    const placeholderMat = new THREE.MeshStandardMaterial({
      color: 0xb8a07a, roughness: 0.9,
    });
    const canvasMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(p.width, p.height),
      placeholderMat
    );
    canvasMesh.position.z = fDepth + 0.002;
    canvasMesh.userData.painting = p;
    canvasMesh.userData.normal = new THREE.Vector3(...normal);
    canvasMesh.userData.worldPos = new THREE.Vector3(x, y, z);
    grp.add(canvasMesh);
    paintingObjects.push(canvasMesh);

    const isSens = !!(p.nudity || p.graphic);

    fetchImageUrl(p).then(imgUrl => {
      if (!imgUrl) return;
      p.url = imgUrl;
      if (!p.detailUrl) p.detailUrl = imgUrl;

      loadSerially(
        imgUrl,
        t => {
          if (isSens) {
            canvasMesh.userData.cleanTexture = t;
            canvasMesh.userData.applyGateState = function (consent: boolean | null) {
              const isGated = isSens && consent !== true;
              if (isGated) {
                if (canvasMesh.userData.blurredTexture) {
                  canvasMesh.material = new THREE.MeshStandardMaterial({
                    map: canvasMesh.userData.blurredTexture,
                    roughness: 0.7,
                  });
                } else {
                  canvasMesh.material = new THREE.MeshStandardMaterial({
                    color: 0x241b14,
                    roughness: 0.95,
                  });
                  if (!canvasMesh.userData.blurPending) {
                    canvasMesh.userData.blurPending = true;
                    makeBlurredTexture(imgUrl).then(btex => {
                      canvasMesh.userData.blurPending = false;
                      if (btex) canvasMesh.userData.blurredTexture = btex;
                      canvasMesh.userData.applyGateState(consent);
                    });
                  }
                }
              } else {
                canvasMesh.material = new THREE.MeshStandardMaterial({
                  map: t,
                  roughness: 0.7,
                  metalness: 0.0,
                });
              }
            };
            canvasMesh.userData.applyGateState(nudityConsent);
          } else {
            canvasMesh.material = new THREE.MeshStandardMaterial({
              map: t,
              roughness: 0.7,
              metalness: 0.0,
            });
          }
        },
        () => {
          const cv = document.createElement('canvas');
          cv.width = 256;
          cv.height = Math.round((256 * p.height) / p.width);
          const g = cv.getContext('2d')!;
          const grad = g.createLinearGradient(0, 0, cv.width, cv.height);
          grad.addColorStop(0, '#3a2820');
          grad.addColorStop(1, '#6a4a30');
          g.fillStyle = grad;
          g.fillRect(0, 0, cv.width, cv.height);
          g.fillStyle = '#fff';
          g.font = '14px serif';
          g.fillText(p.title, 12, 24);
          const tx = new THREE.CanvasTexture(cv);
          tx.colorSpace = THREE.SRGBColorSpace;
          canvasMesh.material = new THREE.MeshStandardMaterial({ map: tx, roughness: 0.8 });
        }
      );
    });

    const sp = new THREE.SpotLight(0xfff0d0, 2.6, 6.0, Math.PI / 4.5, 0.55, 1.1);
    sp.castShadow = false;
    const lightLocal = new THREE.Object3D();
    lightLocal.position.set(0, 0.95, 0.55);
    grp.add(lightLocal);
    lightLocal.add(sp);
    const tgt = new THREE.Object3D();
    tgt.position.set(0, 0, 0.05);
    grp.add(tgt);
    sp.target = tgt;
    sp.userData.baseIntensity = 2.4;

    const fix = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.06, 0.32, 16),
      new THREE.MeshStandardMaterial({ color: 0xc8a36a, metalness: 0.7, roughness: 0.35 })
    );
    fix.rotation.x = Math.PI / 2.2;
    fix.position.set(0, p.height / 2 + 0.18, fDepth + 0.16);
    grp.add(fix);

    const arm = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, 0.22, 8),
      new THREE.MeshStandardMaterial({ color: 0xc8a36a, metalness: 0.7, roughness: 0.35 })
    );
    arm.position.set(0, p.height / 2 + 0.05, fDepth + 0.08);
    grp.add(arm);

    // Volumetric halo
    const haloBaseY = p.height / 2 + 0.05;
    const haloTopY = _H - 1.65 - 0.15;
    const haloHeight = Math.max(0.6, haloTopY - haloBaseY);
    const haloTopR = 0.18;
    const haloBotR = Math.min(p.width * 0.55, 0.95);
    const haloGeom = new THREE.CylinderGeometry(haloTopR, haloBotR, haloHeight, 36, 6, true);
    const colArr = new Float32Array(haloGeom.attributes.position.count * 3);
    const posArr = haloGeom.attributes.position.array;
    for (let i = 0; i < haloGeom.attributes.position.count; i++) {
      const vy = posArr[i * 3 + 1];
      const tval = (vy + haloHeight / 2) / haloHeight;
      const b = Math.pow(1 - tval, 1.3);
      colArr[i * 3 + 0] = 1.0 * b;
      colArr[i * 3 + 1] = 0.92 * b;
      colArr[i * 3 + 2] = 0.78 * b;
    }
    haloGeom.setAttribute('color', new THREE.BufferAttribute(colArr, 3));
    const haloMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const halo = new THREE.Mesh(haloGeom, haloMat);
    halo.position.set(0, haloBaseY + haloHeight / 2, fDepth + 0.05);
    halo.userData.maxOpacity = 0.22;
    halo.renderOrder = 2;
    grp.add(halo);

    wallLights.push({ painting: p, spot: sp, group: grp, halo });
  }

  return roomPaintingCounts;
}
