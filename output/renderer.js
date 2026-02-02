/**
 * EntryJS Compiled Project - Renderer
 * 
 * This file handles PixiJS rendering only.
 * All project logic runs in WebAssembly.
 */

// ===== CONFIGURATION =====
const STAGE_WIDTH = 640;
const STAGE_HEIGHT = 360;
const TARGET_FPS = 60;
const SCENE_COUNT = 1;

// ===== WASM IMPORTS =====
const wasmImports = {
    math: {
        sin: Math.sin,
        cos: Math.cos,
        sqrt: Math.sqrt,
        random: Math.random,
        floor: Math.floor,
        ceil: Math.ceil,
        abs: Math.abs,
        atan2: Math.atan2
    },
    system: {
        log: (value) => console.log('[WASM]', value),
        playSound: (entityIdx, soundIdx) => playSound(entityIdx, soundIdx),
        sendMessage: (msgIdx) => handleMessage(msgIdx)
    },
    brush: {
        startDrawing: (entityIdx) => startBrushDrawing(entityIdx),
        stopDrawing: (entityIdx) => stopBrushDrawing(entityIdx),
        stamp: (entityIdx) => addStamp(entityIdx),
        clearBrush: () => clearAllBrush(),
        setBrushColor: (entityIdx, r, g, b) => setBrushColor(entityIdx, r, g, b),
        setRandomBrushColor: (entityIdx) => setRandomBrushColor(entityIdx),
        changeBrushThickness: (entityIdx, amount) => changeBrushThickness(entityIdx, amount),
        setBrushThickness: (entityIdx, thickness) => setBrushThickness(entityIdx, thickness),
        changeBrushTransparency: (entityIdx, amount) => changeBrushTransparency(entityIdx, amount),
        setBrushTransparency: (entityIdx, transparency) => setBrushTransparency(entityIdx, transparency),
        startFill: (entityIdx) => startFillMode(entityIdx),
        stopFill: (entityIdx) => stopFillMode(entityIdx),
        setFillColor: (entityIdx, r, g, b) => setFillColor(entityIdx, r, g, b),
        notifyPosition: (entityIdx, x, y) => brushNotifyPosition(entityIdx, x, y)
    }
};

// ===== GLOBAL STATE =====
let wasm = null;
let memory = null;
let app = null;
let sprites = [];
let textures = [];
let sounds = [];
let running = false;
let lastTime = 0;
let currentScene = 0;

// ===== BRUSH/DRAWING STATE =====
// Per-entity containers: each contains (in order) fillGraphics, brushGraphics, sprite
// This ensures entity N's brush is below entity N's sprite but above entity N-1's sprite
let entityContainers = [];  // PIXI.Container per entity
let brushGraphics = [];     // PIXI.Graphics per entity for stroke drawing
let fillGraphics = [];      // PIXI.Graphics per entity for fill drawing
let stampContainer = null;  // Container for stamps (rendered above all entities)
let stamps = [];            // Array of stamp sprites

// Brush state per entity: { isDrawing, isFilling, color, thickness, opacity, fillColor, fillOpacity, lastX, lastY }
let brushStates = [];

// ===== SCENE DATA =====
const SCENE_DATA = [
    { id: "7dwq", name: "장면 1", index: 0 },
];


// ===== ASSET DATA =====
const ENTITY_DATA = [
    {
        id: "7y0y",
        name: "엔트리봇",
        pictures: [
            { id: "vx80", url: "/lib/entry-js/images/media/entrybot1.svg", width: 144, height: 246 },
            { id: "4t48", url: "/lib/entry-js/images/media/entrybot2.svg", width: 144, height: 246 },
        ],
        sounds: [
            { id: "8el5", url: "/lib/entry-js/images/media/bark.mp3" },
        ],
        sceneIndex: 0
    },
    {
        id: "ackl",
        name: "단색 배경",
        pictures: [
            { id: "hx5w", url: "", width: 960, height: 540 },
            { id: "qm1g", url: "", width: 960, height: 540 },
            { id: "yl9y", url: "", width: 960, height: 540 },
        ],
        sounds: [
        ],
        sceneIndex: 0
    },
];


// ===== HELPER FUNCTIONS =====
let placeholderTexture = null;

function getPlaceholderTexture() {
    // Use PIXI.Texture.WHITE as a safe fallback for all PixiJS versions
    if (!placeholderTexture) {
        placeholderTexture = PIXI.Texture.WHITE;
    }
    return placeholderTexture;
}

function normalizeAssetUrl(url) {
    if (!url) return null;
    
    // playentry.org base URL for assets
    const PLAYENTRY_BASE = 'https://playentry.org';
    
    // Helper to wrap URL in proxy
    function proxyUrl(targetUrl) {
        return '/proxy?url=' + encodeURIComponent(targetUrl);
    }
    
    // Handle various URL patterns
    if (url.startsWith('/lib/entry-js/') || url.startsWith('/lib/')) {
        // Entry default assets - load via proxy from playentry.org
        return proxyUrl(PLAYENTRY_BASE + url);
    }
    if (url.startsWith('/uploads/') || url.startsWith('/temp/')) {
        // User uploaded assets - load via proxy from playentry.org
        return proxyUrl(PLAYENTRY_BASE + url);
    }
    if (url.startsWith('//')) {
        // Protocol-relative URL - proxy it
        return proxyUrl('https:' + url);
    }
    if (url.startsWith('http://') || url.startsWith('https://')) {
        // Already absolute URL - check if it needs proxying
        if (url.includes('playentry.org') || url.includes('entry.com') || url.includes('entryjs.org')) {
            return proxyUrl(url);
        }
        return url;
    }
    // Relative path starting with / - try playentry.org via proxy
    if (url.startsWith('/')) {
        return proxyUrl(PLAYENTRY_BASE + url);
    }
    // Local relative path - keep as is (for local assets)
    return url;
}

// ===== INITIALIZATION =====
async function init() {
    console.log('[Renderer] Initializing...');
    
    // Initialize PixiJS (compatible with v6, v7, and v8)
    const canvas = document.getElementById('stage');
    const initOptions = {
        width: STAGE_WIDTH,
        height: STAGE_HEIGHT,
        backgroundColor: 0xffffff,
        antialias: true
    };
    
    // Check PixiJS version and use appropriate initialization
    if (PIXI.Application.prototype.init) {
        // PixiJS v8+ uses async init
        app = new PIXI.Application();
        initOptions.canvas = canvas;
        await app.init(initOptions);
    } else {
        // PixiJS v6/v7 uses constructor options
        initOptions.view = canvas;
        app = new PIXI.Application(initOptions);
    }
    
    // Load WASM module
    try {
        const wasmResponse = await fetch('project.wasm');
        const wasmBuffer = await wasmResponse.arrayBuffer();
        const wasmModule = await WebAssembly.instantiate(wasmBuffer, wasmImports);
        wasm = wasmModule.instance.exports;
        memory = new DataView(wasm.memory.buffer);
        console.log('[Renderer] WASM loaded');
    } catch (error) {
        console.error('[Renderer] Failed to load WASM:', error);
        return;
    }
    
    // Load assets and create sprites
    await loadAssets();
    createSprites();
    
    // Initialize WASM state
    wasm.init();
    
    // Set up input handlers
    setupInputHandlers();
    
    // Start game loop
    running = true;
    lastTime = performance.now();
    requestAnimationFrame(gameLoop);
    
    console.log('[Renderer] Started');
}

// ===== ASSET LOADING =====
// Load image via Image element (works for SVG and all image formats)
// For SVG files, rasterize to exact dimensions to ensure correct sizing
function loadImageAsTexture(url, expectedWidth, expectedHeight) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        
        img.onload = () => {
            try {
                // Check if this is an SVG file that needs rasterization at exact dimensions
                const isSvg = url.toLowerCase().includes('.svg');
                
                if (isSvg && expectedWidth && expectedHeight) {
                    // Rasterize SVG to an offscreen canvas at exact dimensions
                    // This ensures SVG is rendered at the correct pixel size regardless of viewBox
                    const canvas = document.createElement('canvas');
                    canvas.width = expectedWidth;
                    canvas.height = expectedHeight;
                    const ctx = canvas.getContext('2d');
                    
                    // Draw the SVG scaled to fit the expected dimensions
                    ctx.drawImage(img, 0, 0, expectedWidth, expectedHeight);
                    
                    // Create texture from the canvas
                    const texture = PIXI.Texture.from(canvas);
                    resolve(texture);
                } else {
                    // For non-SVG images, create texture directly
                    const texture = PIXI.Texture.from(img);
                    resolve(texture);
                }
            } catch (e) {
                reject(e);
            }
        };
        
        img.onerror = () => {
            reject(new Error('Image load failed: ' + url));
        };
        
        // Set timeout
        setTimeout(() => {
            if (!img.complete) {
                reject(new Error('Image load timeout: ' + url));
            }
        }, 15000);
        
        img.src = url;
    });
}

async function loadAssets() {
    console.log('[Renderer] Loading assets...');
    
    // Load textures for each entity
    for (const entityData of ENTITY_DATA) {
        const entityTextures = [];
        for (const pic of entityData.pictures) {
            const url = normalizeAssetUrl(pic.url);
            if (!url) {
                console.warn('[Renderer] No URL for texture, using placeholder');
                entityTextures.push(getPlaceholderTexture());
                continue;
            }
            try {
                // Use Image element loading for better SVG support
                // Pass expected dimensions so SVG files are rasterized at correct size
                const texture = await loadImageAsTexture(url, pic.width, pic.height);
                
                if (texture && texture.baseTexture && texture.baseTexture.valid) {
                    entityTextures.push(texture);
                    console.log('[Renderer] Loaded texture:', url);
                } else {
                    console.warn('[Renderer] Invalid texture:', url);
                    entityTextures.push(getPlaceholderTexture());
                }
            } catch (e) {
                console.warn('[Renderer] Failed to load texture:', url, e.message);
                entityTextures.push(getPlaceholderTexture());
            }
        }
        // Ensure at least one texture exists
        if (entityTextures.length === 0) {
            entityTextures.push(getPlaceholderTexture());
        }
        textures.push(entityTextures);
    }
    
    // Load sounds
    for (const entityData of ENTITY_DATA) {
        const entitySounds = [];
        for (const snd of entityData.sounds) {
            const url = normalizeAssetUrl(snd.url);
            if (!url) {
                entitySounds.push(null);
                continue;
            }
            try {
                const audio = new Audio(url);
                entitySounds.push(audio);
            } catch (e) {
                console.warn('[Renderer] Failed to load sound:', url);
                entitySounds.push(null);
            }
        }
        sounds.push(entitySounds);
    }
}

// ===== SPRITE CREATION =====
function createSprites() {
    // Create entities in order - each entity has its own container with:
    // 1. Fill graphics (bottom)
    // 2. Brush graphics (middle)
    // 3. Sprite (top)
    // This ensures entity N's brush is below entity N but above entity N-1
    
    for (let i = 0; i < ENTITY_DATA.length; i++) {
        const entityData = ENTITY_DATA[i];
        const entityTextures = textures[i] || [];
        
        // Create container for this entity (positioned at stage center)
        const container = new PIXI.Container();
        container.x = STAGE_WIDTH / 2;
        container.y = STAGE_HEIGHT / 2;
        app.stage.addChild(container);
        entityContainers.push(container);
        
        // Initialize fill graphics (will be created on first use)
        fillGraphics.push(null);
        
        // Initialize brush graphics (will be created on first use)
        brushGraphics.push(null);
        
        // Get first valid texture or use placeholder
        let initialTexture = getPlaceholderTexture();
        for (const tex of entityTextures) {
            if (tex && tex.valid !== false && tex.baseTexture) {
                initialTexture = tex;
                break;
            }
        }
        
        // Create sprite with first texture
        const sprite = new PIXI.Sprite(initialTexture);
        
        // Set anchor to center
        sprite.anchor.set(0.5, 0.5);
        
        // Initial position relative to container (0,0 = center)
        sprite.x = 0;
        sprite.y = 0;
        
        // Only show sprites from the first scene initially
        container.visible = entityData.sceneIndex === 0;
        
        container.addChild(sprite);
        sprites.push({
            sprite,
            textures: entityTextures,
            data: entityData,
            container: container
        });
        
        // Initialize brush state
        brushStates.push({
            isDrawing: false,
            isFilling: false,
            color: 0xFF0000,      // Default red (matches EntryJS)
            thickness: 1,
            opacity: 1.0,         // 0-1 (1 = fully opaque, matches EntryJS default transparency=0)
            fillColor: 0xFF0000,  // Default red (matches EntryJS)
            fillOpacity: 1.0,
            lastX: 0,
            lastY: 0,
            // Track last applied style to avoid redundant lineStyle calls
            _lastColor: -1,
            _lastThickness: -1,
            _lastOpacity: -1
        });
    }
    
    // Create stamp container (rendered above all entities)
    stampContainer = new PIXI.Container();
    stampContainer.x = STAGE_WIDTH / 2;
    stampContainer.y = STAGE_HEIGHT / 2;
    app.stage.addChild(stampContainer);
}

// ===== INPUT HANDLING =====
function setupInputHandlers() {
    const canvas = app.canvas || app.view;
    
    // Mouse position
    canvas.addEventListener('mousemove', (e) => {
        const rect = canvas.getBoundingClientRect();
        const x = (e.clientX - rect.left) * (STAGE_WIDTH / rect.width) - STAGE_WIDTH / 2;
        const y = STAGE_HEIGHT / 2 - (e.clientY - rect.top) * (STAGE_HEIGHT / rect.height);
        
        // Write to WASM memory (offset 16 for mouseX, 24 for mouseY)
        const view = new DataView(wasm.memory.buffer);
        view.setFloat64(16, x, true);
        view.setFloat64(24, y, true);
    });
    
    // Mouse click
    canvas.addEventListener('mousedown', () => {
        const view = new DataView(wasm.memory.buffer);
        view.setInt32(32, 1, true);
    });
    
    canvas.addEventListener('mouseup', () => {
        const view = new DataView(wasm.memory.buffer);
        view.setInt32(32, 0, true);
    });
    
    // Keyboard
    const keyStates = new Uint8Array(64); // 512 bits
    
    document.addEventListener('keydown', (e) => {
        const keycode = e.keyCode;
        if (keycode < 512) {
            const byteIndex = Math.floor(keycode / 8);
            const bitIndex = keycode % 8;
            keyStates[byteIndex] |= (1 << bitIndex);
            
            // Write to WASM memory (offset 36)
            const view = new Uint8Array(wasm.memory.buffer, 36, 64);
            view.set(keyStates);
        }
        // Don't prevent default for browser shortcuts (Ctrl/Cmd/Alt+key combinations)
        if (!e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
        }
    });
    
    document.addEventListener('keyup', (e) => {
        const keycode = e.keyCode;
        if (keycode < 512) {
            const byteIndex = Math.floor(keycode / 8);
            const bitIndex = keycode % 8;
            keyStates[byteIndex] &= ~(1 << bitIndex);
            
            // Write to WASM memory
            const view = new Uint8Array(wasm.memory.buffer, 36, 64);
            view.set(keyStates);
        }
    });
}

// ===== GAME LOOP =====
function gameLoop(currentTime) {
    if (!running) return;
    
    const deltaTime = (currentTime - lastTime) / 1000;
    lastTime = currentTime;
    
    // Call WASM tick
    wasm.tick(deltaTime);
    
    // Check for scene changes
    const wasmScene = wasm.getCurrentScene();
    if (wasmScene !== currentScene) {
        console.log('[Renderer] Scene changed from', currentScene, 'to', wasmScene);
        currentScene = wasmScene;
    }
    
    // Update sprites from WASM state
    updateSprites();
    
    // Request next frame
    requestAnimationFrame(gameLoop);
}

// ===== SPRITE UPDATE =====
function updateSprites() {
    for (let i = 0; i < sprites.length; i++) {
        const { sprite, textures: entityTextures, container } = sprites[i];
        
        // Read entity state from WASM
        const x = wasm.getX(i);
        const y = wasm.getY(i);
        const rotation = wasm.getRotation(i);
        const direction = wasm.getDirection(i);
        const scaleX = wasm.getScaleX(i);
        const scaleY = wasm.getScaleY(i);
        const visible = wasm.getVisible(i);
        const pictureIndex = wasm.getPictureIndex(i);
        
        // Update sprite properties
        // Position relative to entity container (which is centered on stage)
        // Entry Y is inverted relative to PixiJS
        sprite.x = x;
        sprite.y = -y;
        
        // Rotation in degrees, convert to radians
        sprite.rotation = rotation * Math.PI / 180;
        
        // Scale - EntryJS uses scaleX/scaleY directly (1.0 = 100%)
        sprite.scale.x = scaleX;
        sprite.scale.y = scaleY;
        
        // Visibility (set on container so brush is also hidden)
        container.visible = visible !== 0;
        
        // Texture (picture)
        if (entityTextures && entityTextures.length > 0) {
            // Proper modulo that handles negative indices (e.g., -1 wraps to last texture)
            const texIdx = ((pictureIndex % entityTextures.length) + entityTextures.length) % entityTextures.length;
            const newTexture = entityTextures[texIdx];
            if (newTexture && newTexture.valid !== false) {
                sprite.texture = newTexture;
            }
        }
        
        // Note: Brush drawing is now handled via brushNotifyPosition called from WASM
        // This ensures every position change (even multiple per frame) draws a line
    }
}

// ===== SOUND PLAYBACK =====
function playSound(entityIdx, soundIdx) {
    if (sounds[entityIdx] && sounds[entityIdx][soundIdx]) {
        const audio = sounds[entityIdx][soundIdx];
        audio.currentTime = 0;
        audio.play().catch(() => {});
    }
}

// ===== BRUSH/DRAWING SYSTEM =====
// Convert Entry coordinates to PIXI coordinates (relative to center)
function entryToPixiX(x) { return x; }          // X is same
function entryToPixiY(y) { return -y; }         // Y is inverted

// Get or create brush graphics for entity
function getOrCreateBrushGraphics(entityIdx) {
    if (!brushGraphics[entityIdx]) {
        const g = new PIXI.Graphics();
        brushGraphics[entityIdx] = g;
        // Add to entity container, before the sprite (index 0 or after fill)
        const container = entityContainers[entityIdx];
        if (fillGraphics[entityIdx]) {
            container.addChildAt(g, 1); // After fill, before sprite
        } else {
            container.addChildAt(g, 0); // Before sprite
        }
    }
    return brushGraphics[entityIdx];
}

// Get or create fill graphics for entity
function getOrCreateFillGraphics(entityIdx) {
    if (!fillGraphics[entityIdx]) {
        const g = new PIXI.Graphics();
        fillGraphics[entityIdx] = g;
        // Add at the bottom of entity container (index 0)
        const container = entityContainers[entityIdx];
        container.addChildAt(g, 0);
    }
    return fillGraphics[entityIdx];
}

// Apply line style only if changed (performance optimization)
function applyBrushStyle(entityIdx) {
    const state = brushStates[entityIdx];
    const g = brushGraphics[entityIdx];
    if (!g) return;
    
    // Only call lineStyle if something changed
    if (state.color !== state._lastColor || 
        state.thickness !== state._lastThickness || 
        state.opacity !== state._lastOpacity) {
        g.lineStyle(state.thickness, state.color, state.opacity);
        state._lastColor = state.color;
        state._lastThickness = state.thickness;
        state._lastOpacity = state.opacity;
    }
}

// Start drawing for entity
function startBrushDrawing(entityIdx) {
    if (entityIdx < 0 || entityIdx >= brushStates.length) return;
    
    const state = brushStates[entityIdx];
    const g = getOrCreateBrushGraphics(entityIdx);
    
    // Get current entity position from WASM
    const x = wasm.getX(entityIdx);
    const y = wasm.getY(entityIdx);
    
    state.isDrawing = true;
    state.lastX = entryToPixiX(x);
    state.lastY = entryToPixiY(y);
    
    // Apply current style and move to position
    applyBrushStyle(entityIdx);
    g.moveTo(state.lastX, state.lastY);
}

// Stop drawing for entity
function stopBrushDrawing(entityIdx) {
    if (entityIdx < 0 || entityIdx >= brushStates.length) return;
    brushStates[entityIdx].isDrawing = false;
}

// Draw line to current position (called from updateSprites when isDrawing)
function brushLineTo(entityIdx, x, y) {
    if (entityIdx < 0 || entityIdx >= brushStates.length) return;
    
    const state = brushStates[entityIdx];
    if (!state.isDrawing) return;
    
    const g = brushGraphics[entityIdx];
    if (!g) return;
    
    const pixiX = entryToPixiX(x);
    const pixiY = entryToPixiY(y);
    
    // Only draw if position changed
    if (pixiX !== state.lastX || pixiY !== state.lastY) {
        applyBrushStyle(entityIdx);
        g.moveTo(state.lastX, state.lastY);
        g.lineTo(pixiX, pixiY);
        state.lastX = pixiX;
        state.lastY = pixiY;
    }
}

// Set brush color (r, g, b as 0-255)
function setBrushColor(entityIdx, r, g, b) {
    if (entityIdx < 0 || entityIdx >= brushStates.length) return;
    
    const state = brushStates[entityIdx];
    state.color = ((r & 0xFF) << 16) | ((g & 0xFF) << 8) | (b & 0xFF);
    
    // If currently drawing, update position
    if (state.isDrawing && brushGraphics[entityIdx]) {
        const gfx = brushGraphics[entityIdx];
        applyBrushStyle(entityIdx);
        gfx.moveTo(state.lastX, state.lastY);
    }
}

// Set random brush color
function setRandomBrushColor(entityIdx) {
    if (entityIdx < 0 || entityIdx >= brushStates.length) return;
    
    const r = Math.floor(Math.random() * 256);
    const g = Math.floor(Math.random() * 256);
    const b = Math.floor(Math.random() * 256);
    setBrushColor(entityIdx, r, g, b);
}

// Change brush thickness by amount
function changeBrushThickness(entityIdx, amount) {
    if (entityIdx < 0 || entityIdx >= brushStates.length) return;
    
    const state = brushStates[entityIdx];
    state.thickness = Math.max(1, state.thickness + amount);
    
    if (state.isDrawing && brushGraphics[entityIdx]) {
        const gfx = brushGraphics[entityIdx];
        applyBrushStyle(entityIdx);
        gfx.moveTo(state.lastX, state.lastY);
    }
}

// Set brush thickness
function setBrushThickness(entityIdx, thickness) {
    if (entityIdx < 0 || entityIdx >= brushStates.length) return;
    
    const state = brushStates[entityIdx];
    state.thickness = Math.max(1, thickness);
    
    if (state.isDrawing && brushGraphics[entityIdx]) {
        const gfx = brushGraphics[entityIdx];
        applyBrushStyle(entityIdx);
        gfx.moveTo(state.lastX, state.lastY);
    }
}

// Change brush transparency by amount (0-100 scale)
// Note: In EntryJS, transparency changes affect both brush AND fill
function changeBrushTransparency(entityIdx, amount) {
    if (entityIdx < 0 || entityIdx >= brushStates.length) return;
    
    const state = brushStates[entityIdx];
    // Transparency 0 = fully opaque, 100 = fully transparent
    // Opacity 1 = fully opaque, 0 = fully transparent
    const currentTransparency = (1 - state.opacity) * 100;
    const newTransparency = Math.max(0, Math.min(100, currentTransparency + amount));
    state.opacity = 1 - (newTransparency / 100);
    state.fillOpacity = state.opacity;  // Sync fill opacity (matches EntryJS behavior)
    
    if (state.isDrawing && brushGraphics[entityIdx]) {
        const gfx = brushGraphics[entityIdx];
        applyBrushStyle(entityIdx);
        gfx.moveTo(state.lastX, state.lastY);
    }
    
    // Also update fill if active
    if (state.isFilling && fillGraphics[entityIdx]) {
        const gfx = fillGraphics[entityIdx];
        gfx.endFill();
        gfx.beginFill(state.fillColor, state.fillOpacity);
        gfx.moveTo(state.lastX, state.lastY);
    }
}

// Set brush transparency (0-100 scale)
// Note: In EntryJS, transparency changes affect both brush AND fill
function setBrushTransparency(entityIdx, transparency) {
    if (entityIdx < 0 || entityIdx >= brushStates.length) return;
    
    const state = brushStates[entityIdx];
    state.opacity = 1 - (Math.max(0, Math.min(100, transparency)) / 100);
    state.fillOpacity = state.opacity;  // Sync fill opacity (matches EntryJS behavior)
    
    if (state.isDrawing && brushGraphics[entityIdx]) {
        const gfx = brushGraphics[entityIdx];
        applyBrushStyle(entityIdx);
        gfx.moveTo(state.lastX, state.lastY);
    }
    
    // Also update fill if active
    if (state.isFilling && fillGraphics[entityIdx]) {
        const gfx = fillGraphics[entityIdx];
        gfx.endFill();
        gfx.beginFill(state.fillColor, state.fillOpacity);
        gfx.moveTo(state.lastX, state.lastY);
    }
}

// Start fill mode
function startFillMode(entityIdx) {
    if (entityIdx < 0 || entityIdx >= brushStates.length) return;
    
    const state = brushStates[entityIdx];
    const g = getOrCreateFillGraphics(entityIdx);
    
    const x = wasm.getX(entityIdx);
    const y = wasm.getY(entityIdx);
    
    state.isFilling = true;
    state.lastX = entryToPixiX(x);
    state.lastY = entryToPixiY(y);
    
    g.beginFill(state.fillColor, state.fillOpacity);
    g.moveTo(state.lastX, state.lastY);
}

// Stop fill mode
function stopFillMode(entityIdx) {
    if (entityIdx < 0 || entityIdx >= brushStates.length) return;
    
    const state = brushStates[entityIdx];
    if (state.isFilling && fillGraphics[entityIdx]) {
        fillGraphics[entityIdx].endFill();
    }
    state.isFilling = false;
}

// Set fill color
function setFillColor(entityIdx, r, g, b) {
    if (entityIdx < 0 || entityIdx >= brushStates.length) return;
    
    const state = brushStates[entityIdx];
    state.fillColor = ((r & 0xFF) << 16) | ((g & 0xFF) << 8) | (b & 0xFF);
    
    if (state.isFilling && fillGraphics[entityIdx]) {
        const gfx = fillGraphics[entityIdx];
        gfx.endFill();
        gfx.beginFill(state.fillColor, state.fillOpacity);
        gfx.moveTo(state.lastX, state.lastY);
    }
}

// Fill line to (called when filling)
function fillLineTo(entityIdx, x, y) {
    if (entityIdx < 0 || entityIdx >= brushStates.length) return;
    
    const state = brushStates[entityIdx];
    if (!state.isFilling) return;
    
    const g = fillGraphics[entityIdx];
    if (!g) return;
    
    const pixiX = entryToPixiX(x);
    const pixiY = entryToPixiY(y);
    
    if (pixiX !== state.lastX || pixiY !== state.lastY) {
        g.lineTo(pixiX, pixiY);
        state.lastX = pixiX;
        state.lastY = pixiY;
    }
}

// Add stamp (clone current sprite appearance at current position)
function addStamp(entityIdx) {
    if (entityIdx < 0 || entityIdx >= sprites.length) return;
    
    const { sprite } = sprites[entityIdx];
    
    // Create stamp sprite with current texture
    const stampSprite = new PIXI.Sprite(sprite.texture);
    stampSprite.anchor.set(0.5, 0.5);
    
    // Copy current transform (sprite position is already relative to center)
    stampSprite.x = sprite.x;
    stampSprite.y = sprite.y;
    stampSprite.rotation = sprite.rotation;
    stampSprite.scale.x = sprite.scale.x;
    stampSprite.scale.y = sprite.scale.y;
    stampSprite.alpha = sprite.alpha;
    
    stampContainer.addChild(stampSprite);
    stamps.push(stampSprite);
}

// Clear all brush drawings and stamps
function clearAllBrush() {
    // Clear all brush graphics
    for (let i = 0; i < brushGraphics.length; i++) {
        if (brushGraphics[i]) {
            brushGraphics[i].clear();
            // Reset style tracking
            if (brushStates[i]) {
                brushStates[i]._lastColor = -1;
                brushStates[i]._lastThickness = -1;
                brushStates[i]._lastOpacity = -1;
            }
        }
        if (fillGraphics[i]) {
            fillGraphics[i].clear();
        }
    }
    
    // Clear all stamps
    for (const stamp of stamps) {
        stampContainer.removeChild(stamp);
        stamp.destroy();
    }
    stamps = [];
}

// Called from WASM when entity position changes (for continuous brush drawing)
function brushNotifyPosition(entityIdx, x, y) {
    if (entityIdx < 0 || entityIdx >= brushStates.length) return;
    
    const state = brushStates[entityIdx];
    
    // Draw line if brush is active
    if (state.isDrawing) {
        brushLineTo(entityIdx, x, y);
    }
    
    // Draw fill line if fill is active
    if (state.isFilling) {
        fillLineTo(entityIdx, x, y);
    }
}

// ===== MESSAGE HANDLING =====
function handleMessage(msgIdx) {
    console.log('[Renderer] Message sent:', msgIdx);
    // Messages are handled by WASM internally
}

// ===== CONTROLS =====
function stop() {
    running = false;
    wasm.stop();
}

function restart() {
    // Clear all brush drawings and stamps
    clearAllBrush();
    
    // Reset all brush states
    for (let i = 0; i < brushStates.length; i++) {
        brushStates[i].isDrawing = false;
        brushStates[i].isFilling = false;
        brushStates[i].color = 0xFF0000;  // Default red (matches EntryJS)
        brushStates[i].thickness = 1;
        brushStates[i].opacity = 1.0;
        brushStates[i].fillColor = 0xFF0000;  // Default red (matches EntryJS)
        brushStates[i].fillOpacity = 1.0;
        brushStates[i].lastX = 0;
        brushStates[i].lastY = 0;
        brushStates[i]._lastColor = -1;
        brushStates[i]._lastThickness = -1;
        brushStates[i]._lastOpacity = -1;
    }
    
    wasm.init();
    currentScene = 0;
    running = true;
    lastTime = performance.now();
    requestAnimationFrame(gameLoop);
}

// ===== SCENE CONTROL =====
function changeScene(sceneIndex) {
    if (wasm && sceneIndex >= 0 && sceneIndex < SCENE_COUNT) {
        wasm.startScene(sceneIndex);
    }
}

function getSceneInfo() {
    return {
        currentScene,
        sceneCount: SCENE_COUNT,
        scenes: SCENE_DATA
    };
}

// ===== START =====
init().catch(console.error);
