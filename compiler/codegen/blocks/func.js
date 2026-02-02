/**
 * Function Block Handlers
 * 
 * Handles blocks related to custom functions (함수).
 * - func_<id>: Dynamic function call blocks
 * - Function parameters (stringParam_*, booleanParam_*)
 */

/**
 * Parse a hex color string and return packed color value or null if not valid hex
 * Supports #RGB (3 chars) and #RRGGBB (6 chars) formats
 * Returns packed color as R*65536 + G*256 + B
 */
function parseHexToPackedColor(str) {
    if (typeof str !== 'string') return null;
    const match = str.match(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/);
    if (!match) return null;
    
    const hex = match[1];
    let r, g, b;
    if (hex.length === 3) {
        r = parseInt(hex[0] + hex[0], 16);
        g = parseInt(hex[1] + hex[1], 16);
        b = parseInt(hex[2] + hex[2], 16);
    } else {
        r = parseInt(hex.slice(0, 2), 16);
        g = parseInt(hex.slice(2, 4), 16);
        b = parseInt(hex.slice(4, 6), 16);
    }
    return r * 65536 + g * 256 + b;
}

/**
 * Get statement handler for function-related blocks
 * This is called dynamically for func_<id> blocks
 */
const statementBlocks = {
    // Placeholder for dynamic func_<id> blocks
    // These are handled specially in getStatementHandler
};

/**
 * Get value handler for function-related blocks
 * This handles parameter blocks and value-returning functions
 */
const valueBlocks = {
    // Placeholder for dynamic stringParam_* and booleanParam_* blocks
    // These are handled specially in getValueHandler
};

const booleanBlocks = {
    // Placeholder for dynamic booleanParam_* blocks
    // These are handled specially in getBooleanHandler
};

/**
 * Check if a block type is a function call block (func_<id>)
 * @param {string} blockType 
 * @returns {boolean}
 */
function isFunctionCallBlock(blockType) {
    return blockType && blockType.startsWith('func_');
}

/**
 * Check if a block type is a function parameter block
 * @param {string} blockType 
 * @returns {boolean}
 */
function isParamBlock(blockType) {
    return blockType && (
        blockType.startsWith('stringParam_') || 
        blockType.startsWith('booleanParam_')
    );
}

/**
 * Get the function ID from a func_<id> block type
 * @param {string} blockType 
 * @returns {string}
 */
function getFuncIdFromBlockType(blockType) {
    return blockType.replace('func_', '');
}

/**
 * Generate WAT code for calling a user-defined function (statement)
 * @param {Object} ctx - Transpiler context
 * @param {Object} block - The block to transpile
 * @param {number} entityIndex - Current entity index
 * @param {number} threadIndex - Current thread index
 * @returns {string} WAT code
 */
function transpileFunctionCall(ctx, block, entityIndex, threadIndex) {
    const funcId = getFuncIdFromBlockType(block.type);
    const functions = ctx.generator.project?.functions || [];
    const func = functions.find(f => f.id === funcId);
    
    if (!func) {
        return `\n          ;; Function not found: ${funcId}`;
    }

    // Collect arguments from block params
    const args = [];
    
    // block.params contains the argument values passed to the function
    // Skip null params and indicator params (they're not actual arguments)
    if (block.params) {
        for (let i = 0; i < block.params.length; i++) {
            const param = block.params[i];
            if (param !== null && param !== undefined) {
                // Skip indicator params (they have type 'Indicator')
                if (typeof param === 'object' && param.type === 'Indicator') {
                    continue;
                }
                // Check if this is a value that should be transpiled
                if (typeof param === 'object' && param.type) {
                    // Special case: text block with hex color pattern - convert to packed color at compile time
                    if (param.type === 'text' && param.params?.[0]) {
                        const packedColor = parseHexToPackedColor(param.params[0]);
                        if (packedColor !== null) {
                            args.push(`(f64.const ${packedColor})`);
                            continue;
                        }
                    }
                    args.push(ctx.transpileValue(param, entityIndex));
                } else if (typeof param === 'number' || typeof param === 'string') {
                    const numVal = parseFloat(param);
                    if (!isNaN(numVal)) {
                        args.push(`(f64.const ${numVal})`);
                    } else {
                        // Check if string is hex color pattern
                        const packedColor = parseHexToPackedColor(param);
                        if (packedColor !== null) {
                            args.push(`(f64.const ${packedColor})`);
                        } else {
                            args.push('(f64.const 0)');
                        }
                    }
                }
            }
        }
    }

    // Generate the function call
    const argsCode = args.length > 0 ? ' ' + args.join(' ') : '';
    
    // Check if this is a value-returning function
    if (func.type === 'value') {
        // For value functions called as statements, drop the result
        return `
          ;; Call function: ${func.name || funcId}
          (drop (call $user_func_${funcId} (i32.const ${entityIndex})${argsCode}))`;
    } else {
        return `
          ;; Call function: ${func.name || funcId}
          (call $user_func_${funcId} (i32.const ${entityIndex})${argsCode})`;
    }
}

/**
 * Generate WAT code for a value-returning function call
 * @param {Object} ctx - Transpiler context
 * @param {Object} block - The block to transpile
 * @param {number} entityIndex - Current entity index
 * @returns {string} WAT code that produces f64
 */
function transpileFunctionValue(ctx, block, entityIndex) {
    const funcId = getFuncIdFromBlockType(block.type);
    const functions = ctx.generator.project?.functions || [];
    const func = functions.find(f => f.id === funcId);
    
    if (!func) {
        return `(f64.const 0) ;; Function not found: ${funcId}`;
    }

    // Collect arguments
    const args = [];
    if (block.params) {
        for (let i = 0; i < block.params.length; i++) {
            const param = block.params[i];
            if (param !== null && param !== undefined) {
                // Skip indicator params
                if (typeof param === 'object' && param.type === 'Indicator') {
                    continue;
                }
                if (typeof param === 'object' && param.type) {
                    // Special case: text block with hex color pattern - convert to packed color at compile time
                    if (param.type === 'text' && param.params?.[0]) {
                        const packedColor = parseHexToPackedColor(param.params[0]);
                        if (packedColor !== null) {
                            args.push(`(f64.const ${packedColor})`);
                            continue;
                        }
                    }
                    args.push(ctx.transpileValue(param, entityIndex));
                } else if (typeof param === 'number' || typeof param === 'string') {
                    const numVal = parseFloat(param);
                    if (!isNaN(numVal)) {
                        args.push(`(f64.const ${numVal})`);
                    } else {
                        // Check if string is hex color pattern
                        const packedColor = parseHexToPackedColor(param);
                        if (packedColor !== null) {
                            args.push(`(f64.const ${packedColor})`);
                        } else {
                            args.push('(f64.const 0)');
                        }
                    }
                }
            }
        }
    }

    const argsCode = args.length > 0 ? ' ' + args.join(' ') : '';
    return `(call $user_func_${funcId} (i32.const ${entityIndex})${argsCode})`;
}

/**
 * Generate WAT code for a function parameter reference
 * @param {Object} ctx - Transpiler context  
 * @param {Object} block - The parameter block
 * @param {number} entityIndex - Current entity index
 * @returns {string} WAT code
 */
function transpileParamValue(ctx, block, entityIndex) {
    // Parameter blocks reference local variables in the WASM function
    const paramType = block.type;
    
    // Extract param index from the generator's current function context
    const paramIndex = ctx.generator.currentFuncParamMap?.[paramType];
    
    if (paramIndex !== undefined) {
        return `(local.get $param_${paramIndex})`;
    }
    
    return `(f64.const 0) ;; Unknown param: ${paramType}`;
}

/**
 * Generate WAT code for a boolean parameter reference
 * @param {Object} ctx - Transpiler context
 * @param {Object} block - The parameter block
 * @param {number} entityIndex - Current entity index
 * @returns {string} WAT code (i32)
 */
function transpileParamBoolean(ctx, block, entityIndex) {
    const paramType = block.type;
    const paramIndex = ctx.generator.currentFuncParamMap?.[paramType];
    
    if (paramIndex !== undefined) {
        // Boolean params are stored as f64, convert to i32 using comparison (safer than trunc)
        return `(f64.ne (local.get $param_${paramIndex}) (f64.const 0))`;
    }
    
    return '(i32.const 0)';
}

module.exports = { 
    statementBlocks, 
    valueBlocks, 
    booleanBlocks,
    isFunctionCallBlock,
    isParamBlock,
    getFuncIdFromBlockType,
    transpileFunctionCall,
    transpileFunctionValue,
    transpileParamValue,
    transpileParamBoolean
};
