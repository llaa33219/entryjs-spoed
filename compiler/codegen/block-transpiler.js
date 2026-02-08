/**
 * Block Transpiler
 * 
 * Converts EntryJS blocks to WAT (WebAssembly Text) code.
 * Uses modular block handlers from the blocks/ directory.
 */

const {
    statementBlocks,
    valueBlocks,
    booleanBlocks,
    getStatementHandler,
    getValueHandler,
    getBooleanHandler
} = require('./blocks');

class BlockTranspiler {
    constructor(generator) {
        this.generator = generator;
        this.stringLiterals = []; // Track string literals for data section
    }

    /**
     * Create a context object for block handlers
     * @param {number} entityIndex - Current entity index
     * @param {number} threadIndex - Current thread index
     * @param {number} loopDepth - Current loop nesting depth (for thread-based loops)
     * @returns {Object} Context object with helper methods
     */
    createContext(entityIndex, threadIndex, loopDepth = 0) {
        return {
            generator: this.generator,
            entityIndex,
            threadIndex,
            loopDepth,
            transpile: (block, entIdx, thrIdx, lpDepth) => this.transpile(block, entIdx ?? entityIndex, thrIdx ?? threadIndex, lpDepth ?? loopDepth),
            transpileValue: (block, entIdx) => this.transpileValue(block, entIdx ?? entityIndex),
            transpileBoolean: (block, entIdx) => this.transpileBoolean(block, entIdx ?? entityIndex),
            transpileStringValue: (block, entIdx) => this.transpileStringValue(block, entIdx ?? entityIndex),
            isStringValue: (block) => this.isStringValue(block),
            findVariable: (varId) => this.findVariable(varId),
            findList: (listId) => this.findList(listId)
        };
    }

    /**
     * Transpile a block to WAT code
     * @param {Object} block - Parsed block
     * @param {number} entityIndex - Current entity index
     * @param {number} threadIndex - Current thread index
     * @param {number} loopDepth - Current loop nesting depth (for thread-based loops)
     * @returns {string} WAT code
     */
    transpile(block, entityIndex, threadIndex, loopDepth = 0) {
        if (!block || !block.type) return '';

        const handler = getStatementHandler(block.type);
        if (handler) {
            const ctx = this.createContext(entityIndex, threadIndex, loopDepth);
            return handler(ctx, block, entityIndex, threadIndex);
        }

        // Unknown block - add nop with comment (nop ensures valid WAT when inside then/else blocks)
        return `\n          ;; TODO: Unsupported block type: ${block.type}\n          (nop)`;
    }

    /**
     * Transpile a value block (returns f64)
     * @param {*} block - Block or literal value
     * @param {number} entityIndex - Current entity index
     * @returns {string} WAT code that produces f64
     */
    transpileValue(block, entityIndex) {
        if (block === null || block === undefined) {
            return '(f64.const 0)';
        }

        if (typeof block === 'number') {
            return `(f64.const ${block})`;
        }

        if (typeof block === 'string') {
            const num = Number(block);
            if (!isNaN(num) && block.trim() !== '') {
                return `(f64.const ${num})`;
            }
            // String value - return 0 for now (string handling is complex in WASM)
            return '(f64.const 0)';
        }

        if (typeof block === 'object' && block.type) {
            return this.transpileValueBlock(block, entityIndex);
        }

        return '(f64.const 0)';
    }

    /**
     * Transpile a value-returning block
     * @param {Object} block - Parsed block
     * @param {number} entityIndex - Current entity index
     * @returns {string} WAT code that produces f64
     */
    transpileValueBlock(block, entityIndex) {
        const handler = getValueHandler(block.type);
        if (handler) {
            const ctx = this.createContext(entityIndex, 0);
            return handler(ctx, block, entityIndex);
        }

        // Default: return 0
        // Note: Don't use inline comments here as they can break WAT syntax when
        // this value is used as a function argument
        return `(f64.const 0)`;
    }

    /**
     * Transpile a boolean block (returns i32)
     * @param {*} block - Block or literal boolean
     * @param {number} entityIndex - Current entity index
     * @returns {string} WAT code that produces i32 (0 or 1)
     */
    transpileBoolean(block, entityIndex) {
        if (block === null || block === undefined) {
            return '(i32.const 0)';
        }

        if (typeof block === 'boolean') {
            return `(i32.const ${block ? 1 : 0})`;
        }

        if (typeof block === 'object' && block.type) {
            const handler = getBooleanHandler(block.type);
            if (handler) {
                const ctx = this.createContext(entityIndex, 0);
                return handler(ctx, block, entityIndex);
            }
        }

        return '(i32.const 0)';
    }

    /**
     * Transpile a value to a string pointer (i32)
     * This handles both string literals and string-producing blocks
     */
    transpileStringValue(param, entityIndex) {
        if (param === null || param === undefined) {
            return '(i32.const 0)'; // null string pointer
        }

        // String literal - allocate in string pool
        if (typeof param === 'string') {
            const bytes = Buffer.from(param, 'utf8');
            const len = bytes.length;
            
            if (len === 0) {
                return `(call $str_alloc (i32.const 0))`;
            }
            
            // Generate code to allocate string and copy bytes
            let code = `(local.set $temp_str_ptr (call $str_alloc (i32.const ${len})))`;
            for (let i = 0; i < len; i++) {
                code += `\n          (i32.store8 (i32.add (i32.add (local.get $temp_str_ptr) (i32.const 4)) (i32.const ${i})) (i32.const ${bytes[i]}))`;
            }
            code += `\n          (i32.store8 (i32.add (i32.add (local.get $temp_str_ptr) (i32.const 4)) (i32.const ${len})) (i32.const 0))`;
            code += `\n          (local.get $temp_str_ptr)`;
            return code;
        }

        // Number - convert to string
        if (typeof param === 'number') {
            return `(call $f64_to_str (f64.const ${param}))`;
        }

        // Block that produces a string
        if (param && param.type) {
            const blockType = param.type;
            
            // String-producing blocks
            const stringBlocks = [
                'combine_something',
                'char_at',
                'substring',
                'replace_string',
                'change_string_case',
                'text',
                'color',
            ];

            if (stringBlocks.includes(blockType)) {
                return this.transpileStringBlock(param, entityIndex);
            }

            // value_of_index_from_list can return string
            if (blockType === 'value_of_index_from_list') {
                return this.transpileListGetAsStr(param, entityIndex);
            }

            // Function string parameters (stringParam_xxx) - stored as f64, may be negative string pointer
            if (blockType.startsWith('stringParam_')) {
                const numericValue = this.transpileValue(param, entityIndex);
                return `(call $f64_to_str_or_deref ${numericValue})`;
            }

            // Other blocks - treat as numeric and convert to string (or deref if negative string pointer)
            const numericValue = this.transpileValue(param, entityIndex);
            return `(call $f64_to_str_or_deref ${numericValue})`;
        }

        // Default - convert to string
        return `(call $f64_to_str (f64.const 0))`;
    }

    /**
     * Transpile a string-producing block
     */
    transpileStringBlock(block, entityIndex) {
        const ctx = {
            transpileValue: (p) => this.transpileValue(p, entityIndex),
            transpileStringValue: (p) => this.transpileStringValue(p, entityIndex),
            createStringLiteral: (s) => this.createStringLiteral(s),
            generator: this.generator
        };

        switch (block.type) {
            case 'combine_something': {
                const str1 = this.transpileStringValue(block.params?.[1], entityIndex);
                const str2 = this.transpileStringValue(block.params?.[3], entityIndex);
                return `(call $str_concat ${str1} ${str2})`;
            }
            case 'char_at': {
                const strCode = this.transpileStringValue(block.params?.[1], entityIndex);
                const idxCode = this.transpileAsI32(block.params?.[3], entityIndex);
                return `(call $str_char_at_str ${strCode} ${idxCode})`;
            }
            case 'substring': {
                const strCode = this.transpileStringValue(block.params?.[1], entityIndex);
                const startCode = this.transpileAsI32(block.params?.[3], entityIndex);
                const endCode = this.transpileAsI32(block.params?.[5], entityIndex);
                return `(call $str_substring ${strCode} ${startCode} ${endCode})`;
            }
            case 'replace_string': {
                const strCode = this.transpileStringValue(block.params?.[1], entityIndex);
                const oldCode = this.transpileStringValue(block.params?.[3], entityIndex);
                const newCode = this.transpileStringValue(block.params?.[5], entityIndex);
                return `(call $str_replace ${strCode} ${oldCode} ${newCode})`;
            }
            case 'change_string_case': {
                const strCode = this.transpileStringValue(block.params?.[1], entityIndex);
                const mode = (typeof block.params?.[3] === 'string') ? block.params[3].toLowerCase() : 'upper';
                if (mode.includes('lower')) {
                    return `(call $str_to_lower ${strCode})`;
                }
                return `(call $str_to_upper ${strCode})`;
            }
            case 'text': {
                const textValue = block.params?.[0] || '';
                return this.createStringLiteral(textValue.toString());
            }
            case 'color': {
                const colorValue = block.params?.[0] || '#000000';
                return this.createStringLiteral(colorValue.toString());
            }
            default:
                // Unknown string block - return empty string
                return this.createStringLiteral('');
        }
    }

    /**
     * Transpile list get as string
     */
    transpileListGetAsStr(block, entityIndex) {
        const listId = block.params?.[1];
        const list = this.generator.project.variables.lists.find(l => l.id === listId);
        if (!list) {
            return '(i32.const 0)';
        }
        const listIdx = list.memoryIndex;
        const indexParam = block.params?.[0];
        const indexCode = this.transpileListIndex(indexParam, entityIndex);
        return `(call $list_get_as_str (i32.const ${listIdx}) ${indexCode})`;
    }

    /**
     * Transpile list index parameter
     */
    transpileListIndex(indexParam, entityIndex) {
        if (typeof indexParam === 'string') {
            const upper = indexParam.toUpperCase();
            if (upper === 'FIRST') return '(i32.const 0)';
            if (upper === 'LAST') return '(i32.const -1)';
            if (upper === 'RANDOM') return '(i32.const -2)';
            const num = parseInt(indexParam, 10) || 1;
            return `(i32.const ${num})`;
        }
        if (indexParam && indexParam.type) {
            const valueCode = this.transpileValue(indexParam, entityIndex);
            return `(i32.trunc_f64_s ${valueCode})`;
        }
        return '(i32.const 1)';
    }

    /**
     * Transpile a value as i32
     */
    transpileAsI32(param, entityIndex) {
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
            const valueCode = this.transpileValue(param, entityIndex);
            return `(i32.trunc_f64_s ${valueCode})`;
        }
        return '(i32.const 1)';
    }

    /**
     * Create a string literal and return the code to load it
     * For now, we use f64_to_str for numeric literals and inline data for strings
     */
    createStringLiteral(str) {
        if (str === '' || str === null || str === undefined) {
            return '(call $str_alloc (i32.const 0))';
        }
        const addr = this.generator.addStaticString(str);
        return `(i32.const ${addr})`;
    }

    /**
     * Find a variable by ID
     * @param {string} varId - Variable ID
     * @returns {Object|undefined} Variable object with memoryOffset
     */
    findVariable(varId) {
        return this.generator.project.variables.variables.find(v => v.id === varId);
    }

    /**
     * Find a list by ID
     * @param {string} listId - List ID
     * @returns {Object|undefined} List object with memoryIndex, metaOffset, dataOffset
     */
    findList(listId) {
        return this.generator.project.variables.lists.find(l => l.id === listId);
    }

    /**
     * Check if a value parameter represents a string value
     * @param {*} param - The parameter to check
     * @returns {boolean} True if the value is a string
     */
    isStringValue(param) {
        // Check if it's a literal string (non-numeric string)
        if (typeof param === 'string') {
            // If it's a numeric string, it's not a string value
            if (!isNaN(Number(param)) && param.trim() !== '') {
                return false;
            }
            // Special keywords like FIRST, LAST, RANDOM are not string values
            const upper = param.toUpperCase();
            if (['FIRST', 'LAST', 'RANDOM', 'TRUE', 'FALSE'].includes(upper)) {
                return false;
            }
            // Any remaining string (including empty) is a string value
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
                'change_string_case',
                'color'
            ];
            if (pureStringBlocks.includes(param.type)) {
                return true;
            }
            
            // Check for text block with non-numeric content
            if (param.type === 'text') {
                const textVal = param.params?.[0];
                if (typeof textVal === 'string' && (isNaN(Number(textVal)) || textVal.trim() === '')) {
                    return true;
                }
            }
            
            // Note: stringParam_xxx types are stored as f64 in WASM,
            // so they should use numeric comparison, not string comparison
        }
        
        return false;
    }

}

module.exports = { BlockTranspiler };
