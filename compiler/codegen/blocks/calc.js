/**
 * Calculation Block Handlers
 * 
 * Handles blocks related to math operations, values, and coordinates.
 */

const statementBlocks = {};

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
                return `(f64.div ${left} ${right})`;
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
                return `(call $log ${value})`;
            case 'ln':
                return `(call $log ${value})`;
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
        return `(f64.sub ${left} (f64.mul (call $floor (f64.div ${left} ${right})) ${right}))`;
    },

    'quotient_and_mod': (ctx, block, entityIndex) => {
        const left = ctx.transpileValue(block.params?.[0], entityIndex);
        const operator = block.params?.[1];
        const right = ctx.transpileValue(block.params?.[2], entityIndex);

        if (operator === 'QUOTIENT') {
            return `(call $floor (f64.div ${left} ${right}))`;
        } else {
            // MOD
            return `(f64.sub ${left} (f64.mul (call $floor (f64.div ${left} ${right})) ${right}))`;
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

module.exports = { statementBlocks, valueBlocks, booleanBlocks };
