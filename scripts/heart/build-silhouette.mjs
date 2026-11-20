/**
 * Renders the loading placeholder for the heart panel: a flat silhouette of the
 * actual model, projected with the same camera, pose, framing and normalisation
 * that `HeartScene` uses (height 3.3, pivot [0.02, -0.34, 0], camera z 6.5, fov 34).
 * Matching the geometry means the placeholder sits exactly where the real heart
 * appears, so the cross-fade does not jump.
 *
 * Usage: node scripts/heart/build-silhouette.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const GLB = resolve(root, 'public/models/heart/heart.glb');
const OUT = resolve(root, 'public/models/heart/silhouette.png');

const HEIGHT = 3.3;
const WIDTH = 1020;
const FRAME_HEIGHT = 440;
const CAMERA = [0, 0.1, 6.5];
const FOV = 34;
const NEAR = 0.1;

const glb = readFileSync(GLB);
const jsonLength = glb.readUInt32LE(12);
const json = JSON.parse(glb.toString('utf8', 20, 20 + jsonLength));
const binStart = 20 + jsonLength + 8;

function readAccessor(index) {
  const accessor = json.accessors[index];
  const view = json.bufferViews[accessor.bufferView];
  const offset = binStart + view.byteOffset + (accessor.byteOffset ?? 0);
  const components = { SCALAR: 1, VEC2: 2, VEC3: 3 }[accessor.type];
  return new Float32Array(glb.buffer, glb.byteOffset + offset, accessor.count * components);
}

const positions = readAccessor(json.meshes[0].primitives[0].attributes.POSITION);

// Normalise exactly like the scene: centre on the bounding box, scale to HEIGHT.
let minX = Infinity, minY = Infinity, minZ = Infinity;
let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
for (let i = 0; i < positions.length; i += 3) {
  minX = Math.min(minX, positions[i]); maxX = Math.max(maxX, positions[i]);
  minY = Math.min(minY, positions[i + 1]); maxY = Math.max(maxY, positions[i + 1]);
  minZ = Math.min(minZ, positions[i + 2]); maxZ = Math.max(maxZ, positions[i + 2]);
}
const scale = HEIGHT / (maxY - minY);
const cx = (minX + maxX) / 2;
const cy = (minY + maxY) / 2;
const cz = (minZ + maxZ) / 2;

// Pivot rotation [0.02, -0.34, 0] with Euler order XYZ, then position [0, 0.06, 0].
const rx = 0.02;
const ry = -0.34;
const cosX = Math.cos(rx), sinX = Math.sin(rx);
const cosY = Math.cos(ry), sinY = Math.sin(ry);

const world = new Float32Array(positions.length);
for (let i = 0; i < positions.length; i += 3) {
  const x = (positions[i] - cx) * scale;
  const y = (positions[i + 1] - cy) * scale;
  const z = (positions[i + 2] - cz) * scale;

  // Ry then Rx (three composes XYZ as Rx·Ry·Rz).
  const x1 = x * cosY + z * sinY;
  const z1 = -x * sinY + z * cosY;
  const y2 = y * cosX - z1 * sinX;
  const z2 = y * sinX + z1 * cosX;

  world[i] = x1;
  world[i + 1] = y2 + 0.06;
  world[i + 2] = z2;
}

// Camera basis (look-at origin, world up 0,1,0).
const [ex, ey, ez] = CAMERA;
const eyeLength = Math.hypot(ex, ey, ez);
const zAxis = [ex / eyeLength, ey / eyeLength, ez / eyeLength];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const normalize = (v) => {
  const length = Math.hypot(...v) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
};
const xBasis = normalize(cross([0, 1, 0], zAxis));
const yBasis = cross(zAxis, xBasis);

const f = 1 / Math.tan((FOV * Math.PI) / 360);
const aspect = WIDTH / FRAME_HEIGHT;

function project(x, y, z) {
  // view space
  const vx = xBasis[0] * (x - ex) + xBasis[1] * (y - ey) + xBasis[2] * (z - ez);
  const vy = yBasis[0] * (x - ex) + yBasis[1] * (y - ey) + yBasis[2] * (z - ez);
  const vz = zAxis[0] * (x - ex) + zAxis[1] * (y - ey) + zAxis[2] * (z - ez);

  const clipX = (f / aspect) * vx;
  const clipY = f * vy;
  const clipW = -vz;
  if (clipW <= NEAR) return null;
  return [
    (clipX / clipW * 0.5 + 0.5) * WIDTH,
    (1 - (clipY / clipW * 0.5 + 0.5)) * FRAME_HEIGHT,
  ];
}

const mask = new Uint8Array(WIDTH * FRAME_HEIGHT);

for (let t = 0; t < world.length; t += 9) {
  const a = project(world[t], world[t + 1], world[t + 2]);
  const b = project(world[t + 3], world[t + 4], world[t + 5]);
  const c = project(world[t + 6], world[t + 7], world[t + 8]);
  if (!a || !b || !c) continue;

  const minPX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
  const maxPX = Math.min(WIDTH - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
  const minPY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
  const maxPY = Math.min(FRAME_HEIGHT - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
  const area = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
  if (Math.abs(area) < 1e-9) continue;

  for (let y = minPY; y <= maxPY; y++) {
    for (let x = minPX; x <= maxPX; x++) {
      const w0 = ((b[0] - x) * (c[1] - y) - (c[0] - x) * (b[1] - y)) / area;
      const w1 = ((c[0] - x) * (a[1] - y) - (a[0] - x) * (c[1] - y)) / area;
      const w2 = 1 - w0 - w1;
      if (w0 < -0.02 || w1 < -0.02 || w2 < -0.02) continue;
      mask[y * WIDTH + x] = 1;
    }
  }
}

// Crop to the silhouette so the placeholder can be sized by height alone.
let boxMinX = WIDTH, boxMinY = FRAME_HEIGHT, boxMaxX = -1, boxMaxY = -1;
for (let y = 0; y < FRAME_HEIGHT; y++) {
  for (let x = 0; x < WIDTH; x++) {
    if (!mask[y * WIDTH + x]) continue;
    boxMinX = Math.min(boxMinX, x); boxMaxX = Math.max(boxMaxX, x);
    boxMinY = Math.min(boxMinY, y); boxMaxY = Math.max(boxMaxY, y);
  }
}
const pad = 2;
boxMinX = Math.max(0, boxMinX - pad);
boxMinY = Math.max(0, boxMinY - pad);
boxMaxX = Math.min(WIDTH - 1, boxMaxX + pad);
boxMaxY = Math.min(FRAME_HEIGHT - 1, boxMaxY + pad);

const width = boxMaxX - boxMinX + 1;
const height = boxMaxY - boxMinY + 1;
// The crop is symmetric around the model's own bounds, so the component can place
// the image with height + vertical centre alone, at any panel aspect ratio.
const heightPercent = Number((100 * height / FRAME_HEIGHT).toFixed(1));
const centrePercent = Number((100 * (boxMinY + height / 2) / FRAME_HEIGHT).toFixed(1));
console.log(`silhouette ${width}x${height} in a ${WIDTH}x${FRAME_HEIGHT} frame`);
console.log(`HeartSilhouette: h-[${heightPercent}%] top-[${centrePercent}%]`);

// RGBA PNG: a dim warm shadow tone at full alpha inside the mask.
const TONE = [42, 16, 16];
const raw = Buffer.alloc((width * 4 + 1) * height);
for (let y = 0; y < height; y++) {
  const rowStart = y * (width * 4 + 1);
  raw[rowStart] = 0;
  for (let x = 0; x < width; x++) {
    const filled = mask[(y + boxMinY) * WIDTH + (x + boxMinX)];
    const o = rowStart + 1 + x * 4;
    raw[o] = TONE[0];
    raw[o + 1] = TONE[1];
    raw[o + 2] = TONE[2];
    raw[o + 3] = filled ? 255 : 0;
  }
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    let c = (crc ^ byte) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(width, 0);
ihdr.writeUInt32BE(height, 4);
ihdr[8] = 8;
ihdr[9] = 6;

writeFileSync(OUT, Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]));
console.log('wrote public/models/heart/silhouette.png');
