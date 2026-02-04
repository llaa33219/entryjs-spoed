/**
 * Calculation Block Handlers
 * 
 * Handles blocks related to math operations, values, and coordinates.
 */

const statementBlocks = {
    'choose_project_timer_action': (ctx, block, entityIndex) => {
        const action = block.params?.[0];
        switch (action) {
            case 'start':
                return `
          ;; choose_project_timer_action: start
          (call $startProjectTimer)`;
            case 'stop':
                return `
          ;; choose_project_timer_action: stop
          (call $stopProjectTimer)`;
            case 'reset':
                return `
          ;; choose_project_timer_action: reset
          (call $resetProjectTimer)`;
            default:
                return `
          ;; choose_project_timer_action: ${action}
          (call $startProjectTimer)`;
        }
    },

    'reset_project_timer': (ctx, block, entityIndex) => {
        return `
          ;; reset_project_timer
          (call $resetProjectTimer)`;
    },

    'set_visible_project_timer': (ctx, block, entityIndex) => {
        const visibility = block.params?.[0];
        const isVisible = visibility === 'SHOW' || visibility === 'show' ? 1 : 0;
        return `
          ;; set_visible_project_timer: ${visibility}
          (call $setProjectTimerVisible (i32.const ${isVisible}))`;
    }
};

const valueBlocks = {
    'number': (ctx, block, entityIndex) => {
        const value = parseFloat(block.params?.[0]) || 0;
        return `(f64.const ${value})`;
    },

    'text': (ctx, block, entityIndex) => {
        const value = parseFloat(block.params?.[0]);
        if (!isNaN(value)) {
            return `(f64.const ${value})`;
        }
        return '(f64.const 0)';
    },

    'angle': (ctx, block, entityIndex) => {
        const value = parseFloat(block.params?.[0]) || 0;
        return `(f64.const ${value})`;
    },

    'calc_basic': (ctx, block, entityIndex) => {
        const left = ctx.transpileValue(block.params?.[0], entityIndex);
        const operator = block.params?.[1];
        const right = ctx.transpileValue(block.params?.[2], entityIndex);

        switch (operator) {
            case 'PLUS':
                return `(f64.add ${left} ${right})`;
            case 'MINUS':
                return `(f64.sub ${left} ${right})`;
            case 'MULTI':
                return `(f64.mul ${left} ${right})`;
            case 'DIVIDE':
                // Protect against division by zero - return 0 if divisor is 0
                return `(if (result f64) (f64.eq ${right} (f64.const 0)) (then (f64.const 0)) (else (f64.div ${left} ${right})))`;
            default:
                return `(f64.add ${left} ${right})`;
        }
    },

    'calc_rand': (ctx, block, entityIndex) => {
        const min = ctx.transpileValue(block.params?.[1], entityIndex);
        const max = ctx.transpileValue(block.params?.[3], entityIndex);
        return `(call $randomInt ${min} ${max})`;
    },

    'coordinate_mouse': (ctx, block, entityIndex) => {
        const coord = block.params?.[1];
        if (coord === 'x') {
            return '(call $getMouseX)';
        } else {
            return '(call $getMouseY)';
        }
    },

    'coordinate_object': (ctx, block, entityIndex) => {
        const targetId = block.params?.[1];
        const property = block.params?.[3];
        
        // Find target entity index
        let targetIndex = entityIndex;
        if (targetId !== 'self') {
            const idx = ctx.generator.project.objects.findIndex(o => o.id === targetId);
            if (idx >= 0) targetIndex = idx;
        }

        switch (property) {
            case 'x':
                return `(call $getX (i32.const ${targetIndex}))`;
            case 'y':
                return `(call $getY (i32.const ${targetIndex}))`;
            case 'rotation':
                return `(call $getRotation (i32.const ${targetIndex}))`;
            case 'direction':
                return `(call $getDirection (i32.const ${targetIndex}))`;
            case 'size':
                return `(call $getSize (i32.const ${targetIndex}))`;
            default:
                return '(f64.const 0)';
        }
    },

    'calc_operation': (ctx, block, entityIndex) => {
        const value = ctx.transpileValue(block.params?.[1], entityIndex);
        const operation = block.params?.[3];

        switch (operation) {
            case 'square':
                return `(f64.mul ${value} ${value})`;
            case 'root':
                return `(call $sqrt ${value})`;
            case 'abs':
                return `(call $abs ${value})`;
            case 'floor':
                return `(call $floor ${value})`;
            case 'ceil':
                return `(call $ceil ${value})`;
            case 'round':
                return `(call $floor (f64.add ${value} (f64.const 0.5)))`;
            case 'sin':
                return `(call $sin (f64.mul ${value} (f64.const 0.017453292519943295)))`;
            case 'cos':
                return `(call $cos (f64.mul ${value} (f64.const 0.017453292519943295)))`;
            case 'tan':
                return `(f64.div (call $sin (f64.mul ${value} (f64.const 0.017453292519943295))) (call $cos (f64.mul ${value} (f64.const 0.017453292519943295))))`;
            case 'asin':
                return `(f64.mul (call $asin ${value}) (f64.const 57.29577951308232))`;
            case 'acos':
                return `(f64.mul (call $acos ${value}) (f64.const 57.29577951308232))`;
            case 'atan':
                return `(f64.mul (call $atan ${value}) (f64.const 57.29577951308232))`;
            case 'log':
                return `(call $mathLog ${value})`;
            case 'ln':
                return `(call $mathLog ${value})`;
            case 'exp':
                return `(call $exp ${value})`;
            case '10^':
                return `(call $pow (f64.const 10) ${value})`;
            default:
                return value;
        }
    },

    'calc_mod': (ctx, block, entityIndex) => {
        const left = ctx.transpileValue(block.params?.[0], entityIndex);
        const right = ctx.transpileValue(block.params?.[2], entityIndex);
        // WASM doesn't have f64 modulo, so we use: a - floor(a/b) * b
        // Protect against division by zero - return 0 if divisor is 0
        return `(if (result f64) (f64.eq ${right} (f64.const 0)) (then (f64.const 0)) (else (f64.sub ${left} (f64.mul (call $floor (f64.div ${left} ${right})) ${right}))))`;
    },

    'quotient_and_mod': (ctx, block, entityIndex) => {
        const left = ctx.transpileValue(block.params?.[0], entityIndex);
        const operator = block.params?.[1];
        const right = ctx.transpileValue(block.params?.[2], entityIndex);

        // Protect against division by zero - return 0 if divisor is 0
        if (operator === 'QUOTIENT') {
            return `(if (result f64) (f64.eq ${right} (f64.const 0)) (then (f64.const 0)) (else (call $floor (f64.div ${left} ${right}))))`;
        } else {
            // MOD
            return `(if (result f64) (f64.eq ${right} (f64.const 0)) (then (f64.const 0)) (else (f64.sub ${left} (f64.mul (call $floor (f64.div ${left} ${right})) ${right}))))`;
        }
    },

    'get_date': (ctx, block, entityIndex) => {
        const type = block.params?.[0];
        // Date functions need to be imported from JS
        return `(call $getDate (i32.const ${type === 'year' ? 0 : type === 'month' ? 1 : type === 'day' ? 2 : type === 'hour' ? 3 : type === 'minute' ? 4 : 5}))`;
    },

    'get_sound_duration': (ctx, block, entityIndex) => {
        const soundId = block.params?.[0];
        const obj = ctx.generator.project.objects[entityIndex];
        const sound = obj?.sounds?.find(s => s.id === soundId);
        return `(f64.const ${sound?.duration || 1})`;
    },

    'length_of_string': (ctx, block, entityIndex) => {
        // String operations are complex in WASM, return placeholder
        return '(f64.const 0)';
    },

    'combine_something': (ctx, block, entityIndex) => {
        // String concatenation is complex in WASM, return placeholder
        return '(f64.const 0)';
    },

    'char_at': (ctx, block, entityIndex) => {
        // String indexing is complex in WASM, return placeholder
        return '(f64.const 0)';
    },

    'substring': (ctx, block, entityIndex) => {
        // String substring is complex in WASM, return placeholder
        return '(f64.const 0)';
    },

    'index_of_string': (ctx, block, entityIndex) => {
        // String search is complex in WASM, return placeholder
        return '(f64.const 0)';
    },

    'replace_string': (ctx, block, entityIndex) => {
        // String replace is complex in WASM, return placeholder
        return '(f64.const 0)';
    },

    'get_project_timer_value': (ctx, block, entityIndex) => {
        return `(call $getProjectTimer)`;
    },

    'distance_something': (ctx, block, entityIndex) => {
        const targetType = block.params?.[0];
        
        if (targetType === 'mouse' || targetType === 'mouse_pointer') {
            // Distance to mouse: sqrt((mx - x)^2 + (my - y)^2)
            return `(call $sqrt
              (f64.add
                (f64.mul
                  (f64.sub (call $getMouseX) (call $getX (i32.const ${entityIndex})))
                  (f64.sub (call $getMouseX) (call $getX (i32.const ${entityIndex}))))
                (f64.mul
                  (f64.sub (call $getMouseY) (call $getY (i32.const ${entityIndex})))
                  (f64.sub (call $getMouseY) (call $getY (i32.const ${entityIndex}))))))`;
        }
        
        // Distance to another object
        let targetIndex = entityIndex;
        if (targetType) {
            const idx = ctx.generator.project.objects.findIndex(o => o.id === targetType);
            if (idx >= 0) targetIndex = idx;
        }
        return `(call $sqrt
              (f64.add
                (f64.mul
                  (f64.sub (call $getX (i32.const ${targetIndex})) (call $getX (i32.const ${entityIndex})))
                  (f64.sub (call $getX (i32.const ${targetIndex})) (call $getX (i32.const ${entityIndex}))))
                (f64.mul
                  (f64.sub (call $getY (i32.const ${targetIndex})) (call $getY (i32.const ${entityIndex})))
                  (f64.sub (call $getY (i32.const ${targetIndex})) (call $getY (i32.const ${entityIndex}))))))`;
    },

    'get_boolean_value': (ctx, block, entityIndex) => {
        // Boolean value - returns 0 or 1 as f64
        const value = ctx.transpileBoolean(block.params?.[0], entityIndex);
        return `(f64.convert_i32_s ${value})`;
    },

    'current_date_time_format': (ctx, block, entityIndex) => {
        // Date/time format - complex string operation, return timestamp
        return '(f64.const 0) ;; current_date_time_format - string not supported';
    },

    // Color conversion - returns packed color as f64 (R*65536 + G*256 + B)
    'change_rgb_to_hex': (ctx, block, entityIndex) => {
        const r = ctx.transpileValue(block.params?.[0], entityIndex);
        const g = ctx.transpileValue(block.params?.[1], entityIndex);
        const b = ctx.transpileValue(block.params?.[2], entityIndex);
        // Pack RGB into single f64: R*65536 + G*256 + B
        // Using floor to ensure integer values
        return `(f64.add
          (f64.add
            (f64.mul (call $floor ${r}) (f64.const 65536))
            (f64.mul (call $floor ${g}) (f64.const 256)))
          (call $floor ${b}))`;
    }
};

const booleanBlocks = {
    'is_number': (ctx, block, entityIndex) => {
        // Check if value is a number
        return '(i32.const 1)';
    },

    'is_string': (ctx, block, entityIndex) => {
        // Check if value is a string
        return '(i32.const 0)';
    }
};

// String operation blocks
const stringBlocks = {
    // Combine/concatenate strings
    // combine_something: params[0] = value1, params[1] = value2
    combine_something: (block, ctx) => {
        const value1 = block.params?.[0];
        const value2 = block.params?.[1];
        
        const str1 = ctx.transpileStringValue(value1);
        const str2 = ctx.transpileStringValue(value2);
        
        return `(call $str_concat ${str1} ${str2})`;
    },

    // Get character at index (1-based)
    // char_at: params[0] = index, params[1] = string
    char_at: (block, ctx) => {
        const indexParam = block.params?.[0];
        const stringParam = block.params?.[1];
        
        const strCode = ctx.transpileStringValue(stringParam);
        const idxCode = transpileAsI32(indexParam, ctx);
        
        return `(call $str_char_at_str ${strCode} ${idxCode})`;
    },

    // Get substring (1-based start and end indices)
    // substring: params[0] = start, params[1] = end, params[2] = string
    substring: (block, ctx) => {
        const startParam = block.params?.[0];
        const endParam = block.params?.[1];
        const stringParam = block.params?.[2];
        
        const strCode = ctx.transpileStringValue(stringParam);
        const startCode = transpileAsI32(startParam, ctx);
        const endCode = transpileAsI32(endParam, ctx);
        
        return `(call $str_substring ${strCode} ${startCode} ${endCode})`;
    },

    // Find index of substring (returns 1-based index, 0 if not found)
    // index_of_string: params[0] = search, params[1] = string
    index_of_string: (block, ctx) => {
        const searchParam = block.params?.[0];
        const stringParam = block.params?.[1];
        
        const strCode = ctx.transpileStringValue(stringParam);
        const searchCode = ctx.transpileStringValue(searchParam);
        
        // Returns i32, convert to f64 for consistency
        return `(f64.convert_i32_s (call $str_index_of ${strCode} ${searchCode}))`;
    },

    // Replace substring
    // replace_string: params[0] = old, params[1] = new, params[2] = string
    replace_string: (block, ctx) => {
        const oldParam = block.params?.[0];
        const newParam = block.params?.[1];
        const stringParam = block.params?.[2];
        
        const strCode = ctx.transpileStringValue(stringParam);
        const oldCode = ctx.transpileStringValue(oldParam);
        const newCode = ctx.transpileStringValue(newParam);
        
        return `(call $str_replace ${strCode} ${oldCode} ${newCode})`;
    },

    // Get string length
    // length_of_string: params[0] = string
    length_of_string: (block, ctx) => {
        const stringParam = block.params?.[0];
        const strCode = ctx.transpileStringValue(stringParam);
        
        // Returns i32, convert to f64 for consistency
        return `(f64.convert_i32_s (call $str_length ${strCode}))`;
    },

    // Change string case
    // change_string_case: params[0] = mode (upper/lower), params[1] = string
    change_string_case: (block, ctx) => {
        const modeParam = block.params?.[0];
        const stringParam = block.params?.[1];
        
        const strCode = ctx.transpileStringValue(stringParam);
        const mode = (typeof modeParam === 'string') ? modeParam.toLowerCase() : 'upper';
        
        if (mode === 'lower' || mode === 'LOWER') {
            return `(call $str_to_lower ${strCode})`;
        } else {
            return `(call $str_to_upper ${strCode})`;
        }
    },

    // Text/string literal - create string from literal value
    // text: params[0] = the text value
    text: (block, ctx) => {
        const textValue = block.params?.[0] || '';
        return ctx.createStringLiteral(textValue.toString());
    },
};

/**
 * Helper function to transpile a value as i32
 */
function transpileAsI32(param, ctx) {
    if (typeof param === 'number') {
        return `(i32.const ${Math.floor(param)})`;
    }
    if (typeof param === 'string') {
        const num = parseInt(param, 10);
        if (!isNaN(num)) {
            return `(i32.const ${num})`;
        }
    }
    if (param && param.type) {
        const valueCode = ctx.transpileValue(param);
        return `(i32.trunc_f64_s ${valueCode})`;
    }
    return '(i32.const 1)';
}

module.exports = { statementBlocks, valueBlocks, booleanBlocks, stringBlocks };
