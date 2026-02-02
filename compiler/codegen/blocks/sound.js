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

    // Say/think blocks (dialog)
    'dialog_time': (ctx, block, entityIndex, threadIndex) => {
        const text = block.params?.[0];
        const seconds = ctx.transpileValue(block.params?.[1], entityIndex);
        const type = block.params?.[2] || 'speak';
        return `
          ;; dialog_time: ${type}
          (call $showDialog (i32.const ${entityIndex}) (i32.const ${type === 'think' ? 1 : 0}))
          (global.set $thread_${threadIndex}_waiting ${seconds})`;
    },

    'dialog': (ctx, block, entityIndex) => {
        const text = block.params?.[0];
        const type = block.params?.[1] || 'speak';
        return `
          ;; dialog: ${type}
          (call $showDialog (i32.const ${entityIndex}) (i32.const ${type === 'think' ? 1 : 0}))`;
    },

    'remove_dialog': (ctx, block, entityIndex) => {
        return `
          ;; remove_dialog
          (call $hideDialog (i32.const ${entityIndex}))`;
    }
};

const valueBlocks = {
    'get_sound_volume': (ctx, block, entityIndex) => {
        return `(call $getSoundVolume (i32.const ${entityIndex}))`;
    }
};

const booleanBlocks = {};

module.exports = { statementBlocks, valueBlocks, booleanBlocks };
