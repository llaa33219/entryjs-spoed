/**
 * Text Box Block Handlers
 * 
 * Handles blocks related to text box (글상자) objects.
 * TextBox rendering requires complex UI support in the renderer.
 * These are stub implementations that prevent compilation errors.
 */

const statementBlocks = {
    'text_write': (ctx, block, entityIndex) => {
        const value = ctx.transpileValue(block.params?.[1], entityIndex);
        return `
          ;; text_write (textBox not supported in WASM)
          (drop ${value})`;
    },

    'text_append': (ctx, block, entityIndex) => {
        const value = ctx.transpileValue(block.params?.[1], entityIndex);
        return `
          ;; text_append (textBox not supported in WASM)
          (drop ${value})`;
    },

    'text_prepend': (ctx, block, entityIndex) => {
        const value = ctx.transpileValue(block.params?.[1], entityIndex);
        return `
          ;; text_prepend (textBox not supported in WASM)
          (drop ${value})`;
    },

    'text_flush': (ctx, block, entityIndex) => {
        return `
          ;; text_flush (textBox not supported in WASM)
          (nop)`;
    },

    'text_change_effect': (ctx, block, entityIndex) => {
        const value = ctx.transpileValue(block.params?.[1], entityIndex);
        return `
          ;; text_change_effect (textBox not supported in WASM)
          (drop ${value})`;
    },

    'text_change_font': (ctx, block, entityIndex) => {
        return `
          ;; text_change_font (textBox not supported in WASM)
          (nop)`;
    },

    'text_change_font_color': (ctx, block, entityIndex) => {
        return `
          ;; text_change_font_color (textBox not supported in WASM)
          (nop)`;
    },

    'text_change_bg_color': (ctx, block, entityIndex) => {
        return `
          ;; text_change_bg_color (textBox not supported in WASM)
          (nop)`;
    }
};

const valueBlocks = {
    'text_read': (ctx, block, entityIndex) => {
        return '(f64.const 0)';
    }
};

const booleanBlocks = {};

module.exports = { statementBlocks, valueBlocks, booleanBlocks };
