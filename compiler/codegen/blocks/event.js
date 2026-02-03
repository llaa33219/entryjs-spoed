/**
 * Event Block Handlers
 * 
 * Handles event/trigger blocks (when_run_button_click, when_key_pressed, etc.)
 * These blocks don't generate code themselves but are used to determine
 * when threads should be activated.
 */

const statementBlocks = {
    // Event blocks typically don't generate WAT code directly
    // They are handled by the thread activation logic in wat-generator
    
    'when_run_button_click': (ctx, block, entityIndex, threadIndex) => {
        return `
          ;; Event: when_run_button_click (handled by activation logic)`;
    },

    'when_some_key_pressed': (ctx, block, entityIndex, threadIndex) => {
        const keycode = block.params?.[1] || 81;
        return `
          ;; Event: when_some_key_pressed (key: ${keycode})`;
    },

    'when_object_click': (ctx, block, entityIndex, threadIndex) => {
        return `
          ;; Event: when_object_click`;
    },

    'when_message_cast': (ctx, block, entityIndex, threadIndex) => {
        const messageId = block.params?.[0];
        return `
          ;; Event: when_message_cast (message: ${messageId})`;
    },

    'when_scene_start': (ctx, block, entityIndex, threadIndex) => {
        return `
          ;; Event: when_scene_start`;
    },

    'when_clone_start': (ctx, block, entityIndex, threadIndex) => {
        return `
          ;; Event: when_clone_start`;
    },

    'mouse_clicked': (ctx, block, entityIndex, threadIndex) => {
        return `
          ;; Event: mouse_clicked (handled by activation logic)`;
    },

    'mouse_click_cancled': (ctx, block, entityIndex, threadIndex) => {
        return `
          ;; Event: mouse_click_cancled (handled by activation logic)`;
    },

    'when_object_click_canceled': (ctx, block, entityIndex, threadIndex) => {
        return `
          ;; Event: when_object_click_canceled (handled by activation logic)`;
    },

    // Clone operations
    'create_clone': (ctx, block, entityIndex) => {
        const targetId = block.params?.[0];
        let targetIndex = entityIndex;
        if (targetId && targetId !== 'self') {
            const idx = ctx.generator.project.objects.findIndex(o => o.id === targetId);
            if (idx >= 0) targetIndex = idx;
        }
        return `
          ;; create_clone
          (call $createClone (i32.const ${targetIndex}))`;
    },

    'delete_clone': (ctx, block, entityIndex, threadIndex) => {
        return `
          ;; delete_clone
          (call $deleteClone (i32.const ${entityIndex}))
          (global.set $thread_${threadIndex}_active (i32.const 0))
          (return (i32.const 0))`;
    },

    // Scene operations
    'start_scene': (ctx, block, entityIndex, threadIndex) => {
        const sceneId = block.params?.[0];
        const scene = ctx.generator.project.scenes.find(s => s.id === sceneId);
        const sceneIndex = scene?.index || 0;
        // Scene change terminates the current thread
        return `
          ;; start_scene (changes to scene ${sceneIndex})
          (call $startScene (i32.const ${sceneIndex}))
          ;; Terminate this thread after scene change
          (global.set $thread_${threadIndex}_pc (i32.const 0))
          (global.set $thread_${threadIndex}_active (i32.const 0))
          (return (i32.const 0))`;
    },

    'start_neighbor_scene': (ctx, block, entityIndex, threadIndex) => {
        const direction = block.params?.[0];
        const offset = direction === 'prev' ? -1 : 1;
        // Scene change terminates the current thread
        return `
          ;; start_neighbor_scene (${direction})
          (call $startNeighborScene (i32.const ${offset}))
          ;; Terminate this thread after scene change
          (global.set $thread_${threadIndex}_pc (i32.const 0))
          (global.set $thread_${threadIndex}_active (i32.const 0))
          (return (i32.const 0))`;
    }
};

const valueBlocks = {
    'get_scene_name': (ctx, block, entityIndex) => {
        // Scene name is a string, return index as number for now
        return '(f64.const 0)';
    }
};

const booleanBlocks = {};

module.exports = { statementBlocks, valueBlocks, booleanBlocks };
