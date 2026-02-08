/**
 * Variable Block Handlers
 * 
 * Handles blocks related to variables and lists.
 */

/**
 * Check if a value parameter represents a string value
 * @param {*} param - The parameter to check
 * @returns {boolean} True if the value is a string
 */
function isStringValueHelper(param) {
    // Check if it's a literal string (non-numeric string)
    if (typeof param === 'string') {
        // If it's a numeric string, it's not a string value
        if (!isNaN(parseFloat(param)) && isFinite(param)) {
            return false;
        }
        // Special keywords like FIRST, LAST, RANDOM are not string values
        const upper = param.toUpperCase();
        if (['FIRST', 'LAST', 'RANDOM', 'TRUE', 'FALSE'].includes(upper)) {
            return false;
        }
        // Any other non-empty string is a string value
        return true;
    }
    
    // Check if it's a string-producing block
    if (param && typeof param === 'object' && param.type) {
        // These blocks produce strings (return i32 string pointer)
        const pureStringBlocks = [
            'combine_something',
            'char_at', 
            'substring',
            'replace_string',
            'change_string_case'
        ];
        return pureStringBlocks.includes(param.type);
    }
    
    return false;
}

/**
 * Transpile a value parameter as a string pointer (i32)
 * @param {Object} ctx - The transpiler context
 * @param {*} param - The parameter to transpile
 * @param {number} entityIndex - Current entity index
 * @returns {string} WAT code returning i32 string pointer
 */
function transpileStringValueHelper(ctx, param, entityIndex) {
    // If it's a literal string, allocate it in the string pool
    if (typeof param === 'string') {
        const bytes = Buffer.from(param, 'utf8');
        const len = bytes.length;
        
        if (len === 0) {
            // Empty string
            return `(call $str_alloc (i32.const 0))`;
        }
        
        // Generate code to allocate string and copy bytes
        // Uses $temp_str_ptr local variable
        let code = `(local.set $temp_str_ptr (call $str_alloc (i32.const ${len})))`;
        for (let i = 0; i < len; i++) {
            code += `\n          (i32.store8 (i32.add (i32.add (local.get $temp_str_ptr) (i32.const 4)) (i32.const ${i})) (i32.const ${bytes[i]}))`;
        }
        // Null terminate
        code += `\n          (i32.store8 (i32.add (i32.add (local.get $temp_str_ptr) (i32.const 4)) (i32.const ${len})) (i32.const 0))`;
        code += `\n          (local.get $temp_str_ptr)`;
        
        return code;
    }
    
    // If it's a string-producing block (combine_something, char_at, etc.)
    // Use transpileStringValue from block-transpiler which properly handles string blocks
    if (param && typeof param === 'object' && param.type) {
        const stringBlocks = [
            'combine_something',
            'char_at', 
            'substring',
            'replace_string',
            'change_string_case',
            'text'
        ];
        if (stringBlocks.includes(param.type)) {
            // Use the BlockTranspiler's transpileStringBlock method via generator
            // ctx.generator is the WATGenerator which has blockTranspiler
            if (ctx.generator && ctx.generator.blockTranspiler) {
                return ctx.generator.blockTranspiler.transpileStringBlock(param, entityIndex);
            }
            // Fallback: convert to string (shouldn't happen)
            return `(call $f64_to_str ${ctx.transpileValue(param, entityIndex)})`;
        }
    }
    
    // Fallback: convert number to string
    return `(call $f64_to_str ${ctx.transpileValue(param, entityIndex)})`;
}

const statementBlocks = {
    'set_variable': (ctx, block, entityIndex) => {
        const varId = block.params?.[0];
        const value = ctx.transpileValue(block.params?.[1], entityIndex);
        const variable = ctx.findVariable(varId);
        if (variable) {
            return `
          ;; set_variable: ${variable.name}
          (call $setVariable (i32.const ${variable.memoryOffset}) ${value})`;
        }
        return `\n          ;; set_variable: variable not found`;
    },

    'change_variable': (ctx, block, entityIndex) => {
        const varId = block.params?.[0];
        const value = ctx.transpileValue(block.params?.[1], entityIndex);
        const variable = ctx.findVariable(varId);
        if (variable) {
            return `
          ;; change_variable: ${variable.name}
          (call $setVariable (i32.const ${variable.memoryOffset})
            (f64.add (call $getVariable (i32.const ${variable.memoryOffset})) ${value}))`;
        }
        return `\n          ;; change_variable: variable not found`;
    },

    'show_variable': (ctx, block, entityIndex) => {
        const varId = block.params?.[0];
        const variable = ctx.findVariable(varId);
        if (variable) {
            return `
          ;; show_variable: ${variable.name}
          (call $setVarVisible_${variable.memoryIndex} (i32.const 1))`;
        }
        return `\n          ;; show_variable: variable not found`;
    },

    'hide_variable': (ctx, block, entityIndex) => {
        const varId = block.params?.[0];
        const variable = ctx.findVariable(varId);
        if (variable) {
            return `
          ;; hide_variable: ${variable.name}
          (call $setVarVisible_${variable.memoryIndex} (i32.const 0))`;
        }
        return `\n          ;; hide_variable: variable not found`;
    },

    // Function local variable operations
    'set_func_variable': (ctx, block, entityIndex) => {
        const varId = block.params?.[0];
        const value = ctx.transpileValue(block.params?.[1], entityIndex);
        const localVarMap = ctx.generator.currentFuncLocalVarMap;
        
        if (localVarMap && varId in localVarMap) {
            const localIdx = localVarMap[varId];
            return `
          ;; set_func_variable
          (local.set $local_${localIdx} ${value})`;
        }
        return `\n          ;; set_func_variable: variable not found (${varId})`;
    },

    // List operations
    'add_value_to_list': (ctx, block, entityIndex) => {
        const valueParam = block.params?.[0];
        const listId = block.params?.[1];
        const list = ctx.findList(listId);
        if (!list) {
            const value = ctx.transpileValue(valueParam, entityIndex);
            return `
          ;; add_value_to_list: list not found (${listId})
          (drop ${value})`;
        }
        
        // Check if value is a string block (combine_something, char_at, etc.) or literal string
        const isStringValue = isStringValueHelper(valueParam);
        
        if (isStringValue) {
            const strPtr = transpileStringValueHelper(ctx, valueParam, entityIndex);
            return `
          ;; add_value_to_list (string): ${list.name}
          (call $list_push_str (i32.const ${list.memoryIndex}) ${strPtr})`;
        } else {
            const value = ctx.transpileValue(valueParam, entityIndex);
            return `
          ;; add_value_to_list: ${list.name}
          (call $list_push (i32.const ${list.memoryIndex}) ${value})`;
        }
    },

    'remove_value_from_list': (ctx, block, entityIndex) => {
        const indexParam = block.params?.[0];
        const listId = block.params?.[1];
        const list = ctx.findList(listId);
        if (!list) {
            const index = ctx.transpileValue(indexParam, entityIndex);
            return `
          ;; remove_value_from_list: list not found (${listId})
          (drop ${index})`;
        }
        
        const listIdx = list.memoryIndex;
        
        // Handle special index values: "FIRST", "LAST", "RANDOM"
        if (typeof indexParam === 'string') {
            const indexUpper = indexParam.toUpperCase();
            if (indexUpper === 'FIRST') {
                return `
          ;; remove_value_from_list: ${list.name} (first)
          (call $list_remove (i32.const ${listIdx}) (i32.const 0))`;
            } else if (indexUpper === 'LAST') {
                return `
          ;; remove_value_from_list: ${list.name} (last)
          (call $list_remove (i32.const ${listIdx}) (i32.sub (call $list_length (i32.const ${listIdx})) (i32.const 1)))`;
            } else if (indexUpper === 'RANDOM') {
                return `
          ;; remove_value_from_list: ${list.name} (random)
          (call $list_remove (i32.const ${listIdx}) (i32.trunc_f64_s (call $randomRange (f64.const 0) (f64.sub (f64.convert_i32_s (call $list_length (i32.const ${listIdx}))) (f64.const 1)))))`;
            }
        }
        
        // Normal numeric index (1-based in EntryJS)
        const index = ctx.transpileValue(indexParam, entityIndex);
        return `
          ;; remove_value_from_list: ${list.name}
          (call $list_remove (i32.const ${listIdx}) (i32.trunc_f64_s (f64.sub ${index} (f64.const 1))))`;
    },

    'insert_value_to_list': (ctx, block, entityIndex) => {
        const valueParam = block.params?.[0];
        const listId = block.params?.[1];
        const indexParam = block.params?.[2];
        const list = ctx.findList(listId);
        if (!list) {
            const value = ctx.transpileValue(valueParam, entityIndex);
            const index = ctx.transpileValue(indexParam, entityIndex);
            return `
          ;; insert_value_to_list: list not found (${listId})
          (drop ${value})
          (drop ${index})`;
        }
        
        const listIdx = list.memoryIndex;
        const isStringValue = isStringValueHelper(valueParam);
        const insertFunc = isStringValue ? '$list_insert_str' : '$list_insert';
        const value = isStringValue ? transpileStringValueHelper(ctx, valueParam, entityIndex) : ctx.transpileValue(valueParam, entityIndex);
        
        // Handle special index values
        if (typeof indexParam === 'string') {
            const indexUpper = indexParam.toUpperCase();
            if (indexUpper === 'FIRST') {
                return `
          ;; insert_value_to_list${isStringValue ? ' (string)' : ''}: ${list.name} (first)
          (call ${insertFunc} (i32.const ${listIdx}) (i32.const 0) ${value})`;
            } else if (indexUpper === 'LAST') {
                return `
          ;; insert_value_to_list${isStringValue ? ' (string)' : ''}: ${list.name} (last)
          (call ${insertFunc} (i32.const ${listIdx}) (call $list_length (i32.const ${listIdx})) ${value})`;
            } else if (indexUpper === 'RANDOM') {
                return `
          ;; insert_value_to_list${isStringValue ? ' (string)' : ''}: ${list.name} (random)
          (call ${insertFunc} (i32.const ${listIdx}) (i32.trunc_f64_s (call $randomRange (f64.const 0) (f64.convert_i32_s (call $list_length (i32.const ${listIdx}))))) ${value})`;
            }
        }
        
        // Normal numeric index (1-based in EntryJS)
        const index = ctx.transpileValue(indexParam, entityIndex);
        return `
          ;; insert_value_to_list${isStringValue ? ' (string)' : ''}: ${list.name}
          (call ${insertFunc} (i32.const ${listIdx}) (i32.trunc_f64_s (f64.sub ${index} (f64.const 1))) ${value})`;
    },

    'change_value_list_index': (ctx, block, entityIndex) => {
        const listId = block.params?.[0];
        const indexParam = block.params?.[1];
        const valueParam = block.params?.[2];
        const list = ctx.findList(listId);
        if (!list) {
            const value = ctx.transpileValue(valueParam, entityIndex);
            const index = ctx.transpileValue(indexParam, entityIndex);
            return `
          ;; change_value_list_index: list not found (${listId})
          (drop ${index})
          (drop ${value})`;
        }
        
        const listIdx = list.memoryIndex;
        const isStringValue = isStringValueHelper(valueParam);
        const setFunc = isStringValue ? '$list_set_str' : '$list_set';
        const value = isStringValue ? transpileStringValueHelper(ctx, valueParam, entityIndex) : ctx.transpileValue(valueParam, entityIndex);
        
        // Handle special index values
        if (typeof indexParam === 'string') {
            const indexUpper = indexParam.toUpperCase();
            if (indexUpper === 'FIRST') {
                return `
          ;; change_value_list_index${isStringValue ? ' (string)' : ''}: ${list.name} (first)
          (call ${setFunc} (i32.const ${listIdx}) (i32.const 0) ${value})`;
            } else if (indexUpper === 'LAST') {
                return `
          ;; change_value_list_index${isStringValue ? ' (string)' : ''}: ${list.name} (last)
          (call ${setFunc} (i32.const ${listIdx}) (i32.sub (call $list_length (i32.const ${listIdx})) (i32.const 1)) ${value})`;
            } else if (indexUpper === 'RANDOM') {
                return `
          ;; change_value_list_index${isStringValue ? ' (string)' : ''}: ${list.name} (random)
          (call ${setFunc} (i32.const ${listIdx}) (i32.trunc_f64_s (call $randomRange (f64.const 0) (f64.sub (f64.convert_i32_s (call $list_length (i32.const ${listIdx}))) (f64.const 1)))) ${value})`;
            }
        }
        
        // Normal numeric index (1-based in EntryJS)
        const index = ctx.transpileValue(indexParam, entityIndex);
        return `
          ;; change_value_list_index${isStringValue ? ' (string)' : ''}: ${list.name}
          (call ${setFunc} (i32.const ${listIdx}) (i32.trunc_f64_s (f64.sub ${index} (f64.const 1))) ${value})`;
    },

    'delete_all_list': (ctx, block, entityIndex) => {
        const listId = block.params?.[0];
        const list = ctx.findList(listId);
        if (list) {
            return `
          ;; delete_all_list: ${list.name}
          (call $list_clear (i32.const ${list.memoryIndex}))`;
        }
        return `
          ;; delete_all_list: list not found (${listId})`;
    },

    'ask_and_wait': (ctx, block, entityIndex, threadIndex) => {
        const question = block.params?.[0];
        return `
          ;; ask_and_wait
          (call $askAndWait (i32.const ${entityIndex}))
          (global.set $thread_${threadIndex}_waiting (f64.const 0.1))`;
    },

    'set_visible_answer': (ctx, block, entityIndex) => {
        const visible = block.params?.[0];
        const visibleCode = (visible === 'SHOW' || visible === true || visible === 'show') ? 1 : 0;
        return `
          ;; set_visible_answer
          (call $setAnswerVisible (i32.const ${visibleCode}))`;
    },

    'show_list': (ctx, block, entityIndex) => {
        const listId = block.params?.[0];
        const list = ctx.findList(listId);
        if (list) {
            return `
          ;; show_list: ${list.name}
          (call $setListVisible_${list.memoryIndex} (i32.const 1))`;
        }
        return `\n          ;; show_list: list not found`;
    },

    'hide_list': (ctx, block, entityIndex) => {
        const listId = block.params?.[0];
        const list = ctx.findList(listId);
        if (list) {
            return `
          ;; hide_list: ${list.name}
          (call $setListVisible_${list.memoryIndex} (i32.const 0))`;
        }
        return `\n          ;; hide_list: list not found`;
    }
};

const valueBlocks = {
    'get_variable': (ctx, block, entityIndex) => {
        const varId = block.params?.[0];
        const variable = ctx.findVariable(varId);
        if (variable) {
            return `(call $getVariable (i32.const ${variable.memoryOffset}))`;
        }
        return '(f64.const 0)';
    },

    // Function local variable operations
    'get_func_variable': (ctx, block, entityIndex) => {
        const varId = block.params?.[0];
        const localVarMap = ctx.generator.currentFuncLocalVarMap;
        
        if (localVarMap && varId in localVarMap) {
            const localIdx = localVarMap[varId];
            return `(local.get $local_${localIdx})`;
        }
        return `(f64.const 0)`;
    },

    'value_of_index_from_list': (ctx, block, entityIndex) => {
        // EntryJS params: [null, listId, null, indexParam]
        const listId = block.params?.[1];
        const indexParam = block.params?.[3];
        const list = ctx.findList(listId);
        if (!list) {
            return '(f64.const 0)';
        }
        
        const listIdx = list.memoryIndex;
        
        // Handle special index values: "FIRST", "LAST", "RANDOM" (EntryJS compatibility)
        if (typeof indexParam === 'string') {
            const indexUpper = indexParam.toUpperCase();
            if (indexUpper === 'FIRST') {
                return `(call $list_get (i32.const ${listIdx}) (i32.const 0))`;
            } else if (indexUpper === 'LAST') {
                return `(call $list_get (i32.const ${listIdx}) (i32.sub (call $list_length (i32.const ${listIdx})) (i32.const 1)))`;
            } else if (indexUpper === 'RANDOM') {
                // Safe random: if list is empty, returns 0; otherwise random index in [0, length-1]
                return `(if (result f64) (i32.eqz (call $list_length (i32.const ${listIdx})))
                  (then (f64.const 0))
                  (else (call $list_get (i32.const ${listIdx}) (i32.trunc_f64_s (call $randomRange (f64.const 0) (f64.sub (f64.convert_i32_s (call $list_length (i32.const ${listIdx}))) (f64.const 1)))))))`;
            }
        }
        
        // Normal numeric index (EntryJS uses 1-based, WASM uses 0-based)
        const index = ctx.transpileValue(indexParam, entityIndex);
        return `(call $list_get (i32.const ${listIdx}) (i32.trunc_f64_s (f64.sub ${index} (f64.const 1))))`;
    },

    'length_of_list': (ctx, block, entityIndex) => {
        // EntryJS params: [null, listId, null]
        const listId = block.params?.[1];
        const list = ctx.findList(listId);
        if (list) {
            return `(f64.convert_i32_s (call $list_length (i32.const ${list.memoryIndex})))`;
        }
        return '(f64.const 0)';
    },

    // Note: is_included_in_list returns i32 for boolean context - see booleanBlocks below

    'get_canvas_input_value': (ctx, block, entityIndex) => {
        return `(call $getAnswer)`;
    }
};

const booleanBlocks = {
    'is_included_in_list': (ctx, block, entityIndex) => {
        const valueParam = block.params?.[0];
        const listId = block.params?.[1];
        const list = ctx.findList(listId);
        if (!list) {
            return '(i32.const 0)';
        }
        
        const isStringValue = isStringValueHelper(valueParam);
        if (isStringValue) {
            const strPtr = transpileStringValueHelper(ctx, valueParam, entityIndex);
            return `(call $list_contains_str (i32.const ${list.memoryIndex}) ${strPtr})`;
        } else {
            const value = ctx.transpileValue(valueParam, entityIndex);
            return `(call $list_contains (i32.const ${list.memoryIndex}) ${value})`;
        }
    }
};

module.exports = { statementBlocks, valueBlocks, booleanBlocks };
