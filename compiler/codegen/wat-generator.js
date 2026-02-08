/**
 * WAT (WebAssembly Text Format) Code Generator
 * 
 * Generates WAT code from parsed EntryJS project.
 * The generated WASM module handles all project logic.
 */

const { BlockTranspiler } = require('./block-transpiler');

/**
 * Generate WAT code from parsed project
 * @param {Object} project - Parsed project from parser.js
 * @param {Object} options - Compiler options
 * @returns {string} WAT code
 */
function generateWAT(project, options = {}) {
    const generator = new WATGenerator(project, options);
    return generator.generate();
}

class WATGenerator {
    constructor(project, options) {
        this.project = project;
        this.options = options;
        this.blockTranspiler = new BlockTranspiler(this);
        this.labelCounter = 0;
        this.loopIterCounter = 0; // Counter for unique loop iteration variables in user functions
        this.localVars = new Map();
        this.currentFuncParamMap = null; // Map of param block types to indices
        this.currentFuncLocalVarMap = null; // Map of local variable IDs to indices
        this.currentFuncIsValue = false; // Whether currently generating a value-returning function
        this.threadLoopDepths = []; // Max loop nesting depth for each thread
        this.staticStrings = new Map();
        this.staticStringOffset = 0;
    }

    /**
     * Get a new unique loop iteration variable name
     * Used in user functions to ensure nested loops have separate counters
     * @returns {string} Variable name like "iter_0", "iter_1", etc.
     */
    getNewLoopIterVar() {
        return `iter_${this.loopIterCounter++}`;
    }

    /**
     * Analyze the maximum loop nesting depth in a block tree
     * @param {Object|Array} blockOrBlocks - Block or array of blocks to analyze
     * @param {number} currentDepth - Current nesting depth
     * @returns {number} Maximum nesting depth found
     */
    analyzeLoopNesting(blockOrBlocks, currentDepth = 0) {
        if (!blockOrBlocks) return currentDepth;
        
        const blocks = Array.isArray(blockOrBlocks) ? blockOrBlocks : [blockOrBlocks];
        let maxDepth = currentDepth;
        
        for (const block of blocks) {
            if (!block || !block.type) continue;
            
            // Check if this block is a loop that uses thread loopCounter
            const loopBlocks = ['repeat_basic', 'repeat_while_true', 'repeat_inf'];
            const isLoop = loopBlocks.includes(block.type);
            const newDepth = isLoop ? currentDepth + 1 : currentDepth;
            
            if (newDepth > maxDepth) maxDepth = newDepth;
            
            // Recursively analyze statements
            if (block.statements) {
                for (const stmts of block.statements) {
                    const depth = this.analyzeLoopNesting(stmts, newDepth);
                    if (depth > maxDepth) maxDepth = depth;
                }
            }
            
            // Recursively analyze params (for nested blocks in conditions)
            if (block.params) {
                for (const param of block.params) {
                    if (param && typeof param === 'object' && param.type) {
                        const depth = this.analyzeLoopNesting(param, currentDepth);
                        if (depth > maxDepth) maxDepth = depth;
                    }
                }
            }
        }
        
        return maxDepth;
    }

    /**
     * Analyze all threads and store their max loop nesting depths
     */
    analyzeAllThreadLoopDepths() {
        this.threadLoopDepths = [];
        
        for (const obj of this.project.objects) {
            for (const thread of obj.scripts) {
                if (!thread || thread.length === 0) {
                    this.threadLoopDepths.push(1); // Default to at least 1
                    continue;
                }
                // Skip event block (index 0), analyze body blocks
                const bodyBlocks = thread.slice(1);
                const maxDepth = this.analyzeLoopNesting(bodyBlocks, 0);
                // Ensure at least depth 1 for safety
                this.threadLoopDepths.push(Math.max(1, maxDepth));
            }
        }
    }

    generate() {
        // Analyze loop nesting depths before generating code
        this.analyzeAllThreadLoopDepths();
        
        // Initialize static string tracking
        this.stringPoolStart = this.project.stringPool?.start || 0;
        this.staticStrings = new Map();
        this.staticStringOffset = 0;
        
        // Phase 1: Generate code sections first (discovers static strings)
        const entityFunctions = this.generateEntityFunctions();
        const visibilityAndDialogFunctions = this.generateVisibilityAndDialogFunctions();
        const blockFunctions = this.generateBlockFunctions();
        const messageFunctions = this.generateMessageFunctions();
        const userFunctions = this.generateUserFunctions();
        const threadFunctions = this.generateThreadFunctions();
        const mainLoop = this.generateMainLoop();
        
        // Phase 2: Generate header/structure sections (uses final static string layout)
        const sections = [
            this.generateHeader(),
            this.generateImports(),
            this.generateMemory(),
            this.generateGlobals(),
            entityFunctions,
            visibilityAndDialogFunctions,
            blockFunctions,
            messageFunctions,
            userFunctions,
            threadFunctions,
            mainLoop,
            this.generateDataSection(),
            this.generateExports()
        ];

        return sections.join('\n\n');
    }

    addStaticString(str) {
        if (this.staticStrings.has(str)) {
            return this.staticStrings.get(str).addr;
        }
        const bytes = [];
        for (let i = 0; i < str.length && i < 256; i++) {
            bytes.push(str.charCodeAt(i) & 0xFF);
        }
        const len = bytes.length;
        const addr = this.stringPoolStart + this.staticStringOffset;
        const totalSize = ((4 + len + 1) + 3) & ~3;
        this.staticStrings.set(str, { addr, bytes, len, totalSize });
        this.staticStringOffset += totalSize;
        return addr;
    }

    getEffectivePoolStart() {
        return this.stringPoolStart + (this.staticStringOffset || 0);
    }

    generateDataSection() {
        if (!this.staticStrings || this.staticStrings.size === 0) return '';
        let code = '\n  ;; ===== STATIC STRING DATA =====';
        for (const [str, info] of this.staticStrings) {
            const dataBytes = [];
            dataBytes.push(info.len & 0xFF);
            dataBytes.push((info.len >> 8) & 0xFF);
            dataBytes.push((info.len >> 16) & 0xFF);
            dataBytes.push((info.len >> 24) & 0xFF);
            for (const b of info.bytes) {
                dataBytes.push(b);
            }
            dataBytes.push(0);
            while (dataBytes.length % 4 !== 0) {
                dataBytes.push(0);
            }
            const hexStr = dataBytes.map(b => '\\' + b.toString(16).padStart(2, '0')).join('');
            code += `\n  (data (i32.const ${info.addr}) "${hexStr}")`;
        }
        return code;
    }

    generateHeader() {
        return `(module
  ;; EntryJS Compiled Project
  ;; Generated by EntryJS-to-WASM Compiler
  ;; 
  ;; Memory Layout:
  ;; - 0-63: System state (frame count, time, mouse, keys, etc.)
  ;; - 64-1023: Reserved
  ;; - 1024+: Entity data (136 bytes each)
  ;; - After entities: Variables (8 bytes each)`;
    }

    generateImports() {
        return `
  ;; ===== IMPORTS =====
  ;; Math functions from JS
  (import "math" "sin" (func $sin (param f64) (result f64)))
  (import "math" "cos" (func $cos (param f64) (result f64)))
  (import "math" "sqrt" (func $sqrt (param f64) (result f64)))
  (import "math" "random" (func $random (result f64)))
  (import "math" "floor" (func $floor (param f64) (result f64)))
  (import "math" "ceil" (func $ceil (param f64) (result f64)))
  (import "math" "abs" (func $abs (param f64) (result f64)))
  (import "math" "atan2" (func $atan2 (param f64 f64) (result f64)))
  (import "math" "asin" (func $asin (param f64) (result f64)))
  (import "math" "acos" (func $acos (param f64) (result f64)))
  (import "math" "atan" (func $atan (param f64) (result f64)))
  (import "math" "log" (func $mathLog (param f64) (result f64)))
  (import "math" "exp" (func $exp (param f64) (result f64)))
  (import "math" "pow" (func $pow (param f64 f64) (result f64)))
  
  ;; System callbacks
  (import "system" "log" (func $sysLog (param f64)))
  (import "system" "playSound" (func $playSound (param i32 i32)))
  (import "system" "getDeviceType" (func $getDeviceType (result i32)))
  (import "system" "isTouchSupported" (func $isTouchSupported (result i32)))
  
  ;; Timer functions
  (import "timer" "getProjectTimer" (func $getProjectTimer (result f64)))
  (import "timer" "startProjectTimer" (func $startProjectTimer))
  (import "timer" "stopProjectTimer" (func $stopProjectTimer))
  (import "timer" "resetProjectTimer" (func $resetProjectTimer))
  (import "timer" "setProjectTimerVisible" (func $setProjectTimerVisible (param i32)))
  (import "timer" "getDate" (func $getDate (param i32) (result f64)))
  
  ;; Answer/Input functions
  (import "input" "askAndWait" (func $askAndWait (param i32)))
  (import "input" "getAnswer" (func $getAnswer (result f64)))
  (import "input" "setAnswerVisible" (func $setAnswerVisible (param i32)))
  
  ;; Clone functions
  (import "clone" "createClone" (func $createClone (param i32)))
  (import "clone" "deleteClone" (func $deleteClone (param i32)))
  (import "clone" "removeAllClones" (func $removeAllClones))
  
  ;; Sound functions
  (import "sound" "playSoundAndWait" (func $playSoundAndWait (param i32 i32)))
  (import "sound" "playSoundForSeconds" (func $playSoundForSeconds (param i32 i32 f64)))
  (import "sound" "playSoundFromTo" (func $playSoundFromTo (param i32 i32 f64 f64)))
  (import "sound" "changeSoundVolume" (func $changeSoundVolume (param i32 f64)))
  (import "sound" "setSoundVolume" (func $setSoundVolume (param i32 f64)))
  (import "sound" "getSoundVolume" (func $getSoundVolume (param i32) (result f64)))
  (import "sound" "changeSoundSpeed" (func $changeSoundSpeed (param i32 f64)))
  (import "sound" "setSoundSpeed" (func $setSoundSpeed (param i32 f64)))
  (import "sound" "getSoundSpeed" (func $getSoundSpeed (param i32) (result f64)))
  (import "sound" "playBGM" (func $playBGM (param i32 i32)))
  (import "sound" "stopBGM" (func $stopBGM))
  (import "sound" "stopAllSounds" (func $stopAllSounds))
  
  ;; Dialog functions
  (import "dialog" "showDialog" (func $showDialog (param i32 i32)))
  (import "dialog" "hideDialog" (func $hideDialog (param i32)))
  (import "dialog" "sendMessageAndWait" (func $sendMessageAndWait (param i32)))
  
  ;; Brush/Drawing functions (implemented in JS renderer for performance)
  (import "brush" "startDrawing" (func $startDrawing (param i32)))
  (import "brush" "stopDrawing" (func $stopDrawing (param i32)))
  (import "brush" "stamp" (func $stamp (param i32)))
  (import "brush" "clearBrush" (func $clearBrush))
  ;; Note: setBrushColor and setRandomBrushColor are now internal WASM functions
  ;; Colors are stored in entity memory and read by JS renderer
  (import "brush" "changeBrushThickness" (func $changeBrushThickness (param i32 f64)))
  (import "brush" "setBrushThickness" (func $setBrushThickness (param i32 f64)))
  (import "brush" "changeBrushTransparency" (func $changeBrushTransparency (param i32 f64)))
  (import "brush" "setBrushTransparency" (func $setBrushTransparency (param i32 f64)))
  (import "brush" "startFill" (func $startFill (param i32)))
  (import "brush" "stopFill" (func $stopFill (param i32)))
  ;; Note: setFillColor is now internal - colors stored in entity memory
  (import "brush" "notifyPosition" (func $brushNotifyPosition (param i32 f64 f64)))
  
  ;; Effect functions
  (import "effect" "setTransparency" (func $setTransparency (param i32 f64)))
  (import "effect" "changeTransparency" (func $changeTransparency (param i32 f64)))
  (import "effect" "getTransparency" (func $getTransparency (param i32) (result f64)))
  
  ;; Util functions (JS-implemented for complex operations)
  (import "util" "f64ToString" (func $f64_to_str_import (param f64) (result i32)))`;
    }

    generateMemory() {
        const pages = this.project.memorySize || 2;
        return `
  ;; ===== MEMORY =====
  (memory (export "memory") ${pages})
  
  ;; System state offsets
  ;; 0: frame count (i32)
  ;; 4: running (i32)
  ;; 8: current time ms (f64)
  ;; 16: mouse x (f64)
  ;; 24: mouse y (f64)
  ;; 32: mouse clicked (i32)
  ;; 36: key states base (64 bytes for 512 keys as bits)`;
    }

    generateGlobals() {
        let code = `
  ;; ===== GLOBALS =====
  (global $frameCount (mut i32) (i32.const 0))
  (global $running (mut i32) (i32.const 0))
  (global $deltaTime (mut f64) (f64.const 0.016666))
  (global $currentEntityIndex (mut i32) (i32.const 0))
  (global $currentScene (mut i32) (i32.const 0))
  (global $sceneCount (mut i32) (i32.const ${this.project.scenes.length}))
  (global $sceneJustChanged (mut i32) (i32.const 0))
  (global $prevMouseClicked (mut i32) (i32.const 0))
  (global $clickedEntityIndex (mut i32) (i32.const -1))
  (global $isFirstFrame (mut i32) (i32.const 1))`;
        
        // Add message flag globals
        const messages = this.project.messages || [];
        for (let i = 0; i < messages.length; i++) {
            const msg = messages[i];
            code += `\n  (global $msg_flag_${i} (mut i32) (i32.const 0)) ;; message: ${msg.name}`;
        }
        
        // Add variable visibility globals
        const variables = this.project.variables.variables || [];
        for (let i = 0; i < variables.length; i++) {
            const v = variables[i];
            const initialVisible = v.visible !== false ? 1 : 0;
            code += `\n  (global $var_visible_${i} (mut i32) (i32.const ${initialVisible})) ;; ${v.name}`;
        }
        
        // Add list visibility globals
        const lists = this.project.variables.lists || [];
        for (let i = 0; i < lists.length; i++) {
            const l = lists[i];
            const initialVisible = l.visible !== false ? 1 : 0;
            code += `\n  (global $list_visible_${i} (mut i32) (i32.const ${initialVisible})) ;; ${l.name}`;
        }
        
        // Add dialog globals per entity (type: 0=none, 1=speak, 2=think; textPtr: string pointer)
        for (let i = 0; i < this.project.objects.length; i++) {
            code += `\n  (global $dialog_type_${i} (mut i32) (i32.const 0))`;
            code += `\n  (global $dialog_text_ptr_${i} (mut i32) (i32.const 0))`;
        }
        
        // String pool pointer (bump allocator - starts after static strings)
        code += `\n  (global $str_pool_ptr (mut i32) (i32.const ${this.getEffectivePoolStart()}))`;
        
        // Persistent string pool pointer (for strings stored in lists - never reset per tick)
        code += `\n  (global $persistent_pool_ptr (mut i32) (i32.const ${this.project.persistentPool?.start || 0}))`;
        
        // Add thread execution state globals for each thread
        let threadIndex = 0;
        for (const obj of this.project.objects) {
            for (let i = 0; i < obj.scripts.length; i++) {
                code += `\n  (global $thread_${threadIndex}_pc (mut i32) (i32.const 0))`;
                code += `\n  (global $thread_${threadIndex}_waiting (mut f64) (f64.const 0))`;
                code += `\n  (global $thread_${threadIndex}_active (mut i32) (i32.const 0))`;
                // Generate multiple loop counters based on max nesting depth
                const maxLoopDepth = this.threadLoopDepths[threadIndex] || 1;
                for (let depth = 0; depth < maxLoopDepth; depth++) {
                    code += `\n  (global $thread_${threadIndex}_loopCounter_${depth} (mut i32) (i32.const -1))`;
                }
                code += `\n  (global $thread_${threadIndex}_resumeDepth (mut i32) (i32.const 0))`;
                threadIndex++;
            }
        }

        return code;
    }

    /**
     * Generate accessor functions for variable/list visibility and dialog state
     */
    generateVisibilityAndDialogFunctions() {
        let code = `
  ;; ===== VARIABLE/LIST VISIBILITY FUNCTIONS =====`;
        
        const variables = this.project.variables.variables || [];
        const lists = this.project.variables.lists || [];
        const entityCount = this.project.objects.length;
        
        // Variable visibility accessors
        for (let i = 0; i < variables.length; i++) {
            code += `
  (func $getVarVisible_${i} (result i32) (global.get $var_visible_${i}))
  (func $setVarVisible_${i} (param $v i32) (global.set $var_visible_${i} (local.get $v)))`;
        }
        
        // List visibility accessors
        for (let i = 0; i < lists.length; i++) {
            code += `
  (func $getListVisible_${i} (result i32) (global.get $list_visible_${i}))
  (func $setListVisible_${i} (param $v i32) (global.set $list_visible_${i} (local.get $v)))`;
        }
        
        // Dialog accessors per entity
        code += `
  
  ;; ===== DIALOG FUNCTIONS =====`;
        for (let i = 0; i < entityCount; i++) {
            code += `
  (func $getDialogType_${i} (result i32) (global.get $dialog_type_${i}))
  (func $setDialogType_${i} (param $v i32) (global.set $dialog_type_${i} (local.get $v)))
  (func $getDialogTextPtr_${i} (result i32) (global.get $dialog_text_ptr_${i}))
  (func $setDialogTextPtr_${i} (param $v i32) (global.set $dialog_text_ptr_${i} (local.get $v)))`;
        }
        
        // Dynamic dialog dispatcher functions (for use in user functions where entity index is dynamic)
        if (entityCount > 0) {
            // setDialogTypeDyn - dispatches to correct setDialogType_N based on entity index
            code += `
  
  ;; Dynamic dialog type setter (for user functions)
  (func $setDialogTypeDyn (param $idx i32) (param $v i32)`;
            for (let i = 0; i < entityCount; i++) {
                code += `
    (if (i32.eq (local.get $idx) (i32.const ${i}))
      (then (call $setDialogType_${i} (local.get $v))))`;
            }
            code += `)`;
            
            // setDialogTextPtrDyn - dispatches to correct setDialogTextPtr_N based on entity index
            code += `
  
  ;; Dynamic dialog text pointer setter (for user functions)
  (func $setDialogTextPtrDyn (param $idx i32) (param $v i32)`;
            for (let i = 0; i < entityCount; i++) {
                code += `
    (if (i32.eq (local.get $idx) (i32.const ${i}))
      (then (call $setDialogTextPtr_${i} (local.get $v))))`;
            }
            code += `)`;
        }
        
        return code;
    }

    generateEntityFunctions() {
        const ENTITY_SIZE = 136; // Expanded for brush state + width/height
        return `
  ;; ===== ENTITY ACCESSOR FUNCTIONS =====
  
  ;; Get entity base offset: 1024 + entityIndex * 136
  (func $getEntityOffset (param $idx i32) (result i32)
    (i32.add
      (i32.const 1024)
      (i32.mul (local.get $idx) (i32.const ${ENTITY_SIZE}))))
  
  ;; Entity property getters/setters
  ;; X position (offset 0)
  (func $getX (param $idx i32) (result f64)
    (f64.load (call $getEntityOffset (local.get $idx))))
  
  (func $setX (param $idx i32) (param $val f64)
    (f64.store (call $getEntityOffset (local.get $idx)) (local.get $val)))
  
  ;; Y position (offset 8)
  (func $getY (param $idx i32) (result f64)
    (f64.load (i32.add (call $getEntityOffset (local.get $idx)) (i32.const 8))))
  
  (func $setY (param $idx i32) (param $val f64)
    (f64.store (i32.add (call $getEntityOffset (local.get $idx)) (i32.const 8)) (local.get $val)))
  
  ;; Rotation (offset 16)
  (func $getRotation (param $idx i32) (result f64)
    (f64.load (i32.add (call $getEntityOffset (local.get $idx)) (i32.const 16))))
  
  (func $setRotation (param $idx i32) (param $val f64)
    (f64.store (i32.add (call $getEntityOffset (local.get $idx)) (i32.const 16)) (local.get $val)))
  
  ;; Direction (offset 24)
  (func $getDirection (param $idx i32) (result f64)
    (f64.load (i32.add (call $getEntityOffset (local.get $idx)) (i32.const 24))))
  
  (func $setDirection (param $idx i32) (param $val f64)
    (f64.store (i32.add (call $getEntityOffset (local.get $idx)) (i32.const 24)) (local.get $val)))
  
  ;; ScaleX (offset 32)
  (func $getScaleX (param $idx i32) (result f64)
    (f64.load (i32.add (call $getEntityOffset (local.get $idx)) (i32.const 32))))
  
  (func $setScaleX (param $idx i32) (param $val f64)
    (f64.store (i32.add (call $getEntityOffset (local.get $idx)) (i32.const 32)) (local.get $val)))
  
  ;; ScaleY (offset 40)
  (func $getScaleY (param $idx i32) (result f64)
    (f64.load (i32.add (call $getEntityOffset (local.get $idx)) (i32.const 40))))
  
  (func $setScaleY (param $idx i32) (param $val f64)
    (f64.store (i32.add (call $getEntityOffset (local.get $idx)) (i32.const 40)) (local.get $val)))
  
  ;; Size (offset 48) - unified scale
  (func $getSize (param $idx i32) (result f64)
    (f64.load (i32.add (call $getEntityOffset (local.get $idx)) (i32.const 48))))
  
  (func $setSize (param $idx i32) (param $val f64)
    (f64.store (i32.add (call $getEntityOffset (local.get $idx)) (i32.const 48)) (local.get $val)))
  
  ;; Visible (offset 56, i32)
  (func $getVisible (param $idx i32) (result i32)
    (i32.load (i32.add (call $getEntityOffset (local.get $idx)) (i32.const 56))))
  
  (func $setVisible (param $idx i32) (param $val i32)
    (i32.store (i32.add (call $getEntityOffset (local.get $idx)) (i32.const 56)) (local.get $val)))
  
  ;; Picture index (offset 60, i32)
  (func $getPictureIndex (param $idx i32) (result i32)
    (i32.load (i32.add (call $getEntityOffset (local.get $idx)) (i32.const 60))))
  
  (func $setPictureIndex (param $idx i32) (param $val i32)
    (i32.store (i32.add (call $getEntityOffset (local.get $idx)) (i32.const 60)) (local.get $val)))
  
  ;; Scene index (offset 64, i32) - which scene this entity belongs to
  (func $getSceneIndex (param $idx i32) (result i32)
    (i32.load (i32.add (call $getEntityOffset (local.get $idx)) (i32.const 64))))
  
  (func $setSceneIndex (param $idx i32) (param $val i32)
    (i32.store (i32.add (call $getEntityOffset (local.get $idx)) (i32.const 64)) (local.get $val)))
  
  ;; ===== BRUSH COLOR STATE (stored in entity memory) =====
  ;; BrushColorR (offset 68, f64)
  (func $getBrushColorR (param $idx i32) (result f64)
    (f64.load (i32.add (call $getEntityOffset (local.get $idx)) (i32.const 68))))
  (func $setBrushColorR (param $idx i32) (param $val f64)
    (f64.store (i32.add (call $getEntityOffset (local.get $idx)) (i32.const 68)) (local.get $val)))
  
  ;; BrushColorG (offset 76, f64)
  (func $getBrushColorG (param $idx i32) (result f64)
    (f64.load (i32.add (call $getEntityOffset (local.get $idx)) (i32.const 76))))
  (func $setBrushColorG (param $idx i32) (param $val f64)
    (f64.store (i32.add (call $getEntityOffset (local.get $idx)) (i32.const 76)) (local.get $val)))
  
  ;; BrushColorB (offset 84, f64)
  (func $getBrushColorB (param $idx i32) (result f64)
    (f64.load (i32.add (call $getEntityOffset (local.get $idx)) (i32.const 84))))
  (func $setBrushColorB (param $idx i32) (param $val f64)
    (f64.store (i32.add (call $getEntityOffset (local.get $idx)) (i32.const 84)) (local.get $val)))
  
  ;; FillColorR (offset 92, f64)
  (func $getFillColorR (param $idx i32) (result f64)
    (f64.load (i32.add (call $getEntityOffset (local.get $idx)) (i32.const 92))))
  (func $setFillColorR (param $idx i32) (param $val f64)
    (f64.store (i32.add (call $getEntityOffset (local.get $idx)) (i32.const 92)) (local.get $val)))
  
  ;; FillColorG (offset 100, f64)
  (func $getFillColorG (param $idx i32) (result f64)
    (f64.load (i32.add (call $getEntityOffset (local.get $idx)) (i32.const 100))))
  (func $setFillColorG (param $idx i32) (param $val f64)
    (f64.store (i32.add (call $getEntityOffset (local.get $idx)) (i32.const 100)) (local.get $val)))
  
  ;; FillColorB (offset 108, f64)
  (func $getFillColorB (param $idx i32) (result f64)
    (f64.load (i32.add (call $getEntityOffset (local.get $idx)) (i32.const 108))))
  (func $setFillColorB (param $idx i32) (param $val f64)
    (f64.store (i32.add (call $getEntityOffset (local.get $idx)) (i32.const 108)) (local.get $val)))
  
  ;; InitialVisible (offset 116, i32) - stores the original visible state from project JSON
  ;; This is used by $updateSceneVisibility to preserve hidden-at-start objects
  (func $getInitialVisible (param $idx i32) (result i32)
    (i32.load (i32.add (call $getEntityOffset (local.get $idx)) (i32.const 116))))
  
  (func $setInitialVisible (param $idx i32) (param $val i32)
    (i32.store (i32.add (call $getEntityOffset (local.get $idx)) (i32.const 116)) (local.get $val)))
  
  ;; Width (offset 120, f64) - original image width for bounding box
  (func $getWidth (param $idx i32) (result f64)
    (f64.load (i32.add (call $getEntityOffset (local.get $idx)) (i32.const 120))))
  
  (func $setWidth (param $idx i32) (param $val f64)
    (f64.store (i32.add (call $getEntityOffset (local.get $idx)) (i32.const 120)) (local.get $val)))
  
  ;; Height (offset 128, f64) - original image height for bounding box
  (func $getHeight (param $idx i32) (result f64)
    (f64.load (i32.add (call $getEntityOffset (local.get $idx)) (i32.const 128))))
  
  (func $setHeight (param $idx i32) (param $val f64)
    (f64.store (i32.add (call $getEntityOffset (local.get $idx)) (i32.const 128)) (local.get $val)))
  
  ;; Half-width for bounding box: width * |scaleX| / 2
  (func $getHalfW (param $idx i32) (result f64)
    (f64.div
      (f64.mul (call $getWidth (local.get $idx)) (call $abs (call $getScaleX (local.get $idx))))
      (f64.const 2)))
  
  ;; Half-height for bounding box: height * |scaleY| / 2
  (func $getHalfH (param $idx i32) (result f64)
    (f64.div
      (f64.mul (call $getHeight (local.get $idx)) (call $abs (call $getScaleY (local.get $idx))))
      (f64.const 2)))
  
  ;; Set brush color RGB (convenience function)
  (func $setBrushColorRGB (param $idx i32) (param $r f64) (param $g f64) (param $b f64)
    (call $setBrushColorR (local.get $idx) (local.get $r))
    (call $setBrushColorG (local.get $idx) (local.get $g))
    (call $setBrushColorB (local.get $idx) (local.get $b)))
  
  ;; Set fill color RGB (convenience function)
  (func $setFillColorRGB (param $idx i32) (param $r f64) (param $g f64) (param $b f64)
    (call $setFillColorR (local.get $idx) (local.get $r))
    (call $setFillColorG (local.get $idx) (local.get $g))
    (call $setFillColorB (local.get $idx) (local.get $b)))
  
  ;; Unpack packed color (R*65536 + G*256 + B) and set brush color
  ;; If packed is negative, it's a string pointer (negated) to a hex color string like "#RRGGBB"
  (func $unpackAndSetBrushColor (param $idx i32) (param $packed f64)
    (local $packedInt i32)
    (if (f64.lt (local.get $packed) (f64.const 0))
      (then
        (call $parseHexAndSetBrushColor (local.get $idx)
          (i32.trunc_f64_s (f64.neg (local.get $packed)))))
      (else
        (local.set $packedInt (i32.trunc_f64_s (local.get $packed)))
        (call $setBrushColorR (local.get $idx) 
          (f64.convert_i32_s (i32.and (i32.shr_u (local.get $packedInt) (i32.const 16)) (i32.const 255))))
        (call $setBrushColorG (local.get $idx)
          (f64.convert_i32_s (i32.and (i32.shr_u (local.get $packedInt) (i32.const 8)) (i32.const 255))))
        (call $setBrushColorB (local.get $idx)
          (f64.convert_i32_s (i32.and (local.get $packedInt) (i32.const 255)))))))
  
  ;; Unpack packed color and set fill color
  ;; If packed is negative, it's a string pointer (negated) to a hex color string like "#RRGGBB"
  (func $unpackAndSetFillColor (param $idx i32) (param $packed f64)
    (local $packedInt i32)
    (if (f64.lt (local.get $packed) (f64.const 0))
      (then
        (call $parseHexAndSetFillColor (local.get $idx)
          (i32.trunc_f64_s (f64.neg (local.get $packed)))))
      (else
        (local.set $packedInt (i32.trunc_f64_s (local.get $packed)))
        (call $setFillColorR (local.get $idx)
          (f64.convert_i32_s (i32.and (i32.shr_u (local.get $packedInt) (i32.const 16)) (i32.const 255))))
        (call $setFillColorG (local.get $idx)
          (f64.convert_i32_s (i32.and (i32.shr_u (local.get $packedInt) (i32.const 8)) (i32.const 255))))
        (call $setFillColorB (local.get $idx)
          (f64.convert_i32_s (i32.and (local.get $packedInt) (i32.const 255)))))))
  
  ;; Set random brush color (using WASM random)
  (func $setRandomBrushColorInternal (param $idx i32)
    (call $setBrushColorR (local.get $idx) (call $floor (f64.mul (call $random) (f64.const 256))))
    (call $setBrushColorG (local.get $idx) (call $floor (f64.mul (call $random) (f64.const 256))))
    (call $setBrushColorB (local.get $idx) (call $floor (f64.mul (call $random) (f64.const 256))))
    (call $setFillColorR (local.get $idx) (call $floor (f64.mul (call $random) (f64.const 256))))
    (call $setFillColorG (local.get $idx) (call $floor (f64.mul (call $random) (f64.const 256))))
    (call $setFillColorB (local.get $idx) (call $floor (f64.mul (call $random) (f64.const 256)))))
  
  ;; Helper: Move in direction
  (func $moveInDirection (param $idx i32) (param $distance f64)
    (local $angle f64)
    (local $rad f64)
    ;; angle = rotation + direction - 90
    (local.set $angle 
      (f64.sub
        (f64.add (call $getRotation (local.get $idx)) (call $getDirection (local.get $idx)))
        (f64.const 90)))
    ;; rad = angle * PI / 180
    (local.set $rad (f64.mul (local.get $angle) (f64.const 0.017453292519943295)))
    ;; x += distance * cos(rad)
    (call $setX (local.get $idx)
      (f64.add (call $getX (local.get $idx))
        (f64.mul (local.get $distance) (call $cos (local.get $rad)))))
    ;; y -= distance * sin(rad)
    (call $setY (local.get $idx)
      (f64.sub (call $getY (local.get $idx))
        (f64.mul (local.get $distance) (call $sin (local.get $rad))))))`
        + this.generateUpdateEntityDimensionsFunction();
    }

    generateUpdateEntityDimensionsFunction() {
        let code = `
  
  ;; Update entity width/height based on picture index (for AABB accuracy on picture change)
  (func $updateEntityDimensions (param $idx i32) (param $picIdx i32)
    (local $wrappedIdx i32)`;

        for (let i = 0; i < this.project.objects.length; i++) {
            const obj = this.project.objects[i];
            const pics = obj.pictures || [];
            if (pics.length === 0) continue;

            code += `\n    (if (i32.eq (local.get $idx) (i32.const ${i}))`;
            code += `\n      (then`;

            if (pics.length === 1) {
                const w = pics[0].dimension?.width || 100;
                const h = pics[0].dimension?.height || 100;
                code += `\n        (call $setWidth (local.get $idx) (f64.const ${w}))`;
                code += `\n        (call $setHeight (local.get $idx) (f64.const ${h}))`;
            } else {
                code += `\n        (local.set $wrappedIdx`;
                code += `\n          (i32.rem_u`;
                code += `\n            (i32.add`;
                code += `\n              (i32.rem_s (local.get $picIdx) (i32.const ${pics.length}))`;
                code += `\n              (i32.const ${pics.length}))`;
                code += `\n            (i32.const ${pics.length})))`;

                for (let j = 0; j < pics.length; j++) {
                    const w = pics[j].dimension?.width || 100;
                    const h = pics[j].dimension?.height || 100;
                    code += `\n        (if (i32.eq (local.get $wrappedIdx) (i32.const ${j}))`;
                    code += `\n          (then`;
                    code += `\n            (call $setWidth (local.get $idx) (f64.const ${w}))`;
                    code += `\n            (call $setHeight (local.get $idx) (f64.const ${h}))))`;
                }
            }

            code += `))`;
        }

        code += `)`;
        return code;
    }

    generateBlockFunctions() {
        // Generate helper functions used by blocks
        return `
  ;; ===== BLOCK HELPER FUNCTIONS =====
  
  ;; Get mouse X from memory
  (func $getMouseX (result f64)
    (f64.load (i32.const 16)))
  
  ;; Get mouse Y from memory
  (func $getMouseY (result f64)
    (f64.load (i32.const 24)))
  
  ;; Check if mouse is clicked
  (func $isMouseClicked (result i32)
    (i32.load (i32.const 32)))
  
  ;; Check if key is pressed (keycode 0-511)
  (func $isKeyPressed (param $keycode i32) (result i32)
    (local $byteOffset i32)
    (local $bitOffset i32)
    (local.set $byteOffset (i32.add (i32.const 36) (i32.shr_u (local.get $keycode) (i32.const 3))))
    (local.set $bitOffset (i32.and (local.get $keycode) (i32.const 7)))
    (i32.and
      (i32.shr_u (i32.load8_u (local.get $byteOffset)) (local.get $bitOffset))
      (i32.const 1)))
  
  ;; Get variable value
  (func $getVariable (param $varOffset i32) (result f64)
    (f64.load (local.get $varOffset)))
  
  ;; Set variable value (persists string pointers to avoid dangling temp pool references)
  ;; Threshold -1000: string pointers are memory addresses (millions+), safe from normal negative numbers
  (func $setVariable (param $varOffset i32) (param $val f64)
    (if (f64.lt (local.get $val) (f64.const -1000))
      (then
        (f64.store (local.get $varOffset)
          (f64.neg (f64.convert_i32_s
            (call $str_persist (i32.trunc_f64_s (f64.neg (local.get $val)))))))
        (return)))
    (f64.store (local.get $varOffset) (local.get $val)))
  
  ;; Random number between min and max
  (func $randomRange (param $min f64) (param $max f64) (result f64)
    (f64.add
      (local.get $min)
      (f64.mul
        (call $random)
        (f64.sub (local.get $max) (local.get $min)))))
  
  ;; Random integer between min and max (inclusive)
  (func $randomInt (param $min f64) (param $max f64) (result f64)
    (call $floor
      (f64.add
        (local.get $min)
        (f64.mul
          (call $random)
          (f64.add (f64.sub (local.get $max) (local.get $min)) (f64.const 1))))))
  
  ;; ===== SCENE FUNCTIONS =====
  
  ;; Get current scene index
  (func $getCurrentScene (result i32)
    (global.get $currentScene))
  
  ;; Get scene count
  (func $getSceneCount (result i32)
    (global.get $sceneCount))
  
  ;; Update visibility of all entities based on current scene
  ;; Respects initialVisible - objects that were hidden at project start stay hidden
  (func $updateSceneVisibility
    (local $i i32)
    (local $entityCount i32)
    (local.set $entityCount (i32.const ${this.project.objects.length}))
    (local.set $i (i32.const 0))
    (block $break
      (loop $loop
        (br_if $break (i32.ge_u (local.get $i) (local.get $entityCount)))
        ;; Set visible = 1 if entity's sceneIndex == currentScene AND initialVisible == 1, else 0
        (call $setVisible (local.get $i)
          (i32.and
            (i32.eq (call $getSceneIndex (local.get $i)) (global.get $currentScene))
            (call $getInitialVisible (local.get $i))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $loop))))
  
  ;; Start a specific scene by index
  ;; Always sets sceneJustChanged even for same-scene transitions
  ;; (matches EntryJS behavior where start_scene always triggers resetSceneDuringRun + when_scene_start)
  (func $startScene (param $sceneIdx i32)
    ;; Bounds check
    (if (i32.and
          (i32.ge_s (local.get $sceneIdx) (i32.const 0))
          (i32.lt_s (local.get $sceneIdx) (global.get $sceneCount)))
      (then
        (global.set $currentScene (local.get $sceneIdx))
        (global.set $sceneJustChanged (i32.const 1))
        (call $updateSceneVisibility))))
  
  ;; Start neighbor scene (offset: 1 for next, -1 for prev)
  (func $startNeighborScene (param $offset i32)
    (local $newScene i32)
    (local.set $newScene (i32.add (global.get $currentScene) (local.get $offset)))
    ;; Bounds check
    (if (i32.and
          (i32.ge_s (local.get $newScene) (i32.const 0))
          (i32.lt_s (local.get $newScene) (global.get $sceneCount)))
      (then
        (global.set $currentScene (local.get $newScene))
        (global.set $sceneJustChanged (i32.const 1))
        (call $updateSceneVisibility))))
  
  ;; ===== COLLISION DETECTION FUNCTIONS =====
  ;; Uses AABB (axis-aligned bounding box) based on entity width/height and scale
  
  ;; Check if entity touches any edge (AABB bounds check)
  (func $isTouchingEdge (param $idx i32) (result i32)
    (local $x f64)
    (local $y f64)
    (local $hw f64)
    (local $hh f64)
    (local.set $x (call $getX (local.get $idx)))
    (local.set $y (call $getY (local.get $idx)))
    (local.set $hw (call $getHalfW (local.get $idx)))
    (local.set $hh (call $getHalfH (local.get $idx)))
    (i32.or
      (i32.or
        (f64.le (f64.sub (local.get $x) (local.get $hw)) (f64.const -240))
        (f64.ge (f64.add (local.get $x) (local.get $hw)) (f64.const 240)))
      (i32.or
        (f64.le (f64.sub (local.get $y) (local.get $hh)) (f64.const -135))
        (f64.ge (f64.add (local.get $y) (local.get $hh)) (f64.const 135)))))
  
  ;; Check if entity touches top edge
  (func $isTouchingEdgeTop (param $idx i32) (result i32)
    (f64.ge (f64.add (call $getY (local.get $idx)) (call $getHalfH (local.get $idx))) (f64.const 135)))
  
  ;; Check if entity touches bottom edge
  (func $isTouchingEdgeBottom (param $idx i32) (result i32)
    (f64.le (f64.sub (call $getY (local.get $idx)) (call $getHalfH (local.get $idx))) (f64.const -135)))
  
  ;; Check if entity touches left edge
  (func $isTouchingEdgeLeft (param $idx i32) (result i32)
    (f64.le (f64.sub (call $getX (local.get $idx)) (call $getHalfW (local.get $idx))) (f64.const -240)))
  
  ;; Check if entity touches right edge
  (func $isTouchingEdgeRight (param $idx i32) (result i32)
    (f64.ge (f64.add (call $getX (local.get $idx)) (call $getHalfW (local.get $idx))) (f64.const 240)))
  
  ;; Check if entity touches mouse position (AABB point-in-box test)
  (func $isTouchingMouse (param $idx i32) (result i32)
    (local $hw f64)
    (local $hh f64)
    (local.set $hw (call $getHalfW (local.get $idx)))
    (local.set $hh (call $getHalfH (local.get $idx)))
    (i32.and
      (f64.le (call $abs (f64.sub (call $getX (local.get $idx)) (call $getMouseX))) (local.get $hw))
      (f64.le (call $abs (f64.sub (call $getY (local.get $idx)) (call $getMouseY))) (local.get $hh))))
  
  ;; Check if two entities touch each other (AABB overlap test)
  (func $isTouchingObject (param $idx1 i32) (param $idx2 i32) (result i32)
    (i32.and
      (f64.le
        (call $abs (f64.sub (call $getX (local.get $idx1)) (call $getX (local.get $idx2))))
        (f64.add (call $getHalfW (local.get $idx1)) (call $getHalfW (local.get $idx2))))
      (f64.le
        (call $abs (f64.sub (call $getY (local.get $idx1)) (call $getY (local.get $idx2))))
        (f64.add (call $getHalfH (local.get $idx1)) (call $getHalfH (local.get $idx2))))))
  
  ;; Bounce off wall: reflect direction and clamp position using AABB
  (func $bounceWall (param $idx i32)
    (local $hw f64)
    (local $hh f64)
    (local $x f64)
    (local $y f64)
    (local $dir f64)
    (local.set $hw (call $getHalfW (local.get $idx)))
    (local.set $hh (call $getHalfH (local.get $idx)))
    (local.set $x (call $getX (local.get $idx)))
    (local.set $y (call $getY (local.get $idx)))
    (local.set $dir (call $getDirection (local.get $idx)))
    ;; Check right edge: x + halfW >= 240 (else check left)
    (if (f64.ge (f64.add (local.get $x) (local.get $hw)) (f64.const 240))
      (then
        (local.set $dir (f64.sub (f64.const 180) (local.get $dir)))
        (local.set $x (f64.sub (f64.const 240) (local.get $hw))))
      (else
        (if (f64.le (f64.sub (local.get $x) (local.get $hw)) (f64.const -240))
          (then
            (local.set $dir (f64.sub (f64.const 180) (local.get $dir)))
            (local.set $x (f64.add (f64.const -240) (local.get $hw)))))))
    ;; Check top edge: y + halfH >= 135 (else check bottom)
    (if (f64.ge (f64.add (local.get $y) (local.get $hh)) (f64.const 135))
      (then
        (local.set $dir (f64.mul (local.get $dir) (f64.const -1)))
        (local.set $y (f64.sub (f64.const 135) (local.get $hh))))
      (else
        (if (f64.le (f64.sub (local.get $y) (local.get $hh)) (f64.const -135))
          (then
            (local.set $dir (f64.mul (local.get $dir) (f64.const -1)))
            (local.set $y (f64.add (f64.const -135) (local.get $hh)))))))
    (call $setDirection (local.get $idx) (local.get $dir))
    (call $setX (local.get $idx) (local.get $x))
    (call $setY (local.get $idx) (local.get $y))
    (call $brushNotifyPosition (local.get $idx) (local.get $x) (local.get $y)))
  
  ;; Check if object is clicked (mouse pressed and touching object)
  (func $isObjectClicked (param $idx i32) (result i32)
    (i32.and
      (call $isMouseClicked)
      (call $isTouchingMouse (local.get $idx))))
  
  ;; Find which entity is under the mouse (for click events)
  ;; Returns entity index or -1 if no entity under mouse
  ;; Checks entities in order 0, 1, 2, ... (entity 0 is on top in EntryJS)
  (func $findClickedEntity (result i32)
    (local $i i32)
    (local $entityCount i32)
    (local.set $entityCount (i32.const ${this.project.objects.length}))
    (local.set $i (i32.const 0))
    (block $found (result i32)
      (block $notfound
        (loop $loop
          (br_if $notfound (i32.ge_u (local.get $i) (local.get $entityCount)))
          ;; Check if entity is visible and in current scene and mouse is touching it
          (if (i32.and
                (i32.and
                  (call $getVisible (local.get $i))
                  (i32.eq (call $getSceneIndex (local.get $i)) (global.get $currentScene)))
                (call $isTouchingMouse (local.get $i)))
            (then (br $found (local.get $i))))
          (local.set $i (i32.add (local.get $i) (i32.const 1)))
          (br $loop)))
      (i32.const -1)))  ;; Return -1 if no entity found
  
  ;; Update click tracking state at start of tick
  ;; Detects new clicks and sets clickedEntityIndex
  (func $updateClickState
    (local $mouseNow i32)
    (local.set $mouseNow (call $isMouseClicked))
    ;; Detect new click (mouse now pressed, was not pressed before)
    (if (i32.and (local.get $mouseNow) (i32.eqz (global.get $prevMouseClicked)))
      (then
        ;; New click - find which entity is clicked
        (global.set $clickedEntityIndex (call $findClickedEntity)))))
  
  ;; Finalize click state at end of tick
  (func $finalizeClickState
    (local $mouseNow i32)
    (local.set $mouseNow (call $isMouseClicked))
    ;; If mouse was released, clear clicked entity
    (if (i32.and (i32.eqz (local.get $mouseNow)) (global.get $prevMouseClicked))
      (then
        (global.set $clickedEntityIndex (i32.const -1))))
    ;; Update previous mouse state
    (global.set $prevMouseClicked (local.get $mouseNow)))
  
  ;; Note: Brush/drawing functions and dialog functions are imported from JS
  ;; See imports section above
  
  ;; ===== LIST HELPER FUNCTIONS =====
  
  ;; Get list metadata offset by list index
  ;; List metadata: [length(i32), capacity(i32), data_ptr(i32), reserved(12 bytes)]
  (func $list_get_meta_ptr (param $listIdx i32) (result i32)
    (i32.add
      (i32.const ${this.project.listMemory?.metaStart || 0})
      (i32.mul (local.get $listIdx) (i32.const 24))))
  
  ;; Get list length
  (func $list_length (param $listIdx i32) (result i32)
    (i32.load (call $list_get_meta_ptr (local.get $listIdx))))
  
  ;; Set list length
  (func $list_set_length (param $listIdx i32) (param $len i32)
    (i32.store (call $list_get_meta_ptr (local.get $listIdx)) (local.get $len)))
  
  ;; Get list capacity
  (func $list_capacity (param $listIdx i32) (result i32)
    (i32.load (i32.add (call $list_get_meta_ptr (local.get $listIdx)) (i32.const 4))))
  
  ;; Get list data pointer
  (func $list_data_ptr (param $listIdx i32) (result i32)
    (i32.load (i32.add (call $list_get_meta_ptr (local.get $listIdx)) (i32.const 8))))
  
  ;; Get element offset (0-based index) - each element is 16 bytes
  (func $list_element_offset (param $listIdx i32) (param $index i32) (result i32)
    (i32.add
      (call $list_data_ptr (local.get $listIdx))
      (i32.mul (local.get $index) (i32.const 16))))
  
  ;; Get element type at index (0=number, 1=string)
  (func $list_get_type (param $listIdx i32) (param $index i32) (result i32)
    (local $len i32)
    (local.set $len (call $list_length (local.get $listIdx)))
    (if (result i32) (i32.or (i32.lt_s (local.get $index) (i32.const 0)) (i32.ge_s (local.get $index) (local.get $len)))
      (then (i32.const 0))
      (else (i32.load (i32.add (call $list_element_offset (local.get $listIdx) (local.get $index)) (i32.const 8))))))
  
  ;; Get string pointer at index
  (func $list_get_str_ptr (param $listIdx i32) (param $index i32) (result i32)
    (local $len i32)
    (local.set $len (call $list_length (local.get $listIdx)))
    (if (result i32) (i32.or (i32.lt_s (local.get $index) (i32.const 0)) (i32.ge_s (local.get $index) (local.get $len)))
      (then (i32.const 0))
      (else (i32.load (i32.add (call $list_element_offset (local.get $listIdx) (local.get $index)) (i32.const 12))))))
  
  ;; Get value at index (0-based) - returns f64, converts string to number if needed
  (func $list_get (param $listIdx i32) (param $index i32) (result f64)
    (local $len i32)
    (local $offset i32)
    (local.set $len (call $list_length (local.get $listIdx)))
    ;; Bounds check
    (if (result f64) (i32.or
          (i32.lt_s (local.get $index) (i32.const 0))
          (i32.ge_s (local.get $index) (local.get $len)))
      (then (f64.const 0))
      (else
        (local.set $offset (call $list_element_offset (local.get $listIdx) (local.get $index)))
        ;; Check type: 0=number, 1=string
        (if (result f64) (i32.eqz (i32.load (i32.add (local.get $offset) (i32.const 8))))
          (then (f64.load (local.get $offset)))
          (else (call $str_to_f64 (i32.load (i32.add (local.get $offset) (i32.const 12)))))))))
  
  ;; Set numeric value at index (0-based)
  (func $list_set (param $listIdx i32) (param $index i32) (param $value f64)
    (local $len i32)
    (local $offset i32)
    (local.set $len (call $list_length (local.get $listIdx)))
    ;; Bounds check
    (if (i32.and
          (i32.ge_s (local.get $index) (i32.const 0))
          (i32.lt_s (local.get $index) (local.get $len)))
      (then
        (local.set $offset (call $list_element_offset (local.get $listIdx) (local.get $index)))
        (f64.store (local.get $offset) (local.get $value))
        (i32.store (i32.add (local.get $offset) (i32.const 8)) (i32.const 0))  ;; type = number
        (i32.store (i32.add (local.get $offset) (i32.const 12)) (i32.const 0)))))  ;; str_ptr = 0
  
  ;; Set string value at index (0-based)
  (func $list_set_str (param $listIdx i32) (param $index i32) (param $strPtr i32)
    (local $len i32)
    (local $offset i32)
    (local.set $len (call $list_length (local.get $listIdx)))
    ;; Bounds check
    (if (i32.and
          (i32.ge_s (local.get $index) (i32.const 0))
          (i32.lt_s (local.get $index) (local.get $len)))
      (then
        (local.set $offset (call $list_element_offset (local.get $listIdx) (local.get $index)))
        (f64.store (local.get $offset) (f64.const 0))  ;; value = 0
        (i32.store (i32.add (local.get $offset) (i32.const 8)) (i32.const 1))  ;; type = string
        (i32.store (i32.add (local.get $offset) (i32.const 12)) (call $str_persist (local.get $strPtr))))))
  
  ;; Push numeric value to end of list
  (func $list_push (param $listIdx i32) (param $value f64)
    (local $len i32)
    (local $cap i32)
    (local $offset i32)
    (local.set $len (call $list_length (local.get $listIdx)))
    (local.set $cap (call $list_capacity (local.get $listIdx)))
    ;; Check capacity
    (if (i32.lt_s (local.get $len) (local.get $cap))
      (then
        (local.set $offset (call $list_element_offset (local.get $listIdx) (local.get $len)))
        ;; Store value at end (16-byte element: f64 value + i32 type + i32 str_ptr)
        (f64.store (local.get $offset) (local.get $value))
        (i32.store (i32.add (local.get $offset) (i32.const 8)) (i32.const 0))  ;; type = 0 (number)
        (i32.store (i32.add (local.get $offset) (i32.const 12)) (i32.const 0)) ;; str_ptr = 0
        ;; Increment length
        (call $list_set_length (local.get $listIdx) (i32.add (local.get $len) (i32.const 1))))))
  
  ;; Push string value to end of list
  (func $list_push_str (param $listIdx i32) (param $strPtr i32)
    (local $len i32)
    (local $cap i32)
    (local $offset i32)
    (local.set $len (call $list_length (local.get $listIdx)))
    (local.set $cap (call $list_capacity (local.get $listIdx)))
    ;; Check capacity
    (if (i32.lt_s (local.get $len) (local.get $cap))
      (then
        (local.set $offset (call $list_element_offset (local.get $listIdx) (local.get $len)))
        ;; Store string at end (16-byte element)
        (f64.store (local.get $offset) (f64.const 0))  ;; value = 0 (unused for strings)
        (i32.store (i32.add (local.get $offset) (i32.const 8)) (i32.const 1))  ;; type = 1 (string)
        (i32.store (i32.add (local.get $offset) (i32.const 12)) (call $str_persist (local.get $strPtr))) ;; str_ptr (persisted)
        ;; Increment length
        (call $list_set_length (local.get $listIdx) (i32.add (local.get $len) (i32.const 1))))))
  
  ;; Insert numeric value at index (0-based), shift elements right
  (func $list_insert (param $listIdx i32) (param $index i32) (param $value f64)
    (local $len i32)
    (local $cap i32)
    (local $i i32)
    (local $srcOffset i32)
    (local $dstOffset i32)
    (local.set $len (call $list_length (local.get $listIdx)))
    (local.set $cap (call $list_capacity (local.get $listIdx)))
    ;; Clamp index to valid range [0, len]
    (if (i32.lt_s (local.get $index) (i32.const 0))
      (then (local.set $index (i32.const 0))))
    (if (i32.gt_s (local.get $index) (local.get $len))
      (then (local.set $index (local.get $len))))
    ;; Check capacity
    (if (i32.lt_s (local.get $len) (local.get $cap))
      (then
        ;; Shift elements right from end to index (copy all 16 bytes per element)
        (local.set $i (local.get $len))
        (block $break
          (loop $shift
            (br_if $break (i32.le_s (local.get $i) (local.get $index)))
            (local.set $dstOffset (call $list_element_offset (local.get $listIdx) (local.get $i)))
            (local.set $srcOffset (call $list_element_offset (local.get $listIdx) (i32.sub (local.get $i) (i32.const 1))))
            ;; Copy all 16 bytes: value (8) + type (4) + str_ptr (4)
            (f64.store (local.get $dstOffset) (f64.load (local.get $srcOffset)))
            (i32.store (i32.add (local.get $dstOffset) (i32.const 8)) (i32.load (i32.add (local.get $srcOffset) (i32.const 8))))
            (i32.store (i32.add (local.get $dstOffset) (i32.const 12)) (i32.load (i32.add (local.get $srcOffset) (i32.const 12))))
            (local.set $i (i32.sub (local.get $i) (i32.const 1)))
            (br $shift)))
        ;; Store new numeric value with type tag
        (local.set $dstOffset (call $list_element_offset (local.get $listIdx) (local.get $index)))
        (f64.store (local.get $dstOffset) (local.get $value))
        (i32.store (i32.add (local.get $dstOffset) (i32.const 8)) (i32.const 0))  ;; type = 0 (number)
        (i32.store (i32.add (local.get $dstOffset) (i32.const 12)) (i32.const 0)) ;; str_ptr = 0
        ;; Increment length
        (call $list_set_length (local.get $listIdx) (i32.add (local.get $len) (i32.const 1))))))
  
  ;; Insert string value at index (0-based), shift elements right
  (func $list_insert_str (param $listIdx i32) (param $index i32) (param $strPtr i32)
    (local $len i32)
    (local $cap i32)
    (local $i i32)
    (local $srcOffset i32)
    (local $dstOffset i32)
    (local.set $len (call $list_length (local.get $listIdx)))
    (local.set $cap (call $list_capacity (local.get $listIdx)))
    ;; Clamp index to valid range [0, len]
    (if (i32.lt_s (local.get $index) (i32.const 0))
      (then (local.set $index (i32.const 0))))
    (if (i32.gt_s (local.get $index) (local.get $len))
      (then (local.set $index (local.get $len))))
    ;; Check capacity
    (if (i32.lt_s (local.get $len) (local.get $cap))
      (then
        ;; Shift elements right from end to index (copy all 16 bytes per element)
        (local.set $i (local.get $len))
        (block $break
          (loop $shift
            (br_if $break (i32.le_s (local.get $i) (local.get $index)))
            (local.set $dstOffset (call $list_element_offset (local.get $listIdx) (local.get $i)))
            (local.set $srcOffset (call $list_element_offset (local.get $listIdx) (i32.sub (local.get $i) (i32.const 1))))
            ;; Copy all 16 bytes: value (8) + type (4) + str_ptr (4)
            (f64.store (local.get $dstOffset) (f64.load (local.get $srcOffset)))
            (i32.store (i32.add (local.get $dstOffset) (i32.const 8)) (i32.load (i32.add (local.get $srcOffset) (i32.const 8))))
            (i32.store (i32.add (local.get $dstOffset) (i32.const 12)) (i32.load (i32.add (local.get $srcOffset) (i32.const 12))))
            (local.set $i (i32.sub (local.get $i) (i32.const 1)))
            (br $shift)))
        ;; Store new string value with type tag
        (local.set $dstOffset (call $list_element_offset (local.get $listIdx) (local.get $index)))
        (f64.store (local.get $dstOffset) (f64.const 0))  ;; value = 0 (unused for strings)
        (i32.store (i32.add (local.get $dstOffset) (i32.const 8)) (i32.const 1))  ;; type = 1 (string)
        (i32.store (i32.add (local.get $dstOffset) (i32.const 12)) (call $str_persist (local.get $strPtr))) ;; str_ptr (persisted)
        ;; Increment length
        (call $list_set_length (local.get $listIdx) (i32.add (local.get $len) (i32.const 1))))))
  
  ;; Remove value at index (0-based), shift elements left
  (func $list_remove (param $listIdx i32) (param $index i32)
    (local $len i32)
    (local $i i32)
    (local $srcOffset i32)
    (local $dstOffset i32)
    (local.set $len (call $list_length (local.get $listIdx)))
    ;; Bounds check
    (if (i32.and
          (i32.ge_s (local.get $index) (i32.const 0))
          (i32.lt_s (local.get $index) (local.get $len)))
      (then
        ;; Shift elements left (copy all 16 bytes per element)
        (local.set $i (local.get $index))
        (block $break
          (loop $shift
            (br_if $break (i32.ge_s (local.get $i) (i32.sub (local.get $len) (i32.const 1))))
            (local.set $dstOffset (call $list_element_offset (local.get $listIdx) (local.get $i)))
            (local.set $srcOffset (call $list_element_offset (local.get $listIdx) (i32.add (local.get $i) (i32.const 1))))
            ;; Copy all 16 bytes: value (8) + type (4) + str_ptr (4)
            (f64.store (local.get $dstOffset) (f64.load (local.get $srcOffset)))
            (i32.store (i32.add (local.get $dstOffset) (i32.const 8)) (i32.load (i32.add (local.get $srcOffset) (i32.const 8))))
            (i32.store (i32.add (local.get $dstOffset) (i32.const 12)) (i32.load (i32.add (local.get $srcOffset) (i32.const 12))))
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $shift)))
        ;; Decrement length
        (call $list_set_length (local.get $listIdx) (i32.sub (local.get $len) (i32.const 1))))))
  
  ;; Check if list contains numeric value (returns 1 if found, 0 otherwise)
  ;; Only checks elements with type=0 (number)
  (func $list_contains (param $listIdx i32) (param $value f64) (result i32)
    (local $len i32)
    (local $i i32)
    (local $offset i32)
    (local.set $len (call $list_length (local.get $listIdx)))
    (local.set $i (i32.const 0))
    (block $found
      (block $not_found
        (loop $search
          (br_if $not_found (i32.ge_s (local.get $i) (local.get $len)))
          (local.set $offset (call $list_element_offset (local.get $listIdx) (local.get $i)))
          ;; Only compare if type=0 (number)
          (if (i32.eqz (i32.load (i32.add (local.get $offset) (i32.const 8))))
            (then
              (br_if $found (f64.eq (f64.load (local.get $offset)) (local.get $value)))))
          (local.set $i (i32.add (local.get $i) (i32.const 1)))
          (br $search)))
      (return (i32.const 0)))
    (i32.const 1))
  
  ;; Check if list contains string value (returns 1 if found, 0 otherwise)
  ;; Compares string contents, not pointers
  (func $list_contains_str (param $listIdx i32) (param $strPtr i32) (result i32)
    (local $len i32)
    (local $i i32)
    (local $offset i32)
    (local $elemStrPtr i32)
    (local $strLen i32)
    (local $elemStrLen i32)
    (local $j i32)
    (local $match i32)
    (local.set $len (call $list_length (local.get $listIdx)))
    (local.set $strLen (call $str_length (local.get $strPtr)))
    (local.set $i (i32.const 0))
    (block $found
      (block $not_found
        (loop $search
          (br_if $not_found (i32.ge_s (local.get $i) (local.get $len)))
          (local.set $offset (call $list_element_offset (local.get $listIdx) (local.get $i)))
          ;; Only compare if type=1 (string)
          (if (i32.eq (i32.load (i32.add (local.get $offset) (i32.const 8))) (i32.const 1))
            (then
              (local.set $elemStrPtr (i32.load (i32.add (local.get $offset) (i32.const 12))))
              (local.set $elemStrLen (call $str_length (local.get $elemStrPtr)))
              ;; Check if lengths match
              (if (i32.eq (local.get $strLen) (local.get $elemStrLen))
                (then
                  ;; Compare byte by byte
                  (local.set $match (i32.const 1))
                  (local.set $j (i32.const 0))
                  (block $nomatch
                    (loop $compare
                      (br_if $nomatch (i32.ge_s (local.get $j) (local.get $strLen)))
                      (if (i32.ne
                            (i32.load8_u (i32.add (i32.add (local.get $strPtr) (i32.const 4)) (local.get $j)))
                            (i32.load8_u (i32.add (i32.add (local.get $elemStrPtr) (i32.const 4)) (local.get $j))))
                        (then
                          (local.set $match (i32.const 0))
                          (br $nomatch)))
                      (local.set $j (i32.add (local.get $j) (i32.const 1)))
                      (br $compare)))
                  (br_if $found (local.get $match))))))
          (local.set $i (i32.add (local.get $i) (i32.const 1)))
          (br $search)))
      (return (i32.const 0)))
    (i32.const 1))
  
  ;; Clear list (set length to 0)
  (func $list_clear (param $listIdx i32)
    (call $list_set_length (local.get $listIdx) (i32.const 0)))
  
  ;; ===== STRING HELPER FUNCTIONS =====
  
  ;; Allocate string in string pool (bump allocator)
  ;; Returns pointer to string (layout: [len:i32][data:bytes][null])
  (func $str_alloc (param $len i32) (result i32)
    (local $ptr i32)
    (local.set $ptr (global.get $str_pool_ptr))
    ;; Store length at ptr
    (i32.store (local.get $ptr) (local.get $len))
    ;; Advance pool pointer: ptr + 4 (len) + len + 1 (null) + padding to 4-byte align
    (global.set $str_pool_ptr
      (i32.and
        (i32.add (i32.add (local.get $ptr) (i32.add (local.get $len) (i32.const 5))) (i32.const 3))
        (i32.const -4)))
    (local.get $ptr))
  
  ;; Get string length
  (func $str_length (param $ptr i32) (result i32)
    (if (result i32) (i32.eqz (local.get $ptr))
      (then (i32.const 0))
      (else (i32.load (local.get $ptr)))))
  
  ;; Get character at index (1-based) as char code
  (func $str_char_at (param $ptr i32) (param $idx i32) (result i32)
    (local $len i32)
    (local $zeroIdx i32)
    (if (result i32) (i32.eqz (local.get $ptr))
      (then (i32.const 0))
      (else
        (local.set $len (i32.load (local.get $ptr)))
        (local.set $zeroIdx (i32.sub (local.get $idx) (i32.const 1)))
        (if (result i32) (i32.or (i32.lt_s (local.get $zeroIdx) (i32.const 0)) (i32.ge_s (local.get $zeroIdx) (local.get $len)))
          (then (i32.const 0))
          (else (i32.load8_u (i32.add (i32.add (local.get $ptr) (i32.const 4)) (local.get $zeroIdx))))))))
  
  ;; Get character at index (1-based) as new string pointer
  (func $str_char_at_str (param $ptr i32) (param $idx i32) (result i32)
    (local $charCode i32)
    (local $newPtr i32)
    (local.set $charCode (call $str_char_at (local.get $ptr) (local.get $idx)))
    (if (result i32) (i32.eqz (local.get $charCode))
      (then (call $str_alloc (i32.const 0)))
      (else
        (local.set $newPtr (call $str_alloc (i32.const 1)))
        (i32.store8 (i32.add (local.get $newPtr) (i32.const 4)) (local.get $charCode))
        (i32.store8 (i32.add (local.get $newPtr) (i32.const 5)) (i32.const 0))
        (local.get $newPtr))))
  
  ;; Concatenate two strings
  (func $str_concat (param $ptr1 i32) (param $ptr2 i32) (result i32)
    (local $len1 i32)
    (local $len2 i32)
    (local $newPtr i32)
    (local $i i32)
    (local.set $len1 (if (result i32) (i32.eqz (local.get $ptr1)) (then (i32.const 0)) (else (i32.load (local.get $ptr1)))))
    (local.set $len2 (if (result i32) (i32.eqz (local.get $ptr2)) (then (i32.const 0)) (else (i32.load (local.get $ptr2)))))
    (local.set $newPtr (call $str_alloc (i32.add (local.get $len1) (local.get $len2))))
    ;; Copy first string
    (local.set $i (i32.const 0))
    (block $break1
      (loop $copy1
        (br_if $break1 (i32.ge_s (local.get $i) (local.get $len1)))
        (i32.store8
          (i32.add (i32.add (local.get $newPtr) (i32.const 4)) (local.get $i))
          (i32.load8_u (i32.add (i32.add (local.get $ptr1) (i32.const 4)) (local.get $i))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $copy1)))
    ;; Copy second string
    (local.set $i (i32.const 0))
    (block $break2
      (loop $copy2
        (br_if $break2 (i32.ge_s (local.get $i) (local.get $len2)))
        (i32.store8
          (i32.add (i32.add (local.get $newPtr) (i32.const 4)) (i32.add (local.get $len1) (local.get $i)))
          (i32.load8_u (i32.add (i32.add (local.get $ptr2) (i32.const 4)) (local.get $i))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $copy2)))
    ;; Null terminate
    (i32.store8 (i32.add (i32.add (local.get $newPtr) (i32.const 4)) (i32.add (local.get $len1) (local.get $len2))) (i32.const 0))
    (local.get $newPtr))
  
  ;; Get substring (1-based start and end, inclusive)
  (func $str_substring (param $ptr i32) (param $start i32) (param $end i32) (result i32)
    (local $len i32)
    (local $startIdx i32)
    (local $endIdx i32)
    (local $subLen i32)
    (local $newPtr i32)
    (local $i i32)
    (if (result i32) (i32.eqz (local.get $ptr))
      (then (call $str_alloc (i32.const 0)))
      (else
        (local.set $len (i32.load (local.get $ptr)))
        (local.set $startIdx (i32.sub (local.get $start) (i32.const 1)))
        (local.set $endIdx (local.get $end))
        ;; Clamp indices
        (if (i32.lt_s (local.get $startIdx) (i32.const 0)) (then (local.set $startIdx (i32.const 0))))
        (if (i32.gt_s (local.get $endIdx) (local.get $len)) (then (local.set $endIdx (local.get $len))))
        (local.set $subLen (i32.sub (local.get $endIdx) (local.get $startIdx)))
        (if (i32.lt_s (local.get $subLen) (i32.const 0)) (then (local.set $subLen (i32.const 0))))
        (local.set $newPtr (call $str_alloc (local.get $subLen)))
        ;; Copy substring
        (local.set $i (i32.const 0))
        (block $break
          (loop $copy
            (br_if $break (i32.ge_s (local.get $i) (local.get $subLen)))
            (i32.store8
              (i32.add (i32.add (local.get $newPtr) (i32.const 4)) (local.get $i))
              (i32.load8_u (i32.add (i32.add (local.get $ptr) (i32.const 4)) (i32.add (local.get $startIdx) (local.get $i)))))
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $copy)))
        (i32.store8 (i32.add (i32.add (local.get $newPtr) (i32.const 4)) (local.get $subLen)) (i32.const 0))
        (local.get $newPtr))))
  
  ;; Find index of substring (returns 1-based index, 0 if not found)
  (func $str_index_of (param $str i32) (param $search i32) (result i32)
    (local $strLen i32)
    (local $searchLen i32)
    (local $i i32)
    (local $j i32)
    (local $match i32)
    (if (result i32) (i32.or (i32.eqz (local.get $str)) (i32.eqz (local.get $search)))
      (then (i32.const 0))
      (else
        (local.set $strLen (i32.load (local.get $str)))
        (local.set $searchLen (i32.load (local.get $search)))
        (if (result i32) (i32.gt_s (local.get $searchLen) (local.get $strLen))
          (then (i32.const 0))
          (else
            (local.set $i (i32.const 0))
            (block $found (result i32)
              (block $notfound
                (loop $outer
                  (br_if $notfound (i32.gt_s (local.get $i) (i32.sub (local.get $strLen) (local.get $searchLen))))
                  (local.set $match (i32.const 1))
                  (local.set $j (i32.const 0))
                  (block $nomatch
                    (loop $inner
                      (br_if $nomatch (i32.ge_s (local.get $j) (local.get $searchLen)))
                      (if (i32.ne
                            (i32.load8_u (i32.add (i32.add (local.get $str) (i32.const 4)) (i32.add (local.get $i) (local.get $j))))
                            (i32.load8_u (i32.add (i32.add (local.get $search) (i32.const 4)) (local.get $j))))
                        (then
                          (local.set $match (i32.const 0))
                          (br $nomatch)))
                      (local.set $j (i32.add (local.get $j) (i32.const 1)))
                      (br $inner)))
                  (if (local.get $match)
                    (then (br $found (i32.add (local.get $i) (i32.const 1)))))
                  (local.set $i (i32.add (local.get $i) (i32.const 1)))
                  (br $outer)))
              (i32.const 0)))))))
  
  ;; Replace first occurrence of old with new
  (func $str_replace (param $str i32) (param $old i32) (param $new i32) (result i32)
    (local $idx i32)
    (local $strLen i32)
    (local $oldLen i32)
    (local $newLen i32)
    (local $resultLen i32)
    (local $newPtr i32)
    (local $i i32)
    (local $srcIdx i32)
    (local.set $idx (call $str_index_of (local.get $str) (local.get $old)))
    (if (result i32) (i32.eqz (local.get $idx))
      (then
        ;; Not found, return copy of original
        (local.set $strLen (if (result i32) (i32.eqz (local.get $str)) (then (i32.const 0)) (else (i32.load (local.get $str)))))
        (local.set $newPtr (call $str_alloc (local.get $strLen)))
        (local.set $i (i32.const 0))
        (block $break
          (loop $copy
            (br_if $break (i32.ge_s (local.get $i) (local.get $strLen)))
            (i32.store8
              (i32.add (i32.add (local.get $newPtr) (i32.const 4)) (local.get $i))
              (i32.load8_u (i32.add (i32.add (local.get $str) (i32.const 4)) (local.get $i))))
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $copy)))
        (i32.store8 (i32.add (i32.add (local.get $newPtr) (i32.const 4)) (local.get $strLen)) (i32.const 0))
        (local.get $newPtr))
      (else
        ;; Found, build replaced string
        (local.set $strLen (i32.load (local.get $str)))
        (local.set $oldLen (i32.load (local.get $old)))
        (local.set $newLen (if (result i32) (i32.eqz (local.get $new)) (then (i32.const 0)) (else (i32.load (local.get $new)))))
        (local.set $resultLen (i32.add (i32.sub (local.get $strLen) (local.get $oldLen)) (local.get $newLen)))
        (local.set $newPtr (call $str_alloc (local.get $resultLen)))
        (local.set $srcIdx (i32.sub (local.get $idx) (i32.const 1)))
        ;; Copy before
        (local.set $i (i32.const 0))
        (block $break1
          (loop $copy1
            (br_if $break1 (i32.ge_s (local.get $i) (local.get $srcIdx)))
            (i32.store8
              (i32.add (i32.add (local.get $newPtr) (i32.const 4)) (local.get $i))
              (i32.load8_u (i32.add (i32.add (local.get $str) (i32.const 4)) (local.get $i))))
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $copy1)))
        ;; Copy new
        (local.set $i (i32.const 0))
        (block $break2
          (loop $copy2
            (br_if $break2 (i32.ge_s (local.get $i) (local.get $newLen)))
            (i32.store8
              (i32.add (i32.add (local.get $newPtr) (i32.const 4)) (i32.add (local.get $srcIdx) (local.get $i)))
              (i32.load8_u (i32.add (i32.add (local.get $new) (i32.const 4)) (local.get $i))))
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $copy2)))
        ;; Copy after
        (local.set $i (i32.const 0))
        (block $break3
          (loop $copy3
            (br_if $break3 (i32.ge_s (local.get $i) (i32.sub (local.get $strLen) (i32.add (local.get $srcIdx) (local.get $oldLen)))))
            (i32.store8
              (i32.add (i32.add (local.get $newPtr) (i32.const 4)) (i32.add (i32.add (local.get $srcIdx) (local.get $newLen)) (local.get $i)))
              (i32.load8_u (i32.add (i32.add (local.get $str) (i32.const 4)) (i32.add (i32.add (local.get $srcIdx) (local.get $oldLen)) (local.get $i)))))
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $copy3)))
        (i32.store8 (i32.add (i32.add (local.get $newPtr) (i32.const 4)) (local.get $resultLen)) (i32.const 0))
        (local.get $newPtr))))
  
  ;; Convert string to uppercase
  (func $str_to_upper (param $ptr i32) (result i32)
    (local $len i32)
    (local $newPtr i32)
    (local $i i32)
    (local $c i32)
    (if (result i32) (i32.eqz (local.get $ptr))
      (then (call $str_alloc (i32.const 0)))
      (else
        (local.set $len (i32.load (local.get $ptr)))
        (local.set $newPtr (call $str_alloc (local.get $len)))
        (local.set $i (i32.const 0))
        (block $break
          (loop $copy
            (br_if $break (i32.ge_s (local.get $i) (local.get $len)))
            (local.set $c (i32.load8_u (i32.add (i32.add (local.get $ptr) (i32.const 4)) (local.get $i))))
            ;; Convert a-z (97-122) to A-Z (65-90)
            (if (i32.and (i32.ge_u (local.get $c) (i32.const 97)) (i32.le_u (local.get $c) (i32.const 122)))
              (then (local.set $c (i32.sub (local.get $c) (i32.const 32)))))
            (i32.store8 (i32.add (i32.add (local.get $newPtr) (i32.const 4)) (local.get $i)) (local.get $c))
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $copy)))
        (i32.store8 (i32.add (i32.add (local.get $newPtr) (i32.const 4)) (local.get $len)) (i32.const 0))
        (local.get $newPtr))))
  
  ;; Convert string to lowercase
  (func $str_to_lower (param $ptr i32) (result i32)
    (local $len i32)
    (local $newPtr i32)
    (local $i i32)
    (local $c i32)
    (if (result i32) (i32.eqz (local.get $ptr))
      (then (call $str_alloc (i32.const 0)))
      (else
        (local.set $len (i32.load (local.get $ptr)))
        (local.set $newPtr (call $str_alloc (local.get $len)))
        (local.set $i (i32.const 0))
        (block $break
          (loop $copy
            (br_if $break (i32.ge_s (local.get $i) (local.get $len)))
            (local.set $c (i32.load8_u (i32.add (i32.add (local.get $ptr) (i32.const 4)) (local.get $i))))
            ;; Convert A-Z (65-90) to a-z (97-122)
            (if (i32.and (i32.ge_u (local.get $c) (i32.const 65)) (i32.le_u (local.get $c) (i32.const 90)))
              (then (local.set $c (i32.add (local.get $c) (i32.const 32)))))
            (i32.store8 (i32.add (i32.add (local.get $newPtr) (i32.const 4)) (local.get $i)) (local.get $c))
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $copy)))
        (i32.store8 (i32.add (i32.add (local.get $newPtr) (i32.const 4)) (local.get $len)) (i32.const 0))
        (local.get $newPtr))))
  
  ;; Convert f64 to string (delegates to JS for proper decimal formatting)
  (func $f64_to_str (param $val f64) (result i32)
    (call $f64_to_str_import (local.get $val)))
  
  ;; Compare two strings for equality (returns i32: 1 if equal, 0 if not)
  (func $str_equals (param $ptr1 i32) (param $ptr2 i32) (result i32)
    (local $len1 i32)
    (local $len2 i32)
    (local $i i32)
    ;; Handle null pointers
    (if (i32.and (i32.eqz (local.get $ptr1)) (i32.eqz (local.get $ptr2)))
      (then (return (i32.const 1))))
    (if (i32.or (i32.eqz (local.get $ptr1)) (i32.eqz (local.get $ptr2)))
      (then (return (i32.const 0))))
    ;; Compare lengths first
    (local.set $len1 (i32.load (local.get $ptr1)))
    (local.set $len2 (i32.load (local.get $ptr2)))
    (if (i32.ne (local.get $len1) (local.get $len2))
      (then (return (i32.const 0))))
    ;; Compare byte by byte
    (local.set $i (i32.const 0))
    (block $not_equal
      (loop $compare
        (br_if $not_equal (i32.ge_s (local.get $i) (local.get $len1)))
        (if (i32.ne
              (i32.load8_u (i32.add (i32.add (local.get $ptr1) (i32.const 4)) (local.get $i)))
              (i32.load8_u (i32.add (i32.add (local.get $ptr2) (i32.const 4)) (local.get $i))))
          (then (return (i32.const 0))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $compare)))
    (i32.const 1))
  
  ;; Convert string to f64 (supports integer and decimal numbers)
  (func $str_to_f64 (param $ptr i32) (result f64)
    (local $len i32)
    (local $i i32)
    (local $c i32)
    (local $result f64)
    (local $isNeg i32)
    (local $frac f64)
    (if (result f64) (i32.eqz (local.get $ptr))
      (then (f64.const 0))
      (else
        (local.set $len (i32.load (local.get $ptr)))
        (local.set $result (f64.const 0))
        (local.set $i (i32.const 0))
        ;; Check for negative
        (if (i32.and (i32.gt_s (local.get $len) (i32.const 0))
                     (i32.eq (i32.load8_u (i32.add (local.get $ptr) (i32.const 4))) (i32.const 45)))
          (then
            (local.set $isNeg (i32.const 1))
            (local.set $i (i32.const 1))))
        ;; Parse integer digits
        (block $done
          (loop $parse
            (br_if $done (i32.ge_s (local.get $i) (local.get $len)))
            (local.set $c (i32.load8_u (i32.add (i32.add (local.get $ptr) (i32.const 4)) (local.get $i))))
            (br_if $done (i32.or (i32.lt_u (local.get $c) (i32.const 48)) (i32.gt_u (local.get $c) (i32.const 57))))
            (local.set $result
              (f64.add
                (f64.mul (local.get $result) (f64.const 10))
                (f64.convert_i32_u (i32.sub (local.get $c) (i32.const 48)))))
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $parse)))
        ;; Parse decimal point and fractional digits
        (if (i32.and
              (i32.lt_s (local.get $i) (local.get $len))
              (i32.eq (i32.load8_u (i32.add (i32.add (local.get $ptr) (i32.const 4)) (local.get $i))) (i32.const 46)))
          (then
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (local.set $frac (f64.const 0.1))
            (block $done2
              (loop $parse2
                (br_if $done2 (i32.ge_s (local.get $i) (local.get $len)))
                (local.set $c (i32.load8_u (i32.add (i32.add (local.get $ptr) (i32.const 4)) (local.get $i))))
                (br_if $done2 (i32.or (i32.lt_u (local.get $c) (i32.const 48)) (i32.gt_u (local.get $c) (i32.const 57))))
                (local.set $result
                  (f64.add (local.get $result)
                    (f64.mul (f64.convert_i32_u (i32.sub (local.get $c) (i32.const 48))) (local.get $frac))))
                (local.set $frac (f64.mul (local.get $frac) (f64.const 0.1)))
                (local.set $i (i32.add (local.get $i) (i32.const 1)))
                (br $parse2)))))
        (if (result f64) (local.get $isNeg)
          (then (f64.neg (local.get $result)))
          (else (local.get $result))))))
  
  ;; Count non-overlapping occurrences of search string in str
  (func $str_count_of (param $str i32) (param $search i32) (result i32)
    (local $strLen i32)
    (local $searchLen i32)
    (local $count i32)
    (local $i i32)
    (local $j i32)
    (local $match i32)
    (if (result i32) (i32.or (i32.eqz (local.get $str)) (i32.eqz (local.get $search)))
      (then (i32.const 0))
      (else
        (local.set $strLen (i32.load (local.get $str)))
        (local.set $searchLen (i32.load (local.get $search)))
        (if (result i32) (i32.or (i32.eqz (local.get $searchLen)) (i32.gt_s (local.get $searchLen) (local.get $strLen)))
          (then (i32.const 0))
          (else
            (local.set $count (i32.const 0))
            (local.set $i (i32.const 0))
            (block $done
              (loop $outer
                (br_if $done (i32.gt_s (local.get $i) (i32.sub (local.get $strLen) (local.get $searchLen))))
                (local.set $match (i32.const 1))
                (local.set $j (i32.const 0))
                (block $nomatch
                  (loop $inner
                    (br_if $nomatch (i32.ge_s (local.get $j) (local.get $searchLen)))
                    (if (i32.ne
                          (i32.load8_u (i32.add (i32.add (local.get $str) (i32.const 4)) (i32.add (local.get $i) (local.get $j))))
                          (i32.load8_u (i32.add (i32.add (local.get $search) (i32.const 4)) (local.get $j))))
                      (then
                        (local.set $match (i32.const 0))
                        (br $nomatch)))
                    (local.set $j (i32.add (local.get $j) (i32.const 1)))
                    (br $inner)))
                (if (local.get $match)
                  (then
                    (local.set $count (i32.add (local.get $count) (i32.const 1)))
                    (local.set $i (i32.add (local.get $i) (local.get $searchLen)))
                    (br $outer)))
                (local.set $i (i32.add (local.get $i) (i32.const 1)))
                (br $outer)))
            (local.get $count))))))
  
  ;; Reverse string
  (func $str_reverse (param $ptr i32) (result i32)
    (local $len i32)
    (local $newPtr i32)
    (local $i i32)
    (if (result i32) (i32.eqz (local.get $ptr))
      (then (call $str_alloc (i32.const 0)))
      (else
        (local.set $len (i32.load (local.get $ptr)))
        (local.set $newPtr (call $str_alloc (local.get $len)))
        (local.set $i (i32.const 0))
        (block $break
          (loop $copy
            (br_if $break (i32.ge_s (local.get $i) (local.get $len)))
            (i32.store8
              (i32.add (i32.add (local.get $newPtr) (i32.const 4)) (local.get $i))
              (i32.load8_u (i32.add (i32.add (local.get $ptr) (i32.const 4)) (i32.sub (i32.sub (local.get $len) (i32.const 1)) (local.get $i)))))
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $copy)))
        (i32.store8 (i32.add (i32.add (local.get $newPtr) (i32.const 4)) (local.get $len)) (i32.const 0))
        (local.get $newPtr))))
  
  ;; Extract RGB component from hex string "#RRGGBB" or "RRGGBB"
  ;; component: 0=R, 1=G, 2=B
  (func $hexToRgbComponent (param $strPtr i32) (param $component i32) (result i32)
    (local $len i32)
    (local $dataStart i32)
    (local $offset i32)
    (if (i32.eqz (local.get $strPtr))
      (then (return (i32.const 0))))
    (local.set $len (call $str_length (local.get $strPtr)))
    ;; Check for "#RRGGBB" format (len >= 7 and starts with '#')
    (if (i32.and
          (i32.ge_s (local.get $len) (i32.const 7))
          (i32.eq (i32.load8_u (i32.add (local.get $strPtr) (i32.const 4))) (i32.const 35)))
      (then (local.set $dataStart (i32.add (local.get $strPtr) (i32.const 5))))
      (else
        ;; "RRGGBB" format - need at least 6 chars
        (if (i32.lt_s (local.get $len) (i32.const 6))
          (then (return (i32.const 0))))
        (local.set $dataStart (i32.add (local.get $strPtr) (i32.const 4)))))
    (local.set $offset (i32.mul (local.get $component) (i32.const 2)))
    (i32.add
      (i32.mul (call $hexCharToDigit (i32.load8_u (i32.add (local.get $dataStart) (local.get $offset)))) (i32.const 16))
      (call $hexCharToDigit (i32.load8_u (i32.add (local.get $dataStart) (i32.add (local.get $offset) (i32.const 1)))))))
  
    ;; Get list value as string pointer (converts number to string if needed)
  (func $list_get_as_str (param $listIdx i32) (param $index i32) (result i32)
    ;; For now, just convert the numeric value to string
    ;; TODO: Support mixed-type lists with type tagging
    (call $f64_to_str (call $list_get (local.get $listIdx) (local.get $index))))
  
  ;; Convert f64 to string pointer, or dereference if it's a negative-encoded string pointer
  ;; Convention: negative f64 = negated string pointer (i32), positive f64 = numeric value
  (func $f64_to_str_or_deref (param $val f64) (result i32)
    (if (result i32) (f64.lt (local.get $val) (f64.const 0))
      (then (i32.trunc_f64_s (f64.neg (local.get $val))))
      (else (call $f64_to_str (local.get $val)))))
  
  ;; Persist string to persistent pool (for strings stored in lists)
  ;; Strings in the temp pool are invalidated each tick - this copies them to a permanent location
  (func $str_persist (param $ptr i32) (result i32)
    (local $len i32)
    (local $newPtr i32)
    (local $i i32)
    ;; If null, return null
    (if (i32.eqz (local.get $ptr))
      (then (return (i32.const 0))))
    ;; If pointer is a static string (below dynamic pool start), it's permanent - return as-is
    (if (i32.lt_u (local.get $ptr) (i32.const ${this.getEffectivePoolStart()}))
      (then (return (local.get $ptr))))
    ;; If already in persistent pool, return as-is
    (if (i32.ge_u (local.get $ptr) (i32.const ${this.project.persistentPool?.start || 0}))
      (then (return (local.get $ptr))))
    ;; Copy string to persistent pool
    (local.set $len (i32.load (local.get $ptr)))
    (local.set $newPtr (global.get $persistent_pool_ptr))
    ;; Store length
    (i32.store (local.get $newPtr) (local.get $len))
    ;; Copy bytes
    (local.set $i (i32.const 0))
    (block $break
      (loop $copy
        (br_if $break (i32.ge_s (local.get $i) (local.get $len)))
        (i32.store8
          (i32.add (i32.add (local.get $newPtr) (i32.const 4)) (local.get $i))
          (i32.load8_u (i32.add (i32.add (local.get $ptr) (i32.const 4)) (local.get $i))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $copy)))
    ;; Null terminate
    (i32.store8 (i32.add (i32.add (local.get $newPtr) (i32.const 4)) (local.get $len)) (i32.const 0))
    ;; Advance persistent pool pointer (aligned to 4 bytes)
    (global.set $persistent_pool_ptr
      (i32.and
        (i32.add (i32.add (local.get $newPtr) (i32.add (local.get $len) (i32.const 5))) (i32.const 3))
        (i32.const -4)))
    (local.get $newPtr))
  
  ;; Convert a hex character ASCII code to its digit value (0-15)
  ;; '0'-'9' (48-57) -> 0-9, 'A'-'F' (65-70) -> 10-15, 'a'-'f' (97-102) -> 10-15
  (func $hexCharToDigit (param $c i32) (result i32)
    (if (result i32) (i32.and (i32.ge_u (local.get $c) (i32.const 48)) (i32.le_u (local.get $c) (i32.const 57)))
      (then (i32.sub (local.get $c) (i32.const 48)))
      (else
        (if (result i32) (i32.and (i32.ge_u (local.get $c) (i32.const 65)) (i32.le_u (local.get $c) (i32.const 70)))
          (then (i32.sub (local.get $c) (i32.const 55)))
          (else
            (if (result i32) (i32.and (i32.ge_u (local.get $c) (i32.const 97)) (i32.le_u (local.get $c) (i32.const 102)))
              (then (i32.sub (local.get $c) (i32.const 87)))
              (else (i32.const 0))))))))
  
  ;; Parse hex color string "#RRGGBB" or "RRGGBB" and set brush color
  ;; String layout: [len:i32 at ptr][data at ptr+4]
  (func $parseHexAndSetBrushColor (param $idx i32) (param $strPtr i32)
    (local $len i32)
    (local $r i32) (local $g i32) (local $b i32)
    (local $dataStart i32)
    (local.set $len (call $str_length (local.get $strPtr)))
    (if (i32.and
          (i32.ge_s (local.get $len) (i32.const 7))
          (i32.eq (i32.load8_u (i32.add (local.get $strPtr) (i32.const 4))) (i32.const 35)))
      (then
        (local.set $dataStart (i32.add (local.get $strPtr) (i32.const 5))))
      (else
        (if (i32.ge_s (local.get $len) (i32.const 6))
          (then
            (local.set $dataStart (i32.add (local.get $strPtr) (i32.const 4)))))))
    (if (local.get $dataStart)
      (then
        (local.set $r (i32.add
          (i32.mul (call $hexCharToDigit (i32.load8_u (local.get $dataStart))) (i32.const 16))
          (call $hexCharToDigit (i32.load8_u (i32.add (local.get $dataStart) (i32.const 1))))))
        (local.set $g (i32.add
          (i32.mul (call $hexCharToDigit (i32.load8_u (i32.add (local.get $dataStart) (i32.const 2)))) (i32.const 16))
          (call $hexCharToDigit (i32.load8_u (i32.add (local.get $dataStart) (i32.const 3))))))
        (local.set $b (i32.add
          (i32.mul (call $hexCharToDigit (i32.load8_u (i32.add (local.get $dataStart) (i32.const 4)))) (i32.const 16))
          (call $hexCharToDigit (i32.load8_u (i32.add (local.get $dataStart) (i32.const 5))))))
        (call $setBrushColorRGB (local.get $idx)
          (f64.convert_i32_s (local.get $r))
          (f64.convert_i32_s (local.get $g))
          (f64.convert_i32_s (local.get $b))))))
  
  ;; Parse hex color string "#RRGGBB" or "RRGGBB" and set fill color
  (func $parseHexAndSetFillColor (param $idx i32) (param $strPtr i32)
    (local $len i32)
    (local $r i32) (local $g i32) (local $b i32)
    (local $dataStart i32)
    (local.set $len (call $str_length (local.get $strPtr)))
    (if (i32.and
          (i32.ge_s (local.get $len) (i32.const 7))
          (i32.eq (i32.load8_u (i32.add (local.get $strPtr) (i32.const 4))) (i32.const 35)))
      (then
        (local.set $dataStart (i32.add (local.get $strPtr) (i32.const 5))))
      (else
        (if (i32.ge_s (local.get $len) (i32.const 6))
          (then
            (local.set $dataStart (i32.add (local.get $strPtr) (i32.const 4)))))))
    (if (local.get $dataStart)
      (then
        (local.set $r (i32.add
          (i32.mul (call $hexCharToDigit (i32.load8_u (local.get $dataStart))) (i32.const 16))
          (call $hexCharToDigit (i32.load8_u (i32.add (local.get $dataStart) (i32.const 1))))))
        (local.set $g (i32.add
          (i32.mul (call $hexCharToDigit (i32.load8_u (i32.add (local.get $dataStart) (i32.const 2)))) (i32.const 16))
          (call $hexCharToDigit (i32.load8_u (i32.add (local.get $dataStart) (i32.const 3))))))
        (local.set $b (i32.add
          (i32.mul (call $hexCharToDigit (i32.load8_u (i32.add (local.get $dataStart) (i32.const 4)))) (i32.const 16))
          (call $hexCharToDigit (i32.load8_u (i32.add (local.get $dataStart) (i32.const 5))))))
        (call $setFillColorRGB (local.get $idx)
          (f64.convert_i32_s (local.get $r))
          (f64.convert_i32_s (local.get $g))
          (f64.convert_i32_s (local.get $b))))))`;
    }

    /**
     * Generate message/signal helper functions
     */
    generateMessageFunctions() {
        const messages = this.project.messages || [];
        
        let code = `
  ;; ===== MESSAGE/SIGNAL FUNCTIONS =====`;
        
        if (messages.length === 0) {
            // Generate stub functions when no messages exist
            code += `
  
  ;; No messages defined - stub functions
  (func $setMessageFlag (param $msgIdx i32)
    (nop))
  
  (func $clearAllMessageFlags
    (nop))`;
            return code;
        }
        
        // Generate setMessageFlag function with switch on msgIdx
        code += `
  
  ;; Set message flag by index
  (func $setMessageFlag (param $msgIdx i32)`;
        
        for (let i = 0; i < messages.length; i++) {
            code += `
    (if (i32.eq (local.get $msgIdx) (i32.const ${i}))
      (then (global.set $msg_flag_${i} (i32.const 1))))`;
        }
        
        code += `)`;
        
        // Generate clearAllMessageFlags function
        code += `
  
  ;; Clear all message flags (called at end of frame)
  (func $clearAllMessageFlags`;
        
        for (let i = 0; i < messages.length; i++) {
            code += `
    (global.set $msg_flag_${i} (i32.const 0))`;
        }
        
        code += `)`;
        
        return code;
    }

    /**
     * Generate WASM functions for user-defined functions (함수)
     */
    generateUserFunctions() {
        const functions = this.project.functions || [];
        if (functions.length === 0) {
            return '\n  ;; ===== USER FUNCTIONS =====';
        }

        let code = '\n  ;; ===== USER FUNCTIONS =====';

        for (const func of functions) {
            code += this.generateUserFunction(func);
        }

        return code;
    }

    /**
     * Generate a single user-defined function
     */
    generateUserFunction(func) {
        const funcId = func.id;
        const funcName = func.name || `func_${funcId}`;
        const isValueFunc = func.type === 'value';

        // Parse the function content to extract parameters and body
        const { params, bodyBlocks, returnValueBlock } = this.parseFunctionContent(func);

        // Build parameter map for transpiling param blocks
        this.currentFuncParamMap = {};
        params.forEach((p, idx) => {
            this.currentFuncParamMap[p.type] = idx;
        });

        // Build local variable map for transpiling local variable blocks
        this.currentFuncLocalVarMap = {};
        const localVars = func.localVariables || [];
        localVars.forEach((v, idx) => {
            this.currentFuncLocalVarMap[v.id] = idx;
        });

        // Generate parameter declarations
        const paramDecls = params.map((p, idx) => `(param $param_${idx} f64)`).join(' ');
        const resultDecl = isValueFunc ? '(result f64)' : '';

        // Track whether current function returns a value (for stop_object return handling)
        this.currentFuncIsValue = isValueFunc;

        // Reset loop iteration counter for this function
        // This counter is used to generate unique loop variables for nested loops
        this.loopIterCounter = 0;

        // Generate function body FIRST so we know how many loop iter vars are needed
        // Use a special entity index marker that will be replaced with the local $entityIdx
        let bodyCode = '';
        for (const block of bodyBlocks) {
            if (block && block.type) {
                // Use -1 as entityIndex to indicate dynamic (from param)
                // Then replace the constant with the local variable
                let blockCode = this.blockTranspiler.transpile(block, -1, -1);
                // Replace (i32.const -1) with (local.get $entityIdx)
                blockCode = blockCode.replace(/\(i32\.const -1\)/g, '(local.get $entityIdx)');
                bodyCode += blockCode;
            }
        }

        // Generate return value for value functions
        let returnCode = '';
        if (isValueFunc) {
            if (returnValueBlock) {
                let retVal = this.blockTranspiler.transpileValue(returnValueBlock, -1);
                retVal = retVal.replace(/\(i32\.const -1\)/g, '(local.get $entityIdx)');
                returnCode = `\n    ;; Return value\n    ${retVal}`;
            } else {
                returnCode = '\n    ;; Default return value\n    (f64.const 0)';
            }
        }

        // Now generate local variable declarations (after body so we know how many loop vars needed)
        let localsDecl = `
    (local $temp f64)
    (local $condResult i32)
    (local $temp_str_ptr i32)`;

        // Add loop iteration variables (one for each nested loop in the function)
        for (let i = 0; i < this.loopIterCounter; i++) {
            localsDecl += `\n    (local $iter_${i} i32)`;
        }

        // Add local variable declarations for function local variables
        localVars.forEach((v, idx) => {
            localsDecl += `\n    (local $local_${idx} f64) ;; ${v.name}`;
        });

        // Clear param map, local var map, and value function flag
        this.currentFuncParamMap = null;
        this.currentFuncLocalVarMap = null;
        this.currentFuncIsValue = false;

        return `
  
  ;; User function: ${funcName}
  (func $user_func_${funcId} (param $entityIdx i32) ${paramDecls} ${resultDecl}${localsDecl}
    ${bodyCode}${returnCode}
  )`;
    }

    /**
     * Parse function content to extract parameters and body blocks
     * @param {Object} func - Parsed function object
     * @returns {{params: Array, bodyBlocks: Array, returnValueBlock: Object|null}}
     */
    parseFunctionContent(func) {
        const result = {
            params: [],
            bodyBlocks: [],
            returnValueBlock: null
        };

        const content = func.content || [];
        if (content.length === 0) {
            return result;
        }

        // Find the function definition block (function_create or function_create_value)
        const defBlock = content.find(block => 
            block && (block.type === 'function_create' || block.type === 'function_create_value')
        );

        if (!defBlock) {
            // If no definition block, treat all content as body
            result.bodyBlocks = content.filter(b => b && b.type);
            return result;
        }

        // Extract parameters from the field chain in params[0]
        if (defBlock.params && defBlock.params[0]) {
            this.extractFunctionParams(defBlock.params[0], result.params);
        }

        // Extract body blocks from statements[0]
        if (defBlock.statements && defBlock.statements[0]) {
            result.bodyBlocks = defBlock.statements[0].filter(b => b && b.type);
        }

        // For value functions, extract return value from params[3] (VALUE param)
        if (func.type === 'value' && defBlock.params && defBlock.params[3]) {
            result.returnValueBlock = defBlock.params[3];
        }

        return result;
    }

    /**
     * Extract function parameters from field chain
     * @param {Object} fieldBlock - The field block (function_field_label, etc.)
     * @param {Array} params - Array to collect parameters
     */
    extractFunctionParams(fieldBlock, params) {
        if (!fieldBlock || !fieldBlock.type) {
            return;
        }

        // Check if this field is a parameter
        if (fieldBlock.type === 'function_field_string') {
            // String parameter - params[0] contains the param block
            if (fieldBlock.params && fieldBlock.params[0] && fieldBlock.params[0].type) {
                params.push({
                    type: fieldBlock.params[0].type,
                    accept: 'string'
                });
            }
        } else if (fieldBlock.type === 'function_field_boolean') {
            // Boolean parameter - params[0] contains the param block
            if (fieldBlock.params && fieldBlock.params[0] && fieldBlock.params[0].type) {
                params.push({
                    type: fieldBlock.params[0].type,
                    accept: 'boolean'
                });
            }
        }
        // function_field_label is just a label, skip it

        // Recursively process the next field (linked via params[1] or output)
        if (fieldBlock.params && fieldBlock.params[1]) {
            this.extractFunctionParams(fieldBlock.params[1], params);
        }
    }

    generateThreadFunctions() {
        let code = '\n  ;; ===== THREAD EXECUTION FUNCTIONS =====';
        
        let threadIndex = 0;
        for (let objIdx = 0; objIdx < this.project.objects.length; objIdx++) {
            const obj = this.project.objects[objIdx];
            
            for (let scriptIdx = 0; scriptIdx < obj.scripts.length; scriptIdx++) {
                const thread = obj.scripts[scriptIdx];
                if (!thread || thread.length === 0) continue;

                const eventBlock = thread[0];
                if (!eventBlock) continue;

                code += this.generateThreadFunction(threadIndex, objIdx, thread);
                threadIndex++;
            }
        }

        return code;
    }

    generateThreadFunction(threadIndex, entityIndex, thread) {
        const eventBlock = thread[0];
        const eventType = eventBlock?.type || 'unknown';
        
        // Reset local variables for this thread
        this.localVars.clear();
        this.currentEntityIndex = entityIndex;

        let code = `
  
  ;; Thread ${threadIndex}: ${eventType} for entity ${entityIndex}
  (func $thread_${threadIndex}_run (param $entityIdx i32) (result i32)
    (local $pc i32)
    (local $temp f64)
    (local $iterCount i32)
    (local $condResult i32)
    (local $temp_str_ptr i32)
    
    ;; Get current program counter
    (local.set $pc (global.get $thread_${threadIndex}_pc))
    
    ;; Check if waiting
    (if (f64.gt (global.get $thread_${threadIndex}_waiting) (f64.const 0))
      (then
        (global.set $thread_${threadIndex}_waiting
          (f64.sub (global.get $thread_${threadIndex}_waiting) (global.get $deltaTime)))
        (return (i32.const 1))))  ;; Still running
    
    ;; Execute based on PC
    (block $end
      (block $done`;

        // Generate code for each block in the thread (skip event block)
        let pc = 0;
        for (let i = 1; i < thread.length; i++) {
            const block = thread[i];
            if (!block) continue;
            
            code += `
        (block $pc_${pc}
          (br_if $pc_${pc} (i32.ne (local.get $pc) (i32.const ${pc})))`;
            
            code += this.blockTranspiler.transpile(block, entityIndex, threadIndex, 0);  // Start at loopDepth 0
            
            code += `
          (local.set $pc (i32.add (local.get $pc) (i32.const 1)))
          (global.set $thread_${threadIndex}_pc (local.get $pc))
          (global.set $thread_${threadIndex}_resumeDepth (i32.const 0))
          (br $done))`;
            
            pc++;
        }

        code += `
        ;; End of thread
        (global.set $thread_${threadIndex}_pc (i32.const 0))
        (global.set $thread_${threadIndex}_resumeDepth (i32.const 0))
        (return (i32.const 0))  ;; Thread finished
      )  ;; $done
    )  ;; $end
    
    (i32.const 1)  ;; Thread still running
  )`;

        return code;
    }

    generateMainLoop() {
        let eventHandlers = '';
        let sceneStartHandlers = '';
        let objectClickHandlers = '';
        let objectClickCanceledHandlers = '';
        let messageHandlers = '';
        let threadCalls = '';
        
        let threadIndex = 0;
        for (let objIdx = 0; objIdx < this.project.objects.length; objIdx++) {
            const obj = this.project.objects[objIdx];
            const objSceneIndex = obj.sceneIndex || 0;
            
            for (let scriptIdx = 0; scriptIdx < obj.scripts.length; scriptIdx++) {
                const thread = obj.scripts[scriptIdx];
                if (!thread || thread.length === 0) continue;

                const eventBlock = thread[0];
                if (!eventBlock) continue;

                // Generate event activation logic
                const eventType = eventBlock.type;
                if (eventType === 'when_run_button_click') {
                    // Only activate if entity is in current scene
                    const maxLoopDepth = this.threadLoopDepths[threadIndex] || 1;
                    let resetLoopCounters = '';
                    for (let d = 0; d < maxLoopDepth; d++) {
                        resetLoopCounters += `\n        (global.set $thread_${threadIndex}_loopCounter_${d} (i32.const -1))`;
                    }
                    resetLoopCounters += `\n        (global.set $thread_${threadIndex}_resumeDepth (i32.const 0))`;
                    eventHandlers += `
    ;; Activate thread ${threadIndex} on start (entity scene: ${objSceneIndex})
    (if (i32.and
          (global.get $isFirstFrame)
          (i32.eq (i32.const ${objSceneIndex}) (global.get $currentScene)))
      (then${resetLoopCounters}
        (global.set $thread_${threadIndex}_active (i32.const 1))))`;
                } else if (eventType === 'when_some_key_pressed') {
                    const keycode = eventBlock.params?.[1] || 81;
                    // Only activate if entity is in current scene
                    const maxLoopDepth = this.threadLoopDepths[threadIndex] || 1;
                    let resetLoopCounters = '';
                    for (let d = 0; d < maxLoopDepth; d++) {
                        resetLoopCounters += `\n        (global.set $thread_${threadIndex}_loopCounter_${d} (i32.const -1))`;
                    }
                    resetLoopCounters += `\n        (global.set $thread_${threadIndex}_resumeDepth (i32.const 0))`;
                    eventHandlers += `
    ;; Activate thread ${threadIndex} on key ${keycode} (entity scene: ${objSceneIndex})
    (if (i32.and
          (call $isKeyPressed (i32.const ${keycode}))
          (i32.eq (i32.const ${objSceneIndex}) (global.get $currentScene)))
      (then${resetLoopCounters}
        (global.set $thread_${threadIndex}_active (i32.const 1))))`;
                } else if (eventType === 'when_scene_start') {
                    // Activate when scene changes to this entity's scene
                    const maxLoopDepth = this.threadLoopDepths[threadIndex] || 1;
                    let resetLoopCounters = '';
                    for (let d = 0; d < maxLoopDepth; d++) {
                        resetLoopCounters += `\n        (global.set $thread_${threadIndex}_loopCounter_${d} (i32.const -1))`;
                    }
                    resetLoopCounters += `\n        (global.set $thread_${threadIndex}_resumeDepth (i32.const 0))`;
                    sceneStartHandlers += `
    ;; Activate thread ${threadIndex} on scene start (entity scene: ${objSceneIndex})
    (if (i32.and
          (global.get $sceneJustChanged)
          (i32.eq (i32.const ${objSceneIndex}) (global.get $currentScene)))
      (then
        (global.set $thread_${threadIndex}_pc (i32.const 0))
        (global.set $thread_${threadIndex}_waiting (f64.const 0))${resetLoopCounters}
        (global.set $thread_${threadIndex}_active (i32.const 1))))`;
                } else if (eventType === 'when_object_click') {
                    // Activate when this entity is clicked (new click on entity)
                    // $clickedEntityIndex is set by $updateClickState when a new click is detected
                    const maxLoopDepth = this.threadLoopDepths[threadIndex] || 1;
                    let resetLoopCounters = '';
                    for (let d = 0; d < maxLoopDepth; d++) {
                        resetLoopCounters += `\n        (global.set $thread_${threadIndex}_loopCounter_${d} (i32.const -1))`;
                    }
                    resetLoopCounters += `\n        (global.set $thread_${threadIndex}_resumeDepth (i32.const 0))`;
                    objectClickHandlers += `
    ;; Activate thread ${threadIndex} when object ${objIdx} is clicked
    (if (i32.and
          ;; Check if this entity was just clicked
          (i32.eq (global.get $clickedEntityIndex) (i32.const ${objIdx}))
          ;; And this is a new click (prev was not clicked)
          (i32.eqz (global.get $prevMouseClicked)))
      (then
        (global.set $thread_${threadIndex}_pc (i32.const 0))
        (global.set $thread_${threadIndex}_waiting (f64.const 0))${resetLoopCounters}
        (global.set $thread_${threadIndex}_active (i32.const 1))))`;
                } else if (eventType === 'when_object_click_canceled') {
                    // Activate when click is released on this entity
                    const maxLoopDepth = this.threadLoopDepths[threadIndex] || 1;
                    let resetLoopCounters = '';
                    for (let d = 0; d < maxLoopDepth; d++) {
                        resetLoopCounters += `\n        (global.set $thread_${threadIndex}_loopCounter_${d} (i32.const -1))`;
                    }
                    resetLoopCounters += `\n        (global.set $thread_${threadIndex}_resumeDepth (i32.const 0))`;
                    objectClickCanceledHandlers += `
    ;; Activate thread ${threadIndex} when object ${objIdx} click is released
    (if (i32.and
          ;; Check if this entity was the clicked entity
          (i32.eq (global.get $clickedEntityIndex) (i32.const ${objIdx}))
          ;; And click was just released (prev was clicked, now is not)
          (i32.and
            (global.get $prevMouseClicked)
            (i32.eqz (call $isMouseClicked))))
      (then
        (global.set $thread_${threadIndex}_pc (i32.const 0))
        (global.set $thread_${threadIndex}_waiting (f64.const 0))${resetLoopCounters}
        (global.set $thread_${threadIndex}_active (i32.const 1))))`;
                } else if (eventType === 'when_message_cast') {
                    // Activate when the corresponding message is sent
                    // Note: params[0] is null (dropdown), params[1] is the messageId
                    const messageId = eventBlock.params?.[1] || eventBlock.params?.[0];
                    const message = this.project.messages.find(m => m.id === messageId);
                    const msgIndex = message?.index ?? -1;
                    if (msgIndex >= 0) {
                        const maxLoopDepth = this.threadLoopDepths[threadIndex] || 1;
                        let resetLoopCounters = '';
                        for (let d = 0; d < maxLoopDepth; d++) {
                            resetLoopCounters += `\n        (global.set $thread_${threadIndex}_loopCounter_${d} (i32.const -1))`;
                        }
                        resetLoopCounters += `\n        (global.set $thread_${threadIndex}_resumeDepth (i32.const 0))`;
                        messageHandlers += `
    ;; Activate thread ${threadIndex} when message "${message?.name || messageId}" is received (entity scene: ${objSceneIndex})
    (if (i32.and
          (global.get $msg_flag_${msgIndex})
          (i32.eq (i32.const ${objSceneIndex}) (global.get $currentScene)))
      (then
        (global.set $thread_${threadIndex}_pc (i32.const 0))
        (global.set $thread_${threadIndex}_waiting (f64.const 0))${resetLoopCounters}
        (global.set $thread_${threadIndex}_active (i32.const 1))))`;
                    }
                }

                // Generate thread execution call
                // Guard with sceneJustChanged check to stop remaining threads when scene changes mid-tick
                threadCalls += `
    ;; Run thread ${threadIndex}
    (if (i32.and (global.get $thread_${threadIndex}_active) (i32.eqz (global.get $sceneJustChanged)))
      (then
        (if (i32.eqz (call $thread_${threadIndex}_run (i32.const ${objIdx})))
          (then (global.set $thread_${threadIndex}_active (i32.const 0))))))`;

                threadIndex++;
            }
        }

        // Generate scene change cleanup code (deactivate ALL threads and clear dialogs)
        let sceneChangeCleanup = '';
        {
            let tidx = 0;
            for (const obj of this.project.objects) {
                for (let i = 0; i < obj.scripts.length; i++) {
                    sceneChangeCleanup += `\n        (global.set $thread_${tidx}_active (i32.const 0))`;
                    sceneChangeCleanup += `\n        (global.set $thread_${tidx}_pc (i32.const 0))`;
                    sceneChangeCleanup += `\n        (global.set $thread_${tidx}_waiting (f64.const 0))`;
                    const maxLoopDepth = this.threadLoopDepths[tidx] || 1;
                    for (let d = 0; d < maxLoopDepth; d++) {
                        sceneChangeCleanup += `\n        (global.set $thread_${tidx}_loopCounter_${d} (i32.const -1))`;
                    }
                    sceneChangeCleanup += `\n        (global.set $thread_${tidx}_resumeDepth (i32.const 0))`;
                    tidx++;
                }
            }
            // Clear all dialog bubbles
            for (let i = 0; i < this.project.objects.length; i++) {
                sceneChangeCleanup += `\n        (global.set $dialog_type_${i} (i32.const 0))`;
                sceneChangeCleanup += `\n        (global.set $dialog_text_ptr_${i} (i32.const 0))`;
            }
        }

        return `
  ;; ===== MAIN LOOP =====
  
  ;; Initialize entities with their starting values
  (func $init
    ;; Reset scene to first scene
    (global.set $currentScene (i32.const 0))
    (global.set $sceneJustChanged (i32.const 1))
    ;; Reset click tracking state
    (global.set $prevMouseClicked (i32.const 0))
    (global.set $clickedEntityIndex (i32.const -1))
    ;; Reset first frame flag
    (global.set $isFirstFrame (i32.const 1))
    ;; Reset persistent string pool
    (global.set $persistent_pool_ptr (i32.const ${this.project.persistentPool?.start || 0}))
    ${this.generateEntityInitialization()}
    ${this.generateVariableInitialization()}
    ${this.generateListInitialization()}
    (global.set $running (i32.const 1)))
  
  ;; Main tick function - called every frame from JS
  (func $tick (param $dt f64)
    ;; Reset string pool to reclaim temporary strings from previous tick
    (global.set $str_pool_ptr (i32.const ${this.getEffectivePoolStart()}))
    (global.set $deltaTime (local.get $dt))
    
    ;; Update click tracking state (detect new clicks)
    (call $updateClickState)
    
    ;; On scene change: deactivate ALL threads and clear dialog bubbles
    ;; This matches EntryJS behavior where resetSceneDuringRun() clears all executors
    (if (global.get $sceneJustChanged)
      (then${sceneChangeCleanup}))
    
    ;; Handle scene change events (when_scene_start)
    ${sceneStartHandlers}
    
    ;; Reset scene changed flag after processing
    (global.set $sceneJustChanged (i32.const 0))
    
    ;; Handle object click events (when_object_click)
    ${objectClickHandlers}
    
    ;; Handle object click canceled events (when_object_click_canceled)
    ${objectClickCanceledHandlers}
    
    ;; Handle message events (when_message_cast)
    ${messageHandlers}
    
    ;; Clear message flags AFTER handlers activated, BEFORE threads execute
    ;; This ensures signals sent in frame N are received in frame N+1
    (call $clearAllMessageFlags)
    
    ;; Check events and activate threads
    ${eventHandlers}
    
    ;; Execute active threads
    ${threadCalls}
    
    ;; Finalize click state (update prevMouseClicked, clear clickedEntityIndex on release)
    (call $finalizeClickState)
    
    ;; Clear first frame flag and increment frame counter
    (global.set $isFirstFrame (i32.const 0))
    (global.set $frameCount (i32.add (global.get $frameCount) (i32.const 1))))
  
  ;; Stop execution
  (func $stop
    (global.set $running (i32.const 0)))
  
  ;; Get entity count
  (func $getEntityCount (result i32)
    (i32.const ${this.project.objects.length}))`;
    }

    generateEntityInitialization() {
        let code = '';
        for (const obj of this.project.objects) {
            const idx = obj.memoryIndex;
            const e = obj.entity;
            const sceneIdx = obj.sceneIndex || 0;
            // Entity is visible only if it belongs to scene 0 (first scene) AND its original visible state is true
            const initialVisible = (sceneIdx === 0 && e.visible) ? 1 : 0;
            // scaleX/scaleY default to 1.0 if not specified
            const scaleX = e.scaleX ?? 1;
            const scaleY = e.scaleY ?? 1;
            // size is percentage-based: 100 = 100% = scale of 1.0
            // Initialize size from scaleX (assuming scaleX == scaleY for uniform scale)
            const size = scaleX * 100;
            code += `
    ;; Initialize entity ${idx}: ${obj.name} (scene: ${sceneIdx})
    (call $setX (i32.const ${idx}) (f64.const ${e.x}))
    (call $setY (i32.const ${idx}) (f64.const ${e.y}))
    (call $setRotation (i32.const ${idx}) (f64.const ${e.rotation}))
    (call $setDirection (i32.const ${idx}) (f64.const ${e.direction}))
    (call $setScaleX (i32.const ${idx}) (f64.const ${scaleX}))
    (call $setScaleY (i32.const ${idx}) (f64.const ${scaleY}))
    (call $setSize (i32.const ${idx}) (f64.const ${size}))
    (call $setVisible (i32.const ${idx}) (i32.const ${initialVisible}))
    (call $setInitialVisible (i32.const ${idx}) (i32.const ${e.visible ? 1 : 0}))
    (call $setWidth (i32.const ${idx}) (f64.const ${e.width}))
    (call $setHeight (i32.const ${idx}) (f64.const ${e.height}))
    (call $setPictureIndex (i32.const ${idx}) (i32.const 0))
    (call $setSceneIndex (i32.const ${idx}) (i32.const ${sceneIdx}))
    ;; Initialize brush colors to default red (255, 0, 0)
    (call $setBrushColorRGB (i32.const ${idx}) (f64.const 255) (f64.const 0) (f64.const 0))
    (call $setFillColorRGB (i32.const ${idx}) (f64.const 255) (f64.const 0) (f64.const 0))`;
        }
        return code;
    }

    generateVariableInitialization() {
        let code = '';
        for (const v of this.project.variables.variables) {
            const numVal = parseFloat(v.value) || 0;
            code += `
    ;; Initialize variable: ${v.name}
    (call $setVariable (i32.const ${v.memoryOffset}) (f64.const ${numVal}))`;
        }
        return code;
    }

    generateListInitialization() {
        let code = '';
        const lists = this.project.variables.lists || [];
        
        for (const list of lists) {
            const listIdx = list.memoryIndex;
            const initialArray = list.array || [];
            
            code += `
    ;; Initialize list: ${list.name} (index ${listIdx})
    ;; Set metadata: length=0, capacity=${list.capacity}, data_ptr=${list.dataOffset}
    (i32.store (i32.const ${list.metaOffset}) (i32.const 0))
    (i32.store (i32.const ${list.metaOffset + 4}) (i32.const ${list.capacity}))
    (i32.store (i32.const ${list.metaOffset + 8}) (i32.const ${list.dataOffset}))`;
            
            // Add initial values
            for (let i = 0; i < initialArray.length && i < list.capacity; i++) {
                const val = parseFloat(initialArray[i].data || initialArray[i]) || 0;
                code += `
    (call $list_push (i32.const ${listIdx}) (f64.const ${val}))`;
            }
        }
        
        return code;
    }

    generateExports() {
        const variables = this.project.variables.variables || [];
        const lists = this.project.variables.lists || [];
        const entityCount = this.project.objects.length;
        
        let code = `
  ;; ===== EXPORTS =====
  (export "init" (func $init))
  (export "tick" (func $tick))
  (export "stop" (func $stop))
  (export "getEntityCount" (func $getEntityCount))
  (export "getX" (func $getX))
  (export "getY" (func $getY))
  (export "getRotation" (func $getRotation))
  (export "getDirection" (func $getDirection))
  (export "getScaleX" (func $getScaleX))
  (export "getScaleY" (func $getScaleY))
  (export "getSize" (func $getSize))
  (export "getVisible" (func $getVisible))
  (export "getWidth" (func $getWidth))
  (export "getHeight" (func $getHeight))
  (export "getPictureIndex" (func $getPictureIndex))
  (export "getSceneIndex" (func $getSceneIndex))
  (export "getCurrentScene" (func $getCurrentScene))
  (export "getSceneCount" (func $getSceneCount))
  (export "startScene" (func $startScene))
  (export "startNeighborScene" (func $startNeighborScene))
  ;; Brush color exports (for JS renderer to read)
  (export "getBrushColorR" (func $getBrushColorR))
  (export "getBrushColorG" (func $getBrushColorG))
  (export "getBrushColorB" (func $getBrushColorB))
  (export "getFillColorR" (func $getFillColorR))
  (export "getFillColorG" (func $getFillColorG))
  (export "getFillColorB" (func $getFillColorB))`;
        
        // Export variable visibility accessors
        for (let i = 0; i < variables.length; i++) {
            code += `\n  (export "getVarVisible_${i}" (func $getVarVisible_${i}))`;
        }
        
        // Export list visibility accessors
        for (let i = 0; i < lists.length; i++) {
            code += `\n  (export "getListVisible_${i}" (func $getListVisible_${i}))`;
        }
        
        // Export dialog accessors
        for (let i = 0; i < entityCount; i++) {
            code += `\n  (export "getDialogType_${i}" (func $getDialogType_${i}))`;
            code += `\n  (export "getDialogTextPtr_${i}" (func $getDialogTextPtr_${i}))`;
        }
        
        // Export string helper for reading strings from memory
        code += `\n  (export "str_length" (func $str_length))`;
        code += `\n  (export "str_alloc" (func $str_alloc))`;
        
        // Export variable/list accessor for renderer to read values
        code += `\n  (export "getVariable" (func $getVariable))`;
        code += `\n  (export "list_length" (func $list_length))`;
        code += `\n  (export "list_get" (func $list_get))`;
        
        code += `\n)`;
        return code;
    }

    getNewLabel() {
        return `label_${this.labelCounter++}`;
    }
}

module.exports = { generateWAT, WATGenerator };
