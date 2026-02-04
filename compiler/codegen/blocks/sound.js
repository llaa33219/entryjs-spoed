/**
 * Sound and Message Block Handlers
 * 
 * Handles blocks related to sounds and messaging.
 */

const statementBlocks = {
    // Sound blocks
    'sound_something': (ctx, block, entityIndex) => {
        const soundId = block.params?.[0];
        // Find sound index
        const obj = ctx.generator.project.objects[entityIndex];
        const soundIndex = obj?.sounds?.findIndex(s => s.id === soundId) || 0;
        return `
          ;; play_sound
          (call $playSound (i32.const ${entityIndex}) (i32.const ${soundIndex}))`;
    },

    'sound_something_with_block': (ctx, block, entityIndex) => {
        const soundId = block.params?.[0];
        const obj = ctx.generator.project.objects[entityIndex];
        const soundIndex = obj?.sounds?.findIndex(s => s.id === soundId) || 0;
        return `
          ;; play_sound_and_wait
          (call $playSoundAndWait (i32.const ${entityIndex}) (i32.const ${soundIndex}))`;
    },

    'sound_something_second': (ctx, block, entityIndex) => {
        const soundId = block.params?.[0];
        const seconds = ctx.transpileValue(block.params?.[1], entityIndex);
        const obj = ctx.generator.project.objects[entityIndex];
        const soundIndex = obj?.sounds?.findIndex(s => s.id === soundId) || 0;
        return `
          ;; play_sound_for_seconds
          (call $playSoundForSeconds (i32.const ${entityIndex}) (i32.const ${soundIndex}) ${seconds})`;
    },

    'sound_from_to': (ctx, block, entityIndex) => {
        const soundId = block.params?.[0];
        const startTime = ctx.transpileValue(block.params?.[1], entityIndex);
        const endTime = ctx.transpileValue(block.params?.[2], entityIndex);
        const obj = ctx.generator.project.objects[entityIndex];
        const soundIndex = obj?.sounds?.findIndex(s => s.id === soundId) || 0;
        return `
          ;; sound_from_to
          (call $playSoundFromTo (i32.const ${entityIndex}) (i32.const ${soundIndex}) ${startTime} ${endTime})`;
    },

    'sound_something_wait_with_block': (ctx, block, entityIndex, threadIndex) => {
        // Get sound from block parameter (could be get_sounds block)
        let soundBlock = block.params?.[0];
        let soundIndex = 0;
        
        // Handle get_sounds block
        if (soundBlock && typeof soundBlock === 'object' && soundBlock.type === 'get_sounds') {
            const soundId = soundBlock.params?.[0];
            const obj = ctx.generator.project.objects[entityIndex];
            soundIndex = obj?.sounds?.findIndex(s => s.id === soundId) || 0;
        } else if (soundBlock) {
            const obj = ctx.generator.project.objects[entityIndex];
            soundIndex = obj?.sounds?.findIndex(s => s.id === soundBlock) || 0;
        }
        
        const obj = ctx.generator.project.objects[entityIndex];
        const duration = obj?.sounds?.[soundIndex]?.duration || 1;
        return `
          ;; sound_something_wait_with_block
          (call $playSound (i32.const ${entityIndex}) (i32.const ${soundIndex}))
          (global.set $thread_${threadIndex}_waiting (f64.const ${duration}))`;
    },

    'sound_something_second_wait_with_block': (ctx, block, entityIndex, threadIndex) => {
        let soundBlock = block.params?.[0];
        const seconds = ctx.transpileValue(block.params?.[1], entityIndex);
        let soundIndex = 0;
        
        if (soundBlock && typeof soundBlock === 'object' && soundBlock.type === 'get_sounds') {
            const soundId = soundBlock.params?.[0];
            const obj = ctx.generator.project.objects[entityIndex];
            soundIndex = obj?.sounds?.findIndex(s => s.id === soundId) || 0;
        } else if (soundBlock) {
            const obj = ctx.generator.project.objects[entityIndex];
            soundIndex = obj?.sounds?.findIndex(s => s.id === soundBlock) || 0;
        }
        
        return `
          ;; sound_something_second_wait_with_block
          (call $playSoundForSeconds (i32.const ${entityIndex}) (i32.const ${soundIndex}) ${seconds})
          (global.set $thread_${threadIndex}_waiting ${seconds})`;
    },

    'sound_from_to_and_wait': (ctx, block, entityIndex, threadIndex) => {
        const soundId = block.params?.[0];
        const startTime = ctx.transpileValue(block.params?.[1], entityIndex);
        const endTime = ctx.transpileValue(block.params?.[2], entityIndex);
        const obj = ctx.generator.project.objects[entityIndex];
        const soundIndex = obj?.sounds?.findIndex(s => s.id === soundId) || 0;
        return `
          ;; sound_from_to_and_wait
          (call $playSoundFromTo (i32.const ${entityIndex}) (i32.const ${soundIndex}) ${startTime} ${endTime})
          ;; Wait for duration (endTime - startTime)
          (global.set $thread_${threadIndex}_waiting (f64.sub ${endTime} ${startTime}))`;
    },

    'sound_speed_change': (ctx, block, entityIndex) => {
        const value = ctx.transpileValue(block.params?.[0], entityIndex);
        return `
          ;; sound_speed_change
          (call $changeSoundSpeed (i32.const ${entityIndex}) ${value})`;
    },

    'sound_speed_set': (ctx, block, entityIndex) => {
        const value = ctx.transpileValue(block.params?.[0], entityIndex);
        return `
          ;; sound_speed_set
          (call $setSoundSpeed (i32.const ${entityIndex}) ${value})`;
    },

    'play_bgm': (ctx, block, entityIndex) => {
        const soundId = block.params?.[0];
        const obj = ctx.generator.project.objects[entityIndex];
        const soundIndex = obj?.sounds?.findIndex(s => s.id === soundId) || 0;
        return `
          ;; play_bgm
          (call $playBGM (i32.const ${entityIndex}) (i32.const ${soundIndex}))`;
    },

    'stop_bgm': (ctx, block, entityIndex) => {
        return `
          ;; stop_bgm
          (call $stopBGM)`;
    },

    'sound_volume_change': (ctx, block, entityIndex) => {
        const value = ctx.transpileValue(block.params?.[0], entityIndex);
        return `
          ;; change_sound_volume
          (call $changeSoundVolume (i32.const ${entityIndex}) ${value})`;
    },

    'sound_volume_set': (ctx, block, entityIndex) => {
        const value = ctx.transpileValue(block.params?.[0], entityIndex);
        return `
          ;; set_sound_volume
          (call $setSoundVolume (i32.const ${entityIndex}) ${value})`;
    },

    'sound_silent_all': (ctx, block, entityIndex) => {
        return `
          ;; stop_all_sounds
          (call $stopAllSounds)`;
    },

    // Message blocks
    'message_cast': (ctx, block, entityIndex) => {
        const messageId = block.params?.[0];
        const message = ctx.generator.project.messages.find(m => m.id === messageId);
        const msgIndex = message?.index || 0;
        return `
          ;; message_cast
          (call $sendMessage (i32.const ${msgIndex}))`;
    },

    'message_cast_wait': (ctx, block, entityIndex, threadIndex) => {
        const messageId = block.params?.[0];
        const message = ctx.generator.project.messages.find(m => m.id === messageId);
        const msgIndex = message?.index || 0;
        return `
          ;; message_cast_and_wait
          (call $sendMessageAndWait (i32.const ${msgIndex}))`;
    },

    // Note: dialog, dialog_time, remove_dialog are now handled by looks.js
    // They were moved there to support proper string handling with WASM memory
};

const valueBlocks = {
    'get_sound_volume': (ctx, block, entityIndex) => {
        return `(call $getSoundVolume (i32.const ${entityIndex}))`;
    },

    'get_sound_speed': (ctx, block, entityIndex) => {
        return `(call $getSoundSpeed (i32.const ${entityIndex}))`;
    },

    'get_sounds': (ctx, block, entityIndex) => {
        // Returns sound index for use in other sound blocks
        const soundId = block.params?.[0];
        const obj = ctx.generator.project.objects[entityIndex];
        const soundIndex = obj?.sounds?.findIndex(s => s.id === soundId) || 0;
        return `(f64.const ${soundIndex})`;
    }
};

const booleanBlocks = {};

module.exports = { statementBlocks, valueBlocks, booleanBlocks };
