/**
 * Flow Control Block Handlers
 * 
 * Handles blocks related to loops, conditionals, and timing.
 */

const statementBlocks = {
    'wait_second': (ctx, block, entityIndex, threadIndex) => {
        const seconds = ctx.transpileValue(block.params?.[0], entityIndex);
        // In user functions (threadIndex === -1), waiting is not supported
        // Functions should be synchronous
        if (threadIndex === -1) {
            return `
          ;; wait_second (skipped in user function - functions are synchronous)`;
        }
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
        
        // In user functions (threadIndex === -1), use traditional WASM loop
        // Functions cannot use tick-based iteration
        if (threadIndex === -1) {
            const loopId = ctx.generator.getNewLabel();
            return `
          ;; repeat_basic (traditional WASM loop in user function)
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
        }
        
        // EntryJS-compatible repeat: each iteration runs once per tick
        // Uses thread's loop counter global to persist count across ticks
        // -1 means uninitialized, >= 0 means iterations remaining
        // Note: Nested repeat_basic blocks are NOT supported (single counter per thread)
        return `
          ;; repeat_basic (EntryJS-compatible: one iteration per tick)
          ;; Initialize loop counter on first entry (when counter is -1)
          (if (i32.eq (global.get $thread_${threadIndex}_loopCounter) (i32.const -1))
            (then
              (global.set $thread_${threadIndex}_loopCounter (i32.trunc_f64_s ${count}))))
          ;; Check if iterations remain (counter > 0)
          (if (i32.gt_s (global.get $thread_${threadIndex}_loopCounter) (i32.const 0))
            (then
              ;; Decrement counter first (like EntryJS)
              (global.set $thread_${threadIndex}_loopCounter
                (i32.sub (global.get $thread_${threadIndex}_loopCounter) (i32.const 1)))
              ;; Execute inner blocks
              ${innerCode}
              ;; Add tiny delay and stay at same PC for next iteration
              (global.set $thread_${threadIndex}_waiting (f64.const 0.001))
              (return (i32.const 1))))
          ;; Loop finished - reset counter for potential re-entry
          (global.set $thread_${threadIndex}_loopCounter (i32.const -1))`;
    },

    'repeat_inf': (ctx, block, entityIndex, threadIndex) => {
        let innerCode = '';
        if (block.statements?.[0]) {
            for (const innerBlock of block.statements[0]) {
                innerCode += ctx.transpile(innerBlock, entityIndex, threadIndex);
            }
        }
        
        // In user functions (threadIndex === -1), infinite loop is dangerous
        // We limit to a maximum number of iterations to prevent browser freeze
        if (threadIndex === -1) {
            const loopId = ctx.generator.getNewLabel();
            const maxIterations = 10000; // Safety limit
            return `
          ;; repeat_inf (limited loop in user function - max ${maxIterations} iterations)
          (local.set $iterCount (i32.const ${maxIterations}))
          (block $break_${loopId}
            (loop $loop_${loopId}
              ;; Safety check - break after max iterations
              (br_if $break_${loopId} (i32.le_s (local.get $iterCount) (i32.const 0)))
              (local.set $iterCount (i32.sub (local.get $iterCount) (i32.const 1)))
              ;; Execute inner blocks
              ${innerCode}
              ;; Continue loop
              (br $loop_${loopId})
            )
          )`;
        }
        
        // EntryJS-compatible: run inner blocks once per tick, then wait and repeat
        return `
          ;; repeat_inf (EntryJS-compatible: one iteration per tick)
          ${innerCode}
          ;; Add tiny delay and stay at same PC for next iteration
          (global.set $thread_${threadIndex}_waiting (f64.const 0.001))
          (return (i32.const 1))`;
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
        // In user functions (threadIndex === -1), we can't use thread globals
        // The traditional WASM loop uses $break_* labels, but we can't reference them here
        // This is a limitation - stop_repeat in functions may not work correctly
        if (threadIndex === -1) {
            return `
          ;; stop_repeat (in user function - limited support)`;
        }
        // Break out of loop by resetting counter and advancing PC
        return `
          ;; stop_repeat (break) - reset loop counter and fall through
          (global.set $thread_${threadIndex}_loopCounter (i32.const -1))`;
    },

    'wait_until_true': (ctx, block, entityIndex, threadIndex) => {
        const condition = ctx.transpileBoolean(block.params?.[0], entityIndex);
        
        // In user functions (threadIndex === -1), we use a busy-wait loop with safety limit
        if (threadIndex === -1) {
            const loopId = ctx.generator.getNewLabel();
            const maxIterations = 10000; // Safety limit
            return `
          ;; wait_until_true (busy-wait in user function - max ${maxIterations} checks)
          (local.set $iterCount (i32.const ${maxIterations}))
          (block $break_${loopId}
            (loop $loop_${loopId}
              ;; Check if condition is true
              (br_if $break_${loopId} ${condition})
              ;; Safety check - break after max iterations
              (local.set $iterCount (i32.sub (local.get $iterCount) (i32.const 1)))
              (br_if $break_${loopId} (i32.le_s (local.get $iterCount) (i32.const 0)))
              ;; Continue waiting
              (br $loop_${loopId})
            )
          )`;
        }
        
        return `
          ;; wait_until_true (EntryJS-compatible: yield when condition not met)
          (if (i32.eqz ${condition})
            (then
              ;; Condition not met, wait and stay at same PC
              (global.set $thread_${threadIndex}_waiting (f64.const 0.001))
              (return (i32.const 1))))`;
    },

    'repeat_while_true': (ctx, block, entityIndex, threadIndex) => {
        const condition = ctx.transpileBoolean(block.params?.[0], entityIndex);
        const option = block.params?.[1] || 'until';  // 'until' or 'while'
        let innerCode = '';
        if (block.statements?.[0]) {
            for (const innerBlock of block.statements[0]) {
                innerCode += ctx.transpile(innerBlock, entityIndex, threadIndex);
            }
        }
        // EntryJS has two modes: 'until' (repeat until condition becomes true) and 'while' (repeat while condition is true)
        // For 'until': continue if condition is FALSE (i.e., negate the condition)
        // For 'while': continue if condition is TRUE
        const shouldContinue = option === 'until' 
            ? `(i32.eqz ${condition})`  // until: continue while condition is false
            : condition;                 // while: continue while condition is true
        
        // In user functions (threadIndex === -1), use traditional WASM loop
        if (threadIndex === -1) {
            const loopId = ctx.generator.getNewLabel();
            return `
          ;; repeat_while_true (mode: ${option}, traditional WASM loop in user function)
          (block $break_${loopId}
            (loop $loop_${loopId}
              ;; Check condition
              (br_if $break_${loopId} (i32.eqz ${shouldContinue}))
              ;; Execute inner blocks
              ${innerCode}
              ;; Continue loop
              (br $loop_${loopId})
            )
          )`;
        }
        
        return `
          ;; repeat_while_true (mode: ${option}, EntryJS-compatible: one iteration per tick)
          (if ${shouldContinue}
            (then
              ${innerCode}
              ;; Add tiny delay and stay at same PC for next iteration
              (global.set $thread_${threadIndex}_waiting (f64.const 0.001))
              (return (i32.const 1))))
          ;; Condition no longer met - fall through to advance PC`;
    },

    'stop_object': (ctx, block, entityIndex, threadIndex) => {
        const target = block.params?.[0] || 'self';
        
        // In user functions (threadIndex === -1), we can only return from the function
        if (threadIndex === -1) {
            return `
          ;; stop_object (in user function - just returns)
          (return)`;
        }
        
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
    },

    'continue_repeat': (ctx, block, entityIndex, threadIndex) => {
        // In user functions (threadIndex === -1), we can't use thread globals
        // The traditional WASM loop uses $loop_* labels, but we can't reference them here
        // This is a limitation - continue_repeat in functions may not work correctly
        if (threadIndex === -1) {
            return `
          ;; continue_repeat (in user function - limited support)`;
        }
        // Continue to next iteration - just return to stay at same PC
        // The loop will continue on next tick
        return `
          ;; continue_repeat - skip rest of inner blocks, continue loop
          (global.set $thread_${threadIndex}_waiting (f64.const 0.001))
          (return (i32.const 1))`;
    },

    'remove_all_clones': (ctx, block, entityIndex, threadIndex) => {
        return `
          ;; remove_all_clones
          (call $removeAllClones)`;
    }
};

const valueBlocks = {};

const booleanBlocks = {};

module.exports = { statementBlocks, valueBlocks, booleanBlocks };
