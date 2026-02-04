/**
 * EntryJS Project Parser
 * 
 * Parses the EntryJS project JSON and extracts:
 * - Objects (sprites) with their entities, pictures, sounds
 * - Scripts (block code) for each object
 * - Variables and lists
 * - Scenes
 * - Messages
 */

/**
 * Parse an EntryJS project JSON into a normalized structure
 * @param {Object} project - The raw project JSON
 * @returns {Object} Parsed project structure
 */
function parseProject(project) {
    const parsed = {
        scenes: parseScenes(project.scenes || []),
        objects: [],
        variables: parseVariables(project.variables || []),
        messages: parseMessages(project.messages || []),
        functions: parseFunctions(project.functions || []),
        speed: project.speed || 60
    };

    // Helper to find scene index by scene ID
    const getSceneIndex = (sceneId) => {
        const idx = parsed.scenes.findIndex(s => s.id === sceneId);
        return idx >= 0 ? idx : 0;
    };

    // Parse objects
    for (const obj of (project.objects || [])) {
        const parsedObj = parseObject(obj);
        // Assign scene index based on object's scene property
        parsedObj.sceneIndex = getSceneIndex(obj.scene);
        parsed.objects.push(parsedObj);
    }

    // Assign unique indices for WASM memory layout
    assignMemoryIndices(parsed);

    return parsed;
}

/**
 * Parse scenes
 */
function parseScenes(scenes) {
    return scenes.map((scene, index) => ({
        id: scene.id,
        name: scene.name,
        index
    }));
}

/**
 * Parse a single object (sprite)
 */
function parseObject(obj) {
    const scripts = parseScripts(obj.script);
    
    return {
        id: obj.id,
        name: obj.name,
        objectType: obj.objectType || 'sprite', // sprite or textBox
        scene: obj.scene,
        rotateMethod: obj.rotateMethod || 'free',
        entity: parseEntity(obj.entity),
        pictures: parsePictures(obj.sprite?.pictures || []),
        sounds: parseSounds(obj.sprite?.sounds || []),
        scripts,
        selectedPictureId: obj.selectedPictureId
    };
}

/**
 * Parse entity (sprite state)
 */
function parseEntity(entity) {
    if (!entity) {
        return {
            x: 0,
            y: 0,
            regX: 0,
            regY: 0,
            scaleX: 1,
            scaleY: 1,
            rotation: 0,
            direction: 90,
            width: 100,
            height: 100,
            visible: true
        };
    }

    return {
        x: entity.x || 0,
        y: entity.y || 0,
        regX: entity.regX || 0,
        regY: entity.regY || 0,
        scaleX: entity.scaleX || 1,
        scaleY: entity.scaleY || 1,
        rotation: entity.rotation || 0,
        direction: entity.direction || 90,
        width: entity.width || 100,
        height: entity.height || 100,
        visible: entity.visible !== false
    };
}

/**
 * Parse pictures
 */
function parsePictures(pictures) {
    return pictures.map((pic, index) => ({
        id: pic.id,
        name: pic.name,
        fileurl: pic.fileurl,
        filename: pic.filename,
        imageType: pic.imageType || 'png',
        dimension: pic.dimension || { width: 100, height: 100 },
        index
    }));
}

/**
 * Parse sounds
 */
function parseSounds(sounds) {
    return sounds.map((sound, index) => ({
        id: sound.id,
        name: sound.name,
        fileurl: sound.fileurl,
        filename: sound.filename,
        ext: sound.ext || '.mp3',
        duration: sound.duration || 1,
        index
    }));
}

/**
 * Parse scripts (block code)
 * Scripts are arrays of threads, each thread is an array of blocks
 */
function parseScripts(script) {
    if (!script) return [];
    
    // script can be a JSON string or already parsed array
    let threads;
    if (typeof script === 'string') {
        try {
            threads = JSON.parse(script);
        } catch (e) {
            return [];
        }
    } else {
        threads = script;
    }

    if (!Array.isArray(threads)) return [];

    return threads.map(thread => parseThread(thread));
}

/**
 * Parse a thread (array of connected blocks)
 */
function parseThread(thread) {
    if (!Array.isArray(thread)) return [];
    return thread.map(block => parseBlock(block));
}

/**
 * Parse a single block
 */
function parseBlock(block) {
    if (!block || typeof block !== 'object') return null;

    const parsed = {
        type: block.type,
        params: [],
        statements: []
    };

    // Parse parameters
    if (block.params) {
        parsed.params = block.params.map(param => {
            if (param === null || param === undefined) return null;
            if (typeof param === 'object' && param.type) {
                // Nested block
                return parseBlock(param);
            }
            return param; // Literal value
        });
    }

    // Parse nested statements (for loops, if/else, etc.)
    if (block.statements) {
        parsed.statements = block.statements.map(stmt => {
            if (Array.isArray(stmt)) {
                return stmt.map(b => parseBlock(b)).filter(b => b !== null);
            }
            return [];
        });
    }

    return parsed;
}

/**
 * Parse variables
 */
function parseVariables(variables) {
    const result = {
        variables: [],
        lists: []
    };

    for (const v of variables) {
        if (v.variableType === 'list') {
            result.lists.push({
                id: v.id,
                name: v.name,
                array: v.array || [],
                visible: v.visible !== false,
                object: v.object // null for global, objectId for local
            });
        } else if (v.variableType === 'variable' || !v.variableType) {
            // Skip timer and answer special variables
            if (v.variableType === 'timer' || v.variableType === 'answer') continue;
            
            result.variables.push({
                id: v.id,
                name: v.name,
                value: v.value || 0,
                visible: v.visible !== false,
                object: v.object
            });
        }
    }

    return result;
}

/**
 * Parse messages
 */
function parseMessages(messages) {
    return messages.map((msg, index) => ({
        id: msg.id,
        name: msg.name,
        index
    }));
}

/**
 * Parse functions (custom blocks)
 */
function parseFunctions(functions) {
    return functions.map((func, index) => {
        // Parse the function content
        let content = [];
        if (func.content) {
            // content can be a Code object, JSON string, or array
            if (typeof func.content === 'string') {
                try {
                    const parsed = JSON.parse(func.content);
                    // Content is usually an array of threads
                    if (Array.isArray(parsed)) {
                        content = parsed.flat().map(block => parseBlock(block)).filter(b => b !== null);
                    }
                } catch (e) {
                    content = [];
                }
            } else if (Array.isArray(func.content)) {
                // Could be array of threads or array of blocks
                content = func.content.flat().map(block => parseBlock(block)).filter(b => b !== null);
            } else if (func.content._data) {
                // Code object format - extract threads
                const threads = func.content._data || [];
                content = threads.flat().map(block => parseBlock(block)).filter(b => b !== null);
            }
        }

        return {
            id: func.id,
            name: func.name || `func_${index}`,
            type: func.type || 'normal', // 'normal' or 'value'
            params: func.params || [],
            localVariables: func.localVariables || [],
            content: content,
            index
        };
    });
}

/**
 * Assign memory indices for WASM memory layout
 * 
 * Memory Layout:
 * - 0-1023: Reserved for system
 * - 1024+: Entity data (each entity uses 120 bytes)
 *   - 0-7: x (f64)
 *   - 8-15: y (f64)
 *   - 16-23: rotation (f64)
 *   - 24-31: direction (f64)
 *   - 32-39: scaleX (f64)
 *   - 40-47: scaleY (f64)
 *   - 48-55: size (f64)
 *   - 56-59: visible (i32)
 *   - 60-63: pictureIndex (i32)
 *   - 64-67: sceneIndex (i32)
 *   - 68-115: brush/fill colors
 *   - 116-119: initialVisible (i32)
 * - After entities: Variables (8 bytes each, f64)
 * - After variables: List metadata (24 bytes per list)
 *   - 0-3: length (i32)
 *   - 4-7: capacity (i32)
 *   - 8-11: data_ptr (i32)
 *   - 12-23: reserved
 * - After list metadata: List data areas (capacity * 16 bytes per list)
 *   - Each element is 16 bytes (8 bytes f64 + 4 bytes type + 4 bytes str_ptr)
 * - After list data: String pool (256KB)
 */
function assignMemoryIndices(parsed) {
    let memOffset = 1024;
    const ENTITY_SIZE = 120;
    const VARIABLE_SIZE = 8;
    const LIST_META_SIZE = 24;
    const LIST_ELEMENT_SIZE = 16; // 8 bytes f64 value + 4 bytes type + 4 bytes str_ptr
    const DEFAULT_LIST_CAPACITY = 1000000;
    const STRING_POOL_SIZE = 262144; // 256KB for string pool

    // Assign entity memory offsets
    parsed.objects.forEach((obj, index) => {
        obj.memoryIndex = index;
        obj.memoryOffset = memOffset;
        memOffset += ENTITY_SIZE;
    });

    // Assign variable memory offsets
    parsed.variables.variables.forEach((v, index) => {
        v.memoryIndex = index;
        v.memoryOffset = memOffset;
        memOffset += VARIABLE_SIZE;
    });

    // Assign list metadata offsets
    const listMetaStart = memOffset;
    parsed.variables.lists.forEach((list, index) => {
        list.memoryIndex = index;
        list.metaOffset = memOffset;
        list.capacity = DEFAULT_LIST_CAPACITY;
        memOffset += LIST_META_SIZE;
    });

    // Assign list data offsets (after all metadata)
    parsed.variables.lists.forEach((list, index) => {
        list.dataOffset = memOffset;
        memOffset += list.capacity * LIST_ELEMENT_SIZE;
    });

    // Calculate string pool start (after all list data)
    const stringPoolStart = memOffset;
    memOffset += STRING_POOL_SIZE;

    // Store list memory info for code generation
    parsed.listMemory = {
        metaStart: listMetaStart,
        metaSize: LIST_META_SIZE,
        elementSize: LIST_ELEMENT_SIZE,
        defaultCapacity: DEFAULT_LIST_CAPACITY
    };

    // Store string pool info
    parsed.stringPool = {
        start: stringPoolStart,
        size: STRING_POOL_SIZE
    };

    parsed.memorySize = Math.ceil(memOffset / 65536) + 1; // In pages (64KB each)
}

module.exports = { parseProject, parseBlock, parseThread };
