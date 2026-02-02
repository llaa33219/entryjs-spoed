/**
 * Block Registry
 * 
 * Combines all block handlers from category files into unified registries.
 * This allows adding new blocks by simply creating new category files
 * or adding handlers to existing category files.
 */

const movement = require('./movement');
const looks = require('./looks');
const flow = require('./flow');
const variable = require('./variable');
const calc = require('./calc');
const judgement = require('./judgement');
const sound = require('./sound');
const event = require('./event');
const brush = require('./brush');

// List of all block categories
const categories = [
    movement,
    looks,
    flow,
    variable,
    calc,
    judgement,
    sound,
    event,
    brush
];

/**
 * Combined statement block handlers
 * Statement blocks are blocks that perform actions (no return value)
 */
const statementBlocks = {};

/**
 * Combined value block handlers
 * Value blocks return f64 values
 */
const valueBlocks = {};

/**
 * Combined boolean block handlers
 * Boolean blocks return i32 (0 or 1)
 */
const booleanBlocks = {};

// Merge all category handlers
for (const category of categories) {
    if (category.statementBlocks) {
        Object.assign(statementBlocks, category.statementBlocks);
    }
    if (category.valueBlocks) {
        Object.assign(valueBlocks, category.valueBlocks);
    }
    if (category.booleanBlocks) {
        Object.assign(booleanBlocks, category.booleanBlocks);
    }
}

/**
 * Get handler for a statement block
 * @param {string} blockType - The block type
 * @returns {Function|undefined} The handler function
 */
function getStatementHandler(blockType) {
    return statementBlocks[blockType];
}

/**
 * Get handler for a value block
 * @param {string} blockType - The block type
 * @returns {Function|undefined} The handler function
 */
function getValueHandler(blockType) {
    return valueBlocks[blockType];
}

/**
 * Get handler for a boolean block
 * @param {string} blockType - The block type
 * @returns {Function|undefined} The handler function
 */
function getBooleanHandler(blockType) {
    return booleanBlocks[blockType];
}

/**
 * Check if a block type is a statement block
 * @param {string} blockType - The block type
 * @returns {boolean}
 */
function isStatementBlock(blockType) {
    return blockType in statementBlocks;
}

/**
 * Check if a block type is a value block
 * @param {string} blockType - The block type
 * @returns {boolean}
 */
function isValueBlock(blockType) {
    return blockType in valueBlocks;
}

/**
 * Check if a block type is a boolean block
 * @param {string} blockType - The block type
 * @returns {boolean}
 */
function isBooleanBlock(blockType) {
    return blockType in booleanBlocks;
}

/**
 * Get all registered block types
 * @returns {Object} Object with arrays of block types by category
 */
function getAllBlockTypes() {
    return {
        statement: Object.keys(statementBlocks),
        value: Object.keys(valueBlocks),
        boolean: Object.keys(booleanBlocks)
    };
}

module.exports = {
    statementBlocks,
    valueBlocks,
    booleanBlocks,
    getStatementHandler,
    getValueHandler,
    getBooleanHandler,
    isStatementBlock,
    isValueBlock,
    isBooleanBlock,
    getAllBlockTypes
};
