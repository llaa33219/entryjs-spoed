/**
 * Renderer Generator
 * 
 * Generates minimal JavaScript code that uses PixiJS for rendering only.
 * All logic is handled by the WASM module.
 */

/**
 * Generate the renderer JavaScript code
 * @param {Object} project - Parsed project
 * @param {Object} options - Compiler options
 * @returns {string} JavaScript code
 */
function generateRenderer(project, options = {}) {
    const generator = new RendererGenerator(project, options);
    return generator.generate();
}

class RendererGenerator {
    constructor(project, options) {
        this.project = project;
        this.options = options;
    }

    generate() {
        return `/**
 * EntryJS Compiled Project - Renderer
 * 
 * This file handles PixiJS rendering only.
 * All project logic runs in WebAssembly.
 */

// ===== CONFIGURATION =====
const STAGE_WIDTH = 640;
const STAGE_HEIGHT = 360;
const TICK_RATE = 1000000;
const FIXED_DT = 1.0 / TICK_RATE;
const MAX_TICKS_PER_FRAME = 50000;
const MAX_ACCUMULATOR = 0.05;

// Dynamic tick rate adaptation
const TARGET_TICK_MS = 10;
const MIN_TICKS_PER_FRAME = 100;
let dynamicMaxTicks = 10000;
const SCENE_COUNT = ${this.project.scenes.length};
const VARIABLE_COUNT = ${(this.project.variables.variables || []).length};
const LIST_COUNT = ${(this.project.variables.lists || []).length};
const ENTITY_COUNT = ${this.project.objects.length};

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
        sendMessage: (msgIdx) => handleMessage(msgIdx),
        getDeviceType: () => {
            const ua = navigator.userAgent;
            if (/Mobi|Android/i.test(ua)) return 2;
            if (/Tablet|iPad/i.test(ua)) return 1;
            return 0;
        },
        isTouchSupported: () => {
            return ('ontouchstart' in window || navigator.maxTouchPoints > 0) ? 1 : 0;
        }
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
        setProjectTimerVisible: (visible) => {
            timerVisible = visible !== 0;
            if (timerDisplayIndex >= 0 && variableDisplays[timerDisplayIndex]) {
                variableDisplays[timerDisplayIndex].container.visible = timerVisible;
            }
        },
        getDate: (type) => {
            const d = new Date();
            switch (type) {
                case 0: return d.getFullYear();
                case 1: return d.getMonth() + 1;
                case 2: return d.getDate();
                case 3: return d.getHours();
                case 4: return d.getMinutes();
                case 5: return d.getSeconds();
                default: return 0;
            }
        }
    },
    input: {
        askAndWait: (entityIdx) => {
            if (isWaitingForInput) return;
            isWaitingForInput = true;
            showInputField();
        },
        getAnswer: () => {
            if (answerText === '') return 0;
            if (!isNaN(answerValue)) return answerValue;
            if (!wasm || !wasm.str_alloc) return 0;
            const encoder = new TextEncoder();
            const bytes = encoder.encode(answerText);
            const ptr = wasm.str_alloc(bytes.length);
            const mem = new Uint8Array(wasm.memory.buffer);
            for (let k = 0; k < bytes.length; k++) {
                mem[ptr + 4 + k] = bytes[k];
            }
            mem[ptr + 4 + bytes.length] = 0;
            return -ptr;
        },
        setAnswerVisible: (visible) => {
            answerVisible = visible !== 0;
            if (answerDisplayIndex >= 0 && variableDisplays[answerDisplayIndex]) {
                variableDisplays[answerDisplayIndex].container.visible = answerVisible;
            }
        }
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
    },
    effect: {
        setTransparency: (entityIdx, value) => {
            if (sprites[entityIdx]) {
                sprites[entityIdx].sprite.alpha = 1 - Math.max(0, Math.min(100, value)) / 100;
            }
        },
        changeTransparency: (entityIdx, amount) => {
            if (sprites[entityIdx]) {
                const current = (1 - sprites[entityIdx].sprite.alpha) * 100;
                const newVal = Math.max(0, Math.min(100, current + amount));
                sprites[entityIdx].sprite.alpha = 1 - newVal / 100;
            }
        },
        getTransparency: (entityIdx) => {
            if (sprites[entityIdx]) {
                return Math.max(0, Math.min(100, (1 - sprites[entityIdx].sprite.alpha) * 100));
            }
            return 0;
        }
    },
    util: {
        f64ToString: (val) => {
            if (!wasm || !wasm.str_alloc) return 0;
            let str;
            if (isNaN(val) || !isFinite(val)) {
                str = '0';
            } else if (Number.isInteger(val)) {
                str = val.toString();
            } else {
                str = parseFloat(val.toFixed(2)).toString();
            }
            const encoder = new TextEncoder();
            const bytes = encoder.encode(str);
            const ptr = wasm.str_alloc(bytes.length);
            const mem = new Uint8Array(wasm.memory.buffer);
            for (let k = 0; k < bytes.length; k++) {
                mem[ptr + 4 + k] = bytes[k];
            }
            mem[ptr + 4 + bytes.length] = 0;
            return ptr;
        }
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
let accumulator = 0;

// Timer and input state (matching EntryJS engine.js implementation)
// projectTimer uses real system time for accuracy, not deltaTime accumulation
let projectTimerStart = 0;        // timestamp when timer started
let projectTimerPausedTime = 0;   // total accumulated paused time
let projectTimerPauseStart = 0;   // timestamp when pause started (0 if not paused)
let projectTimerIsInit = false;   // whether timer has been started
let answerValue = 0;
let answerText = '';
let timerVisible = false;
let answerVisible = false;
let timerDisplayIndex = -1;
let answerDisplayIndex = -1;

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
// Entity containers hold: frozenFill (bottom) → activeFill → brushGraphics → sprite (top)
// This matches EntryJS z-order where each entity's brush is below its sprite but above previous entities
// Visibility is controlled on the sprite only, so brush traces remain visible when entity is hidden
let entityContainers = [];  // PIXI.Container per entity
let brushGraphics = [];     // PIXI.Graphics per entity for stroke drawing
let frozenFillGraphics = []; // PIXI.Graphics per entity for completed fills (rarely redrawn)
let activeFillGraphics = []; // PIXI.Graphics per entity for current fill session (redrawn each vertex)
let stampContainer = null;  // Container for stamps (rendered above all entities)
let stamps = [];            // Array of stamp sprites

// Variable/List display containers
let variableLayer = null;   // Scaled container (480x270 coordinate space, matching EntryJS stage)
let variableDisplays = [];  // Array of variable display objects
let listDisplays = [];      // Array of list display objects

// Dialog/Speech bubble containers
let dialogBubbles = [];     // Array of dialog bubble objects per entity

// Brush state per entity: { isDrawing, isFilling, color, thickness, opacity, fillColor, fillOpacity, brushLastX, brushLastY, fillLastX, fillLastY }
let brushStates = [];

// Drag state for slide variables and list scroll buttons
let dragState = null;

// Ask-and-wait input state
let isWaitingForInput = false;
let inputOverlay = null;

// ===== SCENE DATA =====
${this.generateSceneData()}

// ===== VARIABLE DATA =====
${this.generateVariableData()}

// ===== TIMER DATA =====
${this.generateTimerData()}

// ===== ANSWER DATA =====
${this.generateAnswerData()}

// ===== LIST DATA =====
${this.generateListData()}

// ===== ASSET DATA =====
${this.generateAssetData()}

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
    accumulator = 0;
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
    // Each entityContainer holds: frozenFill (bottom) → activeFill → brushGraphics → sprite (top)
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
        // Container holds: frozenFill → activeFill → brushGraphics → sprite (bottom to top)
        const container = new PIXI.Container();
        container.x = STAGE_WIDTH / 2;
        container.y = STAGE_HEIGHT / 2;
        entityContainers.push(container);
        
        // Initialize fill graphics (will be created on first use)
        frozenFillGraphics.push(null);
        activeFillGraphics.push(null);
        
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
            // Completed fills from previous fill sessions (persisted across start_fill/stop_fill cycles)
            // Format: [{ points: [{x,y}...], color: 0xRRGGBB, opacity: 0-1, closed: true/false }, ...]
            completedFills: [],
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
    
    // Mouse click (also handles slide variable and scroll button drag start)
    canvas.addEventListener('mousedown', (e) => {
        const rect = canvas.getBoundingClientRect();
        const layerX = (e.clientX - rect.left) * (480 / rect.width);
        const layerY = (e.clientY - rect.top) * (270 / rect.height);
        
        // Check slide variable drag
        for (let i = 0; i < variableDisplays.length; i++) {
            const display = variableDisplays[i];
            if (!display.container.visible || display.varType !== 'slide') continue;
            const localX = layerX - display.container.x;
            const localY = layerY - display.container.y;
            const ow = display.outerWidth || 90;
            if (localY >= 12 && localY <= 26 && localX >= 4 && localX <= ow - 2) {
                dragState = { type: 'slide', index: i };
                updateSlideFromPosition(i, localX);
                return;
            }
        }
        
        // Check list scroll button drag
        for (let i = 0; i < listDisplays.length; i++) {
            const display = listDisplays[i];
            if (!display.container.visible || !display.scrollBtn.visible) continue;
            const localX = layerX - display.container.x;
            const localY = layerY - display.container.y;
            const btnX = display.scrollBtn.x;
            const btnY = display.scrollBtn.y;
            if (localX >= btnX - 2 && localX <= btnX + 9 && localY >= btnY && localY <= btnY + 30) {
                dragState = { type: 'scroll', index: i, offsetY: localY - btnY };
                return;
            }
        }
        
        // No drag started - set WASM click state
        const view = new DataView(wasm.memory.buffer);
        view.setInt32(32, 1, true);
    });
    
    canvas.addEventListener('mouseup', () => {
        if (dragState) return;
        const view = new DataView(wasm.memory.buffer);
        view.setInt32(32, 0, true);
    });
    
    // Keyboard
    const keyStates = new Uint8Array(64); // 512 bits
    
    document.addEventListener('keydown', (e) => {
        if (isWaitingForInput) return;
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
        if (isWaitingForInput) return;
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
    
    // Mouse wheel for list scroll (matching EntryJS scrollButton_ drag behavior)
    canvas.addEventListener('wheel', (e) => {
        const rect = canvas.getBoundingClientRect();
        // Convert mouse position to 480x270 coordinate space (matching variableLayer)
        const layerX = (e.clientX - rect.left) * (480 / rect.width);
        const layerY = (e.clientY - rect.top) * (270 / rect.height);
        
        for (let i = 0; i < listDisplays.length; i++) {
            const display = listDisplays[i];
            if (!display.container.visible || !display.scrollBtn.visible) continue;
            const lx = display.container.x;
            const ly = display.container.y;
            if (layerX >= lx && layerX <= lx + display.width + 7 &&
                layerY >= ly && layerY <= ly + display.height + 22) {
                const delta = e.deltaY > 0 ? 5 : -5;
                display.scrollBtn.y = Math.max(23, Math.min(display.height - 30, display.scrollBtn.y + delta));
                e.preventDefault();
                break;
            }
        }
    }, { passive: false });
    
    // Document-level drag handlers for slide variables and list scroll buttons
    document.addEventListener('mousemove', (e) => {
        if (!dragState) return;
        const rect = canvas.getBoundingClientRect();
        const layerX = (e.clientX - rect.left) * (480 / rect.width);
        const layerY = (e.clientY - rect.top) * (270 / rect.height);
        
        if (dragState.type === 'slide') {
            const display = variableDisplays[dragState.index];
            if (display) {
                const localX = layerX - display.container.x;
                updateSlideFromPosition(dragState.index, localX);
            }
        } else if (dragState.type === 'scroll') {
            const display = listDisplays[dragState.index];
            if (display) {
                const newY = layerY - display.container.y - dragState.offsetY;
                display.scrollBtn.y = Math.max(23, Math.min(display.height - 30, newY));
            }
        }
    });
    
    document.addEventListener('mouseup', () => {
        dragState = null;
    });
}

// ===== SLIDE VARIABLE DRAG =====
function updateSlideFromPosition(displayIndex, localX) {
    const display = variableDisplays[displayIndex];
    if (!display || display.varType !== 'slide') return;
    const maxWidth = display.maxWidth || 70;
    const position = Math.max(0, Math.min(maxWidth, localX - 8));
    const ratio = maxWidth > 0 ? position / maxWidth : 0;
    const minVal = display.data.minValue;
    const maxVal = display.data.maxValue;
    let value = minVal + Math.abs(maxVal - minVal) * ratio;
    value = parseFloat(value.toFixed(2));
    value = Math.max(minVal, Math.min(maxVal, value));
    const view = new DataView(wasm.memory.buffer);
    view.setFloat64(display.data.memoryOffset, value, true);
}

// ===== ASK AND WAIT INPUT =====
function showInputField() {
    if (inputOverlay) return;
    const canvas = app.canvas || app.view;
    const rect = canvas.getBoundingClientRect();
    
    const container = document.createElement('div');
    container.style.cssText = 'position:fixed;' +
        'left:' + rect.left + 'px;' +
        'top:' + (rect.bottom - 42) + 'px;' +
        'width:' + rect.width + 'px;' +
        'height:42px;display:flex;align-items:center;padding:4px 10px;gap:6px;' +
        'background:rgba(255,255,255,0.95);border-top:2px solid #e2e2e2;' +
        'z-index:1000;box-sizing:border-box;';
    
    const input = document.createElement('input');
    input.type = 'text';
    input.style.cssText = "flex:1;height:30px;font-size:14px;" +
        "font-family:NanumGothic,'Nanum Gothic',Arial,sans-serif;" +
        "color:#2c313d;border:2px solid #e2e2e2;border-radius:6px;" +
        "padding:0 10px;outline:none;box-sizing:border-box;";
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submitInput();
        e.stopPropagation();
    });
    input.addEventListener('keyup', (e) => { e.stopPropagation(); });
    
    const button = document.createElement('button');
    button.textContent = '\uD655\uC778';
    button.style.cssText = "height:30px;padding:0 16px;background:#4f80ff;color:white;" +
        "border:none;border-radius:6px;font-size:13px;cursor:pointer;" +
        "font-family:NanumGothic,'Nanum Gothic',Arial,sans-serif;";
    button.addEventListener('click', () => { submitInput(); });
    
    container.appendChild(input);
    container.appendChild(button);
    document.body.appendChild(container);
    
    inputOverlay = { container, input, button };
    setTimeout(() => input.focus(), 50);
}

function submitInput() {
    if (!inputOverlay || !isWaitingForInput) return;
    const inputValue = inputOverlay.input.value;
    if (!inputValue) return;
    answerText = inputValue;
    const numValue = Number(inputValue);
    answerValue = (!isNaN(numValue) && String(numValue) === inputValue) ? numValue : NaN;
    answerVisible = true;
    if (answerDisplayIndex >= 0 && variableDisplays[answerDisplayIndex]) {
        variableDisplays[answerDisplayIndex].container.visible = true;
    }
    hideInputField();
    isWaitingForInput = false;
}

function hideInputField() {
    if (!inputOverlay) return;
    inputOverlay.container.remove();
    inputOverlay = null;
}

// ===== GAME LOOP =====
function gameLoop(currentTime) {
    if (!running) return;
    
    const realDelta = (currentTime - lastTime) / 1000;
    lastTime = currentTime;
    
    // Accumulate real elapsed time, capped to prevent catch-up spiral
    accumulator += Math.min(realDelta, MAX_ACCUMULATOR);
    
    // Calculate how many WASM ticks to run this frame (dynamically adjusted)
    let ticksToRun = Math.floor(accumulator / FIXED_DT);
    ticksToRun = Math.min(ticksToRun, dynamicMaxTicks);
    
    // Run WASM ticks in tight loop (pause when waiting for input)
    if (!isWaitingForInput) {
        const tickStart = performance.now();
        for (let t = 0; t < ticksToRun; t++) {
            wasm.tick(FIXED_DT);
        }
        const tickTime = performance.now() - tickStart;
        
        // Dynamic tick rate adaptation: adjust max ticks based on actual performance
        if (ticksToRun > 0 && tickTime > 0) {
            const timePerTick = tickTime / ticksToRun;
            const idealTicks = Math.floor(TARGET_TICK_MS / Math.max(timePerTick, 0.0001));
            dynamicMaxTicks = Math.floor(dynamicMaxTicks * 0.8 + idealTicks * 0.2);
            dynamicMaxTicks = Math.max(MIN_TICKS_PER_FRAME, Math.min(MAX_TICKS_PER_FRAME, dynamicMaxTicks));
        }
        
        accumulator -= ticksToRun * FIXED_DT;
    } else {
        accumulator = 0;
    }
    
    // Check for scene changes
    const wasmScene = wasm.getCurrentScene();
    if (wasmScene !== currentScene) {
        console.log('[Renderer] Scene changed from', currentScene, 'to', wasmScene);
        currentScene = wasmScene;
    }
    
    // Render once per animation frame
    updateSprites();
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
// Brush graphics are added to entityContainer after fill layers but before sprite
function getOrCreateBrushGraphics(entityIdx) {
    if (!brushGraphics[entityIdx]) {
        const g = new PIXI.Graphics();
        brushGraphics[entityIdx] = g;
        const container = entityContainers[entityIdx];
        // Insert before sprite (last child)
        // Order: frozenFill(0) → activeFill(1) → brush(2) → sprite(last)
        let insertIdx = 0;
        if (frozenFillGraphics[entityIdx]) insertIdx++;
        if (activeFillGraphics[entityIdx]) insertIdx++;
        container.addChildAt(g, insertIdx);
    }
    return brushGraphics[entityIdx];
}

// Get or create frozen fill graphics for entity (completed fills, rarely redrawn)
function getOrCreateFrozenFillGraphics(entityIdx) {
    if (!frozenFillGraphics[entityIdx]) {
        const g = new PIXI.Graphics();
        frozenFillGraphics[entityIdx] = g;
        const container = entityContainers[entityIdx];
        container.addChildAt(g, 0);
    }
    return frozenFillGraphics[entityIdx];
}

// Get or create active fill graphics for entity (current fill session, redrawn each vertex)
function getOrCreateActiveFillGraphics(entityIdx) {
    if (!activeFillGraphics[entityIdx]) {
        getOrCreateFrozenFillGraphics(entityIdx);
        const g = new PIXI.Graphics();
        activeFillGraphics[entityIdx] = g;
        const container = entityContainers[entityIdx];
        container.addChildAt(g, 1);
    }
    return activeFillGraphics[entityIdx];
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
        // Marked closed to match EntryJS transparency change which calls closePath() via paint.endFill()
        state.fillSegments.push({
            points: state.fillPoints.slice(),
            color: state.fillColor,
            opacity: state.fillOpacity,
            closed: true
        });
        // Start new path from current position with NEW opacity
        const lastPoint = state.fillPoints[state.fillPoints.length - 1];
        state.fillPoints = [{ x: lastPoint.x, y: lastPoint.y }];
    }
    
    // Now update fill opacity for future drawing
    state.fillOpacity = state.opacity;
    
    // Redraw active fill layer
    if (state.isFilling && activeFillGraphics[entityIdx]) {
        redrawActiveFill(entityIdx);
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
        // Marked closed to match EntryJS transparency change which calls closePath() via paint.endFill()
        state.fillSegments.push({
            points: state.fillPoints.slice(),
            color: state.fillColor,
            opacity: state.fillOpacity,
            closed: true
        });
        // Start new path from current position with NEW opacity
        const lastPoint = state.fillPoints[state.fillPoints.length - 1];
        state.fillPoints = [{ x: lastPoint.x, y: lastPoint.y }];
    }
    
    // Now update fill opacity for future drawing
    state.fillOpacity = newOpacity;
    
    // Redraw active fill layer
    if (state.isFilling && activeFillGraphics[entityIdx]) {
        redrawActiveFill(entityIdx);
    }
}

// Start fill mode
// If already filling, auto-close previous fill (matches EntryJS beginFill → endFill behavior)
function startFillMode(entityIdx) {
    if (entityIdx < 0 || entityIdx >= brushStates.length) return;
    
    const state = brushStates[entityIdx];
    
    // If already filling, save current session to completedFills first
    if (state.isFilling) {
        saveCurrentFillSession(entityIdx);
    }
    
    const g = getOrCreateActiveFillGraphics(entityIdx);
    
    // Read fill color from WASM memory
    state.fillColor = readFillColorFromWasm(entityIdx);
    
    const x = wasm.getX(entityIdx);
    const y = wasm.getY(entityIdx);
    
    state.isFilling = true;
    state.fillLastX = entryToPixiX(x);
    state.fillLastY = entryToPixiY(y);
    
    // Initialize fillPoints with starting position
    state.fillPoints = [{ x: state.fillLastX, y: state.fillLastY }];
    state.fillSegments = [];  // Clear current session segments (completedFills preserved)
    
    // Clear active layer; frozen layer already shows completedFills from previous sessions
    g.clear();
}

// Save current fill session to completedFills and append to frozen graphics
function saveCurrentFillSession(entityIdx) {
    const state = brushStates[entityIdx];
    const newFills = [];
    
    // Collect all current session segments
    for (const segment of state.fillSegments) {
        if (segment.points.length > 1) {
            const fill = {
                points: segment.points,
                color: segment.color,
                opacity: segment.opacity,
                closed: true
            };
            state.completedFills.push(fill);
            newFills.push(fill);
        }
    }
    
    // Save current path with closePath
    if (state.fillPoints && state.fillPoints.length > 1) {
        const fill = {
            points: state.fillPoints.slice(),
            color: state.fillColor,
            opacity: state.fillOpacity,
            closed: true
        };
        state.completedFills.push(fill);
        newFills.push(fill);
    }
    
    // Clear current session data
    state.fillPoints = [];
    state.fillSegments = [];
    
    // Append only new fills to frozen graphics (incremental, no full redraw)
    if (newFills.length > 0) {
        const fg = getOrCreateFrozenFillGraphics(entityIdx);
        for (const fill of newFills) {
            fg.beginFill(fill.color, fill.opacity);
            fg.moveTo(fill.points[0].x, fill.points[0].y);
            for (let i = 1; i < fill.points.length; i++) {
                fg.lineTo(fill.points[i].x, fill.points[i].y);
            }
            if (fill.closed) {
                fg.closePath();
            }
            fg.endFill();
        }
    }
    
    // Clear active layer
    if (activeFillGraphics[entityIdx]) {
        activeFillGraphics[entityIdx].clear();
    }
}

// Stop fill mode
function stopFillMode(entityIdx) {
    if (entityIdx < 0 || entityIdx >= brushStates.length) return;
    
    const state = brushStates[entityIdx];
    if (state.isFilling) {
        saveCurrentFillSession(entityIdx);
    }
    state.isFilling = false;
    state.fillPoints = [];
    state.fillSegments = [];
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
        // Marked closed to match EntryJS set_fill_color which calls closePath() via paint.endFill()
        state.fillSegments.push({
            points: state.fillPoints.slice(),
            color: state.fillColor,
            opacity: state.fillOpacity,
            closed: true
        });
        // Start new path from current position
        const lastPoint = state.fillPoints[state.fillPoints.length - 1];
        state.fillPoints = [{ x: lastPoint.x, y: lastPoint.y }];
    }
    
    // Update fill color
    state.fillColor = newColor;
    
    // Redraw active fill layer
    if (state.isFilling && activeFillGraphics[entityIdx]) {
        redrawActiveFill(entityIdx);
    }
}

// Redraw active fill layer (current session segments + current path only)
function redrawActiveFill(entityIdx) {
    const state = brushStates[entityIdx];
    const g = activeFillGraphics[entityIdx];
    if (!g) return;
    
    g.clear();
    
    // Draw current session's completed segments (from color/opacity changes)
    for (const segment of state.fillSegments) {
        if (segment.points.length > 1) {
            g.beginFill(segment.color, segment.opacity);
            g.moveTo(segment.points[0].x, segment.points[0].y);
            for (let i = 1; i < segment.points.length; i++) {
                g.lineTo(segment.points[i].x, segment.points[i].y);
            }
            if (segment.closed) {
                g.closePath();
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
    
    const g = activeFillGraphics[entityIdx];
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
        
        // Redraw active layer only (frozen layer unchanged)
        redrawActiveFill(entityIdx);
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
        }
        if (brushStates[i]) {
            brushStates[i]._lastColor = -1;
            brushStates[i]._lastThickness = -1;
            brushStates[i]._lastOpacity = -1;
            brushStates[i].fillPoints = [];
            brushStates[i].fillSegments = [];
            brushStates[i].completedFills = [];
        }
        if (frozenFillGraphics[i]) {
            frozenFillGraphics[i].clear();
        }
        if (activeFillGraphics[i]) {
            activeFillGraphics[i].clear();
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
// EntryJS stage uses 480x270 coordinate space with 4/3 scale (stage.js: scaleX=scaleY=2/1.5)
// variableLayer container applies this scale so all child coordinates match EntryJS exactly

function createVariableDisplays() {
    const fontFamily = "'Nanum Gothic', NanumGothic, Arial, sans-serif";
    
    // Create scaled layer matching EntryJS 480x270 coordinate space (if not already created)
    if (!variableLayer) {
        variableLayer = new PIXI.Container();
        variableLayer.scale.set(STAGE_WIDTH / 480, STAGE_HEIGHT / 270);
        app.stage.addChild(variableLayer);
    }
    
    // Build unified list: regular variables + timer + answer
    const allConfigs = [];
    
    for (let i = 0; i < VARIABLE_DATA.length; i++) {
        const vd = VARIABLE_DATA[i];
        allConfigs.push({
            name: vd.name,
            x: vd.x,
            y: vd.y,
            visible: vd.visible,
            memoryOffset: vd.memoryOffset,
            varType: vd.varType || 'variable',
            color: 0x4f80ff,
            varIndex: i,
            minValue: vd.minValue || 0,
            maxValue: vd.maxValue || 100
        });
    }
    
    // Timer display (#f4af18 matching EntryJS TimerVariable)
    allConfigs.push({
        name: TIMER_DATA.name,
        x: TIMER_DATA.x,
        y: TIMER_DATA.y,
        visible: TIMER_DATA.visible,
        varType: 'timer',
        color: 0xf4af18,
        varIndex: -1
    });
    
    // Answer display (#F57DF1 matching EntryJS AnswerVariable)
    allConfigs.push({
        name: ANSWER_DATA.name,
        x: ANSWER_DATA.x,
        y: ANSWER_DATA.y,
        visible: ANSWER_DATA.visible,
        varType: 'answer',
        color: 0xF57DF1,
        varIndex: -1
    });
    
    for (let idx = 0; idx < allConfigs.length; idx++) {
        const config = allConfigs[idx];
        
        const container = new PIXI.Container();
        // Position in EntryJS 480x270 space (origin at top-left)
        container.x = config.x + 240;
        container.y = config.y + 135;
        
        // Outer background rect (white fill, #aac5d5 border)
        const bg = new PIXI.Graphics();
        container.addChild(bg);
        
        // Value wrapper rect (colored fill matching variable type)
        const valueBg = new PIXI.Graphics();
        container.addChild(valueBg);
        
        // Name text (10pt black, matching EntryJS FONT)
        const nameText = new PIXI.Text(config.name, {
            fontFamily,
            fontSize: 10,
            fill: 0x000000
        });
        nameText.resolution = 2;
        nameText.x = 4;
        nameText.y = -9.5; // GL_VAR_POS.LABEL_Y
        container.addChild(nameText);
        
        // Value text (9pt white, matching EntryJS VALUE_FONT)
        const valueText = new PIXI.Text('0', {
            fontFamily,
            fontSize: 9,
            fill: 0xFFFFFF
        });
        valueText.resolution = 2;
        container.addChild(valueText);
        
        // Slide variable extra UI: slide bar + knob
        let slideBar = null;
        let slideKnob = null;
        if (config.varType === 'slide') {
            slideBar = new PIXI.Graphics();
            container.addChild(slideBar);
            slideKnob = new PIXI.Graphics();
            container.addChild(slideKnob);
        }
        
        container.visible = config.visible;
        
        variableLayer.addChild(container);
        
        const display = {
            container,
            bg,
            valueBg,
            nameText,
            valueText,
            data: config,
            color: config.color,
            varType: config.varType,
            varIndex: config.varIndex,
            slideBar,
            slideKnob
        };
        variableDisplays.push(display);
        
        if (config.varType === 'timer') {
            timerDisplayIndex = variableDisplays.length - 1;
            timerVisible = config.visible;
        } else if (config.varType === 'answer') {
            answerDisplayIndex = variableDisplays.length - 1;
            answerVisible = config.visible;
        }
    }
}

// Read variable display value, handling string pointers (negative f64 = negated string pointer)
function getVarDisplayValue(value, varType) {
    if (value < -0.5) {
        const strPtr = Math.round(-value);
        const str = readStringFromWasm(strPtr);
        if (str) return str;
    }
    
    if (varType === 'timer') {
        return Number(value).toFixed(1);
    }
    if (varType === 'answer') {
        if (parseInt(value, 10) == value) return String(Number(value));
        return Number(value).toFixed(1).replace('.00', '');
    }
    if (varType === 'slide') {
        const v = Number(value);
        if (Number.isInteger(v)) return v.toString();
        return v.toFixed(2);
    }
    if (Number.isInteger(value)) return value.toString();
    return Number(value).toFixed(2).replace('.00', '');
}

function updateVariableDisplays() {
    for (let i = 0; i < variableDisplays.length; i++) {
        const display = variableDisplays[i];
        
        if (display.varType === 'variable' || display.varType === 'slide') {
            if (wasm['getVarVisible_' + display.varIndex]) {
                display.container.visible = wasm['getVarVisible_' + display.varIndex]() !== 0;
            }
        }
        
        if (!display.container.visible) continue;
        
        let displayValue;
        if (display.varType === 'timer') {
            displayValue = getVarDisplayValue(getProjectTimerValue(), 'timer');
        } else if (display.varType === 'answer') {
            displayValue = answerText || '0';
        } else {
            const value = wasm.getVariable ? wasm.getVariable(display.data.memoryOffset) : 0;
            displayValue = getVarDisplayValue(value, display.varType === 'slide' ? 'slide' : 'variable');
        }
        
        display.valueText.text = displayValue;
        
        const nameWidth = display.nameText.width;
        const valueWidth = display.valueText.width;
        
        if (display.varType === 'slide') {
            // Slide variable: taller rect with slide bar below (matching EntryJS slideVariable.js)
            let outerWidth = Math.max(nameWidth + valueWidth + 35, 90);
            display.outerWidth = outerWidth;
            
            // Outer rect: rr(0, -14, width, 42, 4)
            display.bg.clear();
            display.bg.beginFill(0xFFFFFF);
            display.bg.lineStyle(1, 0xaac5d5);
            display.bg.drawRoundedRect(0, -14, outerWidth, 42, 4);
            display.bg.endFill();
            
            // Value wrapper: same as regular variable
            display.valueBg.clear();
            display.valueBg.beginFill(display.color);
            display.valueBg.lineStyle(1, display.color);
            display.valueBg.drawRoundedRect(nameWidth + 14, -10, valueWidth + 15, 16, 7);
            display.valueBg.endFill();
            
            // Slide bar: rr(6, 16, maxWidth+4, 5, 2) with #d8d8d8
            // maxWidth derived from outerWidth (matching EntryJS: Math.max(boxWidth - 20, 50))
            const maxWidth = Math.max(outerWidth - 20, 50);
            display.maxWidth = maxWidth;
            display.slideBar.clear();
            display.slideBar.beginFill(0xd8d8d8);
            display.slideBar.lineStyle(1, 0xd8d8d8);
            display.slideBar.drawRoundedRect(6, 16, maxWidth + 4, 5, 2);
            display.slideBar.endFill();
            
            // Slider knob position based on current value
            const minVal = display.data.minValue;
            const maxVal = display.data.maxValue;
            const numValue = parseFloat(displayValue) || 0;
            const ratio = maxVal !== minVal ? Math.max(0, Math.min(1, (numValue - minVal) / (maxVal - minVal))) : 0;
            const knobX = maxWidth * ratio + 8;
            display.slideKnob.clear();
            display.slideKnob.beginFill(0x4f80ff);
            display.slideKnob.lineStyle(1, 0xA0A1A1);
            display.slideKnob.drawRoundedRect(knobX - 4, 14.5, 8, 8, 4);
            display.slideKnob.endFill();
        } else {
            // Regular variable / timer / answer
            // Outer rect: rr(0, -14, nameW+valW+35, 24, 4) - matching EntryJS _adjustSingleViewBox
            display.bg.clear();
            display.bg.beginFill(0xFFFFFF);
            display.bg.lineStyle(1, 0xaac5d5);
            display.bg.drawRoundedRect(0, -14, nameWidth + valueWidth + 35, 24, 4);
            display.bg.endFill();
            
            // Value wrapper: rr(nameW+14, -10, valW+15, 16, 7) - matching EntryJS wrapper_
            display.valueBg.clear();
            display.valueBg.beginFill(display.color);
            display.valueBg.lineStyle(1, display.color);
            display.valueBg.drawRoundedRect(nameWidth + 14, -10, valueWidth + 15, 16, 7);
            display.valueBg.endFill();
        }
        
        // Value text: x=nameW+21, y=-8.5 (GL_VAR_POS.VALUE_Y)
        display.valueText.x = nameWidth + 21;
        display.valueText.y = -8.5;
    }
}

// ===== LIST DISPLAY =====
function createListDisplays() {
    const fontFamily = "'Nanum Gothic', NanumGothic, Arial, sans-serif";
    const BORDER = 6;
    const MAX_VISIBLE_ITEMS = 15;
    
    for (let i = 0; i < LIST_DATA.length; i++) {
        const listData = LIST_DATA[i];
        const w = listData.width || 100;
        const h = listData.height || 120;
        
        const container = new PIXI.Container();
        // Position in EntryJS 480x270 space
        container.x = listData.x + 240;
        container.y = listData.y + 135;
        
        // Outer rect: white fill, #aac5d5 border (matching EntryJS listVariable.js)
        const rect = new PIXI.Graphics();
        container.addChild(rect);
        
        // Title text (centered, 10pt black, matching EntryJS FONT)
        const titleText = new PIXI.Text(listData.name, {
            fontFamily,
            fontSize: 10,
            fill: 0x000000
        });
        titleText.resolution = 2;
        titleText.y = BORDER - 1; // WebGL mode: BORDER - 1 = 5
        container.addChild(titleText);
        
        // Item container for list items (pre-allocated slots)
        const itemContainer = new PIXI.Container();
        container.addChild(itemContainer);
        
        const items = [];
        for (let j = 0; j < MAX_VISIBLE_ITEMS; j++) {
            // Index text (10pt black, matching EntryJS FONT)
            const indexText = new PIXI.Text('', {
                fontFamily,
                fontSize: 10,
                fill: 0x000000
            });
            indexText.resolution = 2;
            itemContainer.addChild(indexText);
            
            // Value background (#4f80ff matching EntryJS colorSet.canvas.list)
            const valueBg = new PIXI.Graphics();
            itemContainer.addChild(valueBg);
            
            // Value text (9pt white, matching EntryJS VALUE_FONT)
            const valueText = new PIXI.Text('', {
                fontFamily,
                fontSize: 9,
                fill: 0xFFFFFF
            });
            valueText.resolution = 2;
            itemContainer.addChild(valueText);
            
            items.push({ indexText, valueBg, valueText, visible: false });
        }
        
        // Length text at bottom (matching EntryJS FONT = 10pt)
        const lengthText = new PIXI.Text('', {
            fontFamily,
            fontSize: 10,
            fill: 0x333333
        });
        lengthText.resolution = 2;
        container.addChild(lengthText);
        
        // Scroll button (matching EntryJS scrollButton_: rr(0,0,7,30,3.5) fill #aaaaaa)
        const scrollBtn = new PIXI.Graphics();
        scrollBtn.beginFill(0xaaaaaa);
        scrollBtn.drawRoundedRect(0, 0, 7, 30, 3.5);
        scrollBtn.endFill();
        scrollBtn.y = 23;
        scrollBtn.visible = false;
        container.addChild(scrollBtn);
        
        container.visible = listData.visible;
        
        variableLayer.addChild(container);
        listDisplays.push({
            container,
            rect,
            titleText,
            itemContainer,
            items,
            lengthText,
            scrollBtn,
            scrollPosition: 0,
            data: listData,
            width: w,
            height: h
        });
    }
}

function updateListDisplays() {
    for (let i = 0; i < listDisplays.length; i++) {
        const display = listDisplays[i];
        
        if (wasm['getListVisible_' + i]) {
            display.container.visible = wasm['getListVisible_' + i]() !== 0;
        }
        
        if (!display.container.visible) continue;
        
        const w = display.width;
        const h = display.height;
        const BORDER = 6;
        
        // Outer rect: rr(0, 0, width_+7, height_+22, 7) matching EntryJS listVariable.js
        display.rect.clear();
        display.rect.beginFill(0xFFFFFF);
        display.rect.lineStyle(1, 0xaac5d5);
        display.rect.drawRoundedRect(0, 0, w + 7, h + 22, 7);
        display.rect.endFill();
        
        // Center title: x = (width_ - titleWidth)/2 + 3 (WebGL mode)
        display.titleText.text = display.data.name;
        display.titleText.x = (w - display.titleText.width) / 2 + 3;
        
        const length = wasm.list_length ? wasm.list_length(i) : 0;
        display.lengthText.text = length + ' \uAC1C';
        display.lengthText.x = BORDER;
        display.lengthText.y = h + 5;
        
        // maxView = floor((height_ - 15) / 20) matching EntryJS
        const maxView = Math.min(Math.floor((h - 15) / 20), display.items.length);
        const isOverFlow = maxView < length;
        
        // Scroll button and scrollPosition (matching EntryJS listVariable.js)
        let scrollPosition = 0;
        let wrapperWidth;
        if (isOverFlow) {
            display.scrollBtn.visible = true;
            if (display.scrollBtn.y < 23) display.scrollBtn.y = 23;
            if (display.scrollBtn.y > h - 30) display.scrollBtn.y = h - 30;
            display.scrollBtn.x = w - 6;
            scrollPosition = Math.floor(
                ((display.scrollBtn.y - 23) / Math.max(h - 23 - 30, 1)) * (length - maxView)
            );
            scrollPosition = Math.max(0, Math.min(scrollPosition, length - maxView));
            // Narrower wrapperWidth for overflow: w - 2*BORDER - 30 - 6 + 14 = w - 34
            wrapperWidth = Math.max(w - 34, 30);
        } else {
            display.scrollBtn.visible = false;
            display.scrollBtn.y = 25;
            scrollPosition = 0;
            // Normal wrapperWidth: w - 2*BORDER - 20 - 6 + 14 = w - 24
            wrapperWidth = Math.max(w - 24, 30);
        }
        display.scrollPosition = scrollPosition;
        
        for (let j = 0; j < display.items.length; j++) {
            const item = display.items[j];
            const realIdx = j + scrollPosition;
            if (j < maxView && realIdx < length) {
                // Item y: (i - scrollPos) * 20 + 23 matching EntryJS
                const itemY = j * 20 + 23;
                
                // Index text: element.x=BORDER, indexView at (0, GL_LIST_POS.INDEX_Y=5)
                item.indexText.text = '' + (realIdx + 1);
                item.indexText.x = BORDER;
                item.indexText.y = itemY + 5;
                item.indexText.visible = true;
                
                // Value bg: rr(18, 4, wrapperWidth, 17, 2) relative to element at x=BORDER
                item.valueBg.clear();
                item.valueBg.beginFill(0x4f80ff);
                item.valueBg.drawRoundedRect(BORDER + 18, itemY + 4, wrapperWidth, 17, 2);
                item.valueBg.endFill();
                item.valueBg.visible = true;
                
                // Value text: at (24, GL_LIST_POS.VALUE_Y=6) relative to element at x=BORDER
                const value = wasm.list_get ? wasm.list_get(i, realIdx) : 0;
                if (value < -0.5) {
                    const strPtr = Math.round(-value);
                    item.valueText.text = readStringFromWasm(strPtr) || '0';
                } else if (Number.isInteger(value)) {
                    item.valueText.text = value.toString();
                } else {
                    item.valueText.text = Number(value).toFixed(2).replace('.00', '');
                }
                item.valueText.x = BORDER + 24;
                item.valueText.y = itemY + 6;
                item.valueText.visible = true;
            } else {
                item.indexText.visible = false;
                item.valueBg.visible = false;
                item.valueText.visible = false;
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
        
        // Hide dialog bubble if entity is not visible (hidden)
        const entityVisible = wasm.getVisible(i);
        if (!entityVisible) {
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
        brushStates[i].completedFills = [];  // Clear completed fills
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
    
    // Reset timer/answer display visibility to initial state
    timerVisible = TIMER_DATA.visible;
    answerVisible = ANSWER_DATA.visible;
    if (timerDisplayIndex >= 0 && variableDisplays[timerDisplayIndex]) {
        variableDisplays[timerDisplayIndex].container.visible = timerVisible;
    }
    if (answerDisplayIndex >= 0 && variableDisplays[answerDisplayIndex]) {
        variableDisplays[answerDisplayIndex].container.visible = answerVisible;
    }
    answerValue = 0;
    answerText = '';
    
    // Hide input field if showing
    if (inputOverlay) hideInputField();
    isWaitingForInput = false;
    dragState = null;
    
    // Reset list scroll positions
    for (let i = 0; i < listDisplays.length; i++) {
        listDisplays[i].scrollPosition = 0;
        if (listDisplays[i].scrollBtn) {
            listDisplays[i].scrollBtn.y = 23;
        }
    }
    
    wasm.init();
    currentScene = 0;
    running = true;
    lastTime = performance.now();
    accumulator = 0;
    dynamicMaxTicks = 10000;
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
`;
    }

    generateAssetData() {
        let code = 'const ENTITY_DATA = [\n';
        
        for (const obj of this.project.objects) {
            code += `    {\n`;
            code += `        id: "${obj.id}",\n`;
            code += `        name: "${obj.name}",\n`;
            code += `        pictures: [\n`;
            
            for (const pic of obj.pictures) {
                // Generate URL: use fileurl if available, otherwise build from filename
                let url = pic.fileurl || '';
                if (!url && pic.filename && pic.filename.length >= 4) {
                    // Build URL from filename following EntryJS pattern:
                    // /uploads/{first2}/{next2}/image/{filename}.{ext}
                    const filename = pic.filename;
                    const imageType = pic.imageType || 'png';
                    const ext = imageType === 'svg' ? 'svg' : 'png';
                    url = `/uploads/${filename.substring(0, 2)}/${filename.substring(2, 4)}/image/${filename}.${ext}`;
                }
                code += `            { id: "${pic.id}", url: "${url}", width: ${pic.dimension?.width || 100}, height: ${pic.dimension?.height || 100} },\n`;
            }
            
            code += `        ],\n`;
            code += `        sounds: [\n`;
            
            for (const snd of obj.sounds) {
                // Generate URL: use fileurl if available, otherwise build from filename
                let sndUrl = snd.fileurl || '';
                if (!sndUrl && snd.filename && snd.filename.length >= 4) {
                    // Build URL from filename following EntryJS pattern
                    const filename = snd.filename;
                    const ext = snd.ext || '.mp3';
                    sndUrl = `/uploads/${filename.substring(0, 2)}/${filename.substring(2, 4)}/${filename}${ext}`;
                }
                code += `            { id: "${snd.id}", url: "${sndUrl}" },\n`;
            }
            
            code += `        ],\n`;
            code += `        sceneIndex: ${obj.sceneIndex || 0}\n`;
            code += `    },\n`;
        }
        
        code += '];\n';
        return code;
    }

    generateSceneData() {
        let code = 'const SCENE_DATA = [\n';
        
        for (const scene of this.project.scenes) {
            code += `    { id: "${scene.id}", name: "${scene.name}", index: ${scene.index} },\n`;
        }
        
        code += '];\n';
        return code;
    }

    generateVariableData() {
        const variables = this.project.variables.variables || [];
        let code = 'const VARIABLE_DATA = [\n';
        
        for (const v of variables) {
            const name = (v.name || '').replace(/"/g, '\\"');
            const visible = v.visible !== false;
            const x = v.x != null ? v.x : 0;
            const y = v.y != null ? v.y : 0;
            const varType = v.variableType || 'variable';
            let extra = '';
            if (varType === 'slide') {
                extra = `, minValue: ${v.minValue != null ? v.minValue : 0}, maxValue: ${v.maxValue != null ? v.maxValue : 100}`;
            }
            code += `    { id: "${v.id}", name: "${name}", memoryOffset: ${v.memoryOffset}, visible: ${visible}, x: ${x}, y: ${y}, varType: "${varType}"${extra} },\n`;
        }
        
        code += '];\n';
        return code;
    }

    generateListData() {
        const lists = this.project.variables.lists || [];
        let code = 'const LIST_DATA = [\n';
        
        for (const l of lists) {
            const name = (l.name || '').replace(/"/g, '\\"');
            const visible = l.visible !== false;
            const x = l.x != null ? l.x : 0;
            const y = l.y != null ? l.y : 0;
            const width = l.width || 100;
            const height = l.height || 120;
            code += `    { id: "${l.id}", name: "${name}", memoryIndex: ${l.memoryIndex}, visible: ${visible}, x: ${x}, y: ${y}, width: ${width}, height: ${height} },\n`;
        }
        
        code += '];\n';
        return code;
    }

    generateTimerData() {
        const timer = this.project.variables.timer;
        if (timer) {
            const name = (timer.name || '\uCD08\uC2DC\uACC4').replace(/"/g, '\\"');
            const visible = timer.visible !== false;
            // Match EntryJS generateTimer: x = 240 - (name.length * 12 + 70)
            const nameLen = (timer.name || '\uCD08\uC2DC\uACC4').length;
            const defaultX = 240 - (nameLen * 12 + 70);
            const x = timer.x != null ? timer.x : defaultX;
            const y = timer.y != null ? timer.y : -70;
            return `const TIMER_DATA = { name: "${name}", visible: ${visible}, x: ${x}, y: ${y} };\n`;
        }
        // Default: "\uCD08\uC2DC\uACC4" (\uCD08\uC2DC\uACC4, 3 chars), x = 240 - (3*12+70) = 134
        return `const TIMER_DATA = { name: "\uCD08\uC2DC\uACC4", visible: false, x: 134, y: -70 };\n`;
    }

    generateAnswerData() {
        const answer = this.project.variables.answer;
        if (answer) {
            const name = (answer.name || '\uB300\uB2F5').replace(/"/g, '\\"');
            const visible = answer.visible !== false;
            const x = answer.x != null ? answer.x : 150;
            const y = answer.y != null ? answer.y : -100;
            return `const ANSWER_DATA = { name: "${name}", visible: ${visible}, x: ${x}, y: ${y} };\n`;
        }
        // Default answer data (matches EntryJS generateAnswer defaults)
        return `const ANSWER_DATA = { name: "\uB300\uB2F5", visible: false, x: 150, y: -100 };\n`;
    }
}

module.exports = { generateRenderer, RendererGenerator };
