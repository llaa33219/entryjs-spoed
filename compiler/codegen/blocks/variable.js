/**
 * Variable Block Handlers
 * 
 * Handles blocks related to variables and lists.
 */

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
        return `
          ;; show_variable: ${variable?.name || 'unknown'}
          ;; (handled by renderer)`;
    },

    'hide_variable': (ctx, block, entityIndex) => {
        const varId = block.params?.[0];
        const variable = ctx.findVariable(varId);
        return `
          ;; hide_variable: ${variable?.name || 'unknown'}
          ;; (handled by renderer)`;
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
        const listId = block.params?.[0];
        const value = ctx.transpileValue(block.params?.[1], entityIndex);
        return `
          ;; add_value_to_list
          ;; TODO: Implement list operations
          (drop ${value})`;
    },

    'remove_value_from_list': (ctx, block, entityIndex) => {
        const listId = block.params?.[0];
        const index = ctx.transpileValue(block.params?.[1], entityIndex);
        return `
          ;; remove_value_from_list
          ;; TODO: Implement list operations
          (drop ${index})`;
    },

    'insert_value_to_list': (ctx, block, entityIndex) => {
        const listId = block.params?.[0];
        const value = ctx.transpileValue(block.params?.[1], entityIndex);
        const index = ctx.transpileValue(block.params?.[2], entityIndex);
        return `
          ;; insert_value_to_list
          ;; TODO: Implement list operations
          (drop ${value})
          (drop ${index})`;
    },

    'change_value_list_index': (ctx, block, entityIndex) => {
        const listId = block.params?.[0];
        const index = ctx.transpileValue(block.params?.[1], entityIndex);
        const value = ctx.transpileValue(block.params?.[2], entityIndex);
        return `
          ;; change_value_list_index
          ;; TODO: Implement list operations
          (drop ${index})
          (drop ${value})`;
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
        return `(f64.const 0) ;; func_variable not found: ${varId}`;
    },

    'value_of_index_from_list': (ctx, block, entityIndex) => {
        const listId = block.params?.[0];
        const index = ctx.transpileValue(block.params?.[1], entityIndex);
        return `
          ;; value_of_index_from_list - TODO: Implement
          (f64.const 0)`;
    },

    'length_of_list': (ctx, block, entityIndex) => {
        const listId = block.params?.[0];
        return `
          ;; length_of_list - TODO: Implement
          (f64.const 0)`;
    },

    'is_included_in_list': (ctx, block, entityIndex) => {
        const listId = block.params?.[0];
        const value = ctx.transpileValue(block.params?.[1], entityIndex);
        return `
          ;; is_included_in_list - TODO: Implement
          (i32.const 0)`;
    }
};

const booleanBlocks = {
    'is_included_in_list': (ctx, block, entityIndex) => {
        const listId = block.params?.[0];
        const value = ctx.transpileValue(block.params?.[1], entityIndex);
        return `
          ;; is_included_in_list - TODO: Implement
          (i32.const 0)`;
    }
};

module.exports = { statementBlocks, valueBlocks, booleanBlocks };
