// avatar-player.js
// Standalone ES module: 3D talking avatar driven by a pre-recorded MP3
// + a pre-computed viseme timeline JSON.
//
// API:
//   const player = new AvatarPlayer({ container, avatarUrl, visemesUrl, voicesBaseUrl });
//   await player.init();
//   await player.play(clipId);
//   player.stop();
//   player.on('ended', () => {});
//
// The viseme JSON is expected as a map { [clipId]: { duration, frames: [{ t, v }, ...] } }
// where `t` is in seconds and `v` is one of the keys of VISEME_DEFAULTS
// (viseme_sil, viseme_PP, …). `frames` MUST be sorted by `t`.
// Each clip's audio URL is `${voicesBaseUrl}/${clipId}.mp3` unless overridden
// per-clip via an `audioUrl` field.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { WiggleBone } from 'wiggle';
import { TUNING_DEFAULTS } from './tuning-config.js';
import { VISEME_DEFAULTS, ALL_SHAPE_KEYS } from './viseme-config.js';

// Hair bones — same names + structure as the original lipsync-Claude project.
// L0 = root (locked to head, rigid). L1+L2 = WiggleBone (spring physics).
const HAIR_BONES = [
    { name: 'hair001', level: 0 },
    { name: 'hair002', level: 0 },
    { name: 'hair003', level: 0 },
    { name: 'hair004', level: 0 },
    { name: 'Bone005', level: 1 },
    { name: 'Bone003', level: 1 },
    { name: 'Bone001', level: 1 },
    { name: 'Bone007', level: 1 },
    { name: 'Bone009', level: 2 },
    { name: 'Bone008', level: 2 },
];
const HAIR_LEVEL_PARAMS = [
    null,
    { velocity: 0.15, maxStretch: 0.15 },
    { velocity: 0.05, maxStretch: 0.35 },
];
const HAIR_BONE_NAMES = HAIR_BONES.map(b => b.name);

const IDLE_FACE_KEYS = [
    'Eye_Blink', 'Eye_Blink_L', 'Eye_Blink_R',
    'Eye_L_Look_Down', 'Eye_R_Look_Down',
    'Brow_Raise_Outer_L', 'Brow_Raise_Outer_R',
    'Mouth_Smile_L', 'Mouth_Smile_R',
    'Mouth_Roll_In_Lower', 'Mouth_Close',
    'Cheek_Puff_L', 'Cheek_Puff_R',
];

// Idle face & viseme tracks the GLTF animation must NOT drive (we set them manually).
const MANUALLY_CONTROLLED_KEYS = [
    'Mouth_Smile_L', 'Mouth_Smile_R',
    'Mouth_Roll_In_Lower', 'Mouth_Close',
    'Brow_Raise_Outer_L', 'Brow_Raise_Outer_R',
    'Cheek_Puff_L', 'Cheek_Puff_R',
    'Eye_Blink', 'Eye_Blink_L', 'Eye_Blink_R',
    'Eye_L_Look_Down', 'Eye_R_Look_Down',
    ...ALL_SHAPE_KEYS,
];

const _IDLE_BLEND_SPEED = 1.0 / 0.8;
const _HEAD_DRIFT_SPEED = 1.0 / 0.5;
const CROSSFADE_DURATION = 0.8;

export class AvatarPlayer {
    constructor({ container, avatarUrl, visemesUrl, voicesBaseUrl = '/assets/voices' }) {
        if (!container) throw new Error('AvatarPlayer: container is required');
        this.container = container;
        this.avatarUrl = avatarUrl;
        this.visemesUrl = visemesUrl;
        this.voicesBaseUrl = voicesBaseUrl.replace(/\/+$/, '');

        this.cfg = { ...TUNING_DEFAULTS };
        this.visemeMap = {};
        for (const [k, v] of Object.entries(VISEME_DEFAULTS)) {
            this.visemeMap[k] = v.map(s => ({ ...s }));
        }

        // Three.js
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.clock = new THREE.Clock();

        // Avatar
        this.model = null;
        this.mixer = null;
        this.idleAction = null;
        this.parleAction = null;
        this.lipsyncMesh = null;
        this.morphDict = {};
        this.headBone = null;
        this.headBoneRestQuat = new THREE.Quaternion();

        // Hair physics (WiggleBone)
        this.wiggleBones = [];
        this.hairRootLocks = [];

        // Audio + visemes
        this.audioEl = null;
        this.clips = {};            // { clipId: { audioUrl, frames } }
        this.activeClip = null;     // currently playing clip object
        this.frameCursor = 0;       // monotonic index into activeClip.frames
        this.isSpeaking = false;

        // Anim state
        this.elapsedTime = 0;
        this._idleBlend = 1.0;
        this._idleBlendTarget = 1.0;
        this._headDriftFactor = 1.0;
        this._headDriftTarget = 1.0;

        // Lipsync transition state
        this.prevVisemeId = 'viseme_sil';
        this.visemeChangeTime = 0;
        this.morphSnapshot = {};
        this._headEuler = new THREE.Euler();
        this._headQuat = new THREE.Quaternion();

        // Blink state
        this.blinkState = {
            nextBlinkTime: 2.0,
            phase: 'waiting',
            phaseStart: 0,
            doDouble: false,
            doubleCount: 0,
        };

        // Events
        this._listeners = { ended: [] };

        this._onResize = this._onResize.bind(this);
        this._animate = this._animate.bind(this);
    }

    on(event, fn) {
        if (!this._listeners[event]) this._listeners[event] = [];
        this._listeners[event].push(fn);
    }

    _emit(event, ...args) {
        const arr = this._listeners[event];
        if (arr) for (const fn of arr) { try { fn(...args); } catch (e) { console.error(e); } }
    }

    async init() {
        this._setupRenderer();
        this._setupAudio();
        await Promise.all([
            this._loadAvatar(),
            this._loadVisemes(),
        ]);
        this._scheduleNextBlink();
        window.addEventListener('resize', this._onResize);
        this.renderer.setAnimationLoop(this._animate);
    }

    dispose() {
        window.removeEventListener('resize', this._onResize);
        if (this.renderer) {
            this.renderer.setAnimationLoop(null);
            this.renderer.dispose();
            if (this.renderer.domElement.parentNode) {
                this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
            }
        }
        if (this.audioEl) {
            this.audioEl.pause();
            this.audioEl.removeAttribute('src');
        }
    }

    // ── Setup ───────────────────────────────────────────────────────

    _setupRenderer() {
        // Fully transparent: alpha buffer + clear color alpha 0, no scene.background.
        // The page CSS owns the visible background.
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setClearColor(0x000000, 0);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1));
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.NoToneMapping;

        const size = this._containerSize();
        this.renderer.setSize(size.w, size.h, false);
        this.renderer.domElement.style.width = '100%';
        this.renderer.domElement.style.height = '100%';
        this.renderer.domElement.style.display = 'block';
        this.container.appendChild(this.renderer.domElement);

        this.scene = new THREE.Scene();
        // Fallback camera; will be replaced by the GLTF camera if present.
        this.camera = new THREE.PerspectiveCamera(45, size.w / size.h, 0.1, 100);
        this.camera.position.set(0, 1.6, 1.2);
        this.camera.lookAt(0, 1.6, 0);
    }

    _setupAudio() {
        this.audioEl = document.createElement('audio');
        this.audioEl.crossOrigin = 'anonymous';
        this.audioEl.preload = 'auto';
        this.audioEl.playsInline = true;
        this.audioEl.style.display = 'none';
        this.container.appendChild(this.audioEl);

        this.audioEl.addEventListener('ended', () => this._onAudioEnded());
    }

    _containerSize() {
        const rect = this.container.getBoundingClientRect();
        // Avoid 0-sized canvas if container hasn't laid out yet.
        const w = Math.max(1, Math.round(rect.width || this.container.clientWidth || window.innerWidth));
        const h = Math.max(1, Math.round(rect.height || this.container.clientHeight || window.innerHeight));
        return { w, h };
    }

    _onResize() {
        const size = this._containerSize();
        if (this.camera.isPerspectiveCamera) {
            this.camera.aspect = size.w / size.h;
            this.camera.updateProjectionMatrix();
        }
        this.renderer.setSize(size.w, size.h, false);
    }

    // ── Loaders ─────────────────────────────────────────────────────

    async _loadAvatar() {
        const loader = new GLTFLoader();
        const gltf = await loader.loadAsync(this.avatarUrl);
        const model = gltf.scene;
        this.model = model;
        this.scene.add(model);

        // Use the first GLTF camera (excluding any aux "Camera2") cadrée sur le visage.
        let firstCam = null;
        model.traverse((child) => {
            if (child.isCamera && !firstCam && child.name !== 'Camera2') firstCam = child;
        });
        if (firstCam) {
            firstCam.updateWorldMatrix(true, false);
            const wp = new THREE.Vector3(); const wq = new THREE.Quaternion();
            firstCam.getWorldPosition(wp); firstCam.getWorldQuaternion(wq);
            if (firstCam.parent) firstCam.parent.remove(firstCam);
            firstCam.position.copy(wp);
            firstCam.quaternion.copy(wq);
            this.scene.add(firstCam);
            this.camera = firstCam;
            const size = this._containerSize();
            this.camera.aspect = size.w / size.h;
            this.camera.updateProjectionMatrix();
        }

        // Convert materials to unlit. Hair detected by material name ("cheveux")
        // or by the (transparent + emissiveMap + map) signature. Hair gets a
        // merged color+alpha texture so the mask survives the MeshBasicMaterial swap.
        const hairMeshes = [];
        model.traverse((child) => {
            if (!child.isMesh) return;
            const old = child.material;
            const matName = (old && old.name) || '';
            const isHair = matName.toLowerCase().includes('cheveux') ||
                (old && old.transparent && old.emissiveMap && old.map);

            if (isHair) {
                hairMeshes.push({ mesh: child, oldMat: old });
                child.visible = false;
            } else {
                const tex = (old && old.emissiveMap) || (old && old.map) || null;
                if (tex) tex.colorSpace = THREE.SRGBColorSpace;
                child.material = new THREE.MeshBasicMaterial({
                    map: tex,
                    side: (old && old.side) || THREE.FrontSide,
                });
            }
            child.frustumCulled = false;

            if (child.morphTargetDictionary && Object.keys(child.morphTargetDictionary).length > 0) {
                this.lipsyncMesh = child;
                this.morphDict = child.morphTargetDictionary;
            }
        });

        for (const { mesh, oldMat } of hairMeshes) {
            const colorTex = oldMat.emissiveMap;
            const alphaTex = oldMat.map;
            if (colorTex && alphaTex) {
                const merged = await this._mergeColorAndAlpha(colorTex, alphaTex);
                mesh.material = new THREE.MeshBasicMaterial({
                    map: merged,
                    transparent: true,
                    alphaTest: 0.15,
                    depthWrite: true,
                    side: THREE.DoubleSide,
                });
            } else {
                mesh.material = new THREE.MeshBasicMaterial({
                    map: colorTex || alphaTex,
                    transparent: true,
                    alphaTest: 0.15,
                    side: THREE.DoubleSide,
                });
            }
            mesh.visible = true;
            mesh.renderOrder = 1;
        }

        // Find the head bone (rigify-style "Head" / "head"; skip "headtop").
        model.traverse((child) => {
            if (!child.isBone) return;
            const n = child.name.toLowerCase();
            if (n === 'head' || (n.includes('head') && !n.includes('headtop'))) {
                if (!this.headBone) {
                    this.headBone = child;
                    this.headBoneRestQuat.copy(child.quaternion);
                }
            }
        });

        // Animations: strip tracks we drive manually so the mixer doesn't
        // overwrite our blink/viseme/idle face values every frame.
        this.mixer = new THREE.AnimationMixer(model);
        const idleClip = gltf.animations.find(a => a.name === 'idle');
        const parleClip = gltf.animations.find(a => a.name === 'parle');
        this._stripConflictingTracks(idleClip);
        this._stripConflictingTracks(parleClip);

        if (idleClip) {
            this.idleAction = this.mixer.clipAction(idleClip);
            this.idleAction.play();
        }
        if (parleClip) {
            this.parleAction = this.mixer.clipAction(parleClip);
            this.parleAction.setLoop(THREE.LoopRepeat);
            this.parleAction.clampWhenFinished = false;
            this.parleAction.weight = 0;
            this.parleAction.play();
        }

        // Hair physics — must come after the model is in place and bones are world-resolved.
        this._initWiggleBones();
    }

    _stripConflictingTracks(clip) {
        if (!clip) return;
        clip.tracks = clip.tracks.filter(track => {
            // Manually-driven shape keys / blink / brow / mouth / etc.
            if (MANUALLY_CONTROLLED_KEYS.some(key => track.name.includes(key))) return false;
            // Hair bone tracks — physics overrides whatever the GLTF clip says.
            if (HAIR_BONE_NAMES.some(bn => track.name.startsWith(bn + '.'))) return false;
            return true;
        });
    }

    _initWiggleBones() {
        if (!this.model) return;
        for (const { name, level } of HAIR_BONES) {
            const bone = this.model.getObjectByName(name);
            if (!bone) continue;
            const params = HAIR_LEVEL_PARAMS[level];
            if (!params) {
                // L0: pivot — locked to its rest pose every frame so it follows the head rigidly.
                this.hairRootLocks.push({
                    bone,
                    restQuat: bone.quaternion.clone(),
                    restPos: bone.position.clone(),
                });
                continue;
            }
            const wb = new WiggleBone(bone, {
                velocity: params.velocity,
                maxStretch: params.maxStretch,
            });
            wb._baseVelocity = params.velocity;
            wb._baseMaxStretch = params.maxStretch;
            this.wiggleBones.push(wb);
        }
    }

    _updateWiggleBones() {
        const flex = this.cfg.hairFlex ?? 1;
        // 1. Lock L0 roots to rest pose (rigid follow of head bone).
        for (const root of this.hairRootLocks) {
            root.bone.position.copy(root.restPos);
            root.bone.quaternion.copy(root.restQuat);
        }
        // 2. Interpolate wiggle params by hairFlex (1 = soft, 0 = nearly rigid).
        for (const wb of this.wiggleBones) {
            wb.velocity = 1 - flex * (1 - wb._baseVelocity);
            wb.maxStretch = flex * wb._baseMaxStretch;
            wb.update();
        }
    }

    async _loadVisemes() {
        if (!this.visemesUrl) return;
        try {
            const res = await fetch(this.visemesUrl);
            if (!res.ok) {
                console.warn(`AvatarPlayer: visemes JSON missing (${res.status}) — running in idle-only mode.`);
                this.clips = {};
                return;
            }
            this.clips = await res.json();
        } catch (e) {
            console.warn('AvatarPlayer: failed to load visemes JSON — idle-only mode.', e);
            this.clips = {};
        }
    }

    // Hair: combine color (from emissiveMap) with alpha mask (from baseColor).
    // Auto-detects whether the alpha mask lives in the alpha channel or in
    // RGB luminance.
    _mergeColorAndAlpha(colorTex, alphaTex) {
        return new Promise((resolve) => {
            const cImg = colorTex.image; const aImg = alphaTex.image;
            const w = cImg.width; const h = cImg.height;
            const cCanvas = document.createElement('canvas');
            cCanvas.width = w; cCanvas.height = h;
            const cCtx = cCanvas.getContext('2d', { willReadFrequently: true });
            cCtx.drawImage(cImg, 0, 0, w, h);
            const cData = cCtx.getImageData(0, 0, w, h);
            const aCanvas = document.createElement('canvas');
            aCanvas.width = w; aCanvas.height = h;
            const aCtx = aCanvas.getContext('2d', { willReadFrequently: true });
            aCtx.drawImage(aImg, 0, 0, w, h);
            const aData = aCtx.getImageData(0, 0, w, h);

            let hasAlpha = false;
            for (let i = 3; i < aData.data.length; i += 4) {
                if (aData.data[i] < 250) { hasAlpha = true; break; }
            }
            for (let i = 0; i < cData.data.length; i += 4) {
                cData.data[i + 3] = hasAlpha
                    ? aData.data[i + 3]
                    : Math.round(aData.data[i] * 0.299 + aData.data[i + 1] * 0.587 + aData.data[i + 2] * 0.114);
            }
            cCtx.putImageData(cData, 0, 0);

            const merged = new THREE.CanvasTexture(cCanvas);
            merged.colorSpace = THREE.SRGBColorSpace;
            merged.flipY = colorTex.flipY;
            merged.wrapS = colorTex.wrapS;
            merged.wrapT = colorTex.wrapT;
            merged.needsUpdate = true;
            resolve(merged);
        });
    }

    // ── Public play / stop ──────────────────────────────────────────

    async play(clipId) {
        const clip = this.clips[clipId];
        if (!clip) throw new Error(`AvatarPlayer: unknown clip "${clipId}"`);
        if (this.isSpeaking) this.stop();

        this.activeClip = clip;
        this.activeClipId = clipId;
        this.frameCursor = 0;
        this.audioEl.src = clip.audioUrl || `${this.voicesBaseUrl}/${clipId}.wav`;

        // Triggered from a user gesture upstream: play() returns a Promise,
        // we set isSpeaking only once the audio is actually playing so the
        // viseme search doesn't run before currentTime is meaningful.
        return new Promise((resolve, reject) => {
            const onPlaying = () => {
                this.audioEl.removeEventListener('playing', onPlaying);
                this.isSpeaking = true;
                this._setTalking(true);
                resolve();
            };
            this.audioEl.addEventListener('playing', onPlaying);
            const p = this.audioEl.play();
            if (p && p.catch) p.catch((err) => {
                this.audioEl.removeEventListener('playing', onPlaying);
                reject(err);
            });
        });
    }

    stop() {
        if (this.audioEl) {
            this.audioEl.pause();
            try { this.audioEl.currentTime = 0; } catch (_) {}
        }
        if (this.isSpeaking) {
            this.isSpeaking = false;
            this._setTalking(false);
        }
        this.activeClip = null;
        this.frameCursor = 0;
    }

    _onAudioEnded() {
        if (!this.isSpeaking) return;
        this.isSpeaking = false;
        this._setTalking(false);
        this.activeClip = null;
        this.frameCursor = 0;
        this._emit('ended');
    }

    _setTalking(talking) {
        if (!this.idleAction || !this.parleAction) return;
        this._idleBlendTarget = talking ? 0.0 : 1.0;
        if (!talking) this._headDriftTarget = 1.0;
        if (talking) {
            this.parleAction.reset();
            this.parleAction.setEffectiveWeight(1);
            this.parleAction.crossFadeFrom(this.idleAction, CROSSFADE_DURATION, true);
        } else {
            this.idleAction.reset();
            this.idleAction.setEffectiveWeight(1);
            this.idleAction.crossFadeFrom(this.parleAction, CROSSFADE_DURATION, true);
        }
    }

    // ── Render loop ─────────────────────────────────────────────────

    _animate() {
        const dt = this.clock.getDelta();
        this.elapsedTime += dt;

        if (this.mixer) this.mixer.update(dt);

        // Hair physics must run after the mixer (so bones have up-to-date world matrices)
        // but before lipsync/idle face updates which don't touch hair.
        if (this.wiggleBones.length || this.hairRootLocks.length) {
            this.scene.updateMatrixWorld(true);
            this._updateWiggleBones();
        }

        this._applyLipsync();

        // Smooth idle blend & head drift ramps (matches skeleton crossfade).
        if (this._idleBlend !== this._idleBlendTarget) {
            const step = _IDLE_BLEND_SPEED * dt;
            this._idleBlend = this._idleBlend < this._idleBlendTarget
                ? Math.min(this._idleBlend + step, this._idleBlendTarget)
                : Math.max(this._idleBlend - step, this._idleBlendTarget);
        }
        if (this._headDriftFactor !== this._headDriftTarget) {
            const hStep = _HEAD_DRIFT_SPEED * dt;
            this._headDriftFactor = this._headDriftFactor < this._headDriftTarget
                ? Math.min(this._headDriftFactor + hStep, this._headDriftTarget)
                : Math.max(this._headDriftFactor - hStep, this._headDriftTarget);
        }

        this._updateBlink();
        this._updateMicroExpressions();
        this._updateBreathing();
        this._updateHeadDrift();

        this.renderer.render(this.scene, this.camera);
    }

    // ── Viseme lookup + apply ───────────────────────────────────────

    _currentViseme() {
        if (!this.activeClip || !this.activeClip.frames || !this.activeClip.frames.length) return 'viseme_sil';
        const frames = this.activeClip.frames;
        const t = this.audioEl.currentTime;

        // Linear scan with monotonic cursor — audio time only moves forward
        // during normal playback. Reset to 0 on stop()/play() so scrubbing
        // still works.
        let i = this.frameCursor;
        if (i >= frames.length) i = frames.length - 1;
        if (frames[i].t > t) i = 0;
        while (i + 1 < frames.length && frames[i + 1].t <= t) i++;
        this.frameCursor = i;
        return frames[i].v || frames[i].viseme || 'viseme_sil';
    }

    _applyLipsync() {
        if (!this.lipsyncMesh) return;
        const cfg = this.cfg;

        if (this.isSpeaking) {
            const activeViseme = this._currentViseme();
            const shapes = this.visemeMap[activeViseme] || [];

            const targetMap = {};
            for (const k of ALL_SHAPE_KEYS) targetMap[k] = 0;
            for (const { shape, intensity } of shapes) {
                targetMap[shape] = Math.min(intensity * cfg.maxIntensity, 3.0);
            }
            // Procedural jaw boost on open vowels (matches original tuning).
            if (activeViseme === 'viseme_aa' || activeViseme === 'viseme_E') {
                const jawTarget = Math.min(cfg.jawBoost, 3.0);
                targetMap['V_Open'] = Math.max(targetMap['V_Open'] || 0, jawTarget);
            }

            // On viseme change, snapshot current values for ease-in crossfade.
            if (activeViseme !== this.prevVisemeId) {
                for (const k of ALL_SHAPE_KEYS) {
                    const idx = this.morphDict[k];
                    if (idx !== undefined) this.morphSnapshot[k] = this.lipsyncMesh.morphTargetInfluences[idx] || 0;
                }
                this.visemeChangeTime = this.elapsedTime;
                this.prevVisemeId = activeViseme;
            }

            const transitionDur = 0.03 / cfg.lerpSpeed;
            const rawT = Math.min(1.0, (this.elapsedTime - this.visemeChangeTime) / transitionDur);
            const easedT = 1 - Math.pow(1 - rawT, 3); // ease-out cubic

            // Dual speed: incoming shapes ease in from snapshot, outgoing
            // shapes decay fast (lerpDecay) so the mouth closes crisply.
            for (const k of ALL_SHAPE_KEYS) {
                const idx = this.morphDict[k];
                if (idx === undefined) continue;
                const target = targetMap[k] || 0;
                const current = this.lipsyncMesh.morphTargetInfluences[idx] || 0;
                if (target > 0) {
                    const from = this.morphSnapshot[k] !== undefined ? this.morphSnapshot[k] : 0;
                    this.lipsyncMesh.morphTargetInfluences[idx] = from + (target - from) * easedT;
                } else if (current > 0.005) {
                    this.lipsyncMesh.morphTargetInfluences[idx] = THREE.MathUtils.lerp(current, 0, cfg.lerpDecay);
                } else {
                    this.lipsyncMesh.morphTargetInfluences[idx] = 0;
                }
            }
        } else {
            this.prevVisemeId = 'viseme_sil';
            for (const k of ALL_SHAPE_KEYS) {
                const idx = this.morphDict[k];
                if (idx === undefined) continue;
                const current = this.lipsyncMesh.morphTargetInfluences[idx] || 0;
                this.lipsyncMesh.morphTargetInfluences[idx] = current > 0.01
                    ? THREE.MathUtils.lerp(current, 0, cfg.lerpDecay)
                    : 0;
            }
        }
    }

    // ── Idle face animations ────────────────────────────────────────

    _setMorph(name, value) {
        const idx = this.morphDict[name];
        if (idx === undefined || !this.lipsyncMesh) return;
        this.lipsyncMesh.morphTargetInfluences[idx] = Math.max(0, Math.min(value, 1.0));
    }

    _scheduleNextBlink() {
        const min = this.cfg.blinkIntervalMin;
        const max = this.cfg.blinkIntervalMax;
        const r = Math.pow(Math.random(), 1.5);
        this.blinkState.nextBlinkTime = this.elapsedTime + min + r * (max - min);
        this.blinkState.phase = 'waiting';
        this.blinkState.doDouble = Math.random() < this.cfg.doubleBlink;
        this.blinkState.doubleCount = 0;
    }

    _updateBlink() {
        if (!this.lipsyncMesh) return;
        const blinkIdx = this.morphDict['Eye_Blink'];
        if (blinkIdx === undefined) return;
        const closeDur = this.cfg.blinkCloseDuration / 1000;
        const holdDur = this.cfg.blinkHoldDuration / 1000;
        const openDur = closeDur * 1.5;
        const t = this.elapsedTime;
        const s = this.blinkState;

        switch (s.phase) {
            case 'waiting':
                if (t >= s.nextBlinkTime) { s.phase = 'closing'; s.phaseStart = t; }
                break;
            case 'closing': {
                const p = (t - s.phaseStart) / closeDur;
                this.lipsyncMesh.morphTargetInfluences[blinkIdx] = Math.min(1, p * p);
                if (p >= 1) { s.phase = 'holding'; s.phaseStart = t; }
                break;
            }
            case 'holding':
                this.lipsyncMesh.morphTargetInfluences[blinkIdx] = 1;
                if (t - s.phaseStart >= holdDur) { s.phase = 'opening'; s.phaseStart = t; }
                break;
            case 'opening': {
                const p = (t - s.phaseStart) / openDur;
                this.lipsyncMesh.morphTargetInfluences[blinkIdx] = 1 - Math.min(1, Math.sqrt(p));
                if (p >= 1) {
                    this.lipsyncMesh.morphTargetInfluences[blinkIdx] = 0;
                    s.doubleCount++;
                    if (s.doDouble && s.doubleCount < 2) {
                        s.phase = 'closing';
                        s.phaseStart = t + 0.05 + Math.random() * 0.15;
                    } else {
                        this._scheduleNextBlink();
                    }
                }
                break;
            }
        }
    }

    _updateMicroExpressions() {
        if (!this.lipsyncMesh) return;
        const cfg = this.cfg;
        const smile = cfg.smileIntensity;
        const ib = this._idleBlend;
        const sb = 1.0 - ib;
        const tIdle = this.elapsedTime * cfg.microSpeed;
        const tSpeak = this.elapsedTime * cfg.microSpeed * 1.5;

        const smileIdleL = smile + 0.05 + Math.sin(tIdle * 0.23 + 0.0) * cfg.microMouthAmp * 0.6;
        const smileIdleR = smile + 0.04 + Math.sin(tIdle * 0.19 + 1.2) * cfg.microMouthAmp * 0.5;
        this._setMorph('Mouth_Smile_L', smileIdleL * ib + smile * sb);
        this._setMorph('Mouth_Smile_R', smileIdleR * ib + smile * sb);

        const lipRoll = Math.max(0, Math.sin(tIdle * 0.11 + 3.7)) * cfg.microMouthAmp * 0.4;
        this._setMorph('Mouth_Roll_In_Lower', lipRoll * ib);

        const browL = Math.max(0, Math.sin(tIdle * 0.17 + 0.5)) * cfg.microBrowAmp;
        const browR = Math.max(0, Math.sin(tIdle * 0.13 + 2.1)) * cfg.microBrowAmp * 0.7;
        const browSL = Math.max(0, Math.sin(tSpeak * 0.17 + 0.5)) * cfg.microBrowAmp;
        const browSR = Math.max(0, Math.sin(tSpeak * 0.13 + 2.1)) * cfg.microBrowAmp * 0.7;
        this._setMorph('Brow_Raise_Outer_L', browL * ib + browSL * sb);
        this._setMorph('Brow_Raise_Outer_R', browR * ib + browSR * sb);

        const cheek = Math.max(0, Math.sin(tIdle * 0.07 + 5.0)) * 0.05;
        this._setMorph('Cheek_Puff_L', cheek * ib);
        this._setMorph('Cheek_Puff_R', cheek * 0.8 * ib);
    }

    _updateBreathing() {
        if (!this.lipsyncMesh) return;
        const breathPhase = Math.sin(this.elapsedTime * this.cfg.breathSpeed) * 0.5 + 0.5;
        const amp = this.cfg.breathAmplitude;
        this._setMorph('Mouth_Close', (1 - breathPhase) * amp * 0.3 * this._idleBlend);
    }

    _updateHeadDrift() {
        const t = this.elapsedTime;
        const baseAmp = THREE.MathUtils.lerp(this.cfg.headDriftAmp * 0.4, this.cfg.headDriftAmp, this._idleBlend);
        const amp = baseAmp * this._headDriftFactor;

        if (this.headBone) {
            const yaw   = Math.sin(t * 0.31) * amp;
            const pitch = Math.sin(t * 0.23 + 0.7) * amp * 0.5;
            const roll  = Math.sin(t * 0.19 + 1.5) * amp * 0.3;
            this._headEuler.set(pitch, yaw, roll);
            this._headQuat.setFromEuler(this._headEuler);
            this._headQuat.premultiply(this.headBoneRestQuat);
            const slerpT = this._headDriftFactor < 0.5 ? 0.15 : 0.05;
            this.headBone.quaternion.slerp(this._headQuat, slerpT);
        }

        if (this.lipsyncMesh) {
            const gaze = Math.max(0, Math.sin(t * 0.13 + 0.7)) * 0.12 * this._idleBlend;
            this._setMorph('Eye_L_Look_Down', gaze);
            this._setMorph('Eye_R_Look_Down', gaze * 0.9);
        }
    }
}
