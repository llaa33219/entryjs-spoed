/**
 * PixiRenderer - High-performance WebGL/WebGPU rendering for Entry Player
 *
 * Architecture:
 * - PixiJS v8 for sprite batching and general 2D rendering
 * - Custom WebGL shaders for brush strokes (Ciallo-inspired)
 * - Zero-copy integration with WASM render buffer
 */

const RENDER_STRIDE = 16; // Must match WASM render buffer stride

/**
 * BrushRenderer - GPU-accelerated brush stroke rendering
 * Based on Ciallo technique (SIGGRAPH 2024)
 */
class BrushRenderer {
    constructor(app) {
        this.app = app;
        this.entityLayers = new Map(); // entityId -> RenderTexture
    }

    // Shader initialization removed to rely on PixiJS v8 Graphics for stability

    /**
     * Get or create a render texture for an entity's brush layer
     */
    getEntityLayer(entityId, width = 640, height = 360) {
        if (!this.entityLayers.has(entityId)) {
            const texture = PIXI.RenderTexture.create({
                width,
                height,
                resolution: window.devicePixelRatio || 1,
            });
            this.entityLayers.set(entityId, {
                texture,
                sprite: new PIXI.Sprite(texture),
                graphics: new PIXI.Graphics(), // For PixiJS fallback
            });
        }
        return this.entityLayers.get(entityId);
    }

    /**
     * Draw a stroke path to an entity's brush layer
     * @param {number} entityId - Entity ID
     * @param {Array<{x: number, y: number}>} points - Stroke points in Entry coordinates
     * @param {string} color - Stroke color (hex)
     * @param {number} thickness - Stroke thickness
     * @param {number} opacity - Stroke opacity (0-100, Entry format)
     * @param {number} softness - Brush softness (0 = hard, 1 = airbrush)
     */
    drawStroke(entityId, points, color, thickness, opacity = 0, softness = 0) {
        if (!points || points.length < 2) return;

        const layer = this.getEntityLayer(entityId);

        // Convert Entry coordinates to screen coordinates
        const screenPoints = points.map((p) => ({
            x: 320 + p.x,
            y: 180 - p.y,
            radius: thickness / 2,
        }));

        // Use PixiJS Graphics for now (will upgrade to custom WebGL later if needed)
        const g = layer.graphics;

        // Parse color
        const colorNum = parseInt(color.replace('#', ''), 16);
        const alpha = 1 - opacity / 100;

        g.moveTo(screenPoints[0].x, screenPoints[0].y);

        // Use quadratic curves for smooth strokes
        for (let i = 1; i < screenPoints.length; i++) {
            const p1 = screenPoints[i];

            if (i < screenPoints.length - 1) {
                const p2 = screenPoints[i + 1];
                const midX = (p1.x + p2.x) / 2;
                const midY = (p1.y + p2.y) / 2;
                g.quadraticCurveTo(p1.x, p1.y, midX, midY);
            } else {
                g.lineTo(p1.x, p1.y);
            }
        }

        // PixiJS v8 syntax: stroke()
        g.stroke({ width: thickness, color: colorNum, alpha: alpha, cap: 'round', join: 'round' });

        // Render to the entity's texture
        this.app.renderer.render(g, { renderTexture: layer.texture, clear: false });

        // Clear graphics for next stroke
        g.clear();
    }

    /**
     * Clear an entity's brush layer
     */
    clearEntityLayer(entityId) {
        const layer = this.entityLayers.get(entityId);
        if (layer) {
            // Clear the render texture
            const g = new PIXI.Graphics();
            g.rect(0, 0, layer.texture.width, layer.texture.height);
            g.fill({ color: 0x000000, alpha: 0 });
            this.app.renderer.render(g, { renderTexture: layer.texture, clear: true });
            g.destroy();
        }
    }

    /**
     * Draw a stamp (entity image) onto the brush layer
     */
    drawStamp(entityId, sprite, x, y, rotation, scaleX, scaleY) {
        const layer = this.getEntityLayer(entityId);

        // Create a temporary sprite for stamping
        const stampSprite = new PIXI.Sprite(sprite.texture);
        stampSprite.anchor.set(0.5);
        stampSprite.position.set(320 + x, 180 - y);
        stampSprite.rotation = (-rotation * Math.PI) / 180;
        stampSprite.scale.set(scaleX, scaleY);

        // Render to entity's texture
        this.app.renderer.render(stampSprite, { renderTexture: layer.texture, clear: false });
        stampSprite.destroy();
    }

    /**
     * Get the sprite for an entity's brush layer (for compositing)
     */
    getLayerSprite(entityId) {
        const layer = this.entityLayers.get(entityId);
        return layer ? layer.sprite : null;
    }

    /**
     * Clean up resources for a deleted entity
     */
    deleteEntityLayer(entityId) {
        const layer = this.entityLayers.get(entityId);
        if (layer) {
            layer.texture.destroy(true);
            layer.sprite.destroy();
            layer.graphics.destroy();
            this.entityLayers.delete(entityId);
        }
    }

    /**
     * Clean up all resources
     */
    destroy() {
        for (const [id, layer] of this.entityLayers) {
            layer.texture.destroy(true);
            layer.sprite.destroy();
            layer.graphics.destroy();
        }
        this.entityLayers.clear();

        if (this.gl && this.program) {
            // this.gl.deleteProgram(this.program);
        }
    }
}

/**
 * FillRenderer - GPU-accelerated fill polygon rendering
 */
class FillRenderer {
    constructor(app) {
        this.app = app;
        this.fillGraphics = new PIXI.Graphics();
        this.previewGraphics = new PIXI.Graphics();
    }

    /**
     * Draw a filled polygon preview (real-time)
     */
    drawPreview(points, color) {
        if (!points || points.length < 3) return;

        this.previewGraphics.clear();

        const colorNum = parseInt(color.replace('#', ''), 16);

        this.previewGraphics.poly(points.map((p) => ({ x: 320 + p.x, y: 180 - p.y })));
        this.previewGraphics.fill({ color: colorNum });
    }

    /**
     * Finalize fill to an entity's brush layer
     */
    finalizeFill(entityId, points, color, brushRenderer) {
        if (!points || points.length < 3) return;

        const layer = brushRenderer.getEntityLayer(entityId);
        const g = new PIXI.Graphics();

        const colorNum = parseInt(color.replace('#', ''), 16);

        g.poly(points.map((p) => ({ x: 320 + p.x, y: 180 - p.y })));
        g.fill({ color: colorNum });

        // Render to entity's brush layer
        this.app.renderer.render(g, { renderTexture: layer.texture, clear: false });
        g.destroy();

        // Clear preview
        this.previewGraphics.clear();
    }

    clearPreview() {
        this.previewGraphics.clear();
    }

    destroy() {
        this.fillGraphics.destroy();
        this.previewGraphics.destroy();
    }
}

/**
 * Main PixiRenderer class - Manages all WebGL rendering
 */
class PixiRenderer {
    constructor(canvas, options = {}) {
        this.canvas = canvas;
        this.width = options.width || 640;
        this.height = options.height || 360;

        this.app = null;
        this.spritePool = new Map(); // entityId -> Sprite
        this.textPool = new Map(); // entityId -> Text
        this.dialogPool = new Map(); // entityId -> Container (dialog bubble)

        this.brushRenderer = null;
        this.fillRenderer = null;

        this.entityContainer = null; // Main container for entities
        this.brushContainer = null; // Container for brush layers
        this.uiContainer = null; // Container for dialogs and UI

        this.imageCache = new Map(); // pictureId -> Texture
        this.defaultTexture = PIXI.Texture.WHITE; // 1x1 White texture for fallbacks

        this.initialized = false;
        this.debugLogCount = 0; // For throttling logs
    }

    /**
     * Initialize PixiJS application
     */
    async init() {
        // Create PixiJS Application with WebGL preference
        this.app = new PIXI.Application();

        await this.app.init({
            canvas: this.canvas,
            width: this.width,
            height: this.height,
            backgroundColor: 0xffffff,
            antialias: true,
            resolution: window.devicePixelRatio || 1,
            autoDensity: true,
            preference: 'webgl', // Prefer WebGL, fall back to WebGPU or canvas
        });

        // Create layer containers (z-order: background -> brush -> entities -> UI)
        this.brushContainer = new PIXI.Container();
        this.entityContainer = new PIXI.Container();
        this.uiContainer = new PIXI.Container();

        this.app.stage.addChild(this.brushContainer);
        this.app.stage.addChild(this.entityContainer);
        this.app.stage.addChild(this.uiContainer);

        // Initialize specialized renderers
        this.brushRenderer = new BrushRenderer(this.app);
        this.fillRenderer = new FillRenderer(this.app);

        // Add fill preview to UI layer
        this.uiContainer.addChild(this.fillRenderer.previewGraphics);

        this.initialized = true;

        console.log('%c✨ PixiRenderer initialized', 'color: #00ff00; font-weight: bold;');
        console.log(`  Renderer: ${this.app.renderer.type === 1 ? 'WebGL' : 'WebGPU/Canvas'}`);
        console.log(`  Resolution: ${this.width}x${this.height} @${this.app.renderer.resolution}x`);

        return this;
    }

    /**
     * Load an image and cache as texture
     */
    async loadTexture(pictureId, url) {
        if (this.imageCache.has(pictureId)) {
            return this.imageCache.get(pictureId);
        }

        try {
            const texture = await PIXI.Assets.load(url);
            this.imageCache.set(pictureId, texture);
            return texture;
        } catch (e) {
            console.warn(`Failed to load texture: ${pictureId}`, e);
            return null;
        }
    }

    /**
     * Get or create a sprite for an entity
     */
    getSprite(entityId) {
        if (!this.spritePool.has(entityId)) {
            // Initialize with default texture to ensure visibility even without image
            const sprite = new PIXI.Sprite(this.defaultTexture);
            sprite.anchor.set(0.5);
            this.spritePool.set(entityId, sprite);
            this.entityContainer.addChild(sprite);
        }
        return this.spritePool.get(entityId);
    }

    /**
     * Get or create a text object for an entity
     */
    getText(entityId) {
        if (!this.textPool.has(entityId)) {
            const text = new PIXI.Text({
                text: '',
                style: {
                    fontFamily: 'Nanum Gothic, sans-serif',
                    fontSize: 20,
                    fill: 0x000000,
                },
            });
            text.anchor.set(0.5);
            this.textPool.set(entityId, text);
        }
        return this.textPool.get(entityId);
    }

    /**
     * Main render function - called every frame
     * @param {Float64Array} buffer - WASM render buffer
     * @param {Object} entityData - Additional entity data (pictures, text, etc.)
     */
    render(buffer, entityData) {
        if (!this.initialized || !buffer || buffer.length === 0) return;

        const entityIds = new Set();

        // Clear containers (sprites will be repositioned)
        // Note: We don't destroy sprites, just hide/show them
        for (const [id, sprite] of this.spritePool) {
            sprite.visible = false;
        }

        // Process render buffer
        if (this.debugLogCount < 10) {
            console.log(
                `Render frame ${this.debugLogCount}: buffer len=${buffer.length}, entities=${buffer.length / RENDER_STRIDE}`
            );
        }

        for (let i = 0; i < buffer.length; i += RENDER_STRIDE) {
            const id = buffer[i];
            const x = buffer[i + 1];
            const y = buffer[i + 2];
            const rotation = buffer[i + 3];
            // buffer[i + 4] is direction
            const scaleX = buffer[i + 5];
            const scaleY = buffer[i + 6];
            const width = buffer[i + 7];
            const height = buffer[i + 8];
            const visible = buffer[i + 9] > 0.5;

            // Force visible for debugging
            // if (!visible) console.log(`Entity ${id} hidden`);

            entityIds.add(id);

            // Draw brush layer first (always visible regardless of entity visibility)
            const brushLayerSprite = this.brushRenderer.getLayerSprite(id);
            if (brushLayerSprite && !this.brushContainer.children.includes(brushLayerSprite)) {
                this.brushContainer.addChild(brushLayerSprite);
            }

            // Only skip sprite rendering if invisible
            if (!visible) continue;

            // Get entity's sprite
            const sprite = this.getSprite(id);
            sprite.visible = true;

            // Position (convert Entry coords to screen coords)
            sprite.position.set(320 + x, 180 - y);
            sprite.rotation = (-rotation * Math.PI) / 180;
            sprite.scale.set(scaleX, scaleY);

            // Get texture from entity data
            const entity = entityData?.objects?.[id];
            let hasTexture = false;

            if (entity) {
                const pictureId = this._getPictureId(entity, pictureIndex);
                if (pictureId && this.imageCache.has(pictureId)) {
                    sprite.texture = this.imageCache.get(pictureId);
                    sprite.tint = 0xffffff; // Reset tint
                    hasTexture = true;
                }
            }

            // Fallback: Render colored rectangle if no texture
            if (!hasTexture) {
                sprite.texture = this.defaultTexture;
                sprite.tint = entity?.color
                    ? parseInt(entity.color.replace('#', ''), 16)
                    : 0x4a90d9;
            }

            sprite.width = width;
            sprite.height = height;
        }

        // Clean up deleted entities
        for (const [id, sprite] of this.spritePool) {
            if (!entityIds.has(id) && !sprite.visible) {
                // Entity no longer exists, could clean up here
                // For now, just keep hidden (pooling)
            }
        }
    }

    /**
     * Get picture ID from entity data and index
     */
    _getPictureId(entity, pictureIndex) {
        if (entity.sprite?.pictures && pictureIndex >= 0) {
            const pic = entity.sprite.pictures[Math.floor(pictureIndex)];
            return pic?.id;
        }
        return entity.selectedPictureId;
    }

    /**
     * Handle brush path from WASM
     */
    handleBrushPath(entityId, points, color, thickness, opacity) {
        this.brushRenderer.drawStroke(entityId, points, color, thickness, opacity);
    }

    /**
     * Handle brush stamp from WASM
     */
    handleBrushStamp(entityId, x, y, rotation, scaleX, scaleY, pictureId) {
        const sprite = this.spritePool.get(entityId);
        if (sprite) {
            this.brushRenderer.drawStamp(entityId, sprite, x, y, rotation, scaleX, scaleY);
        }
    }

    /**
     * Handle brush erase all
     */
    handleBrushEraseAll(entityId) {
        this.brushRenderer.clearEntityLayer(entityId);
    }

    /**
     * Handle fill path preview
     */
    handleFillPreview(points, color) {
        this.fillRenderer.drawPreview(points, color);
    }

    /**
     * Handle fill finalize
     */
    handleFillFinalize(entityId, points, color) {
        this.fillRenderer.finalizeFill(entityId, points, color, this.brushRenderer);
    }

    /**
     * Handle entity deletion
     */
    handleEntityDelete(entityId) {
        // Clean up sprite
        const sprite = this.spritePool.get(entityId);
        if (sprite) {
            sprite.destroy();
            this.spritePool.delete(entityId);
        }

        // Clean up brush layer
        this.brushRenderer.deleteEntityLayer(entityId);

        // Clean up text
        const text = this.textPool.get(entityId);
        if (text) {
            text.destroy();
            this.textPool.delete(entityId);
        }

        // Clean up dialog
        const dialog = this.dialogPool.get(entityId);
        if (dialog) {
            dialog.destroy();
            this.dialogPool.delete(entityId);
        }
    }

    /**
     * Draw a dialog bubble
     */
    drawDialog(entityId, message, mode, x, y, entityHeight) {
        // Get or create dialog container
        let dialog = this.dialogPool.get(entityId);
        if (!dialog) {
            dialog = new PIXI.Container();
            this.dialogPool.set(entityId, dialog);
            this.uiContainer.addChild(dialog);
        }

        // Clear previous dialog
        dialog.removeChildren();

        if (!message) {
            dialog.visible = false;
            return;
        }

        dialog.visible = true;

        // Create dialog background
        const bg = new PIXI.Graphics();
        const padding = 12;
        const text = new PIXI.Text({
            text: message,
            style: {
                fontFamily: 'Nanum Gothic, sans-serif',
                fontSize: 14,
                fill: 0x000000,
            },
        });

        const textWidth = text.width;
        const textHeight = text.height;
        const balloonWidth = textWidth + padding * 2;
        const balloonHeight = textHeight + padding * 2;
        const radius = 10;

        // Position above entity
        const screenX = 320 + x;
        const screenY = 180 - y - entityHeight / 2 - balloonHeight - 15;

        // Draw balloon
        if (mode === 'think') {
            // Thought bubble style
            bg.roundRect(0, 0, balloonWidth, balloonHeight, radius);
            bg.fill({ color: 0xffffff });
            bg.stroke({ color: 0x000000, width: 2 });

            // Small circles for thought bubble tail
            bg.circle(balloonWidth / 2, balloonHeight + 8, 5);
            bg.fill({ color: 0xffffff });
            bg.stroke({ color: 0x000000, width: 2 });

            bg.circle(balloonWidth / 2 + 5, balloonHeight + 18, 3);
            bg.fill({ color: 0xffffff });
            bg.stroke({ color: 0x000000, width: 2 });
        } else {
            // Speech bubble style
            bg.roundRect(0, 0, balloonWidth, balloonHeight, radius);
            bg.fill({ color: 0xffffff });
            bg.stroke({ color: 0x000000, width: 2 });

            // Triangle tail
            bg.moveTo(balloonWidth / 2 - 8, balloonHeight);
            bg.lineTo(balloonWidth / 2, balloonHeight + 15);
            bg.lineTo(balloonWidth / 2 + 8, balloonHeight);
            bg.fill({ color: 0xffffff });
            bg.stroke({ color: 0x000000, width: 2 });
        }

        dialog.addChild(bg);

        text.position.set(padding, padding);
        dialog.addChild(text);

        dialog.position.set(screenX - balloonWidth / 2, screenY);
    }

    /**
     * Remove dialog
     */
    removeDialog(entityId) {
        const dialog = this.dialogPool.get(entityId);
        if (dialog) {
            dialog.visible = false;
        }
    }

    /**
     * Resize renderer
     */
    resize(width, height) {
        this.app.renderer.resize(width, height);
    }

    /**
     * Destroy renderer and clean up resources
     */
    destroy() {
        this.brushRenderer?.destroy();
        this.fillRenderer?.destroy();

        for (const [id, sprite] of this.spritePool) {
            sprite.destroy();
        }
        this.spritePool.clear();

        for (const [id, text] of this.textPool) {
            text.destroy();
        }
        this.textPool.clear();

        for (const [id, dialog] of this.dialogPool) {
            dialog.destroy();
        }
        this.dialogPool.clear();

        for (const [id, texture] of this.imageCache) {
            texture.destroy(true);
        }
        this.imageCache.clear();

        this.app.destroy(false); // Don't remove canvas
        this.initialized = false;
    }
}

// Export for use in index.html
window.PixiRenderer = PixiRenderer;
window.BrushRenderer = BrushRenderer;
window.FillRenderer = FillRenderer;
