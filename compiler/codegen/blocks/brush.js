/**
 * Brush Block Handlers
 * 
 * Handles blocks related to drawing and brush operations.
 * Colors are passed as separate R, G, B values (0-255) to WASM.
 */

/**
 * Parse a hex color string and return {r, g, b} or null if not valid hex
 * Supports #RGB (3 chars) and #RRGGBB (6 chars) formats
 */
function parseHexColorString(str) {
    if (typeof str !== 'string') return null;
    const match = str.match(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/);
    if (!match) return null;
    
    const hex = match[1];
    if (hex.length === 3) {
        return {
            r: parseInt(hex[0] + hex[0], 16),
            g: parseInt(hex[1] + hex[1], 16),
            b: parseInt(hex[2] + hex[2], 16)
        };
    } else {
        return {
            r: parseInt(hex.slice(0, 2), 16),
            g: parseInt(hex.slice(2, 4), 16),
            b: parseInt(hex.slice(4, 6), 16)
        };
    }
}

/**
 * Parse a color value and return {r, g, b} for static colors
 * or {dynamic: true, type: string, block: object} for dynamic colors
 * Supports: hex strings (#FF0000), color block objects, text blocks with hex values, etc.
 */
function parseColor(colorParam) {
    let colorStr = '#000000';
    
    if (!colorParam) {
        return { r: 0, g: 0, b: 0 };
    }
    
    // Handle color block object with params
    if (typeof colorParam === 'object') {
        // Check if this is a dynamic block (function param, function call, etc.)
        // These need runtime evaluation
        if (colorParam.type) {
            // Text block with hex color pattern - convert at compile time
            if (colorParam.type === 'text' && colorParam.params?.[0]) {
                const hexColor = parseHexColorString(colorParam.params[0]);
                if (hexColor) {
                    return hexColor; // Return static {r, g, b}
                }
            }
            
            // change_rgb_to_hex: we can extract R, G, B components
            if (colorParam.type === 'change_rgb_to_hex') {
                return {
                    dynamic: true,
                    type: 'rgb_components',
                    rBlock: colorParam.params?.[0],
                    gBlock: colorParam.params?.[1],
                    bBlock: colorParam.params?.[2]
                };
            }
            
            // Function call, parameter, variable - returns packed color
            if (colorParam.type.startsWith('stringParam_') ||
                colorParam.type.startsWith('booleanParam_') ||
                colorParam.type.startsWith('func_') ||
                colorParam.type === 'get_variable' ||
                colorParam.type === 'get_func_variable') {
                return {
                    dynamic: true,
                    type: 'packed',
                    block: colorParam
                };
            }
        }
        
        if (colorParam.params && colorParam.params[0]) {
            const firstParam = colorParam.params[0];
            // Make sure it's a string before assigning
            if (typeof firstParam === 'string') {
                colorStr = firstParam;
            } else if (typeof firstParam === 'object' && firstParam.type === 'color' && firstParam.params?.[0]) {
                colorStr = firstParam.params[0];
            }
        } else if (colorParam.type === 'color') {
            colorStr = colorParam.params?.[0] || '#000000';
        }
    } else if (typeof colorParam === 'string') {
        colorStr = colorParam;
    }
    
    // Ensure colorStr is a string
    if (typeof colorStr !== 'string') {
        return { r: 0, g: 0, b: 0 };
    }
    
    // Parse hex color string
    if (colorStr.startsWith('#')) {
        const hex = colorStr.slice(1);
        if (hex.length === 6) {
            return {
                r: parseInt(hex.slice(0, 2), 16) || 0,
                g: parseInt(hex.slice(2, 4), 16) || 0,
                b: parseInt(hex.slice(4, 6), 16) || 0
            };
        } else if (hex.length === 3) {
            return {
                r: parseInt(hex[0] + hex[0], 16) || 0,
                g: parseInt(hex[1] + hex[1], 16) || 0,
                b: parseInt(hex[2] + hex[2], 16) || 0
            };
        }
    }
    
    return { r: 0, g: 0, b: 0 };
}

/**
 * Generate WAT code to set brush color (handles both static and dynamic)
 */
function generateSetBrushColor(ctx, colorParam, entityIndex) {
    const color = parseColor(colorParam);
    
    if (color.dynamic) {
        if (color.type === 'rgb_components') {
            // change_rgb_to_hex block - extract R, G, B and set directly
            const r = ctx.transpileValue(color.rBlock, entityIndex);
            const g = ctx.transpileValue(color.gBlock, entityIndex);
            const b = ctx.transpileValue(color.bBlock, entityIndex);
            return `
          ;; set_color: dynamic RGB components
          (call $setBrushColorRGB (i32.const ${entityIndex}) ${r} ${g} ${b})`;
        } else {
            // Packed color from function/variable - unpack and set
            const packed = ctx.transpileValue(color.block, entityIndex);
            return `
          ;; set_color: dynamic packed color
          (call $unpackAndSetBrushColor (i32.const ${entityIndex}) ${packed})`;
        }
    }
    
    // Static color
    const { r, g, b } = color;
    return `
          ;; set_color: rgb(${r}, ${g}, ${b})
          (call $setBrushColorRGB (i32.const ${entityIndex}) (f64.const ${r}) (f64.const ${g}) (f64.const ${b}))`;
}

/**
 * Generate WAT code to set fill color (handles both static and dynamic)
 */
function generateSetFillColor(ctx, colorParam, entityIndex) {
    const color = parseColor(colorParam);
    
    if (color.dynamic) {
        if (color.type === 'rgb_components') {
            // change_rgb_to_hex block - extract R, G, B and set directly
            const r = ctx.transpileValue(color.rBlock, entityIndex);
            const g = ctx.transpileValue(color.gBlock, entityIndex);
            const b = ctx.transpileValue(color.bBlock, entityIndex);
            return `
          ;; set_fill_color: dynamic RGB components
          (call $setFillColorRGB (i32.const ${entityIndex}) ${r} ${g} ${b})`;
        } else {
            // Packed color from function/variable - unpack and set
            const packed = ctx.transpileValue(color.block, entityIndex);
            return `
          ;; set_fill_color: dynamic packed color
          (call $unpackAndSetFillColor (i32.const ${entityIndex}) ${packed})`;
        }
    }
    
    // Static color
    const { r, g, b } = color;
    return `
          ;; set_fill_color: rgb(${r}, ${g}, ${b})
          (call $setFillColorRGB (i32.const ${entityIndex}) (f64.const ${r}) (f64.const ${g}) (f64.const ${b}))`;
}

const statementBlocks = {
    'brush_stamp': (ctx, block, entityIndex) => {
        return `
          ;; brush_stamp
          (call $stamp (i32.const ${entityIndex}))`;
    },

    'brush_clear': (ctx, block, entityIndex) => {
        return `
          ;; brush_clear
          (call $clearBrush)`;
    },

    'brush_erase_all': (ctx, block, entityIndex) => {
        return `
          ;; brush_erase_all
          (call $clearBrush)`;
    },

    'start_drawing': (ctx, block, entityIndex) => {
        return `
          ;; start_drawing
          (call $startDrawing (i32.const ${entityIndex}))`;
    },

    'stop_drawing': (ctx, block, entityIndex) => {
        return `
          ;; stop_drawing
          (call $stopDrawing (i32.const ${entityIndex}))`;
    },

    'set_color': (ctx, block, entityIndex) => {
        return generateSetBrushColor(ctx, block.params?.[0], entityIndex);
    },

    'set_brush_color_to': (ctx, block, entityIndex) => {
        return generateSetBrushColor(ctx, block.params?.[0], entityIndex);
    },

    'set_random_color': (ctx, block, entityIndex) => {
        return `
          ;; set_random_color (internal WASM function)
          (call $setRandomBrushColorInternal (i32.const ${entityIndex}))`;
    },

    'set_random_brush_color': (ctx, block, entityIndex) => {
        return `
          ;; set_random_brush_color (internal WASM function)
          (call $setRandomBrushColorInternal (i32.const ${entityIndex}))`;
    },

    'change_brush_transparency': (ctx, block, entityIndex) => {
        const value = ctx.transpileValue(block.params?.[0], entityIndex);
        return `
          ;; change_brush_transparency
          (call $changeBrushTransparency (i32.const ${entityIndex}) ${value})`;
    },

    'set_brush_tranparency': (ctx, block, entityIndex) => {
        const value = ctx.transpileValue(block.params?.[0], entityIndex);
        return `
          ;; set_brush_tranparency
          (call $setBrushTransparency (i32.const ${entityIndex}) ${value})`;
    },

    'set_brush_transparency': (ctx, block, entityIndex) => {
        const value = ctx.transpileValue(block.params?.[0], entityIndex);
        return `
          ;; set_brush_transparency
          (call $setBrushTransparency (i32.const ${entityIndex}) ${value})`;
    },

    'change_thickness': (ctx, block, entityIndex) => {
        const value = ctx.transpileValue(block.params?.[0], entityIndex);
        return `
          ;; change_thickness
          (call $changeBrushThickness (i32.const ${entityIndex}) ${value})`;
    },

    'change_brush_thickness': (ctx, block, entityIndex) => {
        const value = ctx.transpileValue(block.params?.[0], entityIndex);
        return `
          ;; change_brush_thickness
          (call $changeBrushThickness (i32.const ${entityIndex}) ${value})`;
    },

    'set_thickness': (ctx, block, entityIndex) => {
        const value = ctx.transpileValue(block.params?.[0], entityIndex);
        return `
          ;; set_thickness
          (call $setBrushThickness (i32.const ${entityIndex}) ${value})`;
    },

    'set_brush_thickness': (ctx, block, entityIndex) => {
        const value = ctx.transpileValue(block.params?.[0], entityIndex);
        return `
          ;; set_brush_thickness
          (call $setBrushThickness (i32.const ${entityIndex}) ${value})`;
    },

    'start_fill': (ctx, block, entityIndex) => {
        return `
          ;; start_fill
          (call $startFill (i32.const ${entityIndex}))`;
    },

    'stop_fill': (ctx, block, entityIndex) => {
        return `
          ;; stop_fill
          (call $stopFill (i32.const ${entityIndex}))`;
    },

    'set_fill_color': (ctx, block, entityIndex) => {
        return generateSetFillColor(ctx, block.params?.[0], entityIndex);
    }
};

const valueBlocks = {};

const booleanBlocks = {};

module.exports = { statementBlocks, valueBlocks, booleanBlocks };
