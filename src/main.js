import * as THREE from "three";

const canvas = document.getElementById("canvas");
const renderMode = document.getElementById("render-mode");
const pauseButton = document.getElementById("pause-button");
const openMathButton = document.getElementById("open-math");
const closeMathButton = document.getElementById("close-math");
const languageToggle = document.getElementById("language-toggle");
const mathModal = document.getElementById("math-modal");
const mathContent = document.getElementById("math-content");

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2e3440);

const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
camera.position.set(0, 0, 3);

const geometry = new THREE.IcosahedronGeometry(1, 1);
const material = new THREE.MeshStandardMaterial({
  color: 0x88c0d0,
  wireframe: true,
});
const mesh = new THREE.Mesh(geometry, material);
scene.add(mesh);

const light = new THREE.DirectionalLight(0xeceff4, 1.5);
light.position.set(2, 3, 4);
scene.add(light);
scene.add(new THREE.AmbientLight(0x4c566a, 0.8));

let isAnimating = true;
let modalLanguage = "en";

const modalCopy = {
  en: `
    <p>This scene rotates a mesh in 3D space using two angular velocities, one for the x-axis and one for the y-axis.</p>
    <p>The camera uses perspective projection, which maps a 3D point $(x, y, z)$ into screen space by dividing by depth.</p>
    <p>Rotation is a matrix transform. For example, rotation around the y-axis is expressed as:</p>
    <p>$$
      R_y(\\theta) =
      \\begin{bmatrix}
      \\cos\\theta & 0 & \\sin\\theta \\\\
      0 & 1 & 0 \\\\
      -\\sin\\theta & 0 & \\cos\\theta
      \\end{bmatrix}
    $$</p>
    <p>Animating over time means the angle becomes a function $\\theta(t)$, so the object moves smoothly frame by frame. The implementation applies this each tick:</p>
    <pre><code class="language-js">function animate(t = 0) {
  requestAnimationFrame(animate);
  mesh.rotation.x = t * 0.0003; // omega_x
  mesh.rotation.y = t * 0.0005; // omega_y
  renderer.render(scene, camera);
}
animate();</code></pre>
  `,
  zhTW: `
    <p>這個場景讓一個 3D 網格以兩個角速度持續旋轉，分別對應 x 軸與 y 軸。</p>
    <p>相機使用透視投影，會把三維點 $(x, y, z)$ 依照深度做縮放後映射到螢幕平面。</p>
    <p>旋轉本質上是矩陣變換。以 y 軸旋轉為例，可寫成：</p>
    <p>$$
      R_y(\\theta) =
      \\begin{bmatrix}
      \\cos\\theta & 0 & \\sin\\theta \\\\
      0 & 1 & 0 \\\\
      -\\sin\\theta & 0 & \\cos\\theta
      \\end{bmatrix}
    $$</p>
    <p>當角度變成時間函數 $\\theta(t)$，物體就會隨著每一幀平滑地運動。實際程式碼如下：</p>
    <pre><code class="language-js">function animate(t = 0) {
  requestAnimationFrame(animate);
  mesh.rotation.x = t * 0.0003; // omega_x
  mesh.rotation.y = t * 0.0005; // omega_y
  renderer.render(scene, camera);
}
animate();</code></pre>
  `,
};

function renderModalContent() {
  mathContent.innerHTML = modalCopy[modalLanguage];
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

function resize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.setSize(width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

window.addEventListener("resize", resize);
resize();
renderModalContent();

renderMode.addEventListener("change", (event) => {
  material.wireframe = event.target.value === "wireframe";
});

pauseButton.addEventListener("click", () => {
  isAnimating = !isAnimating;
  pauseButton.textContent = isAnimating ? "Pause Rotation" : "Resume Rotation";
});

openMathButton.addEventListener("click", () => {
  renderModalContent();
  mathModal.hidden = false;
});

closeMathButton.addEventListener("click", () => {
  mathModal.hidden = true;
});

languageToggle.addEventListener("click", () => {
  modalLanguage = modalLanguage === "en" ? "zhTW" : "en";
  renderModalContent();
});

function animate(time = 0) {
  requestAnimationFrame(animate);
  if (isAnimating) {
    mesh.rotation.x = time * 0.0003;
    mesh.rotation.y = time * 0.0005;
  }
  renderer.render(scene, camera);
}

animate();
