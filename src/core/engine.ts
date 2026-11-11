import * as THREE from 'three';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

export type Quality = 'low' | 'medium' | 'high';
interface Preset {
  pixelRatio: number;
  shadows: number; // shadow map size, 0 = off
  post: boolean;
  smaa: boolean;
}
export const PRESETS: Record<Quality, Preset> = {
  low: { pixelRatio: 1, shadows: 0, post: false, smaa: false },
  medium: { pixelRatio: 2, shadows: 1024, post: true, smaa: false }, // SMAA cost ~8 fps on integrated GPUs
  high: { pixelRatio: 2, shadows: 2048, post: true, smaa: true },
};
const ORDER: Quality[] = ['low', 'medium', 'high'];

function detectQuality(gl: WebGLRenderingContext | WebGL2RenderingContext): Quality {
  const forced = new URLSearchParams(location.search).get('quality') as Quality | null;
  if (forced && forced in PRESETS) return forced;
  const coarse = matchMedia('(pointer: coarse)').matches;
  const cores = navigator.hardwareConcurrency ?? 4;
  if (coarse) return cores >= 8 ? 'medium' : 'low';
  // Integrated graphics cannot hold 60 fps on the high preset, however many CPU cores there are.
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
  if (/Intel|UHD|Iris|SwiftShader|llvmpipe|Microsoft Basic/i.test(gpu)) return 'medium';
  return cores >= 8 ? 'high' : 'medium';
}

const VignetteShader = {
  uniforms: { tDiffuse: { value: null }, strength: { value: 0.32 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float strength; varying vec2 vUv;
    void main(){ vec4 c = texture2D(tDiffuse, vUv); float d = distance(vUv, vec2(0.5));
      c.rgb *= 1.0 - strength * smoothstep(0.35, 0.85, d); gl_FragColor = c; }`,
};

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Renderer, scene, camera, post-processing and the frame loop. */
export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly labels = new CSS2DRenderer();
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.08, 1200);
  quality: Quality = 'medium';
  bloom!: UnrealBloomPass;
  private composer: EffectComposer | null = null;
  private bokeh: BokehPass | null = null;
  private frameFns: ((dt: number, t: number) => void)[] = [];
  private qualityFns: ((q: Quality, p: Preset) => void)[] = [];
  private clock = new THREE.Clock();
  private slow = 0;
  private settleUntil = 6;
  private frames = 0;
  /** Smoothed frames per second, for the debug panel and auto quality. */
  fps = 60;
  /** Longest frame (ms) since it was last reset: used to measure hitches. */
  maxFrame = 0;

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // Shadows are re-rendered when the sun moves and on every third frame (for walking people), not every frame.
    this.renderer.shadowMap.autoUpdate = false;
    this.quality = detectQuality(this.renderer.getContext());
    host.appendChild(this.renderer.domElement);
    this.labels.domElement.className = 'label-layer';
    host.appendChild(this.labels.domElement);
    this.applyQuality();
    addEventListener('resize', () => this.resize());
  }

  get preset(): Preset {
    return PRESETS[this.quality];
  }
  onFrame(fn: (dt: number, t: number) => void) {
    this.frameFns.push(fn);
  }
  onQuality(fn: (q: Quality, p: Preset) => void) {
    this.qualityFns.push(fn);
    fn(this.quality, this.preset);
  }
  setQuality(q: Quality) {
    if (q === this.quality) return;
    this.quality = q;
    this.applyQuality();
    for (const fn of this.qualityFns) fn(q, this.preset);
  }

  private applyQuality() {
    const p = this.preset;
    this.renderer.shadowMap.enabled = true; // toggled per light, so presets can change at runtime
    this.composer?.dispose();
    this.composer = null;
    this.bokeh = null;
    if (p.post) {
      const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
      const composer = new EffectComposer(this.renderer, target);
      composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.28, 0.5, 2.1);
      composer.addPass(this.bloom);
      this.bokeh = new BokehPass(this.scene, this.camera, { focus: 1.2, aperture: 0.004, maxblur: 0.008 });
      this.bokeh.enabled = false;
      composer.addPass(this.bokeh);
      composer.addPass(new OutputPass());
      // Multisampled float targets render black on some GPUs, so anti-aliasing is done with SMAA instead.
      if (p.smaa) composer.addPass(new SMAAPass());
      composer.addPass(new ShaderPass(VignetteShader));
      this.composer = composer;
    }
    this.resize();
  }

  /** Depth of field (first-person option). Ignored on the low preset. */
  setDof(on: boolean, focus = 1.2) {
    if (!this.bokeh) return;
    this.bokeh.enabled = on;
    (this.bokeh.uniforms as Record<string, THREE.IUniform>).focus.value = focus;
  }

  resize() {
    const w = this.host.clientWidth || innerWidth;
    const h = this.host.clientHeight || innerHeight;
    const pr = Math.min(devicePixelRatio, this.preset.pixelRatio);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h);
    this.labels.setSize(w, h);
    this.composer?.setPixelRatio(pr);
    this.composer?.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  start() {
    this.clock.start();
    this.renderer.setAnimationLoop(() => {
      const raw = this.clock.getDelta();
      // Before rendering, so a resolution change never leaves a cleared (black) canvas on screen.
      this.autoQuality(raw);
      const dt = Math.min(raw, 0.1);
      if (this.frames > 30) this.maxFrame = Math.max(this.maxFrame, raw * 1000);
      if (this.frames % 3 === 0) this.renderer.shadowMap.needsUpdate = true;
      const t = this.clock.elapsedTime;
      for (const fn of this.frameFns) fn(dt, t);
      if (this.composer) this.composer.render(dt);
      else this.renderer.render(this.scene, this.camera);
      this.labels.render(this.scene, this.camera);
    });
  }

  /**
   * Sharpness first: the scene is always drawn at the screen's own resolution (up to 2x), never upscaled.
   * Only if the device cannot even hold 24 fps for a few seconds does the preset step down (fewer effects,
   * same resolution). It never steps back up, so it cannot oscillate.
   */
  private autoQuality(raw: number) {
    if (raw <= 0 || document.hidden) return;
    this.fps += (1 / raw - this.fps) * 0.05;
    this.frames++;
    // Timed, not counted in frames: a device at 6 fps must not wait 40 s for help.
    if (this.clock.elapsedTime < this.settleUntil) return; // let shaders compile and the intro settle first
    this.slow = this.fps < 24 ? this.slow + raw : 0;
    const i = ORDER.indexOf(this.quality);
    if (this.slow < 4 || i === 0 || new URLSearchParams(location.search).has('quality')) return;
    this.slow = 0;
    this.settleUntil = this.clock.elapsedTime + 3;
    this.setQuality(ORDER[i - 1]);
  }
}
