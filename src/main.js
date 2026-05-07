import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import GUI from "https://cdn.jsdelivr.net/npm/lil-gui@0.19/+esm";

const canvas = document.getElementById("canvas");
const nodeLabelsOverlay = document.getElementById("node-labels");
const impulseInfo = document.getElementById("impulse-info");
const windInfo = document.getElementById("wind-info");
const statusBanner = document.getElementById("status-banner");
const verletDiagnosticsBody = document.getElementById("verlet-diagnostics-body");
const diagnosticsNodeSelect = document.getElementById("diagnostics-node-select");
const diagnosticsAxisSelect = document.getElementById("diagnostics-axis-select");
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
const DIAGNOSTIC_HISTORY_LENGTH = 5;
const DISPLACEMENT_DIRECTION = new THREE.Vector3(0.12, 0, 1).normalize();
const WIND_DISPLACEMENT_DIRECTION = new THREE.Vector3(1, 0, -0.12).normalize();
const GRAVITY_ACCELERATION = -9.8;
const IMPULSE_DURATION = 1 / 60;
// Give the tail a small opposite offset so the initial frame already shows a visible sag.
const INITIAL_TAIL_OFFSET = DISPLACEMENT_DIRECTION.clone().multiplyScalar(-0.22);
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

const DEFAULT_STATE = {
  isAnimating: true,
  modalLanguage: "en",
  forceTarget: "tip",
  forceScale: 6,
  stiffnessScale: 360,
  massScale: 1,
  dampingScale: 2.8,
  windEnabled: false,
  windMode: "steady",
  renderMode: "solid",
  showTraces: true,
  cutMode: false,
  statusUntil: 0,
  impulseUntil: 0,
  lastImpulseTarget: "tip",
  hoveredLinkIndex: -1,
  pointerInsideCanvas: false,
  poleReleased: false,
};
const state = { ...DEFAULT_STATE };

const ui = {
  impulseTarget: state.forceTarget,
  force: state.forceScale,
  stiffness: state.stiffnessScale,
  mass: state.massScale,
  damping: state.dampingScale,
  wind: state.windEnabled,
  windMode: state.windMode,
  render: state.renderMode,
  tracePaths: state.showTraces,
  cutMode: state.cutMode,
  applyPulse: () => applyImpulse(state.forceTarget, state.forceScale),
  toggleMotion: () => toggleMotion(),
  releasePole: () => releasePoleAnchors(),
  reset: () => resetSceneState(),
  restoreLinks: () => restoreAllLinks(),
  resetView: () => resetView(),
};
const guiControllers = [];
let motionController = null;

const nodes = [];
const links = [];
const triangles = [];
const tailIndices = [COLS - 1, 2 * COLS - 1, 3 * COLS - 1];
const traceStates = tailIndices.map(() => []);
const traceLines = [];
const nodeLabelElements = [];
const verletDiagnosticsHistory = [];
const diagnosticsSelection = {
  nodeId: 11,
  axis: "z",
};
let diagnosticsFrameIndex = 0;
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

function getNodeMass(totalMass = state.massScale) {
  return totalMass / NODE_COUNT;
}

function getMovableNodeIndices() {
  return nodes.filter((node) => !node.fixed).map((node) => node.index);
}

function nodeIndex(row, col) {
  return row * COLS + col;
}


function createRestPosition(row, col) {
  return new THREE.Vector3(POLE_X + col * REST_X, FLAG_TOP_Y - row * REST_Y, 0);
}

function getInitialNodePosition(node) {
  if (tailIndices.includes(node.index)) {
    return node.anchor.clone().add(INITIAL_TAIL_OFFSET);
  }
  return node.anchor.clone();
}

function buildNodeLabels() {
  nodeLabelsOverlay.innerHTML = "";
  nodeLabelElements.length = 0;
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

function buildDiagnosticsControls() {
  if (!diagnosticsNodeSelect || !diagnosticsAxisSelect) {
    return;
  }

  diagnosticsNodeSelect.innerHTML = nodes.map((node) => `
    <option value="${node.index}"${node.index === diagnosticsSelection.nodeId ? " selected" : ""}>node ${node.index}</option>
  `).join("");

  diagnosticsNodeSelect.addEventListener("change", (event) => {
    diagnosticsSelection.nodeId = Number(event.target.value);
    renderVerletDiagnostics();
  });

  diagnosticsAxisSelect.addEventListener("change", (event) => {
    diagnosticsSelection.axis = event.target.value;
    renderVerletDiagnostics();
  });

  const diagnosticsToggle = document.getElementById("diagnostics-toggle");
  const diagnosticsDetail = document.getElementById("diagnostics-detail");
  if (diagnosticsToggle && diagnosticsDetail) {
    diagnosticsToggle.addEventListener("click", () => {
      const collapsed = !diagnosticsDetail.hidden;
      diagnosticsDetail.hidden = collapsed;
      diagnosticsToggle.textContent = collapsed ? "▶" : "▼";
      diagnosticsToggle.setAttribute("aria-label", collapsed ? "Expand details" : "Collapse details");
    });
  }
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
      position: fixed ? anchor.clone() : getInitialNodePosition({ index, anchor }),
      previousPosition: fixed ? anchor.clone() : getInitialNodePosition({ index, anchor }),
      acceleration: new THREE.Vector3(),
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

function renderModalContent() {
  const modalCopy = {
    en: `
      <p>This flag is modeled as a small spring lattice with 12 nodes. The three pole-side nodes are pinned by default, and the remaining nodes move in full 3D.</p>
      <p>The per-frame solver is split into two stages: a Verlet prediction pass and a Position-Based Dynamics constraint pass.</p>
      <p>The starting point is the undamped position Verlet step</p>
      <p>$$
        x_{t+\\Delta t} = 2x_t - x_{t-\\Delta t} + a_t\\Delta t^2
      $$</p>
      <p>which can be rearranged into</p>
      <p>$$
        x_{t+\\Delta t} = x_t + (x_t - x_{t-\\Delta t}) + a_t\\Delta t^2
      $$</p>
      <p>The difference term $x_t - x_{t-\\Delta t}$ acts like an implicit velocity because it stores how far the node moved during the previous step without keeping a separate velocity variable.</p>
      <p>To add damping, the solver assumes that this velocity-like term decays according to the continuous drag model $m\\dot{v} + cv = 0$, whose solution over one time step is $v_{t+\\Delta t} = v_t e^{-c\\Delta t / m}$.</p>
      <p>Applying that decay to the implicit velocity produces the damped position form</p>
      <p>$$
        x_{t+\\Delta t} = x_t + (x_t - x_{t-\\Delta t}) e^{-c\\Delta t / m} + a_t\\Delta t^2
      $$</p>
      <p>where gravity and external drive first accumulate into $a_t$. This is why the solver stores <code>position</code> and <code>previousPosition</code> instead of a primary velocity state.</p>
      <p>The GUI slider is therefore controlling the damping coefficient $c$ in kg/s, not a raw 0-to-1 blend factor. The actual per-step velocity retention is computed from $e^{-c\\Delta t / m}$, which keeps the behavior more consistent when $\\Delta t$ changes with frame rate.</p>
      <p>After that prediction, Position-Based Dynamics enforces the link lengths by iterating over every uncut link seven times. For each link, the solver measures the normalized stretch error</p>
      <p>$$
        \\frac{\\lVert x_b - x_a \\rVert - L}{\\lVert x_b - x_a \\rVert}
      $$</p>
      <p>and scales it by the spring response $1 - e^{-k w\\Delta t^2 / m}$ before splitting the positional correction across the two endpoints.</p>
      <p>Here $k$ is the GUI spring stiffness in N/m, $w$ is the per-link weight, and $m$ is the per-node mass. Using an exponential response keeps the correction dimensionless while still tying it back to the physical control values.</p>
      <pre><code class="language-js">const verletStep = node.position.clone()
  .sub(node.previousPosition)
  .multiplyScalar(Math.exp(-c * dt / m));
node.position
  .add(verletStep)
  .addScaledVector(node.acceleration, dt * dt);</code></pre>
    `,
    zhTW: `
      <p>這面旗子被建模成一個 12 節點的小型彈簧晶格。靠旗桿的 3 個節點預設固定，其餘節點在 3D 空間中運動。</p>
      <p>每一幀的 solver 分成兩段：先做 Verlet 預測，再做 Position-Based Dynamics 約束修正。</p>
      <p>起點其實是沒有阻尼的 position Verlet：</p>
      <p>$$
        x_{t+\\Delta t} = 2x_t - x_{t-\\Delta t} + a_t\\Delta t^2
      $$</p>
      <p>把它改寫一下，就會變成：</p>
      <p>$$
        x_{t+\\Delta t} = x_t + (x_t - x_{t-\\Delta t}) + a_t\\Delta t^2
      $$</p>
      <p>其中 $x_t - x_{t-\\Delta t}$ 這一項可以看成「隱含速度」: 它代表節點上一個時間步到底移動了多少，只是 solver 沒有另外存一個顯式 velocity 變數。</p>
      <p>如果要加入阻尼，可以假設這個速度型項 obey 連續阻力模型 $m\\dot{v} + cv = 0$。它在一個時間步內的解析解是 $v_{t+\\Delta t} = v_t e^{-c\\Delta t / m}$，也就是速度會做指數衰減。</p>
      <p>把這個衰減直接套到隱含速度上，就得到這個專案使用的 damped Verlet 形式：</p>
      <p>$$
        x_{t+\\Delta t} = x_t + (x_t - x_{t-\\Delta t}) e^{-c\\Delta t / m} + a_t\\Delta t^2
      $$</p>
      <p>其中重力和外力會先累積到 $a_t$。這也是為什麼 solver 主要存的是 <code>position</code> 和 <code>previousPosition</code>，而不是把 velocity 當成主要狀態。</p>
      <p>所以 GUI 上的 damping slider 調的其實是阻尼係數 $c$，單位是 kg/s，不是直接調一個 0 到 1 的比例。真正每一步保留多少「速度感」是由 $e^{-c\\Delta t / m}$ 算出來的，這樣在不同幀率下會比直接寫死 0.9、0.95 這種每幀係數更一致。</p>
      <p>做完這個預測之後，Position-Based Dynamics 會把每條未被 cut 的 link 重複掃過 7 輪，強制它們回到接近原本長度。對每條 link，solver 先量出正規化的伸長誤差：</p>
      <p>$$
        \\frac{\\lVert x_b - x_a \\rVert - L}{\\lVert x_b - x_a \\rVert}
      $$</p>
      <p>再乘上彈簧響應 $1 - e^{-k w\\Delta t^2 / m}$，最後把位置修正量分配到兩個端點上。</p>
      <p>這裡的 $k$ 是 GUI 上的彈簧剛度，單位是 N/m，$w$ 是 link 權重，$m$ 是每個節點分到的質量。用指數形式可以讓修正量保持無因次，同時又和實際控制參數維持對應關係。</p>
      <pre><code class="language-js">const verletStep = node.position.clone()
  .sub(node.previousPosition)
  .multiplyScalar(Math.exp(-c * dt / m));
node.position
  .add(verletStep)
  .addScaledVector(node.acceleration, dt * dt);</code></pre>
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
  const gravity = new THREE.Vector3(0, GRAVITY_ACCELERATION, 0);
  const constraintIterations = 7;
  const dtSquared = dt * dt;
  const nodeMass = getNodeMass();
  const damping = Math.exp(-state.dampingScale * dt / nodeMass);
  const previousPositions = new Map();
  const nodeTerms = {};

  for (const node of nodes) {
    if (node.fixed) {
      nodeTerms[node.index] = {
        position: node.anchor.clone(),
        previousPosition: node.anchor.clone(),
        delta: new THREE.Vector3(),
        acceleration: new THREE.Vector3(),
        nextPosition: node.anchor.clone(),
      };
      node.position.copy(node.anchor);
      node.previousPosition.copy(node.anchor);
      node.acceleration.set(0, 0, 0);
      continue;
    }

    node.acceleration.multiplyScalar(1 / nodeMass);
    node.acceleration.add(gravity);

    const currentPosition = node.position.clone();
    previousPositions.set(node.index, currentPosition);
    const previousPosition = node.previousPosition.clone();
    const delta = currentPosition.clone().sub(previousPosition);
    const acceleration = node.acceleration.clone();
    const verletStep = delta.clone().multiplyScalar(damping);
    const nextPosition = currentPosition.clone().add(verletStep).addScaledVector(acceleration, dtSquared);
    nodeTerms[node.index] = {
      position: currentPosition,
      previousPosition,
      delta,
      acceleration,
      nextPosition: nextPosition.clone(),
    };
    node.position.copy(nextPosition);
    node.previousPosition.copy(currentPosition);
    node.acceleration.set(0, 0, 0);
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
      const response = 1 - Math.exp(-(state.stiffnessScale * link.weight * dtSquared) / nodeMass);
      // Split the positional correction evenly across two free endpoints.
      // With one fixed endpoint, the full correction is applied to the free node below.
      const correction = delta.multiplyScalar(0.5 * response * difference);

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
      node.previousPosition.copy(node.anchor);
    }
  }

  let maxSpeed = 0;
  let totalSpeed = 0;
  let movableCount = 0;
  let tailDisplacement = 0;

  for (const node of nodes) {
    if (node.fixed) {
      continue;
    }

    const previousPosition = previousPositions.get(node.index);
    const speed = previousPosition ? node.position.distanceTo(previousPosition) / Math.max(dt, 1e-6) : 0;
    maxSpeed = Math.max(maxSpeed, speed);
    totalSpeed += speed;
    movableCount += 1;

    if (tailIndices.includes(node.index)) {
      tailDisplacement += node.position.distanceTo(node.anchor);
    }
  }

  return {
    dtMs: dt * 1000,
    damping,
    nodeTerms,
    maxSpeed,
    avgSpeed: movableCount ? totalSpeed / movableCount : 0,
    tailDisplacement: tailDisplacement / tailIndices.length,
    iterations: constraintIterations,
  };
}

function renderVerletDiagnostics() {
  if (!verletDiagnosticsBody) {
    return;
  }

  const axis = diagnosticsSelection.axis;
  const nodeId = diagnosticsSelection.nodeId;

  const rows = verletDiagnosticsHistory.length
    ? verletDiagnosticsHistory.map((entry) => `
      <tr>
        <td>${entry.frame}</td>
        <td>${entry.nodeTerms[nodeId].position[axis].toFixed(1)}</td>
        <td>${entry.nodeTerms[nodeId].previousPosition[axis].toFixed(1)}</td>
        <td>${entry.nodeTerms[nodeId].delta[axis].toFixed(1)}</td>
        <td>${entry.damping.toFixed(2)}</td>
        <td>${entry.nodeTerms[nodeId].acceleration[axis].toFixed(0)}</td>
        <td>${entry.dtMs.toFixed(0)}</td>
        <td>${entry.nodeTerms[nodeId].nextPosition[axis].toFixed(1)}</td>
      </tr>
    `).join("")
    : `
      <tr>
        <td>--</td>
        <td>--</td>
        <td>--</td>
        <td>--</td>
        <td>--</td>
        <td>--</td>
        <td>--</td>
        <td>--</td>
      </tr>
    `;

  verletDiagnosticsBody.innerHTML = rows;
}

function pushVerletDiagnostics(frameMetrics) {
  verletDiagnosticsHistory.unshift({
    frame: `f${frameMetrics.frame}`,
    dtMs: frameMetrics.dtMs,
    damping: frameMetrics.damping,
    nodeTerms: frameMetrics.nodeTerms,
  });

  if (verletDiagnosticsHistory.length > DIAGNOSTIC_HISTORY_LENGTH) {
    verletDiagnosticsHistory.length = DIAGNOSTIC_HISTORY_LENGTH;
  }

  renderVerletDiagnostics();
}

function addVelocityImpulse(node, direction, magnitude, dt = 1 / 60) {
  node.previousPosition.addScaledVector(direction, -magnitude * dt);
}

function applyWindDrive(now) {
  if (!state.windEnabled) {
    return;
  }

  const nodeMass = getNodeMass();
  for (const index of getMovableNodeIndices()) {
    const node = nodes[index];
    const windDirection = getWindDirection(now, node);
    const windForce = getWindDriveValue(now, node) * state.forceScale;
    node.acceleration.addScaledVector(windDirection, windForce / nodeMass);
  }
}

function getWindDirection(now, node = nodes[getMovableNodeIndices()[0] ?? FREE_INDICES[0]]) {
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
    const ripple = 0.1 * (0.5 + 0.5 * Math.sin(phase * 0.72));
    return burst * burst * 0.9 + ripple;
  }

  const baseFlow = 0.35;
  const ripple = 0.15 * (0.5 + 0.5 * Math.sin(phase));
  const gust = 0.5 * Math.max(0, Math.sin(phase * 0.47 + 1.2));
  return baseFlow + ripple + gust;
}

function getWindArrowState(now) {
  if (!state.windEnabled) {
    return {
      direction: WIND_DISPLACEMENT_DIRECTION.clone(),
      length: 0,
    };
  }

  const movableIndices = getMovableNodeIndices();
  if (!movableIndices.length) {
    return {
      direction: WIND_DISPLACEMENT_DIRECTION.clone(),
      length: 0,
    };
  }

  let totalDrive = 0;
  const direction = new THREE.Vector3();
  for (const index of movableIndices) {
    const node = nodes[index];
    const drive = getWindDriveValue(now, node);
    totalDrive += drive;
    direction.addScaledVector(getWindDirection(now, node), Math.abs(drive));
  }

  const averageDrive = totalDrive / movableIndices.length;
  if (direction.lengthSq() < 1e-6) {
    direction.copy(getWindDirection(now));
  } else {
    direction.normalize();
  }
  const length = 1.35 + Math.min(Math.abs(averageDrive) / 0.013, 1) * 1.1;

  return { direction, length };
}

function getImpulseSelection(target) {
  const movableIndices = getMovableNodeIndices();
  const map = {
    tip: movableIndices.filter((index) => nodes[index].col === COLS - 1),
    mid: movableIndices.filter((index) => nodes[index].col >= 1 && nodes[index].col <= 2),
    global: movableIndices,
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
  state.hoveredLinkIndex = -1;
  highlightedLink.visible = false;
  updateGeometry();
  state.statusUntil = performance.now() + 2200;
  statusBanner.textContent = "Restored all links. The flag mesh and spring lattice are back to the intact state.";
}

function syncPoleAnchorState() {
  const anchored = !state.poleReleased;
  fixedPoints.visible = anchored;
  anchorGroup.visible = anchored;

  nodes.forEach((node, index) => {
    if (node.col !== 0) {
      return;
    }
    node.fixed = anchored;
    const label = nodeLabelElements[index];
    if (label) {
      label.classList.toggle("fixed", anchored);
    }
  });
}

function releasePoleAnchors() {
  if (state.poleReleased) {
    return;
  }

  state.poleReleased = true;
  nodes.forEach((node) => {
    if (node.col !== 0) {
      return;
    }
    node.previousPosition.copy(node.position);
    node.acceleration.set(0, 0, 0);
  });
  syncPoleAnchorState();
  updateGeometry();
  state.statusUntil = performance.now() + 2600;
  statusBanner.textContent = "Released the three pole-side nodes. The flag is now fully free and responds only to the Verlet + PBD cloth solve.";
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
  updateGeometry();
  state.statusUntil = performance.now() + 2400;
  statusBanner.textContent = `Cut link ${hovered.a}-${hovered.b}. The cloth constraints and line rendering updated.`;
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
      if (freeIndex !== undefined) {
        freePositions.setXYZ(freeIndex, node.position.x, node.position.y, node.position.z);
      }
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
  impulseArrow.setDirection(DISPLACEMENT_DIRECTION);
  impulseArrow.setLength(length, 0.2, 0.12);
  impulseArrow.line.material.opacity = opacity;
  impulseArrow.cone.material.opacity = opacity;
  impulseArrow.visible = true;
}

function applyImpulse(target, magnitude) {
  const selected = getImpulseSelection(target);
  const impulseDirection = DISPLACEMENT_DIRECTION;
  const nodeMass = getNodeMass();
  const impulseMagnitude = magnitude * IMPULSE_DURATION;

  selected.forEach((index) => {
    const node = nodes[index];
    const rowBias = 1 - Math.abs(node.row - 1) * 0.18;
    const sign = node.row === 1 ? 1 : 0.86;
    addVelocityImpulse(node, impulseDirection, (impulseMagnitude * rowBias * sign) / nodeMass);
  });

  state.lastImpulseTarget = target;
  state.impulseUntil = performance.now() + 1000;
  impulseArrow.line.material.opacity = 1;
  impulseArrow.cone.material.opacity = 1;
  state.statusUntil = performance.now() + 2600;
  statusBanner.textContent = `Applied ${target} pulse at ${magnitude.toFixed(1)} N for ${(IMPULSE_DURATION * 1000).toFixed(1)} ms. Watch how the tail motion and constraint recovery respond.`;
}

function applyRenderMode(value) {
  state.renderMode = value;
  const wireframe = value === "wireframe";
  flagMesh.visible = !wireframe;
  edgeLines.material.opacity = wireframe ? 0.88 : 0.38;
  edgeLines.visible = true;
  freePoints.material.size = wireframe ? 0.135 : 0.12;
}

function resetSceneState() {
  Object.assign(state, DEFAULT_STATE);
  setCutMode(false);
  links.forEach((link) => {
    link.cut = false;
  });
  highlightedLink.visible = false;

  for (const node of nodes) {
    const initialPosition = node.fixed ? node.anchor.clone() : getInitialNodePosition(node);
    node.position.copy(initialPosition);
    node.previousPosition.copy(initialPosition);
    node.acceleration.set(0, 0, 0);
  }
  traceStates.forEach((trace) => trace.splice(0, trace.length));
  verletDiagnosticsHistory.length = 0;
  diagnosticsFrameIndex = 0;
  syncPoleAnchorState();
  updateControls();
  applyRenderMode(state.renderMode);
  updateGeometry();
  renderVerletDiagnostics();
  state.statusUntil = performance.now() + 2200;
  statusBanner.textContent = "Reset scene state and restored the default parameters.";
}

function resetView() {
  camera.position.set(0.3, 0.1, 10.8);
  controls.target.set(1.45, 0.45, 0);
  controls.update();
}

function updateMotionControlLabel() {
  if (!motionController) {
    return;
  }
  motionController.name(state.isAnimating ? "Pause" : "Play");
}

function toggleMotion() {
  state.isAnimating = !state.isAnimating;
  updateMotionControlLabel();
  state.statusUntil = performance.now() + 1800;
  statusBanner.textContent = state.isAnimating
    ? "Simulation resumed. Verlet prediction and PBD projection are running again."
    : "Simulation paused. The current frame is held for inspection.";
}

function syncGuiState() {
  ui.impulseTarget = state.forceTarget;
  ui.force = state.forceScale;
  ui.stiffness = state.stiffnessScale;
  ui.mass = state.massScale;
  ui.damping = state.dampingScale;
  ui.wind = state.windEnabled;
  ui.windMode = state.windMode;
  ui.render = state.renderMode;
  ui.tracePaths = state.showTraces;
  ui.cutMode = state.cutMode;
  guiControllers.forEach((controller) => controller.updateDisplay());
  updateMotionControlLabel();
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
  gui.add(ui, "force", 0.5, 20, 0.5).name("Drive Force (N)").onChange((value) => {
    state.forceScale = value;
    state.statusUntil = performance.now() + 2400;
    statusBanner.textContent = `Set drive force to ${state.forceScale.toFixed(1)} N. Wind uses it as force amplitude and pulse uses it for a ${Math.round(IMPULSE_DURATION * 1000)} ms shove.`;
  }),
  gui.add(ui, "stiffness", 20, 1200, 10).name("Spring Stiffness (N/m)").onChange((value) => {
    state.stiffnessScale = value;
    state.statusUntil = performance.now() + 2400;
    statusBanner.textContent = `Set spring stiffness to ${state.stiffnessScale.toFixed(0)} N/m. The per-link response is 1 - exp(-k w dt^2 / m).`;
  }),
  gui.add(ui, "mass", 0.5, 2.8, 0.1).name("Mass (kg)").onChange((value) => {
    state.massScale = value;
    state.statusUntil = performance.now() + 2400;
    statusBanner.textContent = `Set total cloth mass to ${state.massScale.toFixed(1)} kg. It is split across all 12 nodes, so wind and impulses drive the flag less aggressively.`;
  }),
  gui.add(ui, "damping", 0.1, 6, 0.1).name("Damping (kg/s)").onChange((value) => {
    state.dampingScale = value;
    state.statusUntil = performance.now() + 2400;
    statusBanner.textContent = `Set damping to ${state.dampingScale.toFixed(1)} kg/s. Higher values remove motion faster each frame.`;
  }),
  windController,
  windModeController,
  gui.add(ui, "render", ["solid", "wireframe"]).name("Render").onChange((value) => {
    applyRenderMode(value);
  }),
  gui.add(ui, "tracePaths").name("Trace Paths").onChange((value) => {
    state.showTraces = value;
    updateControls();
  }),
  cutModeController,
);

motionController = gui.add(ui, "toggleMotion").name("Pause");

gui.add(ui, "applyPulse").name("Apply Pulse");
gui.add(ui, "releasePole").name("Release Pole");
gui.add(ui, "reset").name("Reset");
gui.add(ui, "resetView").name("Reset View");

const cutModeRow = cutModeController.domElement;
const restoreLinksRow = restoreLinksController.domElement;
const cutModeWidget = cutModeRow.querySelector(".widget");
const restoreLinksButton = restoreLinksRow.querySelector("button");

if (cutModeWidget && restoreLinksButton) {
  restoreLinksButton.textContent = "Restore";
  restoreLinksButton.style.marginLeft = "0.5rem";
  restoreLinksButton.style.paddingInline = "0.7rem";
  cutModeWidget.style.display = "flex";
  cutModeWidget.style.alignItems = "center";
  cutModeWidget.appendChild(restoreLinksButton);
  restoreLinksRow.style.display = "none";
}

buildNodeLabels();
buildDiagnosticsControls();
renderModalContent();
renderVerletDiagnostics();
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
    const frameMetrics = updateNodeMotion(dt);
    updateGeometry();
    updateTraces();
    pushVerletDiagnostics({
      frame: ++diagnosticsFrameIndex,
      ...frameMetrics,
    });
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
