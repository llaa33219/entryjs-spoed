/**
 * Flow Control Block Handlers
 * 
 * Handles blocks related to loops, conditionals, and timing.
 */

const statementBlocks = {
    'wait_second': (ctx, block, entityIndex, threadIndex) => {
        const seconds = ctx.transpileValue(block.params?.[0], entityIndex);
        return `
          ;; wait_second
          (global.set $thread_${threadIndex}_waiting ${seconds})`;
    },

    'repeat_basic': (ctx, block, entityIndex, threadIndex) => {
        const count = ctx.transpileValue(block.params?.[0], entityIndex);
        let innerCode = '';
        if (block.statements?.[0]) {
            for (const innerBlock of block.statements[0]) {
                innerCode += ctx.transpile(innerBlock, entityIndex, threadIndex);
            }
        }
        // Generate unique labels for this loop
        const loopId = ctx.generator.getNewLabel();
        return `
          ;; repeat_basic ${count} times
          (local.set $iterCount (i32.trunc_f64_s ${count}))
          (block $break_${loopId}
            (loop $loop_${loopId}
              ;; Check if iterCount <= 0, if so break
              (br_if $break_${loopId} (i32.le_s (local.get $iterCount) (i32.const 0)))
              ;; Decrement counter
              (local.set $iterCount (i32.sub (local.get $iterCount) (i32.const 1)))
              ;; Execute inner blocks
              ${innerCode}
              ;; Continue loop
              (br $loop_${loopId})
            )
          )`;
    },

    'repeat_inf': (ctx, block, entityIndex, threadIndex) => {
        let innerCode = '';
        if (block.statements?.[0]) {
            for (const innerBlock of block.statements[0]) {
                innerCode += ctx.transpile(innerBlock, entityIndex, threadIndex);
            }
        }
        return `
          ;; repeat_inf (infinite loop - runs inner blocks each tick)
          ${innerCode}
          ;; Reset PC to repeat
          (global.set $thread_${threadIndex}_pc (i32.const 0))`;
    },

    '_if': (ctx, block, entityIndex, threadIndex) => {
        const condition = ctx.transpileBoolean(block.params?.[0], entityIndex);
        let thenCode = '';
        if (block.statements?.[0]) {
            for (const innerBlock of block.statements[0]) {
                thenCode += ctx.transpile(innerBlock, entityIndex, threadIndex);
            }
        }
        return `
          ;; _if
          (if ${condition}
            (then ${thenCode}))`;
    },

    'if_else': (ctx, block, entityIndex, threadIndex) => {
        const condition = ctx.transpileBoolean(block.params?.[0], entityIndex);
        let thenCode = '';
        let elseCode = '';
        if (block.statements?.[0]) {
            for (const innerBlock of block.statements[0]) {
                thenCode += ctx.transpile(innerBlock, entityIndex, threadIndex);
            }
        }
        if (block.statements?.[1]) {
            for (const innerBlock of block.statements[1]) {
                elseCode += ctx.transpile(innerBlock, entityIndex, threadIndex);
            }
        }
        return `
          ;; if_else
          (if ${condition}
            (then ${thenCode})
            (else ${elseCode}))`;
    },

    'stop_repeat': (ctx, block, entityIndex, threadIndex) => {
        return `
          ;; stop_repeat (break)
          (br $end)`;
    },

    'wait_until_true': (ctx, block, entityIndex, threadIndex) => {
        const condition = ctx.transpileBoolean(block.params?.[0], entityIndex);
        return `
          ;; wait_until_true
          (if (i32.eqz ${condition})
            (then
              ;; Condition not met, wait
              (global.set $thread_${threadIndex}_waiting (f64.const 0.001))))`;
    },

    'repeat_while_true': (ctx, block, entityIndex, threadIndex) => {
        const condition = ctx.transpileBoolean(block.params?.[0], entityIndex);
        let innerCode = '';
        if (block.statements?.[0]) {
            for (const innerBlock of block.statements[0]) {
                innerCode += ctx.transpile(innerBlock, entityIndex, threadIndex);
            }
        }
        return `
          ;; repeat_while_true
          (if ${condition}
            (then
              ${innerCode}
              ;; Continue loop by resetting PC
              (global.set $thread_${threadIndex}_pc (i32.const 0))))`;
    },

    'stop_object': (ctx, block, entityIndex, threadIndex) => {
        const target = block.params?.[0] || 'self';
        if (target === 'self' || target === 'this') {
            return `
          ;; stop_object (this script)
          (global.set $thread_${threadIndex}_active (i32.const 0))
          (return (i32.const 0))`;
        }
        // TODO: Handle stopping all scripts or other objects
        return `
          ;; stop_object: ${target}
          (global.set $thread_${threadIndex}_active (i32.const 0))
          (return (i32.const 0))`;
    },

    'restart_project': (ctx, block, entityIndex, threadIndex) => {
        return `
          ;; restart_project
          (call $init)`;
    },

    'stop_run': (ctx, block, entityIndex, threadIndex) => {
        return `
          ;; stop_run (stop all)
          (call $stop)`;
    }
};

const valueBlocks = {};

const booleanBlocks = {};

module.exports = { statementBlocks, valueBlocks, booleanBlocks };
