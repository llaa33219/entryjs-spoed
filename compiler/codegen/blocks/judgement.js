/**
 * Judgement Block Handlers
 * 
 * Handles blocks related to boolean operations, comparisons, and conditions.
 */

const statementBlocks = {};

const valueBlocks = {};

const booleanBlocks = {
    'True': (ctx, block, entityIndex) => {
        return '(i32.const 1)';
    },

    'False': (ctx, block, entityIndex) => {
        return '(i32.const 0)';
    },

    'boolean_basic_operator': (ctx, block, entityIndex) => {
        const leftParam = block.params?.[0];
        const operator = block.params?.[1];
        const rightParam = block.params?.[2];
        
        // Check if either operand is a string value
        const leftIsString = ctx.isStringValue(leftParam);
        const rightIsString = ctx.isStringValue(rightParam);
        
        // If either is a string, use string comparison for EQUAL/NOT_EQUAL
        if ((leftIsString || rightIsString) && (operator === 'EQUAL' || operator === 'NOT_EQUAL')) {
            const leftStr = ctx.transpileStringValue(leftParam, entityIndex);
            const rightStr = ctx.transpileStringValue(rightParam, entityIndex);
            
            if (operator === 'EQUAL') {
                return `(call $str_equals ${leftStr} ${rightStr})`;
            } else {
                return `(i32.eqz (call $str_equals ${leftStr} ${rightStr}))`;
            }
        }
        
        // Numeric comparison
        const left = ctx.transpileValue(leftParam, entityIndex);
        const right = ctx.transpileValue(rightParam, entityIndex);

        switch (operator) {
            case 'EQUAL':
                return `(f64.eq ${left} ${right})`;
            case 'NOT_EQUAL':
                return `(f64.ne ${left} ${right})`;
            case 'GREATER':
                return `(f64.gt ${left} ${right})`;
            case 'LESS':
                return `(f64.lt ${left} ${right})`;
            case 'GREATER_OR_EQUAL':
                return `(f64.ge ${left} ${right})`;
            case 'LESS_OR_EQUAL':
                return `(f64.le ${left} ${right})`;
            default:
                return '(i32.const 0)';
        }
    },

    'boolean_and_or': (ctx, block, entityIndex) => {
        const left = ctx.transpileBoolean(block.params?.[0], entityIndex);
        const operator = block.params?.[1];
        const right = ctx.transpileBoolean(block.params?.[2], entityIndex);

        if (operator === 'AND') {
            return `(i32.and ${left} ${right})`;
        } else {
            return `(i32.or ${left} ${right})`;
        }
    },

    'boolean_not': (ctx, block, entityIndex) => {
        const value = ctx.transpileBoolean(block.params?.[1], entityIndex);
        return `(i32.eqz ${value})`;
    },

    'is_clicked': (ctx, block, entityIndex) => {
        return '(call $isMouseClicked)';
    },

    'is_press_some_key': (ctx, block, entityIndex) => {
        const keycode = parseInt(block.params?.[0]) || 0;
        return `(call $isKeyPressed (i32.const ${keycode}))`;
    },

    'is_object_clicked': (ctx, block, entityIndex) => {
        const targetId = block.params?.[0];
        let targetIndex = entityIndex;
        if (targetId && targetId !== 'self') {
            const idx = ctx.generator.project.objects.findIndex(o => o.id === targetId);
            if (idx >= 0) targetIndex = idx;
        }
        return `(call $isObjectClicked (i32.const ${targetIndex}))`;
    },

    'is_touched': (ctx, block, entityIndex) => {
        const targetId = block.params?.[0];
        const targetType = block.params?.[1] || 'object';
        
        if (targetType === 'mouse' || targetId === 'mouse') {
            return `(call $isTouchingMouse (i32.const ${entityIndex}))`;
        } else if (targetType === 'edge' || targetId === 'edge') {
            return `(call $isTouchingEdge (i32.const ${entityIndex}))`;
        } else {
            // Touching another object
            let targetIndex = 0;
            const idx = ctx.generator.project.objects.findIndex(o => o.id === targetId);
            if (idx >= 0) targetIndex = idx;
            return `(call $isTouchingObject (i32.const ${entityIndex}) (i32.const ${targetIndex}))`;
        }
    },

    'boolean_comparison': (ctx, block, entityIndex) => {
        const leftParam = block.params?.[0];
        const operator = block.params?.[1];
        const rightParam = block.params?.[2];
        
        // Check if either operand is a string value for equality comparison
        const leftIsString = ctx.isStringValue(leftParam);
        const rightIsString = ctx.isStringValue(rightParam);
        
        // If either is a string, use string comparison for EQUAL
        if ((leftIsString || rightIsString) && (operator === '=' || operator === 'EQUAL')) {
            const leftStr = ctx.transpileStringValue(leftParam, entityIndex);
            const rightStr = ctx.transpileStringValue(rightParam, entityIndex);
            return `(call $str_equals ${leftStr} ${rightStr})`;
        }
        
        // Numeric comparison
        const left = ctx.transpileValue(leftParam, entityIndex);
        const right = ctx.transpileValue(rightParam, entityIndex);

        switch (operator) {
            case '=':
            case 'EQUAL':
                return `(f64.eq ${left} ${right})`;
            case '>':
            case 'GREATER':
                return `(f64.gt ${left} ${right})`;
            case '<':
            case 'LESS':
                return `(f64.lt ${left} ${right})`;
            case '>=':
            case 'GREATER_OR_EQUAL':
                return `(f64.ge ${left} ${right})`;
            case '<=':
            case 'LESS_OR_EQUAL':
                return `(f64.le ${left} ${right})`;
            default:
                return '(i32.const 0)';
        }
    },

    'reach_something': (ctx, block, entityIndex) => {
        // params[1] contains the target type in some versions
        const targetType = block.params?.[1] || block.params?.[0];
        
        switch (targetType) {
            case 'mouse':
                return `(call $isTouchingMouse (i32.const ${entityIndex}))`;
            case 'wall':
            case 'edge':
                return `(call $isTouchingEdge (i32.const ${entityIndex}))`;
            case 'wall_up':
                return `(call $isTouchingEdgeTop (i32.const ${entityIndex}))`;
            case 'wall_down':
                return `(call $isTouchingEdgeBottom (i32.const ${entityIndex}))`;
            case 'wall_left':
                return `(call $isTouchingEdgeLeft (i32.const ${entityIndex}))`;
            case 'wall_right':
                return `(call $isTouchingEdgeRight (i32.const ${entityIndex}))`;
            default:
                // Could be an object ID
                if (targetType && typeof targetType === 'string') {
                    const idx = ctx.generator.project.objects.findIndex(o => o.id === targetType);
                    if (idx >= 0) {
                        return `(call $isTouchingObject (i32.const ${entityIndex}) (i32.const ${idx}))`;
                    }
                }
                return `(call $isTouchingEdge (i32.const ${entityIndex}))`;
        }
    },

    'is_type': (ctx, block, entityIndex) => {
        const value = ctx.transpileValue(block.params?.[0], entityIndex);
        const typeCheck = block.params?.[1];
        
        // Type checking is complex in WASM, provide simple defaults
        if (typeCheck === 'number') {
            return '(i32.const 1)'; // Assume all values are numbers
        }
        return '(i32.const 0)';
    },

    'boolean_contain': (ctx, block, entityIndex) => {
        const haystackStr = ctx.transpileStringValue(block.params?.[0], entityIndex);
        const needleStr = ctx.transpileStringValue(block.params?.[2], entityIndex);
        return `(i32.gt_s (call $str_index_of ${haystackStr} ${needleStr}) (i32.const 0))`;
    },

    'boolean_start_with': (ctx, block, entityIndex) => {
        const haystackStr = ctx.transpileStringValue(block.params?.[0], entityIndex);
        const needleStr = ctx.transpileStringValue(block.params?.[2], entityIndex);
        return `(i32.eq (call $str_index_of ${haystackStr} ${needleStr}) (i32.const 1))`;
    },

    'boolean_between': (ctx, block, entityIndex) => {
        const value = ctx.transpileValue(block.params?.[0], entityIndex);
        const min = ctx.transpileValue(block.params?.[2], entityIndex);
        const max = ctx.transpileValue(block.params?.[4], entityIndex);
        return `(i32.and (f64.ge ${value} ${min}) (f64.le ${value} ${max}))`;
    },

    'is_boost_mode': (ctx, block, entityIndex) => {
        // Check if in boost mode - always return true for compiled WASM
        return '(i32.const 1)';
    },

    'is_current_device_type': (ctx, block, entityIndex) => {
        const device = block.params?.[0] || 'desktop';
        if (device === 'desktop') {
            // desktop = type is 0 (not mobile and not tablet)
            return `(i32.eqz (call $getDeviceType))`;
        } else if (device === 'tablet') {
            return `(i32.eq (call $getDeviceType) (i32.const 1))`;
        } else {
            // mobile
            return `(i32.eq (call $getDeviceType) (i32.const 2))`;
        }
    },

    'is_touch_supported': (ctx, block, entityIndex) => {
        return '(call $isTouchSupported)';
    },

    'boolean_shell': (ctx, block, entityIndex) => {
        // Boolean wrapper - just return the inner boolean value
        return ctx.transpileBoolean(block.params?.[0], entityIndex);
    },

    'is_clicked_mouse': (ctx, block, entityIndex) => {
        // Check if mouse button is clicked (left/right/both)
        const button = block.params?.[0];
        // For simplicity, just check if any mouse button is clicked
        // In WASM we only track general mouse click state
        return '(call $isMouseClicked)';
    },

    'object_is_visible': (ctx, block, entityIndex) => {
        // Check if object is visible
        const targetId = block.params?.[0];
        let targetIndex = entityIndex;
        if (targetId && targetId !== 'self') {
            const idx = ctx.generator.project.objects.findIndex(o => o.id === targetId);
            if (idx >= 0) targetIndex = idx;
        }
        return `(call $getVisible (i32.const ${targetIndex}))`;
    }
};

module.exports = { statementBlocks, valueBlocks, booleanBlocks };
