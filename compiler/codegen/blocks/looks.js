/**
 * Looks Block Handlers
 * 
 * Handles blocks related to appearance, visibility, and size.
 */

const statementBlocks = {
    'show': (ctx, block, entityIndex) => {
        return `
          ;; show
          (call $setVisible (i32.const ${entityIndex}) (i32.const 1))`;
    },

    'hide': (ctx, block, entityIndex) => {
        return `
          ;; hide
          (call $setVisible (i32.const ${entityIndex}) (i32.const 0))`;
    },

    'change_scale_size': (ctx, block, entityIndex) => {
        // Size is percentage-based: 100 = 100% = scaleX/Y of 1.0
        // change_scale_size adds to current size percentage
        const value = ctx.transpileValue(block.params?.[0], entityIndex);
        return `
          ;; change_scale_size - add to size percentage and update scale
          ;; Calculate new size = current size + value
          (local.set $temp (f64.add (call $getSize (i32.const ${entityIndex})) ${value}))
          ;; Clamp minimum to 1 (1%)
          (if (f64.lt (local.get $temp) (f64.const 1))
            (then (local.set $temp (f64.const 1))))
          ;; Set size
          (call $setSize (i32.const ${entityIndex}) (local.get $temp))
          ;; Set scaleX = scaleY = size / 100
          (local.set $temp (f64.div (local.get $temp) (f64.const 100)))
          (call $setScaleX (i32.const ${entityIndex}) (local.get $temp))
          (call $setScaleY (i32.const ${entityIndex}) (local.get $temp))`;
    },

    'set_scale_size': (ctx, block, entityIndex) => {
        // Size is percentage-based: 100 = 100% = scaleX/Y of 1.0
        // set_scale_size sets size to specific percentage
        const value = ctx.transpileValue(block.params?.[0], entityIndex);
        return `
          ;; set_scale_size - set size percentage and update scale
          ;; Clamp minimum to 1 (1%)
          (local.set $temp ${value})
          (if (f64.lt (local.get $temp) (f64.const 1))
            (then (local.set $temp (f64.const 1))))
          ;; Set size
          (call $setSize (i32.const ${entityIndex}) (local.get $temp))
          ;; Set scaleX = scaleY = size / 100
          (local.set $temp (f64.div (local.get $temp) (f64.const 100)))
          (call $setScaleX (i32.const ${entityIndex}) (local.get $temp))
          (call $setScaleY (i32.const ${entityIndex}) (local.get $temp))`;
    },

    'change_to_next_shape': (ctx, block, entityIndex) => {
        const direction = block.params?.[0] === 'prev' ? -1 : 1;
        return `
          ;; change_to_next_shape
          (call $setPictureIndex (i32.const ${entityIndex})
            (i32.add (call $getPictureIndex (i32.const ${entityIndex})) (i32.const ${direction})))`;
    },

    'change_to_some_shape': (ctx, block, entityIndex) => {
        const pictureId = block.params?.[0];
        // Find picture index by ID
        const obj = ctx.generator.project.objects[entityIndex];
        const idx = obj?.pictures?.findIndex(p => p.id === pictureId);
        const pictureIndex = (idx === -1 || idx === undefined) ? 0 : idx;
        return `
          ;; change_to_some_shape
          (call $setPictureIndex (i32.const ${entityIndex}) (i32.const ${pictureIndex}))`;
    },

    'set_effect_volume': (ctx, block, entityIndex) => {
        const effectType = block.params?.[0];
        const value = ctx.transpileValue(block.params?.[1], entityIndex);
        // Effect types: transparency, color, brightness, etc.
        return `
          ;; set_effect_volume: ${effectType}
          ;; TODO: Implement effect system
          (drop ${value})`;
    },

    'change_effect_volume': (ctx, block, entityIndex) => {
        const effectType = block.params?.[0];
        const value = ctx.transpileValue(block.params?.[1], entityIndex);
        return `
          ;; change_effect_volume: ${effectType}
          ;; TODO: Implement effect system
          (drop ${value})`;
    },

    'clear_effect': (ctx, block, entityIndex) => {
        return `
          ;; clear_effect
          ;; TODO: Reset all effects`;
    },

    'dialog': (ctx, block, entityIndex) => {
        const text = block.params?.[0];
        const dialogType = block.params?.[1]; // 'speak' or 'think'
        const typeCode = dialogType === 'think' ? 1 : 0;
        return `
          ;; dialog: ${dialogType}
          (call $showDialog (i32.const ${entityIndex}) (i32.const ${typeCode}))`;
    },

    'dialog_time': (ctx, block, entityIndex) => {
        const text = block.params?.[0];
        const seconds = ctx.transpileValue(block.params?.[1], entityIndex);
        const dialogType = block.params?.[2]; // 'speak' or 'think'
        const typeCode = dialogType === 'think' ? 1 : 0;
        return `
          ;; dialog_time: ${dialogType}
          (call $showDialog (i32.const ${entityIndex}) (i32.const ${typeCode}))`;
    },

    'remove_dialog': (ctx, block, entityIndex) => {
        return `
          ;; remove_dialog
          (call $showDialog (i32.const ${entityIndex}) (i32.const -1))`;
    },

    'add_effect_amount': (ctx, block, entityIndex) => {
        const effectType = block.params?.[0];
        const value = ctx.transpileValue(block.params?.[1], entityIndex);
        return `
          ;; add_effect_amount: ${effectType}
          ;; TODO: Implement effect system
          (drop ${value})`;
    }
};

const valueBlocks = {
    'get_size': (ctx, block, entityIndex) => {
        return `(call $getSize (i32.const ${entityIndex}))`;
    }
};

const booleanBlocks = {};

module.exports = { statementBlocks, valueBlocks, booleanBlocks };
