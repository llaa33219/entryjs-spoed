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
const VARIABLE_COUNT = 4;
const LIST_COUNT = 0;
const ENTITY_COUNT = 1;

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
        atan2: Math.atan2,
        asin: Math.asin,
        acos: Math.acos,
        atan: Math.atan,
        log: Math.log,
        exp: Math.exp,
        pow: Math.pow
    },
    system: {
        log: (value) => console.log('[WASM]', value),
        playSound: (entityIdx, soundIdx) => playSound(entityIdx, soundIdx),
        sendMessage: (msgIdx) => handleMessage(msgIdx)
    },
    timer: {
        getProjectTimer: () => getProjectTimerValue(),
        startProjectTimer: () => {
            // Match EntryJS startProjectTimer behavior
            projectTimerStart = performance.now();
            projectTimerIsInit = true;
            projectTimerPausedTime = 0;
            projectTimerPauseStart = 0;
        },
        stopProjectTimer: () => {
            // Match EntryJS stopProjectTimer behavior - stops and resets to 0
            projectTimerIsInit = false;
            projectTimerPausedTime = 0;
            projectTimerPauseStart = 0;
            projectTimerStart = 0;
        },
        resetProjectTimer: () => {
            // Match EntryJS resetTimer behavior - resets value but keeps running if it was running
            if (!projectTimerIsInit) return;
            const current = performance.now();
            projectTimerStart = current;
            projectTimerPausedTime = 0;
            // If paused, update pause start to current time so timer shows 0
            if (projectTimerPauseStart > 0) {
                projectTimerPauseStart = current;
            }
        },
        setProjectTimerVisible: (visible) => { /* TODO: implement timer visibility */ }
    },
    input: {
        askAndWait: (entityIdx) => { /* TODO: implement ask and wait */ },
        getAnswer: () => answerValue,
        setAnswerVisible: (visible) => { /* TODO: implement answer visibility */ }
    },
    clone: {
        createClone: (entityIdx) => { /* TODO: implement clone creation */ },
        deleteClone: (entityIdx) => { /* TODO: implement clone deletion */ },
        removeAllClones: () => { /* TODO: implement remove all clones */ }
    },
    sound: {
        playSoundAndWait: (entityIdx, soundIdx) => playSound(entityIdx, soundIdx),
        playSoundForSeconds: (entityIdx, soundIdx, seconds) => playSound(entityIdx, soundIdx),
        playSoundFromTo: (entityIdx, soundIdx, from, to) => playSound(entityIdx, soundIdx),
        changeSoundVolume: (entityIdx, amount) => { /* TODO: implement */ },
        setSoundVolume: (entityIdx, volume) => { /* TODO: implement */ },
        getSoundVolume: (entityIdx) => 100,
        changeSoundSpeed: (entityIdx, amount) => { /* TODO: implement */ },
        setSoundSpeed: (entityIdx, speed) => { /* TODO: implement */ },
        getSoundSpeed: (entityIdx) => 1,
        playBGM: (entityIdx, soundIdx) => playSound(entityIdx, soundIdx),
        stopBGM: () => { /* TODO: implement */ },
        stopAllSounds: () => { /* TODO: implement */ }
    },
    dialog: {
        showDialog: (entityIdx, type) => { /* TODO: implement dialog */ },
        hideDialog: (entityIdx) => { /* TODO: implement */ },
        sendMessageAndWait: (msgIdx) => handleMessage(msgIdx)
    },
    brush: {
        startDrawing: (entityIdx) => startBrushDrawing(entityIdx),
        stopDrawing: (entityIdx) => stopBrushDrawing(entityIdx),
        stamp: (entityIdx) => addStamp(entityIdx),
        clearBrush: () => clearAllBrush(),
        // Note: setBrushColor, setRandomBrushColor, setFillColor are now handled in WASM
        // Colors are stored in entity memory and read by JS when needed
        changeBrushThickness: (entityIdx, amount) => changeBrushThickness(entityIdx, amount),
        setBrushThickness: (entityIdx, thickness) => setBrushThickness(entityIdx, thickness),
        changeBrushTransparency: (entityIdx, amount) => changeBrushTransparency(entityIdx, amount),
        setBrushTransparency: (entityIdx, transparency) => setBrushTransparency(entityIdx, transparency),
        startFill: (entityIdx) => startFillMode(entityIdx),
        stopFill: (entityIdx) => stopFillMode(entityIdx),
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

// Timer and input state (matching EntryJS engine.js implementation)
// projectTimer uses real system time for accuracy, not deltaTime accumulation
let projectTimerStart = 0;        // timestamp when timer started
let projectTimerPausedTime = 0;   // total accumulated paused time
let projectTimerPauseStart = 0;   // timestamp when pause started (0 if not paused)
let projectTimerIsInit = false;   // whether timer has been started
let answerValue = 0;

// Get current project timer value (calculated on-demand for accuracy)
// Formula matches EntryJS: Math.max((current - start - pausedTime) / 1000, 0)
function getProjectTimerValue() {
    if (!projectTimerIsInit) {
        return 0;
    }
    const current = performance.now();
    // If paused, use pause start time instead of current time
    const effectiveTime = projectTimerPauseStart > 0 ? projectTimerPauseStart : current;
    return Math.max((effectiveTime - projectTimerStart - projectTimerPausedTime) / 1000, 0);
}

// ===== BRUSH/DRAWING STATE =====
// Entity containers hold: fillGraphics (bottom) → brushGraphics (middle) → sprite (top)
// This matches EntryJS z-order where each entity's brush is below its sprite but above previous entities
// Visibility is controlled on the sprite only, so brush traces remain visible when entity is hidden
let entityContainers = [];  // PIXI.Container per entity
let brushGraphics = [];     // PIXI.Graphics per entity for stroke drawing
let fillGraphics = [];      // PIXI.Graphics per entity for fill drawing
let stampContainer = null;  // Container for stamps (rendered above all entities)
let stamps = [];            // Array of stamp sprites

// Variable/List display containers
let variableDisplays = [];  // Array of variable display objects
let listDisplays = [];      // Array of list display objects

// Dialog/Speech bubble containers
let dialogBubbles = [];     // Array of dialog bubble objects per entity

// Brush state per entity: { isDrawing, isFilling, color, thickness, opacity, fillColor, fillOpacity, brushLastX, brushLastY, fillLastX, fillLastY }
let brushStates = [];

// ===== SCENE DATA =====
const SCENE_DATA = [
    { id: "7dwq", name: "장면 1", index: 0 },
];


// ===== VARIABLE DATA =====
const VARIABLE_DATA = [
    { id: "igmi", name: "변수1", memoryOffset: 1144, visible: true },
    { id: "quhj", name: "변수", memoryOffset: 1152, visible: true },
    { id: "brih", name: "초시계", memoryOffset: 1160, visible: false },
    { id: "1vu8", name: "대답", memoryOffset: 1168, visible: false },
];


// ===== LIST DATA =====
const LIST_DATA = [
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
    
    // Create variable/list displays and dialog bubbles
    createVariableDisplays();
    createListDisplays();
    createDialogBubbles();
    
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
    // Create entities with proper z-order matching EntryJS:
    // Each entityContainer holds: fillGraphics (bottom) → brushGraphics (middle) → sprite (top)
    // 
    // This ensures entity N's brush is below entity N's sprite but ABOVE entity N-1's sprite.
    // Visibility is controlled on the sprite only, so brush traces remain visible when entity is hidden.
    // 
    // Rendering order (bottom to top):
    // 1. Entity containers (each with fill/brush/sprite in proper order)
    // 2. stampContainer (stamps rendered above everything)
    // 
    // IMPORTANT: In EntryJS, objects[0] is rendered on TOP (front).
    // In PixiJS, children added LATER are rendered on TOP.
    // So we add containers in REVERSE order to match EntryJS z-order.
    
    for (let i = 0; i < ENTITY_DATA.length; i++) {
        const entityData = ENTITY_DATA[i];
        const entityTextures = textures[i] || [];
        
        // Create container for this entity (positioned at stage center)
        // Container holds: fillGraphics → brushGraphics → sprite (bottom to top)
        const container = new PIXI.Container();
        container.x = STAGE_WIDTH / 2;
        container.y = STAGE_HEIGHT / 2;
        entityContainers.push(container);
        
        // Initialize fill graphics (will be created on first use, added at index 0)
        fillGraphics.push(null);
        
        // Initialize brush graphics (will be created on first use, added at index 1 or after fill)
        brushGraphics.push(null);
        
        // Get first valid texture or use placeholder
        let initialTexture = getPlaceholderTexture();
        for (const tex of entityTextures) {
            if (tex && tex.valid !== false && tex.baseTexture) {
                initialTexture = tex;
                break;
            }
        }
        
        // Create sprite with first texture (added last, renders on top within container)
        const sprite = new PIXI.Sprite(initialTexture);
        
        // Set anchor to center
        sprite.anchor.set(0.5, 0.5);
        
        // Initial position relative to container (0,0 = center)
        sprite.x = 0;
        sprite.y = 0;
        
        // Only show sprites from the first scene initially
        // Note: visibility is on sprite, not container, so brush traces remain visible
        sprite.visible = entityData.sceneIndex === 0;
        
        container.addChild(sprite);
        sprites.push({
            sprite,
            textures: entityTextures,
            data: entityData,
            container: container
        });
        
        // Initialize brush state
        // Note: brush and fill have independent position tracking to avoid interference
        brushStates.push({
            isDrawing: false,
            isFilling: false,
            color: 0xFF0000,      // Default red (matches EntryJS)
            thickness: 1,
            opacity: 1.0,         // 0-1 (1 = fully opaque, matches EntryJS default transparency=0)
            fillColor: 0xFF0000,  // Default red (matches EntryJS)
            fillOpacity: 1.0,
            // Separate position tracking for brush and fill
            brushLastX: 0,
            brushLastY: 0,
            fillLastX: 0,
            fillLastY: 0,
            // Fill path points for real-time rendering (PixiJS requires endFill() to show fill)
            fillPoints: [],
            // Completed fill segments (each segment has its own color/opacity, preserved when style changes)
            // Format: [{ points: [{x,y}...], color: 0xRRGGBB, opacity: 0-1 }, ...]
            fillSegments: [],
            // Track last applied style to avoid redundant lineStyle calls
            _lastColor: -1,
            _lastThickness: -1,
            _lastOpacity: -1
        });
    }
    
    // Add entity containers to stage in REVERSE order
    // This ensures ENTITY_DATA[0] is rendered on top (matching EntryJS z-order)
    for (let i = entityContainers.length - 1; i >= 0; i--) {
        app.stage.addChild(entityContainers[i]);
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
    
    // Note: Project timer is now calculated on-demand in getProjectTimerValue()
    // No need to update it here - this matches EntryJS behavior for accuracy
    
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
    
    // Update variable/list displays and dialog bubbles
    updateVariableDisplays();
    updateListDisplays();
    updateDialogBubbles();
    
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
        
        // Visibility (only affects sprite, brush traces remain visible per EntryJS behavior)
        // Note: we set sprite.visible, not container.visible, so brush/fill graphics stay visible
        sprite.visible = visible !== 0;
        
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
// Brush graphics are added to entityContainer, positioned after fill but before sprite
function getOrCreateBrushGraphics(entityIdx) {
    if (!brushGraphics[entityIdx]) {
        const g = new PIXI.Graphics();
        brushGraphics[entityIdx] = g;
        const container = entityContainers[entityIdx];
        // Insert before sprite (which is always last child)
        // Order: fillGraphics (0) → brushGraphics (1) → sprite (last)
        const insertIdx = fillGraphics[entityIdx] ? 1 : 0;
        container.addChildAt(g, insertIdx);
    }
    return brushGraphics[entityIdx];
}

// Get or create fill graphics for entity
// Fill graphics are added to entityContainer at index 0 (bottom, below brush and sprite)
function getOrCreateFillGraphics(entityIdx) {
    if (!fillGraphics[entityIdx]) {
        const g = new PIXI.Graphics();
        fillGraphics[entityIdx] = g;
        const container = entityContainers[entityIdx];
        // Insert at bottom of container
        container.addChildAt(g, 0);
        // If brush graphics exists, it needs to stay after fill
        // Since we inserted at 0, brush (if exists) is now at 1, sprite at 2 - correct order
    }
    return fillGraphics[entityIdx];
}

// Read brush color from WASM memory and return as packed 0xRRGGBB
function readBrushColorFromWasm(entityIdx) {
    const r = Math.floor(wasm.getBrushColorR(entityIdx)) & 0xFF;
    const g = Math.floor(wasm.getBrushColorG(entityIdx)) & 0xFF;
    const b = Math.floor(wasm.getBrushColorB(entityIdx)) & 0xFF;
    return (r << 16) | (g << 8) | b;
}

// Read fill color from WASM memory and return as packed 0xRRGGBB
function readFillColorFromWasm(entityIdx) {
    const r = Math.floor(wasm.getFillColorR(entityIdx)) & 0xFF;
    const g = Math.floor(wasm.getFillColorG(entityIdx)) & 0xFF;
    const b = Math.floor(wasm.getFillColorB(entityIdx)) & 0xFF;
    return (r << 16) | (g << 8) | b;
}

// Apply line style only if changed (performance optimization)
// Now reads color from WASM memory
function applyBrushStyle(entityIdx) {
    const state = brushStates[entityIdx];
    const g = brushGraphics[entityIdx];
    if (!g) return;
    
    // Read current color from WASM memory
    const currentColor = readBrushColorFromWasm(entityIdx);
    state.color = currentColor;
    
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
    state.brushLastX = entryToPixiX(x);
    state.brushLastY = entryToPixiY(y);
    
    // Apply current style and move to position
    applyBrushStyle(entityIdx);
    g.moveTo(state.brushLastX, state.brushLastY);
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
    if (pixiX !== state.brushLastX || pixiY !== state.brushLastY) {
        applyBrushStyle(entityIdx);
        g.moveTo(state.brushLastX, state.brushLastY);
        g.lineTo(pixiX, pixiY);
        state.brushLastX = pixiX;
        state.brushLastY = pixiY;
    }
}

// Note: setBrushColor and setRandomBrushColor are now handled in WASM
// Colors are stored in entity memory and read when drawing

// Change brush thickness by amount
function changeBrushThickness(entityIdx, amount) {
    if (entityIdx < 0 || entityIdx >= brushStates.length) return;
    
    const state = brushStates[entityIdx];
    state.thickness = Math.max(1, state.thickness + amount);
    
    if (state.isDrawing && brushGraphics[entityIdx]) {
        const gfx = brushGraphics[entityIdx];
        applyBrushStyle(entityIdx);
        gfx.moveTo(state.brushLastX, state.brushLastY);
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
        gfx.moveTo(state.brushLastX, state.brushLastY);
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
    
    if (state.isDrawing && brushGraphics[entityIdx]) {
        const gfx = brushGraphics[entityIdx];
        applyBrushStyle(entityIdx);
        gfx.moveTo(state.brushLastX, state.brushLastY);
    }
    
    // If fill is active, save current path as a segment and start new path with new opacity
    // This matches EntryJS behavior: existing fill keeps old style, new drawing uses new style
    if (state.isFilling && state.fillPoints.length > 1) {
        // Save current path as completed segment with OLD opacity
        state.fillSegments.push({
            points: state.fillPoints.slice(),
            color: state.fillColor,
            opacity: state.fillOpacity
        });
        // Start new path from current position with NEW opacity
        const lastPoint = state.fillPoints[state.fillPoints.length - 1];
        state.fillPoints = [{ x: lastPoint.x, y: lastPoint.y }];
    }
    
    // Now update fill opacity for future drawing
    state.fillOpacity = state.opacity;
    
    // Redraw all segments + current path
    if (state.isFilling && fillGraphics[entityIdx]) {
        redrawAllFill(entityIdx);
    }
}

// Set brush transparency (0-100 scale)
// Note: In EntryJS, transparency changes affect both brush AND fill
function setBrushTransparency(entityIdx, transparency) {
    if (entityIdx < 0 || entityIdx >= brushStates.length) return;
    
    const state = brushStates[entityIdx];
    const newOpacity = 1 - (Math.max(0, Math.min(100, transparency)) / 100);
    
    if (state.isDrawing && brushGraphics[entityIdx]) {
        const gfx = brushGraphics[entityIdx];
        state.opacity = newOpacity;
        applyBrushStyle(entityIdx);
        gfx.moveTo(state.brushLastX, state.brushLastY);
    } else {
        state.opacity = newOpacity;
    }
    
    // If fill is active, save current path as a segment and start new path with new opacity
    // This matches EntryJS behavior: existing fill keeps old style, new drawing uses new style
    if (state.isFilling && state.fillPoints.length > 1) {
        // Save current path as completed segment with OLD opacity
        state.fillSegments.push({
            points: state.fillPoints.slice(),
            color: state.fillColor,
            opacity: state.fillOpacity
        });
        // Start new path from current position with NEW opacity
        const lastPoint = state.fillPoints[state.fillPoints.length - 1];
        state.fillPoints = [{ x: lastPoint.x, y: lastPoint.y }];
    }
    
    // Now update fill opacity for future drawing
    state.fillOpacity = newOpacity;
    
    // Redraw all segments + current path
    if (state.isFilling && fillGraphics[entityIdx]) {
        redrawAllFill(entityIdx);
    }
}

// Start fill mode
function startFillMode(entityIdx) {
    if (entityIdx < 0 || entityIdx >= brushStates.length) return;
    
    const state = brushStates[entityIdx];
    const g = getOrCreateFillGraphics(entityIdx);
    
    // Read fill color from WASM memory
    state.fillColor = readFillColorFromWasm(entityIdx);
    
    const x = wasm.getX(entityIdx);
    const y = wasm.getY(entityIdx);
    
    state.isFilling = true;
    state.fillLastX = entryToPixiX(x);
    state.fillLastY = entryToPixiY(y);
    
    // Initialize fillPoints with starting position
    // We store all points to redraw the entire path on each update
    // (PixiJS v7 requires endFill() to render fill, so we must redraw each time)
    state.fillPoints = [{ x: state.fillLastX, y: state.fillLastY }];
    state.fillSegments = [];  // Clear any previous segments
    
    // Draw initial point (single point won't show, but sets up the graphics)
    g.clear();
    g.beginFill(state.fillColor, state.fillOpacity);
    g.moveTo(state.fillLastX, state.fillLastY);
    g.endFill();
}

// Stop fill mode
function stopFillMode(entityIdx) {
    if (entityIdx < 0 || entityIdx >= brushStates.length) return;
    
    const state = brushStates[entityIdx];
    if (state.isFilling && fillGraphics[entityIdx]) {
        const g = fillGraphics[entityIdx];
        
        // Final redraw: all segments + current path with closePath on final segment
        g.clear();
        
        // Draw all completed segments
        for (const segment of state.fillSegments) {
            if (segment.points.length > 1) {
                g.beginFill(segment.color, segment.opacity);
                g.moveTo(segment.points[0].x, segment.points[0].y);
                for (let i = 1; i < segment.points.length; i++) {
                    g.lineTo(segment.points[i].x, segment.points[i].y);
                }
                g.endFill();
            }
        }
        
        // Draw current path with closePath
        const points = state.fillPoints;
        if (points && points.length > 1) {
            g.beginFill(state.fillColor, state.fillOpacity);
            g.moveTo(points[0].x, points[0].y);
            for (let i = 1; i < points.length; i++) {
                g.lineTo(points[i].x, points[i].y);
            }
            g.closePath();
            g.endFill();
        }
    }
    state.isFilling = false;
    state.fillPoints = [];  // Clear points array
    state.fillSegments = [];  // Clear segments array
}

// Sync fill color from WASM memory
// Call this when fill color might have changed
function syncFillColorFromWasm(entityIdx) {
    if (entityIdx < 0 || entityIdx >= brushStates.length) return;
    
    const state = brushStates[entityIdx];
    const newColor = readFillColorFromWasm(entityIdx);
    
    // If fill is active and color changed, save current path as a segment
    if (state.isFilling && state.fillColor !== newColor && state.fillPoints.length > 1) {
        // Save current path as completed segment with OLD color
        state.fillSegments.push({
            points: state.fillPoints.slice(),
            color: state.fillColor,
            opacity: state.fillOpacity
        });
        // Start new path from current position
        const lastPoint = state.fillPoints[state.fillPoints.length - 1];
        state.fillPoints = [{ x: lastPoint.x, y: lastPoint.y }];
    }
    
    // Update fill color
    state.fillColor = newColor;
    
    // Redraw all segments + current path
    if (state.isFilling && fillGraphics[entityIdx]) {
        redrawAllFill(entityIdx);
    }
}

// Helper function to redraw all fill segments + current path
function redrawAllFill(entityIdx) {
    const state = brushStates[entityIdx];
    const g = fillGraphics[entityIdx];
    if (!g) return;
    
    g.clear();
    
    // Draw all completed segments (each with their own color/opacity)
    for (const segment of state.fillSegments) {
        if (segment.points.length > 1) {
            g.beginFill(segment.color, segment.opacity);
            g.moveTo(segment.points[0].x, segment.points[0].y);
            for (let i = 1; i < segment.points.length; i++) {
                g.lineTo(segment.points[i].x, segment.points[i].y);
            }
            g.endFill();
        }
    }
    
    // Draw current path with current color/opacity
    const points = state.fillPoints;
    if (points.length > 1) {
        g.beginFill(state.fillColor, state.fillOpacity);
        g.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
            g.lineTo(points[i].x, points[i].y);
        }
        g.endFill();
    }
}

// Fill line to (called when filling)
// In PixiJS v7, fill is only rendered after endFill() is called.
// To show fill in real-time, we store all points and redraw the entire path each time.
function fillLineTo(entityIdx, x, y) {
    if (entityIdx < 0 || entityIdx >= brushStates.length) return;
    
    const state = brushStates[entityIdx];
    if (!state.isFilling) return;
    
    const g = fillGraphics[entityIdx];
    if (!g) return;
    
    // Sync fill color from WASM (in case it changed)
    syncFillColorFromWasm(entityIdx);
    
    const pixiX = entryToPixiX(x);
    const pixiY = entryToPixiY(y);
    
    // Only add point if position changed
    if (pixiX !== state.fillLastX || pixiY !== state.fillLastY) {
        // Add new point to the path
        state.fillPoints.push({ x: pixiX, y: pixiY });
        state.fillLastX = pixiX;
        state.fillLastY = pixiY;
        
        // Redraw all segments + current path
        redrawAllFill(entityIdx);
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
                brushStates[i].fillPoints = [];  // Clear fill path
                brushStates[i].fillSegments = [];  // Clear fill segments
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

// ===== VARIABLE DISPLAY =====
function createVariableDisplays() {
    const fontFamily = 'Arial, sans-serif';
    const fontSize = 12;
    
    for (let i = 0; i < VARIABLE_DATA.length; i++) {
        const varData = VARIABLE_DATA[i];
        
        // Create container for this variable display
        const container = new PIXI.Container();
        container.x = 10;
        container.y = 10 + i * 28;  // Stack vertically
        
        // Background
        const bg = new PIXI.Graphics();
        bg.beginFill(0xF5A623, 0.9);  // Orange background like EntryJS
        bg.drawRoundedRect(0, 0, 120, 24, 4);
        bg.endFill();
        container.addChild(bg);
        
        // Name label
        const nameText = new PIXI.Text(varData.name, {
            fontFamily,
            fontSize,
            fill: 0xFFFFFF,
            fontWeight: 'bold'
        });
        nameText.x = 6;
        nameText.y = 4;
        container.addChild(nameText);
        
        // Value background (white rounded rect)
        const valueBg = new PIXI.Graphics();
        valueBg.beginFill(0xFFFFFF, 1);
        valueBg.drawRoundedRect(nameText.width + 12, 2, 50, 20, 3);
        valueBg.endFill();
        container.addChild(valueBg);
        
        // Value text
        const valueText = new PIXI.Text('0', {
            fontFamily,
            fontSize,
            fill: 0x333333
        });
        valueText.x = nameText.width + 16;
        valueText.y = 4;
        container.addChild(valueText);
        
        // Initially hidden based on project settings
        container.visible = varData.visible;
        
        app.stage.addChild(container);
        variableDisplays.push({
            container,
            bg,
            valueBg,
            nameText,
            valueText,
            data: varData
        });
    }
}

function updateVariableDisplays() {
    for (let i = 0; i < variableDisplays.length; i++) {
        const display = variableDisplays[i];
        const varData = display.data;
        
        // Update visibility from WASM
        if (wasm['getVarVisible_' + i]) {
            display.container.visible = wasm['getVarVisible_' + i]() !== 0;
        }
        
        if (!display.container.visible) continue;
        
        // Update value from WASM memory
        const value = wasm.getVariable ? wasm.getVariable(varData.memoryOffset) : 0;
        let displayValue = value;
        
        // Format number nicely
        if (Number.isInteger(value)) {
            displayValue = value.toString();
        } else {
            displayValue = value.toFixed(2);
        }
        
        display.valueText.text = displayValue;
        
        // Adjust value background width based on text
        const newWidth = Math.max(50, display.valueText.width + 10);
        display.valueBg.clear();
        display.valueBg.beginFill(0xFFFFFF, 1);
        display.valueBg.drawRoundedRect(display.nameText.width + 12, 2, newWidth, 20, 3);
        display.valueBg.endFill();
        
        // Adjust background width
        const totalWidth = display.nameText.width + 18 + newWidth;
        display.bg.clear();
        display.bg.beginFill(0xF5A623, 0.9);
        display.bg.drawRoundedRect(0, 0, totalWidth, 24, 4);
        display.bg.endFill();
    }
}

// ===== LIST DISPLAY =====
function createListDisplays() {
    const fontFamily = 'Arial, sans-serif';
    const fontSize = 11;
    
    for (let i = 0; i < LIST_DATA.length; i++) {
        const listData = LIST_DATA[i];
        
        // Create container for this list display
        const container = new PIXI.Container();
        container.x = 150;  // Position to the right of variables
        container.y = 10 + i * 120;  // Stack vertically with more space
        
        // Title bar
        const titleBar = new PIXI.Graphics();
        titleBar.beginFill(0xE85000, 0.9);  // Darker orange for lists
        titleBar.drawRoundedRect(0, 0, 100, 20, 4);
        titleBar.endFill();
        container.addChild(titleBar);
        
        // Title text
        const titleText = new PIXI.Text(listData.name, {
            fontFamily,
            fontSize,
            fill: 0xFFFFFF,
            fontWeight: 'bold'
        });
        titleText.x = 6;
        titleText.y = 3;
        container.addChild(titleText);
        
        // List body background
        const bodyBg = new PIXI.Graphics();
        bodyBg.beginFill(0xFFFFFF, 0.95);
        bodyBg.lineStyle(1, 0xE85000, 1);
        bodyBg.drawRoundedRect(0, 20, 100, 80, 4);
        bodyBg.endFill();
        container.addChild(bodyBg);
        
        // Create text elements for list items (show up to 5 items)
        const itemTexts = [];
        for (let j = 0; j < 5; j++) {
            const itemText = new PIXI.Text('', {
                fontFamily,
                fontSize: 10,
                fill: 0x333333
            });
            itemText.x = 6;
            itemText.y = 24 + j * 14;
            container.addChild(itemText);
            itemTexts.push(itemText);
        }
        
        // Length indicator
        const lengthText = new PIXI.Text('length: 0', {
            fontFamily,
            fontSize: 9,
            fill: 0x888888
        });
        lengthText.x = 6;
        lengthText.y = 86;
        container.addChild(lengthText);
        
        // Initially hidden based on project settings
        container.visible = listData.visible;
        
        app.stage.addChild(container);
        listDisplays.push({
            container,
            titleBar,
            titleText,
            bodyBg,
            itemTexts,
            lengthText,
            data: listData
        });
    }
}

function updateListDisplays() {
    for (let i = 0; i < listDisplays.length; i++) {
        const display = listDisplays[i];
        const listData = display.data;
        
        // Update visibility from WASM
        if (wasm['getListVisible_' + i]) {
            display.container.visible = wasm['getListVisible_' + i]() !== 0;
        }
        
        if (!display.container.visible) continue;
        
        // Get list length from WASM
        const length = wasm.list_length ? wasm.list_length(i) : 0;
        display.lengthText.text = 'length: ' + length;
        
        // Update item texts (show first 5 items)
        for (let j = 0; j < display.itemTexts.length; j++) {
            if (j < length) {
                // Get value from list
                const value = wasm.list_get ? wasm.list_get(i, j) : 0;
                let displayValue;
                if (Number.isInteger(value)) {
                    displayValue = value.toString();
                } else {
                    displayValue = value.toFixed(2);
                }
                display.itemTexts[j].text = (j + 1) + ': ' + displayValue;
                display.itemTexts[j].visible = true;
            } else {
                display.itemTexts[j].visible = false;
            }
        }
    }
}

// ===== DIALOG BUBBLES =====
function createDialogBubbles() {
    const fontFamily = 'Arial, sans-serif';
    
    for (let i = 0; i < ENTITY_COUNT; i++) {
        // Create container for dialog bubble (positioned relative to stage center like sprites)
        const container = new PIXI.Container();
        container.visible = false;
        
        // Background graphic (will be drawn dynamically based on text)
        const bg = new PIXI.Graphics();
        container.addChild(bg);
        
        // Text
        const text = new PIXI.Text('', {
            fontFamily,
            fontSize: 14,
            fill: 0x000000,
            wordWrap: true,
            wordWrapWidth: 150
        });
        text.x = 10;
        text.y = 8;
        container.addChild(text);
        
        app.stage.addChild(container);
        dialogBubbles.push({
            container,
            bg,
            text,
            entityIdx: i,
            type: 0,  // 0=none, 1=speak, 2=think
            lastText: ''
        });
    }
}

// Read string from WASM memory
function readStringFromWasm(ptr) {
    if (!ptr || ptr === 0) return '';
    
    const memoryBuffer = new Uint8Array(wasm.memory.buffer);
    const length = new DataView(wasm.memory.buffer).getInt32(ptr, true);
    
    if (length <= 0 || length > 10000) return '';
    
    const bytes = memoryBuffer.slice(ptr + 4, ptr + 4 + length);
    const decoder = new TextDecoder('utf-8');
    return decoder.decode(bytes);
}

function updateDialogBubbles() {
    for (let i = 0; i < dialogBubbles.length; i++) {
        const bubble = dialogBubbles[i];
        
        // Get dialog type and text pointer from WASM
        const dialogType = wasm['getDialogType_' + i] ? wasm['getDialogType_' + i]() : 0;
        
        if (dialogType === 0) {
            bubble.container.visible = false;
            continue;
        }
        
        // Get text from WASM memory
        const textPtr = wasm['getDialogTextPtr_' + i] ? wasm['getDialogTextPtr_' + i]() : 0;
        const dialogText = readStringFromWasm(textPtr);
        
        if (!dialogText) {
            bubble.container.visible = false;
            continue;
        }
        
        // Update text if changed
        if (bubble.lastText !== dialogText) {
            bubble.text.text = dialogText;
            bubble.lastText = dialogText;
            
            // Redraw background based on text size
            const padding = 10;
            const width = Math.max(60, bubble.text.width + padding * 2);
            const height = bubble.text.height + padding * 2;
            
            bubble.bg.clear();
            
            const bgColor = 0xFFFFFF;
            const borderColor = dialogType === 2 ? 0x888888 : 0x4f80ff;  // Gray for think, blue for speak
            
            bubble.bg.beginFill(bgColor);
            bubble.bg.lineStyle(2, borderColor, 1);
            bubble.bg.drawRoundedRect(0, 0, width, height, 8);
            bubble.bg.endFill();
            
            // Draw tail/notch
            if (dialogType === 1) {
                // Speak bubble - pointed tail
                bubble.bg.beginFill(bgColor);
                bubble.bg.lineStyle(2, borderColor, 1);
                bubble.bg.moveTo(10, height);
                bubble.bg.lineTo(5, height + 10);
                bubble.bg.lineTo(20, height);
                bubble.bg.endFill();
                // Cover the line inside
                bubble.bg.lineStyle(0);
                bubble.bg.beginFill(bgColor);
                bubble.bg.drawRect(11, height - 1, 8, 2);
                bubble.bg.endFill();
            } else if (dialogType === 2) {
                // Think bubble - small circles
                bubble.bg.beginFill(bgColor);
                bubble.bg.lineStyle(2, borderColor, 1);
                bubble.bg.drawCircle(12, height + 8, 5);
                bubble.bg.drawCircle(6, height + 16, 3);
                bubble.bg.endFill();
            }
        }
        
        // Position bubble above entity
        if (sprites[i]) {
            const sprite = sprites[i].sprite;
            const container = sprites[i].container;
            
            // Calculate position (bubble above sprite)
            const bubbleX = container.x + sprite.x - bubble.bg.width / 2;
            const bubbleY = container.y + sprite.y - sprite.height / 2 - bubble.bg.height - 20;
            
            bubble.container.x = Math.max(5, Math.min(STAGE_WIDTH - bubble.bg.width - 5, bubbleX));
            bubble.container.y = Math.max(5, bubbleY);
        }
        
        bubble.container.visible = true;
    }
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
        brushStates[i].brushLastX = 0;
        brushStates[i].brushLastY = 0;
        brushStates[i].fillLastX = 0;
        brushStates[i].fillLastY = 0;
        brushStates[i].fillPoints = [];  // Clear fill path points
        brushStates[i].fillSegments = [];  // Clear fill segments
        brushStates[i]._lastColor = -1;
        brushStates[i]._lastThickness = -1;
        brushStates[i]._lastOpacity = -1;
    }
    
    // Reset dialog bubbles
    for (let i = 0; i < dialogBubbles.length; i++) {
        dialogBubbles[i].container.visible = false;
        dialogBubbles[i].lastText = '';
    }
    
    // Reset project timer state
    projectTimerStart = 0;
    projectTimerPausedTime = 0;
    projectTimerPauseStart = 0;
    projectTimerIsInit = false;
    
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
