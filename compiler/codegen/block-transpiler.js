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
    }

    /**
     * Create a context object for block handlers
     * @param {number} entityIndex - Current entity index
     * @param {number} threadIndex - Current thread index
     * @returns {Object} Context object with helper methods
     */
    createContext(entityIndex, threadIndex) {
        return {
            generator: this.generator,
            entityIndex,
            threadIndex,
            transpile: (block, entIdx, thrIdx) => this.transpile(block, entIdx ?? entityIndex, thrIdx ?? threadIndex),
            transpileValue: (block, entIdx) => this.transpileValue(block, entIdx ?? entityIndex),
            transpileBoolean: (block, entIdx) => this.transpileBoolean(block, entIdx ?? entityIndex),
            findVariable: (varId) => this.findVariable(varId)
        };
    }

    /**
     * Transpile a block to WAT code
     * @param {Object} block - Parsed block
     * @param {number} entityIndex - Current entity index
     * @param {number} threadIndex - Current thread index
     * @returns {string} WAT code
     */
    transpile(block, entityIndex, threadIndex) {
        if (!block || !block.type) return '';

        const handler = getStatementHandler(block.type);
        if (handler) {
            const ctx = this.createContext(entityIndex, threadIndex);
            return handler(ctx, block, entityIndex, threadIndex);
        }

        // Unknown block - add comment
        return `\n          ;; TODO: Unsupported block type: ${block.type}`;
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
            const num = parseFloat(block);
            if (!isNaN(num)) {
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
        return `(f64.const 0) ;; Unsupported value block: ${block.type}`;
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
     * Find a variable by ID
     * @param {string} varId - Variable ID
     * @returns {Object|undefined} Variable object with memoryOffset
     */
    findVariable(varId) {
        return this.generator.project.variables.variables.find(v => v.id === varId);
    }
}

module.exports = { BlockTranspiler };
