/**
 * Brush Block Handlers
 * 
 * Handles blocks related to drawing and brush operations.
 * Colors are passed as separate R, G, B values (0-255) to WASM.
 */

/**
 * Parse a color value and return {r, g, b}
 * Supports: hex strings (#FF0000), color block objects, etc.
 */
function parseColor(colorParam) {
    let colorStr = '#000000';
    
    if (!colorParam) {
        return { r: 0, g: 0, b: 0 };
    }
    
    // Handle color block object with params
    if (typeof colorParam === 'object') {
        if (colorParam.params && colorParam.params[0]) {
            colorStr = colorParam.params[0];
        } else if (colorParam.type === 'color') {
            colorStr = colorParam.params?.[0] || '#000000';
        }
    } else if (typeof colorParam === 'string') {
        colorStr = colorParam;
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
        const colorParam = block.params?.[0];
        const { r, g, b } = parseColor(colorParam);
        return `
          ;; set_color: rgb(${r}, ${g}, ${b})
          (call $setBrushColor (i32.const ${entityIndex}) (i32.const ${r}) (i32.const ${g}) (i32.const ${b}))`;
    },

    'set_brush_color_to': (ctx, block, entityIndex) => {
        const colorParam = block.params?.[0];
        const { r, g, b } = parseColor(colorParam);
        return `
          ;; set_brush_color_to: rgb(${r}, ${g}, ${b})
          (call $setBrushColor (i32.const ${entityIndex}) (i32.const ${r}) (i32.const ${g}) (i32.const ${b}))`;
    },

    'set_random_color': (ctx, block, entityIndex) => {
        return `
          ;; set_random_color
          (call $setRandomBrushColor (i32.const ${entityIndex}))`;
    },

    'set_random_brush_color': (ctx, block, entityIndex) => {
        return `
          ;; set_random_brush_color
          (call $setRandomBrushColor (i32.const ${entityIndex}))`;
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
        const colorParam = block.params?.[0];
        const { r, g, b } = parseColor(colorParam);
        return `
          ;; set_fill_color: rgb(${r}, ${g}, ${b})
          (call $setFillColor (i32.const ${entityIndex}) (i32.const ${r}) (i32.const ${g}) (i32.const ${b}))`;
    }
};

const valueBlocks = {};

const booleanBlocks = {};

module.exports = { statementBlocks, valueBlocks, booleanBlocks };
