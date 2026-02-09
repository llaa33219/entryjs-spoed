/**
 * Looks Block Handlers
 * 
 * Handles blocks related to appearance, visibility, and size.
 */

const _textEncoder = new TextEncoder();

/**
 * Generate WAT code to allocate a string literal in memory
 * @param {string} str - The string to allocate
 * @returns {string} WAT code that returns i32 string pointer
 */
function generateStringAllocation(str) {
    if (!str || str.length === 0) {
        return '(call $str_alloc (i32.const 0))';
    }
    
    const bytes = _textEncoder.encode(str);
    const len = bytes.length;
    
    let code = `(block (result i32)
            (local.set $temp_str_ptr (call $str_alloc (i32.const ${len})))`;
    
    for (let i = 0; i < len; i++) {
        code += `\n            (i32.store8 (i32.add (i32.add (local.get $temp_str_ptr) (i32.const 4)) (i32.const ${i})) (i32.const ${bytes[i]}))`;
    }
    
    // Null terminate
    code += `\n            (i32.store8 (i32.add (i32.add (local.get $temp_str_ptr) (i32.const 4)) (i32.const ${len})) (i32.const 0))`;
    code += `\n            (local.get $temp_str_ptr))`;
    
    return code;
}

const statementBlocks = {
    'show': (ctx, block, entityIndex) => {
        return `
          ;; show
          (call $setVisible (i32.const ${entityIndex}) (i32.const 1))
          (call $setInitialVisible (i32.const ${entityIndex}) (i32.const 1))`;
    },

    'hide': (ctx, block, entityIndex) => {
        return `
          ;; hide
          (call $setVisible (i32.const ${entityIndex}) (i32.const 0))
          (call $setInitialVisible (i32.const ${entityIndex}) (i32.const 0))`;
    },

    'change_scale_size': (ctx, block, entityIndex) => {
        // Matching EntryJS: targetSize = getSize() + delta, factor = max(1, targetSize) / getSize()
        // Then scaleX *= factor, scaleY *= factor (proportional scaling)
        const value = ctx.transpileValue(block.params?.[0], entityIndex);
        return `
          ;; change_scale_size - proportional scaling matching EntryJS
          ;; Cache current size to avoid redundant $getSize computation
          (local.set $temp2 (call $getSize (i32.const ${entityIndex})))
          ;; targetSize = currentSize + delta, clamped to min 1
          (local.set $temp (f64.add (local.get $temp2) ${value}))
          (if (f64.lt (local.get $temp) (f64.const 1))
            (then (local.set $temp (f64.const 1))))
          ;; factor = targetSize / currentSize (guard against zero)
          (local.set $temp (f64.div (local.get $temp)
            (select
              (local.get $temp2)
              (f64.const 1)
              (f64.gt (local.get $temp2) (f64.const 0)))))
          ;; scaleX *= factor, scaleY *= factor
          (call $setScaleX (i32.const ${entityIndex})
            (f64.mul (call $getScaleX (i32.const ${entityIndex})) (local.get $temp)))
          (call $setScaleY (i32.const ${entityIndex})
            (f64.mul (call $getScaleY (i32.const ${entityIndex})) (local.get $temp)))`;
    },

    'set_scale_size': (ctx, block, entityIndex) => {
        // Matching EntryJS setSize(): factor = max(1, value) / getSize()
        // Then scaleX *= factor, scaleY *= factor (proportional scaling)
        const value = ctx.transpileValue(block.params?.[0], entityIndex);
        return `
          ;; set_scale_size - proportional scaling matching EntryJS setSize()
          ;; Cache current size to avoid redundant $getSize computation
          (local.set $temp2 (call $getSize (i32.const ${entityIndex})))
          ;; Clamp target size to minimum 1
          (local.set $temp ${value})
          (if (f64.lt (local.get $temp) (f64.const 1))
            (then (local.set $temp (f64.const 1))))
          ;; factor = targetSize / currentSize (guard against zero)
          (local.set $temp (f64.div (local.get $temp)
            (select
              (local.get $temp2)
              (f64.const 1)
              (f64.gt (local.get $temp2) (f64.const 0)))))
          ;; scaleX *= factor, scaleY *= factor
          (call $setScaleX (i32.const ${entityIndex})
            (f64.mul (call $getScaleX (i32.const ${entityIndex})) (local.get $temp)))
          (call $setScaleY (i32.const ${entityIndex})
            (f64.mul (call $getScaleY (i32.const ${entityIndex})) (local.get $temp)))`;
    },

    'change_to_next_shape': (ctx, block, entityIndex) => {
        const direction = block.params?.[0] === 'prev' ? -1 : 1;
        return `
          ;; change_to_next_shape
          (call $setPictureIndex (i32.const ${entityIndex})
            (i32.add (call $getPictureIndex (i32.const ${entityIndex})) (i32.const ${direction})))
          (call $updateEntityDimensions (i32.const ${entityIndex}) (call $getPictureIndex (i32.const ${entityIndex})))`;
    },

    'change_to_some_shape': (ctx, block, entityIndex) => {
        // Extract picture value - can be get_pictures block or direct value
        let pictureValue = block.params?.[0];
        
        // If it's a get_pictures block, extract the actual picture ID from its params
        if (pictureValue && typeof pictureValue === 'object' && pictureValue.type === 'get_pictures') {
            pictureValue = pictureValue.params?.[0];
        }
        
        // Find picture index - support ID, name, or 1-based index (like EntryJS getPicture)
        const obj = ctx.generator.project.objects[entityIndex];
        const pictures = obj?.pictures || [];
        let pictureIndex = 0;
        
        if (pictureValue !== null && pictureValue !== undefined) {
            const valueStr = String(pictureValue).trim();
            
            // 1. Try to find by ID
            let idx = pictures.findIndex(p => p.id === valueStr);
            
            // 2. Try to find by name
            if (idx === -1) {
                idx = pictures.findIndex(p => p.name === valueStr);
            }
            
            // 3. Try as 1-based index (like EntryJS)
            if (idx === -1) {
                const numValue = parseFloat(valueStr);
                if (!isNaN(numValue) && numValue > 0 && numValue <= pictures.length) {
                    idx = Math.floor(numValue) - 1; // Convert 1-based to 0-based
                }
            }
            
            if (idx !== -1) {
                pictureIndex = idx;
            }
        }
        
        return `
          ;; change_to_some_shape
          (call $setPictureIndex (i32.const ${entityIndex}) (i32.const ${pictureIndex}))
          (call $updateEntityDimensions (i32.const ${entityIndex}) (i32.const ${pictureIndex}))`;
    },

    'set_effect_volume': (ctx, block, entityIndex) => {
        // Deprecated block - uses 'opacity' param (not 'transparency')
        // EntryJS: sprite.effect.alpha = effectValue / 100
        const effectType = block.params?.[0];
        const value = ctx.transpileValue(block.params?.[1], entityIndex);
        if (effectType === 'transparency') {
            return `
          ;; set_effect_volume: set transparency to value
          (call $setTransparency (i32.const ${entityIndex}) ${value})`;
        }
        if (effectType === 'opacity') {
            return `
          ;; set_effect_volume: set opacity to value (alpha = value/100, transparency = 100 - value)
          (call $setTransparency (i32.const ${entityIndex}) (f64.sub (f64.const 100) ${value}))`;
        }
        return `
          ;; set_effect_volume: ${effectType} (not implemented)
          (drop ${value})`;
    },

    'change_effect_volume': (ctx, block, entityIndex) => {
        // Legacy block - not found in current EntryJS source
        // Expected behavior: alpha += value/100 (for opacity), alpha -= value/100 (for transparency)
        const effectType = block.params?.[0];
        const value = ctx.transpileValue(block.params?.[1], entityIndex);
        if (effectType === 'transparency') {
            return `
          ;; change_effect_volume: change transparency by amount
          (call $changeTransparency (i32.const ${entityIndex}) ${value})`;
        }
        if (effectType === 'opacity') {
            return `
          ;; change_effect_volume: change opacity by amount (alpha += value/100, transparency -= value)
          (call $changeTransparency (i32.const ${entityIndex}) (f64.neg ${value}))`;
        }
        return `
          ;; change_effect_volume: ${effectType} (not implemented)
          (drop ${value})`;
    },

    'clear_effect': (ctx, block, entityIndex) => {
        // Legacy block - maps to Python Entry.clear_effect(), equivalent to erase_all_effects
        return `
          ;; clear_effect (legacy)
          (call $setTransparency (i32.const ${entityIndex}) (f64.const 0))`;
    },

    'dialog': (ctx, block, entityIndex, threadIndex) => {
        const textParam = block.params?.[0];
        const dialogType = block.params?.[1]; // 'speak' or 'think'
        const typeCode = dialogType === 'think' ? 2 : 1; // 0=none, 1=speak, 2=think
        
        // Generate code to create string and set dialog
        let textCode;
        if (textParam && typeof textParam === 'object' && textParam.type === 'text') {
            // It's a text block, get the string from params
            const textStr = String(textParam.params?.[0] ?? '');
            textCode = generateStringAllocation(textStr);
        } else if (typeof textParam === 'string') {
            textCode = generateStringAllocation(textParam);
        } else if (typeof textParam === 'number') {
            textCode = `(call $f64_to_str (f64.const ${textParam}))`;
        } else if (textParam && textParam.type) {
            // It's a value block - convert result to string (use _or_deref to handle string pointers)
            const valueCode = ctx.transpileValue(textParam, entityIndex);
            textCode = `(call $f64_to_str_or_deref ${valueCode})`;
        } else {
            textCode = generateStringAllocation('');
        }
        
        // Use dynamic dispatcher when entityIndex is -1 (inside user function)
        if (entityIndex === -1) {
            return `
          ;; dialog: ${dialogType} (dynamic entity)
          (call $setDialogTextPtrDyn (local.get $entityIdx) ${textCode})
          (call $setDialogTypeDyn (local.get $entityIdx) (i32.const ${typeCode}))`;
        }
        
        return `
          ;; dialog: ${dialogType}
          (call $setDialogTextPtr_${entityIndex} ${textCode})
          (call $setDialogType_${entityIndex} (i32.const ${typeCode}))`;
    },

    'dialog_time': (ctx, block, entityIndex, threadIndex) => {
        const textParam = block.params?.[0];
        const seconds = ctx.transpileValue(block.params?.[1], entityIndex);
        const dialogType = block.params?.[2]; // 'speak' or 'think'
        const typeCode = dialogType === 'think' ? 2 : 1; // 0=none, 1=speak, 2=think
        
        // Generate code to create string and set dialog
        let textCode;
        if (textParam && typeof textParam === 'object' && textParam.type === 'text') {
            const textStr = String(textParam.params?.[0] ?? '');
            textCode = generateStringAllocation(textStr);
        } else if (typeof textParam === 'string') {
            textCode = generateStringAllocation(textParam);
        } else if (typeof textParam === 'number') {
            textCode = `(call $f64_to_str (f64.const ${textParam}))`;
        } else if (textParam && textParam.type) {
            const valueCode = ctx.transpileValue(textParam, entityIndex);
            textCode = `(call $f64_to_str_or_deref ${valueCode})`;
        } else {
            textCode = generateStringAllocation('');
        }
        
        // Use dynamic dispatcher when entityIndex is -1 (inside user function)
        // Note: dialog_time with waiting doesn't work well in user functions since
        // user functions don't have their own thread context, but we still handle it
        if (entityIndex === -1) {
            return `
          ;; dialog_time: ${dialogType} (dynamic entity, waiting not supported in user functions)
          (call $setDialogTextPtrDyn (local.get $entityIdx) ${textCode})
          (call $setDialogTypeDyn (local.get $entityIdx) (i32.const ${typeCode}))`;
        }
        
        return `
          ;; dialog_time: ${dialogType} for ${seconds} seconds
          (call $setDialogTextPtr_${entityIndex} ${textCode})
          (call $setDialogType_${entityIndex} (i32.const ${typeCode}))
          ;; Wait for specified time, then clear dialog
          (global.set $thread_${threadIndex}_waiting ${seconds})`;
    },

    'remove_dialog': (ctx, block, entityIndex) => {
        // Use dynamic dispatcher when entityIndex is -1 (inside user function)
        if (entityIndex === -1) {
            return `
          ;; remove_dialog (dynamic entity)
          (call $setDialogTypeDyn (local.get $entityIdx) (i32.const 0))
          (call $setDialogTextPtrDyn (local.get $entityIdx) (i32.const 0))`;
        }
        
        return `
          ;; remove_dialog
          (call $setDialogType_${entityIndex} (i32.const 0))
          (call $setDialogTextPtr_${entityIndex} (i32.const 0))`;
    },

    'add_effect_amount': (ctx, block, entityIndex) => {
        const effectType = block.params?.[0];
        const value = ctx.transpileValue(block.params?.[1], entityIndex);
        if (effectType === 'transparency') {
            return `
          ;; add_effect_amount: change transparency by amount
          (call $changeTransparency (i32.const ${entityIndex}) ${value})`;
        }
        return `
          ;; add_effect_amount: ${effectType} (not implemented)
          (drop ${value})`;
    },

    'change_effect_amount': (ctx, block, entityIndex) => {
        const effectType = block.params?.[0];
        const value = ctx.transpileValue(block.params?.[1], entityIndex);
        if (effectType === 'transparency') {
            return `
          ;; change_effect_amount: set transparency to absolute value
          (call $setTransparency (i32.const ${entityIndex}) ${value})`;
        }
        return `
          ;; change_effect_amount: ${effectType} (not implemented)
          (drop ${value})`;
    },

    'set_effect_amount': (ctx, block, entityIndex) => {
        // EntryJS: sprite.effect.alpha -= effectValue / 100 (relative change)
        const effectType = block.params?.[0];
        const value = ctx.transpileValue(block.params?.[1], entityIndex);
        if (effectType === 'transparency') {
            return `
          ;; set_effect_amount: change transparency by amount
          (call $changeTransparency (i32.const ${entityIndex}) ${value})`;
        }
        return `
          ;; set_effect_amount: ${effectType} (not implemented)
          (drop ${value})`;
    },

    'erase_all_effects': (ctx, block, entityIndex) => {
        // EntryJS resetFilter() resets all effects (alpha, hue, hsv, brightness, etc.)
        // Currently only transparency is implemented; other effects will need to be reset here when added
        return `
          ;; erase_all_effects
          (call $setTransparency (i32.const ${entityIndex}) (f64.const 0))`;
    },

    'stretch_scale_size': (ctx, block, entityIndex) => {
        // Matching EntryJS setXSize/setYSize: factor = max(1, getSize() + value) / getSize()
        // Then only adjust the relevant axis
        const direction = block.params?.[0];
        const value = ctx.transpileValue(block.params?.[1], entityIndex);
        const scaleFunc = direction === 'WIDTH' ? 'setScaleX' : 'setScaleY';
        const getFunc = direction === 'WIDTH' ? 'getScaleX' : 'getScaleY';
        return `
          ;; stretch_scale_size: ${direction === 'WIDTH' ? 'width' : 'height'} - proportional single-axis scaling
          ;; Cache current size to avoid redundant $getSize computation
          (local.set $temp2 (call $getSize (i32.const ${entityIndex})))
          ;; targetSize = currentSize + value, clamped to min 1
          (local.set $temp (f64.add (local.get $temp2) ${value}))
          (if (f64.lt (local.get $temp) (f64.const 1))
            (then (local.set $temp (f64.const 1))))
          ;; factor = targetSize / currentSize (guard against zero)
          (local.set $temp (f64.div (local.get $temp)
            (select
              (local.get $temp2)
              (f64.const 1)
              (f64.gt (local.get $temp2) (f64.const 0)))))
          ;; scale *= factor (single axis only)
          (call $${scaleFunc} (i32.const ${entityIndex})
            (f64.mul (call $${getFunc} (i32.const ${entityIndex})) (local.get $temp)))`;
    },

    'reset_scale_size': (ctx, block, entityIndex) => {
        // Matching EntryJS resetSize(): restore to scaleOriginX/Y from project init
        return `
          ;; reset_scale_size - restore original scale from project init
          (call $setScaleX (i32.const ${entityIndex}) (call $getScaleOriginX (i32.const ${entityIndex})))
          (call $setScaleY (i32.const ${entityIndex}) (call $getScaleOriginY (i32.const ${entityIndex})))`;
    },

    'flip_x': (ctx, block, entityIndex) => {
        return `
          ;; flip_x - flip horizontally
          (call $setScaleX (i32.const ${entityIndex})
            (f64.mul (call $getScaleX (i32.const ${entityIndex})) (f64.const -1)))`;
    },

    'flip_y': (ctx, block, entityIndex) => {
        return `
          ;; flip_y - flip vertically
          (call $setScaleY (i32.const ${entityIndex})
            (f64.mul (call $getScaleY (i32.const ${entityIndex})) (f64.const -1)))`;
    },

    'change_object_index': (ctx, block, entityIndex) => {
        // Change layer order: front, back, prev (forward), next (backward)
        const direction = block.params?.[0];
        // Layer ordering is handled by renderer, just log for now
        return `
          ;; change_object_index: ${direction}
          ;; (handled by renderer - layer ordering)`;
    },

    'change_object_index_to': (ctx, block, entityIndex) => {
        // Change to specific layer index
        const targetIndex = ctx.transpileValue(block.params?.[0], entityIndex);
        return `
          ;; change_object_index_to
          ;; (handled by renderer - layer ordering)
          (drop ${targetIndex})`;
    },

    'set_effect': (ctx, block, entityIndex) => {
        // EntryJS: sprite.effect.alpha = effectValue / 100 (absolute set, uses 'opacity' param)
        const effectType = block.params?.[0];
        const value = ctx.transpileValue(block.params?.[1], entityIndex);
        if (effectType === 'transparency') {
            return `
          ;; set_effect: set transparency to value
          (call $setTransparency (i32.const ${entityIndex}) ${value})`;
        }
        if (effectType === 'opacity') {
            return `
          ;; set_effect: set opacity to value (alpha = value/100, transparency = 100 - value)
          (call $setTransparency (i32.const ${entityIndex}) (f64.sub (f64.const 100) ${value}))`;
        }
        return `
          ;; set_effect: ${effectType} (not implemented)
          (drop ${value})`;
    },

    'change_effect': (ctx, block, entityIndex) => {
        // Legacy block - not found in current EntryJS source
        // Expected behavior: alpha += value/100 (for opacity), alpha -= value/100 (for transparency)
        const effectType = block.params?.[0];
        const value = ctx.transpileValue(block.params?.[1], entityIndex);
        if (effectType === 'transparency') {
            return `
          ;; change_effect: change transparency by amount
          (call $changeTransparency (i32.const ${entityIndex}) ${value})`;
        }
        if (effectType === 'opacity') {
            return `
          ;; change_effect: change opacity by amount (alpha += value/100, transparency -= value)
          (call $changeTransparency (i32.const ${entityIndex}) (f64.neg ${value}))`;
        }
        return `
          ;; change_effect: ${effectType} (not implemented)
          (drop ${value})`;
    }
};

const valueBlocks = {
    'get_size': (ctx, block, entityIndex) => {
        return `(call $getSize (i32.const ${entityIndex}))`;
    },

    'get_pictures': (ctx, block, entityIndex) => {
        // Returns current picture index (or picture data, simplified to index)
        return `(f64.convert_i32_s (call $getPictureIndex (i32.const ${entityIndex})))`;
    },

    'get_effect_value': (ctx, block, entityIndex) => {
        const effectType = block.params?.[0];
        if (effectType === 'transparency') {
            return `(call $getTransparency (i32.const ${entityIndex}))`;
        }
        if (effectType === 'opacity') {
            return `(f64.sub (f64.const 100) (call $getTransparency (i32.const ${entityIndex})))`;
        }
        return `(f64.const 0)`;
    },

    'current_picture_name': (ctx, block, entityIndex) => {
        // String operations not supported, return picture index as number
        return `(f64.convert_i32_s (call $getPictureIndex (i32.const ${entityIndex})))`;
    }
};

const booleanBlocks = {};

module.exports = { statementBlocks, valueBlocks, booleanBlocks };
