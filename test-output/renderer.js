/**
 * EntryJS Compiled Project - Renderer
 * 
 * This file handles PixiJS rendering only.
 * All project logic runs in WebAssembly.
 */

// ===== CONFIGURATION =====
const STAGE_WIDTH = 480;
const STAGE_HEIGHT = 360;
const TARGET_FPS = 60;

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

// ===== ASSET DATA =====
const ENTITY_DATA = [
    {
        id: "obj1",
        name: "Entrybot",
        pictures: [
            { id: "pic1", url: "media/entrybot1.svg", width: 144, height: 246 },
            { id: "pic2", url: "media/entrybot2.svg", width: 144, height: 246 },
        ],
        sounds: [
            { id: "snd1", url: "media/bark.mp3" },
        ]
    },
];


// ===== INITIALIZATION =====
async function init() {
    console.log('[Renderer] Initializing...');
    
    // Initialize PixiJS
    app = new PIXI.Application({
        width: STAGE_WIDTH,
        height: STAGE_HEIGHT,
        backgroundColor: 0xffffff,
        view: document.getElementById('stage'),
        antialias: true
    });
    
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
async function loadAssets() {
    console.log('[Renderer] Loading assets...');
    
    // Load textures for each entity
    for (const entityData of ENTITY_DATA) {
        const entityTextures = [];
        for (const pic of entityData.pictures) {
            try {
                const texture = await PIXI.Assets.load(pic.url);
                entityTextures.push(texture);
            } catch (e) {
                console.warn('[Renderer] Failed to load texture:', pic.url);
                // Create placeholder texture
                const graphics = new PIXI.Graphics();
                graphics.beginFill(0xcccccc);
                graphics.drawRect(0, 0, pic.width || 100, pic.height || 100);
                graphics.endFill();
                entityTextures.push(app.renderer.generateTexture(graphics));
            }
        }
        textures.push(entityTextures);
    }
    
    // Load sounds
    for (const entityData of ENTITY_DATA) {
        const entitySounds = [];
        for (const snd of entityData.sounds) {
            try {
                const audio = new Audio(snd.url);
                entitySounds.push(audio);
            } catch (e) {
                console.warn('[Renderer] Failed to load sound:', snd.url);
                entitySounds.push(null);
            }
        }
        sounds.push(entitySounds);
    }
}

// ===== SPRITE CREATION =====
function createSprites() {
    for (let i = 0; i < ENTITY_DATA.length; i++) {
        const entityData = ENTITY_DATA[i];
        const entityTextures = textures[i];
        
        // Create sprite with first texture
        const sprite = new PIXI.Sprite(entityTextures[0] || PIXI.Texture.WHITE);
        
        // Set anchor to center
        sprite.anchor.set(0.5, 0.5);
        
        // Initial position (will be updated from WASM)
        sprite.x = STAGE_WIDTH / 2;
        sprite.y = STAGE_HEIGHT / 2;
        
        app.stage.addChild(sprite);
        sprites.push({
            sprite,
            textures: entityTextures,
            data: entityData
        });
    }
}

// ===== INPUT HANDLING =====
function setupInputHandlers() {
    const canvas = app.view;
    
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
        e.preventDefault();
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
    
    // Update sprites from WASM state
    updateSprites();
    
    // Request next frame
    requestAnimationFrame(gameLoop);
}

// ===== SPRITE UPDATE =====
function updateSprites() {
    for (let i = 0; i < sprites.length; i++) {
        const { sprite, textures: entityTextures } = sprites[i];
        
        // Read entity state from WASM
        const x = wasm.getX(i);
        const y = wasm.getY(i);
        const rotation = wasm.getRotation(i);
        const direction = wasm.getDirection(i);
        const scaleX = wasm.getScaleX(i);
        const scaleY = wasm.getScaleY(i);
        const size = wasm.getSize(i);
        const visible = wasm.getVisible(i);
        const pictureIndex = wasm.getPictureIndex(i);
        
        // Update sprite properties
        // Convert from Entry coordinates to PixiJS coordinates
        sprite.x = STAGE_WIDTH / 2 + x;
        sprite.y = STAGE_HEIGHT / 2 - y;
        
        // Rotation in degrees, convert to radians
        sprite.rotation = rotation * Math.PI / 180;
        
        // Scale
        const sizeScale = size / 100;
        sprite.scale.x = scaleX * sizeScale;
        sprite.scale.y = scaleY * sizeScale;
        
        // Visibility
        sprite.visible = visible !== 0;
        
        // Texture (picture)
        const texIdx = Math.abs(pictureIndex) % (entityTextures.length || 1);
        if (entityTextures[texIdx]) {
            sprite.texture = entityTextures[texIdx];
        }
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
    wasm.init();
    running = true;
    lastTime = performance.now();
    requestAnimationFrame(gameLoop);
}

// ===== START =====
init().catch(console.error);
