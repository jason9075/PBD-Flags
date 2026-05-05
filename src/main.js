import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import GUI from "https://cdn.jsdelivr.net/npm/lil-gui@0.19/+esm";

const canvas = document.getElementById("canvas");
const nodeLabelsOverlay = document.getElementById("node-labels");
const impulseInfo = document.getElementById("impulse-info");
const windInfo = document.getElementById("wind-info");
const modeInfo = document.getElementById("mode-info");
const explorerInfo = document.getElementById("mode-explorer-info");
const statusBanner = document.getElementById("status-banner");
const amplitudeChart = document.getElementById("amplitude-chart");
const modeGallery = document.getElementById("mode-gallery");
const openMathButton = document.getElementById("open-math");
const closeMathButton = document.getElementById("close-math");
const languageToggle = document.getElementById("language-toggle");
const mathModal = document.getElementById("math-modal");
const mathContent = document.getElementById("math-content");
let windLabel = null;

const COLS = 4;
const ROWS = 3;
const NODE_COUNT = COLS * ROWS;
const REST_X = 1.15;
const REST_Y = 0.85;
const poleHeight = 6.7;
const poleRadius = 0.05;
const FLAG_TOP_OFFSET = 0.1;
const FLAG_TOP_Y = poleHeight * 0.5 - FLAG_TOP_OFFSET;
const POLE_X = -1.2 * REST_X;
const TRACE_LENGTH = 54;
const DISPLACEMENT_DIRECTION = new THREE.Vector3(0.12, 0, 1).normalize();
const WIND_DISPLACEMENT_DIRECTION = new THREE.Vector3(1, 0, -0.12).normalize();
const FREE_INDICES = [];
const FREE_LOOKUP = new Map();

for (let row = 0; row < ROWS; row += 1) {
  for (let col = 1; col < COLS; col += 1) {
    const nodeIndex = row * COLS + col;
    FREE_LOOKUP.set(nodeIndex, FREE_INDICES.length);
    FREE_INDICES.push(nodeIndex);
  }
}

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x2e3440, 0.06);

const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
camera.position.set(0.3, 0.1, 10.8);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(1.45, 0.45, 0);
controls.minDistance = 4.5;
controls.maxDistance = 18;
controls.maxPolarAngle = Math.PI * 0.92;
controls.update();

scene.add(new THREE.AmbientLight(0x4c566a, 1.4));
const keyLight = new THREE.DirectionalLight(0xeceff4, 1.6);
keyLight.position.set(3, 3, 6);
scene.add(keyLight);
const rimLight = new THREE.DirectionalLight(0x81a1c1, 1.1);
rimLight.position.set(-2, 1, 4);
scene.add(rimLight);

const floor = new THREE.Mesh(
  new THREE.CircleGeometry(10, 48),
  new THREE.MeshStandardMaterial({
    color: 0x3b4252,
    transparent: true,
    opacity: 0.34,
    roughness: 0.9,
    metalness: 0.02,
  }),
);
floor.rotation.x = -Math.PI * 0.5;
floor.position.set(1.45, -2.55, -0.25);
scene.add(floor);

const state = {
  isAnimating: true,
  modalLanguage: "en",
  forceTarget: "tip",
  forceScale: 1.6,
  stiffnessScale: 1.2,
  massScale: 1,
  windEnabled: false,
  windMode: "steady",
  renderMode: "solid",
  showTraces: true,
  showArrows: true,
  cutMode: false,
  activeMode: null,
  statusUntil: 0,
  impulseUntil: 0,
  lastImpulseTarget: "tip",
  hoveredLinkIndex: -1,
  pointerInsideCanvas: false,
};

const ui = {
  impulseTarget: state.forceTarget,
  force: state.forceScale,
  stiffness: state.stiffnessScale,
  mass: state.massScale,
  wind: state.windEnabled,
  windMode: state.windMode,
  render: state.renderMode,
  motion: state.isAnimating,
  tracePaths: state.showTraces,
  modeArrows: state.showArrows,
  cutMode: state.cutMode,
  applyPulse: () => applyImpulse(state.forceTarget, state.forceScale),
  resetCalm: () => resetCalmState(),
  restoreLinks: () => restoreAllLinks(),
  resetView: () => resetView(),
};
const guiControllers = [];

const nodes = [];
const links = [];
const triangles = [];
const tailIndices = [COLS - 1, 2 * COLS - 1, 3 * COLS - 1];
const traceStates = tailIndices.map(() => []);
const traceLines = [];
const amplitudeRows = [];
const arrowHelpers = [];
const nodeLabelElements = [];
const pointerScreen = new THREE.Vector2();
const projectedA = new THREE.Vector3();
const projectedB = new THREE.Vector3();
const highlightedLinkPositions = [
  new THREE.Vector3(),
  new THREE.Vector3(),
];
const windDirectionArrow = new THREE.ArrowHelper(
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(0, 0, 0),
  1.8,
  0x88c0d0,
  0.24,
  0.14,
);
const windArrowDirection = new THREE.Vector3(1, 0, 0);
windDirectionArrow.visible = false;
scene.add(windDirectionArrow);
const impulseArrow = new THREE.ArrowHelper(
  DISPLACEMENT_DIRECTION.clone(),
  new THREE.Vector3(0, 0, 0),
  1.2,
  0xbf616a,
  0.2,
  0.12,
);
impulseArrow.visible = false;
impulseArrow.line.material.transparent = true;
impulseArrow.cone.material.transparent = true;
scene.add(impulseArrow);

function nodeIndex(row, col) {
  return row * COLS + col;
}

function rotateDirectionByAnchor(direction) {
  return direction.clone();
}

function createRestPosition(row, col) {
  return new THREE.Vector3(POLE_X + col * REST_X, FLAG_TOP_Y - row * REST_Y, 0);
}

function buildNodeLabels() {
  nodeLabelsOverlay.innerHTML = "";
  windLabel = document.createElement("div");
  windLabel.id = "wind-label";
  windLabel.className = "wind-label";
  windLabel.hidden = true;
  windLabel.textContent = "Wind";
  nodeLabelsOverlay.appendChild(windLabel);
  nodes.forEach((node) => {
    const label = document.createElement("div");
    label.className = `node-label${node.fixed ? " fixed" : ""}`;
    label.textContent = `${node.index}`;
    nodeLabelsOverlay.appendChild(label);
    nodeLabelElements.push(label);
  });
}

function getColumnSag(col, stiffnessScale) {
  const normalized = col / (COLS - 1);
  return normalized * normalized * (0.2 + (1.55 / stiffnessScale));
}

for (let row = 0; row < ROWS; row += 1) {
  for (let col = 0; col < COLS; col += 1) {
    const index = nodeIndex(row, col);
    const anchor = createRestPosition(row, col);
    const fixed = col === 0;
    nodes.push({
      index,
      row,
      col,
      fixed,
      anchor,
      position: anchor.clone(),
      velocity: new THREE.Vector3(),
      displacement: 0,
    });
  }
}

for (let row = 0; row < ROWS; row += 1) {
  for (let col = 0; col < COLS; col += 1) {
    const current = nodeIndex(row, col);
    if (col < COLS - 1) {
      const right = nodeIndex(row, col + 1);
      links.push({
        a: current,
        b: right,
        weight: 1,
        axis: "horizontal",
        cut: false,
        visible: true,
        restLength: nodes[current].anchor.distanceTo(nodes[right].anchor),
      });
    }
    if (row < ROWS - 1) {
      const down = nodeIndex(row + 1, col);
      links.push({
        a: current,
        b: down,
        weight: 1,
        axis: "vertical",
        cut: false,
        visible: true,
        restLength: nodes[current].anchor.distanceTo(nodes[down].anchor),
      });
    }
  }
}

for (let row = 0; row < ROWS - 1; row += 1) {
  for (let col = 0; col < COLS - 1; col += 1) {
    const a = nodeIndex(row, col);
    const b = nodeIndex(row, col + 1);
    const c = nodeIndex(row + 1, col);
    const d = nodeIndex(row + 1, col + 1);

    links.push({
      a,
      b: d,
      weight: 0.55,
      axis: "shear",
      cut: false,
      visible: false,
      restLength: nodes[a].anchor.distanceTo(nodes[d].anchor),
    });
    links.push({
      a: b,
      b: c,
      weight: 0.55,
      axis: "shear",
      cut: false,
      visible: false,
      restLength: nodes[b].anchor.distanceTo(nodes[c].anchor),
    });
  }
}

const visibleLinks = links.filter((link) => link.visible !== false);

for (let row = 0; row < ROWS - 1; row += 1) {
  for (let col = 0; col < COLS - 1; col += 1) {
    const a = nodeIndex(row, col);
    const b = nodeIndex(row, col + 1);
    const c = nodeIndex(row + 1, col);
    const d = nodeIndex(row + 1, col + 1);
    triangles.push(a, c, b, b, c, d);
  }
}

const flagGeometry = new THREE.BufferGeometry();
flagGeometry.setIndex(triangles);
flagGeometry.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(NODE_COUNT * 3), 3));
const flagMaterial = new THREE.MeshStandardMaterial({
  color: 0x81a1c1,
  side: THREE.DoubleSide,
  transparent: true,
  opacity: 0.68,
  roughness: 0.72,
  metalness: 0.08,
  wireframe: false,
});
const flagMesh = new THREE.Mesh(flagGeometry, flagMaterial);
scene.add(flagMesh);

const edgeGeometry = new THREE.BufferGeometry();
edgeGeometry.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(visibleLinks.length * 2 * 3), 3));
const edgeLines = new THREE.LineSegments(
  edgeGeometry,
  new THREE.LineBasicMaterial({ color: 0x88c0d0, transparent: true, opacity: 0.72 }),
);
scene.add(edgeLines);
const highlightedLink = new THREE.Line(
  new THREE.BufferGeometry().setFromPoints(highlightedLinkPositions),
  new THREE.LineBasicMaterial({ color: 0xebcb8b, transparent: true, opacity: 0.95 }),
);
highlightedLink.visible = false;
scene.add(highlightedLink);

const poleGroup = new THREE.Group();
const poleMesh = new THREE.Mesh(
  new THREE.CylinderGeometry(poleRadius, poleRadius, poleHeight, 20),
  new THREE.MeshStandardMaterial({
    color: 0x4c566a,
    roughness: 0.48,
    metalness: 0.32,
  }),
);
poleMesh.position.set(nodes[0].anchor.x, 0, -0.08);
poleGroup.add(poleMesh);

const finial = new THREE.Mesh(
  new THREE.SphereGeometry(0.085, 18, 18),
  new THREE.MeshStandardMaterial({
    color: 0x88c0d0,
    emissive: 0x233746,
    roughness: 0.4,
    metalness: 0.2,
  }),
);
finial.position.set(nodes[0].anchor.x, poleHeight * 0.5 + 0.09, -0.08);
poleGroup.add(finial);

const base = new THREE.Mesh(
  new THREE.CylinderGeometry(0.1, 0.16, 0.16, 20),
  new THREE.MeshStandardMaterial({
    color: 0x3b4252,
    roughness: 0.8,
    metalness: 0.1,
  }),
);
base.position.set(nodes[0].anchor.x, -poleHeight * 0.5 - 0.01, -0.08);
poleGroup.add(base);
scene.add(poleGroup);

const fixedGeometry = new THREE.BufferGeometry();
fixedGeometry.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(ROWS * 3), 3));
const fixedPoints = new THREE.Points(
  fixedGeometry,
  new THREE.PointsMaterial({ color: 0xbf616a, size: 0.14, sizeAttenuation: true }),
);
scene.add(fixedPoints);

const freeGeometry = new THREE.BufferGeometry();
freeGeometry.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(FREE_INDICES.length * 3), 3));
const freePoints = new THREE.Points(
  freeGeometry,
  new THREE.PointsMaterial({ color: 0xeceff4, size: 0.12, sizeAttenuation: true }),
);
scene.add(freePoints);

const anchorGroup = new THREE.Group();
for (let row = 0; row < ROWS; row += 1) {
  const center = nodes[nodeIndex(row, 0)].anchor;
  const size = 0.11;
  const crossGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(center.x - size, center.y - size, 0.16),
    new THREE.Vector3(center.x + size, center.y + size, 0.16),
    new THREE.Vector3(center.x - size, center.y + size, 0.16),
    new THREE.Vector3(center.x + size, center.y - size, 0.16),
  ]);
  const cross = new THREE.LineSegments(
    crossGeometry,
    new THREE.LineBasicMaterial({ color: 0xbf616a }),
  );
  anchorGroup.add(cross);
}
scene.add(anchorGroup);

for (let index = 0; index < tailIndices.length; index += 1) {
  const traceGeometry = new THREE.BufferGeometry();
  traceGeometry.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(TRACE_LENGTH * 3), 3));
  const line = new THREE.Line(
    traceGeometry,
    new THREE.LineBasicMaterial({ color: 0xebcb8b, transparent: true, opacity: 0.44 }),
  );
  traceLines.push(line);
  scene.add(line);
}

function buildModeMatrix(stiffnessScale, massScale) {
  const size = FREE_INDICES.length;
  const matrix = Array.from({ length: size }, () => Array(size).fill(0));
  for (const link of links) {
    if (link.cut) {
      continue;
    }
    const { a, b, weight } = link;
    const freeA = FREE_LOOKUP.get(a);
    const freeB = FREE_LOOKUP.get(b);
    const k = (weight * stiffnessScale) / massScale;
    if (freeA !== undefined) {
      matrix[freeA][freeA] += k;
    }
    if (freeB !== undefined) {
      matrix[freeB][freeB] += k;
    }
    if (freeA !== undefined && freeB !== undefined) {
      matrix[freeA][freeB] -= k;
      matrix[freeB][freeA] -= k;
    }
  }
  return matrix;
}

function jacobiEigenDecomposition(input) {
  const size = input.length;
  const matrix = input.map((row) => [...row]);
  const vectors = Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, col) => (row === col ? 1 : 0)),
  );
  const maxIterations = 80;

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    let p = 0;
    let q = 1;
    let maxValue = Math.abs(matrix[p][q]);
    for (let row = 0; row < size; row += 1) {
      for (let col = row + 1; col < size; col += 1) {
        const value = Math.abs(matrix[row][col]);
        if (value > maxValue) {
          maxValue = value;
          p = row;
          q = col;
        }
      }
    }
    if (maxValue < 1e-10) {
      break;
    }

    const app = matrix[p][p];
    const aqq = matrix[q][q];
    const apq = matrix[p][q];
    const theta = (aqq - app) / (2 * apq);
    const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
    const c = 1 / Math.sqrt(t * t + 1);
    const s = t * c;

    for (let col = 0; col < size; col += 1) {
      if (col !== p && col !== q) {
        const mp = matrix[col][p];
        const mq = matrix[col][q];
        matrix[col][p] = c * mp - s * mq;
        matrix[p][col] = matrix[col][p];
        matrix[col][q] = s * mp + c * mq;
        matrix[q][col] = matrix[col][q];
      }
    }

    matrix[p][p] = c * c * app - 2 * s * c * apq + s * s * aqq;
    matrix[q][q] = s * s * app + 2 * s * c * apq + c * c * aqq;
    matrix[p][q] = 0;
    matrix[q][p] = 0;

    for (let row = 0; row < size; row += 1) {
      const vp = vectors[row][p];
      const vq = vectors[row][q];
      vectors[row][p] = c * vp - s * vq;
      vectors[row][q] = s * vp + c * vq;
    }
  }

  const values = matrix.map((row, index) => row[index]);
  const result = values.map((value, index) => ({
    value,
    vector: vectors.map((row) => row[index]),
  }));
  result.sort((left, right) => left.value - right.value);

  result.forEach((mode) => {
    const norm = Math.hypot(...mode.vector) || 1;
    mode.vector = mode.vector.map((entry) => entry / norm);
    mode.frequency = Math.sqrt(Math.max(mode.value, 0));
  });

  return result;
}

let modes = [];

function updateModes() {
  modes = jacobiEigenDecomposition(buildModeMatrix(state.stiffnessScale, state.massScale));
  buildModeGallery();
  amplitudeRows.length = 0;
  buildAmplitudeChart();
}

function buildModeGallery() {
  modeGallery.innerHTML = "";
  modes.forEach((mode, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "mode-button";
    if (state.activeMode === index) {
      button.classList.add("active");
    }
    button.innerHTML = `<strong>v${index + 1}</strong>`;
    button.addEventListener("click", () => exciteMode(index));
    modeGallery.appendChild(button);
  });
}

function buildAmplitudeChart() {
  amplitudeChart.innerHTML = "";
  for (let index = 0; index < modes.length; index += 1) {
    const row = document.createElement("div");
    row.className = "bar-row";
    row.innerHTML = `
      <span>v${index + 1}</span>
      <div class="bar-track"><div class="bar-fill"></div></div>
      <strong>0.00</strong>
    `;
    amplitudeChart.appendChild(row);
    amplitudeRows.push({
      fill: row.querySelector(".bar-fill"),
      value: row.querySelector("strong"),
    });
  }
}

function renderModalContent() {
  const modalCopy = {
    en: `
      <p>This flag is modeled as a small spring lattice with 12 nodes and 9 free vertical degrees of freedom after fixing the pole side.</p>
      <p>The free displacement vector $q \\in \\mathbb{R}^9$ follows a damped second-order system:</p>
      <p>$$
        \\ddot{q} + c\\dot{q} + Kq = f(t)
      $$</p>
      <p>Here $K$ is the stiffness matrix assembled from horizontal and vertical springs. Its eigenvectors define the modal basis:</p>
      <p>$$
        K\\mathbf{v}_i = \\lambda_i \\mathbf{v}_i, \\qquad \\omega_i = \\sqrt{\\lambda_i}
      $$</p>
      <p>Projecting the current shape onto each mode reveals which oscillation family the chosen force excites most strongly. Localized forcing near the tip tends to emphasize higher-frequency modes because it injects sharper spatial variation.</p>
      <pre><code class="language-js">for (const mode of modes) {
  const amplitude = dot(displacement, mode.vector);
  bars.push(Math.abs(amplitude));
}</code></pre>
    `,
    zhTW: `
      <p>這面旗子被建模成一個小型彈簧晶格。總共有 12 個節點，左側固定在旗桿上的 3 個點不動，因此剩下 9 個自由的垂直位移自由度。</p>
      <p>把自由位移寫成向量 $q \\in \\mathbb{R}^9$，其運動可近似為阻尼二階系統：</p>
      <p>$$
        \\ddot{q} + c\\dot{q} + Kq = f(t)
      $$</p>
      <p>其中 $K$ 是由水平與垂直彈簧組裝出的剛度矩陣。對它做特徵分解後，可得到模態基底：</p>
      <p>$$
        K\\mathbf{v}_i = \\lambda_i \\mathbf{v}_i, \\qquad \\omega_i = \\sqrt{\\lambda_i}
      $$</p>
      <p>每個特徵向量 $\\mathbf{v}_i$ 對應一種「純模式」的旗幟形狀，而特徵值決定它的自然頻率。當你把目前位移投影到這些模態上，就能看出哪個模式最主導當前運動。</p>
      <p>尾端施力比全域施力更容易激發高頻模態，因為尾端脈衝在空間上更局部，會帶入較尖銳的形變，這種形狀和高階模態更接近。</p>
      <pre><code class="language-js">for (const mode of modes) {
  const amplitude = dot(displacement, mode.vector);
  bars.push(Math.abs(amplitude));
}</code></pre>
    `,
  };

  mathContent.innerHTML = modalCopy[state.modalLanguage];
  if (window.renderMathInElement) {
    window.renderMathInElement(mathContent, {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "$", right: "$", display: false },
      ],
    });
  }
  if (window.Prism) {
    window.Prism.highlightAllUnder(mathContent);
  }
}

function updateNodeMotion(dt) {
  const gravity = new THREE.Vector3(0, -4.4, 0);
  const damping = Math.exp(-2.8 * dt / state.massScale);
  const stretchStiffness = Math.min(0.34 + state.stiffnessScale * 0.2, 0.92);
  const constraintIterations = 7;
  const displacementDirection = rotateDirectionByAnchor(DISPLACEMENT_DIRECTION);
  const previousPositions = nodes.map((node) => node.position.clone());

  for (const node of nodes) {
    if (node.fixed) {
      node.position.copy(node.anchor);
      node.velocity.set(0, 0, 0);
      continue;
    }

    node.velocity.addScaledVector(gravity, dt);
    node.velocity.multiplyScalar(damping);
    node.position.addScaledVector(node.velocity, dt);
  }

  for (let iteration = 0; iteration < constraintIterations; iteration += 1) {
    for (const node of nodes) {
      if (node.fixed) {
        node.position.copy(node.anchor);
      }
    }

    for (const link of links) {
      if (link.cut) {
        continue;
      }

      const a = nodes[link.a];
      const b = nodes[link.b];
      const delta = b.position.clone().sub(a.position);
      const distance = delta.length();
      if (distance < 1e-6) {
        continue;
      }

      const difference = (distance - link.restLength) / distance;
      const correction = delta.multiplyScalar(0.5 * stretchStiffness * difference);

      if (!a.fixed && !b.fixed) {
        a.position.add(correction);
        b.position.sub(correction);
      } else if (a.fixed && !b.fixed) {
        b.position.sub(correction.multiplyScalar(2));
      } else if (!a.fixed && b.fixed) {
        a.position.add(correction.multiplyScalar(2));
      }
    }
  }

  for (const node of nodes) {
    if (node.fixed) {
      node.position.copy(node.anchor);
      node.velocity.set(0, 0, 0);
      node.displacement = 0;
      continue;
    }

    node.velocity.copy(node.position).sub(previousPositions[node.index]).multiplyScalar(1 / Math.max(dt, 1e-4));
    node.displacement = node.position.clone().sub(node.anchor).dot(displacementDirection);
  }
}

function applyWindDrive(now) {
  if (!state.windEnabled) {
    return;
  }

  for (const index of FREE_INDICES) {
    const node = nodes[index];
    const windDirection = getWindDirection(now, node);
    node.velocity.addScaledVector(windDirection, getWindDriveValue(now, node) / state.massScale);
  }
}

function getWindDirection(now, node = nodes[FREE_INDICES[0]]) {
  const baseDirection = WIND_DISPLACEMENT_DIRECTION.clone();

  if (state.windMode !== "steady") {
    return baseDirection;
  }

  const swayAngle = 0.2 * Math.sin(now * 0.0012 + node.col * 0.6 + node.row * 0.35);
  return baseDirection.applyAxisAngle(new THREE.Vector3(0, 1, 0), swayAngle).normalize();
}

function getWindDriveValue(now, node) {
  const phase = now * 0.0018 + node.col * 0.85 + node.row * 0.4;

  if (state.windMode === "pulse") {
    const burst = Math.max(0, Math.sin(now * 0.006 + node.col * 0.7));
    const ripple = 0.0045 * (0.5 + 0.5 * Math.sin(phase * 0.72));
    return (burst * burst * 0.042 + ripple) * state.forceScale;
  }

  const baseFlow = 0.018;
  const ripple = 0.006 * (0.5 + 0.5 * Math.sin(phase));
  const gust = 0.02 * Math.max(0, Math.sin(phase * 0.47 + 1.2));
  return (baseFlow + ripple + gust) * state.forceScale;
}

function getWindArrowState(now) {
  if (!state.windEnabled) {
    return {
      direction: WIND_DISPLACEMENT_DIRECTION.clone(),
      length: 0,
    };
  }

  let totalDrive = 0;
  const direction = new THREE.Vector3();
  for (const index of FREE_INDICES) {
    const node = nodes[index];
    const drive = getWindDriveValue(now, node);
    totalDrive += drive;
    direction.addScaledVector(getWindDirection(now, node), Math.abs(drive));
  }

  const averageDrive = totalDrive / FREE_INDICES.length;
  if (direction.lengthSq() < 1e-6) {
    direction.copy(getWindDirection(now));
  } else {
    direction.normalize();
  }
  const length = 1.35 + Math.min(Math.abs(averageDrive) / 0.013, 1) * 1.1;

  return { direction, length };
}

function getImpulseSelection(target) {
  const map = {
    tip: FREE_INDICES.filter((index) => nodes[index].col === COLS - 1),
    mid: FREE_INDICES.filter((index) => nodes[index].col >= 1 && nodes[index].col <= 2),
    global: FREE_INDICES,
  };

  return map[target];
}

function setCutMode(enabled) {
  state.cutMode = enabled;
  controls.enabled = !enabled;
  canvas.style.cursor = enabled ? "crosshair" : "";
  if (!enabled) {
    state.hoveredLinkIndex = -1;
    state.pointerInsideCanvas = false;
    highlightedLink.visible = false;
  }
}

function restoreAllLinks() {
  links.forEach((link) => {
    link.cut = false;
  });
  state.activeMode = null;
  state.hoveredLinkIndex = -1;
  highlightedLink.visible = false;
  updateModes();
  updateGeometry();
  state.statusUntil = performance.now() + 2200;
  statusBanner.textContent = "Restored all links. The flag mesh and modal coupling are back to the intact lattice.";
}

function updateHighlightedLink() {
  const hovered = visibleLinks[state.hoveredLinkIndex];
  if (!state.cutMode || !hovered || hovered.cut) {
    highlightedLink.visible = false;
    return;
  }

  highlightedLinkPositions[0].copy(nodes[hovered.a].position).setZ(nodes[hovered.a].position.z + 0.04);
  highlightedLinkPositions[1].copy(nodes[hovered.b].position).setZ(nodes[hovered.b].position.z + 0.04);
  highlightedLink.geometry.setFromPoints(highlightedLinkPositions);
  highlightedLink.visible = true;
}

function pointToSegmentDistance(pointerX, pointerY, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const lengthSquared = abx * abx + aby * aby;
  if (lengthSquared < 1e-6) {
    return Math.hypot(pointerX - ax, pointerY - ay);
  }

  const t = Math.max(0, Math.min(1, ((pointerX - ax) * abx + (pointerY - ay) * aby) / lengthSquared));
  const closestX = ax + abx * t;
  const closestY = ay + aby * t;
  return Math.hypot(pointerX - closestX, pointerY - closestY);
}

function updateHoveredLink(clientX, clientY) {
  if (!state.cutMode || !state.pointerInsideCanvas) {
    return;
  }

  const rect = canvas.getBoundingClientRect();
  const threshold = 10;
  let closestIndex = -1;
  let closestDistance = threshold;

  visibleLinks.forEach((link, index) => {
    if (link.cut) {
      return;
    }

    projectedA.copy(nodes[link.a].position).project(camera);
    projectedB.copy(nodes[link.b].position).project(camera);

    if (
      projectedA.z < -1 || projectedA.z > 1 ||
      projectedB.z < -1 || projectedB.z > 1
    ) {
      return;
    }

    const ax = rect.left + ((projectedA.x + 1) * 0.5) * rect.width;
    const ay = rect.top + ((-projectedA.y + 1) * 0.5) * rect.height;
    const bx = rect.left + ((projectedB.x + 1) * 0.5) * rect.width;
    const by = rect.top + ((-projectedB.y + 1) * 0.5) * rect.height;
    const distance = pointToSegmentDistance(clientX, clientY, ax, ay, bx, by);

    if (distance < closestDistance) {
      closestDistance = distance;
      closestIndex = index;
    }
  });

  state.hoveredLinkIndex = closestIndex;
  updateHighlightedLink();
}

function cutHoveredLink() {
  const hovered = visibleLinks[state.hoveredLinkIndex];
  if (!state.cutMode || !hovered || hovered.cut) {
    return;
  }

  hovered.cut = true;
  state.hoveredLinkIndex = -1;
  highlightedLink.visible = false;
  state.activeMode = null;
  updateModes();
  updateGeometry();
  state.statusUntil = performance.now() + 2400;
  statusBanner.textContent = `Cut link ${hovered.a}-${hovered.b}. Modal coupling and line rendering updated.`;
}

function updateGeometry() {
  const surfacePositions = flagGeometry.getAttribute("position");
  const linePositions = edgeGeometry.getAttribute("position");
  const fixedPositions = fixedGeometry.getAttribute("position");
  const freePositions = freeGeometry.getAttribute("position");

  nodes.forEach((node, index) => {
    surfacePositions.setXYZ(index, node.position.x, node.position.y, node.position.z);
    if (node.fixed) {
      fixedPositions.setXYZ(node.row, node.position.x, node.position.y, node.position.z + 0.18);
    } else {
      const freeIndex = FREE_LOOKUP.get(index);
      freePositions.setXYZ(freeIndex, node.position.x, node.position.y, node.position.z);
    }
  });

  visibleLinks.forEach((link, edgeIndex) => {
    const a = nodes[link.a].position;
    const b = link.cut ? a : nodes[link.b].position;
    linePositions.setXYZ(edgeIndex * 2, a.x, a.y, a.z + 0.01);
    linePositions.setXYZ(edgeIndex * 2 + 1, b.x, b.y, b.z + 0.01);
  });

  surfacePositions.needsUpdate = true;
  linePositions.needsUpdate = true;
  fixedPositions.needsUpdate = true;
  freePositions.needsUpdate = true;
  flagGeometry.computeVertexNormals();
  updateHighlightedLink();
}

function updateNodeLabels() {
  const width = window.innerWidth;
  const height = window.innerHeight;

  nodes.forEach((node, index) => {
    const label = nodeLabelElements[index];
    const projected = node.position.clone().project(camera);
    const isVisible = projected.z >= -1 && projected.z <= 1;

    if (!isVisible) {
      label.style.display = "none";
      return;
    }

    label.style.display = "block";
    label.style.left = `${((projected.x + 1) * 0.5) * width}px`;
    label.style.top = `${((-projected.y + 1) * 0.5) * height - 12}px`;
  });
}

function updateWindLabel() {
  if (!windLabel) {
    return;
  }

  if (!state.windEnabled) {
    windLabel.hidden = true;
    return;
  }

  const width = window.innerWidth;
  const height = window.innerHeight;
  const projected = windDirectionArrow.position.clone().project(camera);
  const isVisible = projected.z >= -1 && projected.z <= 1;

  if (!isVisible) {
    windLabel.hidden = true;
    return;
  }

  const anchor = windDirectionArrow.position.clone().add(windArrowDirection.clone().multiplyScalar(0.55));
  const labelProjected = anchor.project(camera);

  windLabel.hidden = false;
  windLabel.style.left = `${((labelProjected.x + 1) * 0.5) * width}px`;
  windLabel.style.top = `${((-labelProjected.y + 1) * 0.5) * height - 18}px`;
}

function updateTraces() {
  traceLines.forEach((line, traceIndex) => {
    const history = traceStates[traceIndex];
    const node = nodes[tailIndices[traceIndex]].position.clone();
    history.push(node);
    if (history.length > TRACE_LENGTH) {
      history.shift();
    }
    const positions = line.geometry.getAttribute("position");
    for (let index = 0; index < TRACE_LENGTH; index += 1) {
      const point = history[index] || node;
      positions.setXYZ(index, point.x, point.y, point.z);
    }
    positions.needsUpdate = true;
    line.visible = state.showTraces;
  });
}

function getDisplacementVector() {
  return FREE_INDICES.map((index) => nodes[index].displacement);
}

function dot(left, right) {
  let sum = 0;
  for (let index = 0; index < left.length; index += 1) {
    sum += left[index] * right[index];
  }
  return sum;
}

function updateAmplitudeUI(now) {
  const displacement = getDisplacementVector();
  const amplitudes = modes.map((mode) => Math.abs(dot(displacement, mode.vector)));
  const maxAmplitude = Math.max(...amplitudes, 0.0001);
  const dominantIndex = amplitudes.indexOf(Math.max(...amplitudes));
  const dominantValue = amplitudes[dominantIndex] || 0;

  amplitudeRows.forEach((row, index) => {
    const amplitude = amplitudes[index];
    row.fill.style.width = `${(amplitude / maxAmplitude) * 100}%`;
    row.value.textContent = amplitude.toFixed(2);
  });

  if (dominantValue > 0.03) {
    if (state.statusUntil < now) {
      statusBanner.textContent = `Detected v${dominantIndex + 1} as the leading response. Compare tail forcing against global forcing to see more high-mode energy.`;
    }
  } else {
    if (state.statusUntil < now) {
      statusBanner.textContent = "Trigger an impulse to compare how localized forcing amplifies higher modes at the flag tail.";
    }
  }

  updateModeArrows(dominantIndex, dominantValue);
}

function updateModeArrows(dominantIndex, dominantValue) {
  arrowHelpers.forEach((arrow, index) => {
    if (!state.showArrows || dominantValue < 0.03) {
      arrow.visible = false;
      return;
    }
    const amplitude = modes[dominantIndex].vector[index];
    const direction = rotateDirectionByAnchor(new THREE.Vector3(0.2, 0, amplitude));
    const origin = nodes[FREE_INDICES[index]].position;
    arrow.position.copy(origin);
    arrow.setDirection(direction);
    arrow.setLength(0.14 + Math.abs(amplitude) * 0.7, 0.08, 0.05);
    arrow.visible = true;
  });
}

function updateWindDirectionArrow(now = performance.now()) {
  const topLeft = nodes[nodeIndex(0, 0)].position;
  const anchorOffset = new THREE.Vector3(0.15, 0, 0);
  const origin = new THREE.Vector3(topLeft.x, poleHeight * 0.5 + 0.09, topLeft.z).add(anchorOffset);
  const { direction, length } = getWindArrowState(now);

  windArrowDirection.copy(direction);
  windDirectionArrow.position.copy(origin);
  windDirectionArrow.setDirection(direction);
  windDirectionArrow.setLength(length, 0.24, 0.14);
  windDirectionArrow.visible = state.windEnabled;
}

function updateImpulseArrow(now = performance.now()) {
  if (now >= state.impulseUntil) {
    impulseArrow.visible = false;
    impulseArrow.line.material.opacity = 0;
    impulseArrow.cone.material.opacity = 0;
    return;
  }

  const selected = getImpulseSelection(state.lastImpulseTarget);
  if (!selected.length) {
    impulseArrow.visible = false;
    return;
  }

  const origin = new THREE.Vector3();
  selected.forEach((index) => {
    origin.add(nodes[index].position);
  });
  origin.multiplyScalar(1 / selected.length);
  origin.y += 0.45;

  const progress = 1 - Math.max(0, state.impulseUntil - now) / 1000;
  const length = 1.55 - progress * 0.35;
  const opacity = 1 - progress;

  impulseArrow.position.copy(origin);
  impulseArrow.setDirection(rotateDirectionByAnchor(DISPLACEMENT_DIRECTION));
  impulseArrow.setLength(length, 0.2, 0.12);
  impulseArrow.line.material.opacity = opacity;
  impulseArrow.cone.material.opacity = opacity;
  impulseArrow.visible = true;
}

function applyImpulse(target, magnitude) {
  const selected = getImpulseSelection(target);
  const impulseDirection = rotateDirectionByAnchor(DISPLACEMENT_DIRECTION);

  selected.forEach((index) => {
    const node = nodes[index];
    const rowBias = 1 - Math.abs(node.row - 1) * 0.18;
    const sign = node.row === 1 ? 1 : 0.86;
    node.velocity.addScaledVector(impulseDirection, (magnitude * rowBias * sign) / state.massScale);
  });

  state.lastImpulseTarget = target;
  state.impulseUntil = performance.now() + 1000;
  impulseArrow.line.material.opacity = 1;
  impulseArrow.cone.material.opacity = 1;
  state.statusUntil = performance.now() + 2600;
  statusBanner.textContent = `Applied ${target} pulse at ${magnitude.toFixed(1)}x force. Watch which bars rise first.`;
}

function exciteMode(modeIndex) {
  state.activeMode = modeIndex;
  buildModeGallery();
  const scale = state.forceScale * 0.62;
  const modeDirection = rotateDirectionByAnchor(DISPLACEMENT_DIRECTION);
  FREE_INDICES.forEach((nodeId, vectorIndex) => {
    nodes[nodeId].velocity.addScaledVector(modeDirection, modes[modeIndex].vector[vectorIndex] * scale);
  });
  state.statusUntil = performance.now() + 2800;
  statusBanner.textContent = `Excited pure mode v${modeIndex + 1}. This isolates its natural deformation pattern.`;
}

function applyRenderMode(value) {
  state.renderMode = value;
  const wireframe = value === "wireframe";
  flagMesh.visible = !wireframe;
  edgeLines.material.opacity = wireframe ? 0.88 : 0.38;
  edgeLines.visible = true;
  freePoints.material.size = wireframe ? 0.135 : 0.12;
}

function resetCalmState() {
  for (const node of nodes) {
    node.displacement = 0;
    node.velocity.set(0, 0, 0);
    node.position.copy(node.anchor);
  }
  state.activeMode = null;
  buildModeGallery();
  updateGeometry();
  syncGuiState();
  state.statusUntil = performance.now() + 2200;
  statusBanner.textContent = "Reset to flat release. With wind off, the flag now falls under gravity and settles downward.";
}

function resetView() {
  camera.position.set(0.3, 0.1, 10.8);
  controls.target.set(1.45, 0.45, 0);
  controls.update();
}

function syncGuiState() {
  ui.impulseTarget = state.forceTarget;
  ui.force = state.forceScale;
  ui.stiffness = state.stiffnessScale;
  ui.mass = state.massScale;
  ui.wind = state.windEnabled;
  ui.windMode = state.windMode;
  ui.render = state.renderMode;
  ui.motion = state.isAnimating;
  ui.tracePaths = state.showTraces;
  ui.modeArrows = state.showArrows;
  ui.cutMode = state.cutMode;
  guiControllers.forEach((controller) => controller.updateDisplay());
  updateWindDirectionArrow();
}

function updateControls() {
  syncGuiState();
}

function resize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.setSize(width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  updateWindDirectionArrow();
}

openMathButton.addEventListener("click", () => {
  renderModalContent();
  mathModal.hidden = false;
});

closeMathButton.addEventListener("click", () => {
  mathModal.hidden = true;
});

languageToggle.addEventListener("click", () => {
  state.modalLanguage = state.modalLanguage === "en" ? "zhTW" : "en";
  renderModalContent();
});

mathModal.addEventListener("click", (event) => {
  if (event.target === mathModal) {
    mathModal.hidden = true;
  }
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    mathModal.hidden = true;
  }
  if (event.key === "Escape" && state.cutMode) {
    setCutMode(false);
    syncGuiState();
  }
});

window.addEventListener("resize", resize);
canvas.addEventListener("pointermove", (event) => {
  state.pointerInsideCanvas = true;
  pointerScreen.set(event.clientX, event.clientY);
  updateHoveredLink(pointerScreen.x, pointerScreen.y);
});
canvas.addEventListener("pointerleave", () => {
  state.pointerInsideCanvas = false;
  if (!state.cutMode) {
    return;
  }
  state.hoveredLinkIndex = -1;
  highlightedLink.visible = false;
});
canvas.addEventListener("click", () => {
  cutHoveredLink();
});

const gui = new GUI({ title: "Scene Controls" });
const impulseController = gui.add(ui, "impulseTarget", ["tip", "mid", "global"]).name("Impulse").onChange((value) => {
  state.forceTarget = value;
});
impulseController.domElement.addEventListener("mouseenter", () => {
  impulseInfo.hidden = false;
});
impulseController.domElement.addEventListener("mouseleave", () => {
  impulseInfo.hidden = true;
});

const windController = gui.add(ui, "wind").name("Wind").onChange((value) => {
  state.windEnabled = value;
  state.statusUntil = performance.now() + 2200;
  statusBanner.textContent = state.windEnabled
    ? `Wind drive enabled in ${state.windMode} mode.`
    : "Wind disabled. The tail should settle into a gravity-dominated droop.";
});

const windModeController = gui.add(ui, "windMode", ["steady", "pulse"]).name("Wind Mode").onChange((value) => {
  state.windMode = value;
  state.statusUntil = performance.now() + 2200;
  statusBanner.textContent = state.windMode === "pulse"
    ? "Wind mode set to pulse. When wind is on, the flag receives rhythmic gust bursts."
    : "Wind mode set to steady. When wind is on, the flag receives a continuous breeze.";
});
windModeController.domElement.addEventListener("mouseenter", () => {
  windInfo.hidden = false;
});
windModeController.domElement.addEventListener("mouseleave", () => {
  windInfo.hidden = true;
});

const modeCuesController = gui.add(ui, "modeArrows").name("Mode Cues").onChange((value) => {
  state.showArrows = value;
  updateControls();
});
modeCuesController.domElement.addEventListener("mouseenter", () => {
  modeInfo.hidden = false;
});
modeCuesController.domElement.addEventListener("mouseleave", () => {
  modeInfo.hidden = true;
});
const cutModeController = gui.add(ui, "cutMode").name("Cut Mode").onChange((value) => {
  setCutMode(value);
  state.statusUntil = performance.now() + 2200;
  statusBanner.textContent = value
    ? "Cut Mode enabled. Hover a link to highlight it, then click to cut."
    : "Cut Mode disabled. Orbit controls restored.";
});
const restoreLinksController = gui.add(ui, "restoreLinks").name("Restore Links");

guiControllers.push(
  impulseController,
  gui.add(ui, "force", 0.3, 10, 0.1).name("Force").onChange((value) => {
    state.forceScale = value;
  }),
  gui.add(ui, "stiffness", 0.1, 2.6, 0.1).name("Stiffness").onChange((value) => {
    state.stiffnessScale = value;
    updateModes();
    state.statusUntil = performance.now() + 2400;
    statusBanner.textContent = `Raised stiffness to ${state.stiffnessScale.toFixed(1)}x. Higher eigenvalues produce faster, tighter flutter.`;
  }),
  gui.add(ui, "mass", 0.5, 2.8, 0.1).name("Mass").onChange((value) => {
    state.massScale = value;
    updateModes();
    state.statusUntil = performance.now() + 2400;
    statusBanner.textContent = `Set mass to ${state.massScale.toFixed(1)}x. Higher mass adds inertia and lowers the flutter frequencies.`;
  }),
  windController,
  windModeController,
  gui.add(ui, "render", ["solid", "wireframe"]).name("Render").onChange((value) => {
    applyRenderMode(value);
  }),
  gui.add(ui, "motion").name("Motion").onChange((value) => {
    state.isAnimating = value;
  }),
  gui.add(ui, "tracePaths").name("Trace Paths").onChange((value) => {
    state.showTraces = value;
    updateControls();
  }),
  modeCuesController,
  cutModeController,
);

gui.add(ui, "applyPulse").name("Apply Pulse");
gui.add(ui, "resetCalm").name("Reset Calm");
gui.add(ui, "resetView").name("Reset View");

const cutModeRow = cutModeController.domElement;
const restoreLinksRow = restoreLinksController.domElement;
const cutModeWidget = cutModeRow.querySelector(".widget");
const restoreLinksButton = restoreLinksRow.querySelector("button");
const modeExplorerTitle = document.getElementById("mode-explorer-title");

if (cutModeWidget && restoreLinksButton) {
  restoreLinksButton.textContent = "Restore";
  restoreLinksButton.style.marginLeft = "0.5rem";
  restoreLinksButton.style.paddingInline = "0.7rem";
  cutModeWidget.style.display = "flex";
  cutModeWidget.style.alignItems = "center";
  cutModeWidget.appendChild(restoreLinksButton);
  restoreLinksRow.style.display = "none";
}

if (modeExplorerTitle && explorerInfo) {
  modeExplorerTitle.addEventListener("mouseenter", () => {
    explorerInfo.hidden = false;
  });
  modeExplorerTitle.addEventListener("mouseleave", () => {
    explorerInfo.hidden = true;
  });
}

for (let index = 0; index < FREE_INDICES.length; index += 1) {
  const arrow = new THREE.ArrowHelper(
    new THREE.Vector3(0, 0, 1),
    nodes[FREE_INDICES[index]].position,
    0.3,
    0xa3be8c,
    0.08,
    0.05,
  );
  arrow.visible = false;
  arrowHelpers.push(arrow);
  scene.add(arrow);
}

buildNodeLabels();
updateModes();
renderModalContent();
updateControls();
applyRenderMode(state.renderMode);
resize();
updateWindDirectionArrow();
updateGeometry();

let previousTime = performance.now();

function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min((now - previousTime) / 1000, 0.025);
  previousTime = now;

  if (state.isAnimating) {
    applyWindDrive(now);
    updateNodeMotion(dt);
    updateGeometry();
    updateTraces();
    updateAmplitudeUI(now);
  }
  if (state.cutMode && state.pointerInsideCanvas) {
    updateHoveredLink(pointerScreen.x, pointerScreen.y);
  }

  controls.update();
  updateWindDirectionArrow(now);
  updateImpulseArrow(now);
  updateNodeLabels();
  updateWindLabel();
  renderer.render(scene, camera);
}

animate(previousTime);
