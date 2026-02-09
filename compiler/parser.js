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
        visible: entity.visible !== false,
        text: entity.text || '',
        bgColor: entity.bgColor || '#ffffff',
        fontSize: entity.fontSize || 20,
        colour: entity.colour || '#000000',
        font: entity.font || '',
        textAlign: entity.textAlign || 0,
        lineBreak: entity.lineBreak || false,
        underLine: entity.underLine || false,
        strike: entity.strike || false
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
        lists: [],
        timer: null,
        answer: null
    };

    for (const v of variables) {
        if (v.variableType === 'timer') {
            // Match EntryJS generateTimer: x = 240 - (name.length * 12 + 70)
            const timerName = v.name || '\uCD08\uC2DC\uACC4';
            const defaultTimerX = 240 - (timerName.length * 12 + 70);
            result.timer = {
                id: v.id,
                name: v.name,
                value: v.value || 0,
                visible: v.visible !== false,
                x: v.x != null ? v.x : defaultTimerX,
                y: v.y != null ? v.y : -70
            };
        } else if (v.variableType === 'answer') {
            result.answer = {
                id: v.id,
                name: v.name,
                value: v.value || 0,
                visible: v.visible !== false,
                x: v.x != null ? v.x : 150,
                y: v.y != null ? v.y : -100
            };
        } else if (v.variableType === 'list') {
            result.lists.push({
                id: v.id,
                name: v.name,
                array: v.array || [],
                visible: v.visible !== false,
                x: v.x != null ? v.x : 0,
                y: v.y != null ? v.y : 0,
                width: v.width || 100,
                height: v.height || 120,
                object: v.object
            });
        } else if (v.variableType === 'slide') {
            result.variables.push({
                id: v.id,
                name: v.name,
                value: v.value || 0,
                visible: v.visible !== false,
                x: v.x != null ? v.x : 0,
                y: v.y != null ? v.y : 0,
                object: v.object,
                variableType: 'slide',
                minValue: parseFloat(v.minValue) || 0,
                maxValue: parseFloat(v.maxValue) || 100
            });
        } else {
            result.variables.push({
                id: v.id,
                name: v.name,
                value: v.value || 0,
                visible: v.visible !== false,
                x: v.x != null ? v.x : 0,
                y: v.y != null ? v.y : 0,
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
 * - 1024+: Entity data (each entity uses 152 bytes)
 *   - 0-7: x (f64)
 *   - 8-15: y (f64)
 *   - 16-23: rotation (f64)
 *   - 24-31: direction (f64)
 *   - 32-39: scaleX (f64)
 *   - 40-47: scaleY (f64)
 *   - 48-55: (reserved, formerly size)
 *   - 56-59: visible (i32)
 *   - 60-63: pictureIndex (i32)
 *   - 64-67: sceneIndex (i32)
 *   - 68-115: brush/fill colors
 *   - 116-119: initialVisible (i32)
 *   - 120-127: width (f64)
 *   - 128-135: height (f64)
 *   - 136-143: scaleOriginX (f64)
 *   - 144-151: scaleOriginY (f64)
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
    const ENTITY_SIZE = 152;
    const VARIABLE_SIZE = 8;
    const LIST_META_SIZE = 24;
    const LIST_ELEMENT_SIZE = 16; // 8 bytes f64 value + 4 bytes type + 4 bytes str_ptr
    const STRING_POOL_SIZE = 64 * 1024 * 1024; // 64MB for temporary string pool
    const PERSISTENT_STRING_POOL_SIZE = 64 * 1024 * 1024; // 64MB for persistent string pool (strings stored in lists)

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
        list.capacity = Math.max((list.array || []).length * 2, 100);
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

    // Calculate persistent string pool start (after temp string pool)
    const persistentPoolStart = memOffset;
    memOffset += PERSISTENT_STRING_POOL_SIZE;

    // Store list memory info for code generation
    parsed.listMemory = {
        metaStart: listMetaStart,
        metaSize: LIST_META_SIZE,
        elementSize: LIST_ELEMENT_SIZE
    };

    // Store string pool info
    parsed.stringPool = {
        start: stringPoolStart,
        size: STRING_POOL_SIZE
    };

    // Store persistent string pool info
    parsed.persistentPool = {
        start: persistentPoolStart,
        size: PERSISTENT_STRING_POOL_SIZE
    };

    parsed.heapStart = memOffset;
    parsed.memorySize = Math.ceil(memOffset / 65536) + 1; // In pages (64KB each)
}

module.exports = { parseProject, parseBlock, parseThread };
