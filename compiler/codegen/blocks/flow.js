/**
 * Flow Control Block Handlers
 * 
 * Handles blocks related to loops, conditionals, and timing.
 */

/**
 * Split a loop body into pre-loop blocks and from-loop-onwards blocks.
 * Used for resume depth logic: when resuming from a deeper nested loop,
 * blocks before the first nested loop are skipped.
 */
function splitLoopBody(ctx, block, entityIndex, threadIndex, loopDepth) {
    const loopBlockTypes = ['repeat_basic', 'repeat_while_true', 'repeat_inf'];
    const innerStatements = block.statements?.[0] || [];
    let innerCode = '', preLoopCode = '', fromLoopCode = '';
    let foundNestedLoop = false;
    for (const innerBlock of innerStatements) {
        const code = ctx.transpile(innerBlock, entityIndex, threadIndex, loopDepth + 1);
        innerCode += code;
        if (!foundNestedLoop && loopBlockTypes.includes(innerBlock?.type)) {
            foundNestedLoop = true;
        }
        if (foundNestedLoop) {
            fromLoopCode += code;
        } else {
            preLoopCode += code;
        }
    }
    return { innerCode, preLoopCode, fromLoopCode, foundNestedLoop };
}

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
        const loopDepth = ctx.loopDepth || 0;
        
        // In user functions (threadIndex === -1), use traditional WASM loop
        // Functions cannot use tick-based iteration
        if (threadIndex === -1) {
            const loopId = ctx.generator.getNewLabel();
            const iterVar = ctx.generator.getNewLoopIterVar();
            
            // Push labels so stop_repeat/continue_repeat can reference them
            ctx.generator.pushLoopLabels(`break_${loopId}`, `loop_${loopId}`);
            let innerCode = '';
            const innerStatements = block.statements?.[0] || [];
            for (const innerBlock of innerStatements) {
                innerCode += ctx.transpile(innerBlock, entityIndex, threadIndex, loopDepth + 1);
            }
            ctx.generator.popLoopLabels();
            
            return `
          ;; repeat_basic (traditional WASM loop in user function)
          (local.set $${iterVar} (i32.trunc_f64_s ${count}))
          (block $break_${loopId}
            (loop $loop_${loopId}
              (br_if $break_${loopId} (i32.le_s (local.get $${iterVar}) (i32.const 0)))
              (local.set $${iterVar} (i32.sub (local.get $${iterVar}) (i32.const 1)))
              ${innerCode}
              (br $loop_${loopId})
            )
          )`;
        }
        
        const { innerCode, preLoopCode, fromLoopCode, foundNestedLoop } = splitLoopBody(ctx, block, entityIndex, threadIndex, loopDepth);
        
        // waitPhase reset: only outermost loop resets waitPhase for next iteration
        const waitPhaseReset = loopDepth === 0
            ? `\n              (global.set $thread_${threadIndex}_waitPhase (i32.const 0))`
            : '';
        
        // Thread-based path with nested loop: use resume depth to avoid
        // re-executing preamble blocks when resuming from a deeper loop
        if (foundNestedLoop) {
            const skipCond = `(i32.gt_s (global.get $thread_${threadIndex}_resumeDepth) (i32.const ${loopDepth + 1}))`;
            return `
          ;; repeat_basic (EntryJS-compatible: one iteration per tick, depth ${loopDepth}, has nested loop)
          ;; Only init counter when NOT resuming from deeper loop
          (if (i32.eqz ${skipCond})
            (then
              (if (i32.eq (global.get $thread_${threadIndex}_loopCounter_${loopDepth}) (i32.const -1))
                (then
                  (global.set $thread_${threadIndex}_loopCounter_${loopDepth} (i32.trunc_f64_s ${count}))))))
          ;; Check if iterations remain (counter > 0) OR resuming from deeper loop
          (if (i32.or ${skipCond} (i32.gt_s (global.get $thread_${threadIndex}_loopCounter_${loopDepth}) (i32.const 0)))
            (then
              ;; Only decrement and execute preamble when NOT resuming from deeper
              (if (i32.eqz ${skipCond})
                (then
                  (global.set $thread_${threadIndex}_loopCounter_${loopDepth}
                    (i32.sub (global.get $thread_${threadIndex}_loopCounter_${loopDepth}) (i32.const 1)))
                  ${preLoopCode}))
              ;; Always execute from nested loop onwards
              ${fromLoopCode}${waitPhaseReset}
              ;; Yield (reached when nested loop finished and fell through)
              (global.set $thread_${threadIndex}_resumeDepth (i32.const ${loopDepth + 1}))
              (global.set $thread_${threadIndex}_waiting (f64.const 0.001))
              (return (i32.const 1))))
          ;; Loop finished - reset counter for potential re-entry
          (global.set $thread_${threadIndex}_loopCounter_${loopDepth} (i32.const -1))`;
        }
        
        // No nested loop - standard tick-based iteration
        return `
          ;; repeat_basic (EntryJS-compatible: one iteration per tick, depth ${loopDepth})
          ;; Initialize loop counter on first entry (when counter is -1)
          (if (i32.eq (global.get $thread_${threadIndex}_loopCounter_${loopDepth}) (i32.const -1))
            (then
              (global.set $thread_${threadIndex}_loopCounter_${loopDepth} (i32.trunc_f64_s ${count}))))
          ;; Check if iterations remain (counter > 0)
          (if (i32.gt_s (global.get $thread_${threadIndex}_loopCounter_${loopDepth}) (i32.const 0))
            (then
              ;; Decrement counter first (like EntryJS)
              (global.set $thread_${threadIndex}_loopCounter_${loopDepth}
                (i32.sub (global.get $thread_${threadIndex}_loopCounter_${loopDepth}) (i32.const 1)))
              ;; Execute inner blocks
              ${innerCode}${waitPhaseReset}
              ;; Add tiny delay and stay at same PC for next iteration
              (global.set $thread_${threadIndex}_resumeDepth (i32.const ${loopDepth + 1}))
              (global.set $thread_${threadIndex}_waiting (f64.const 0.001))
              (return (i32.const 1))))
          ;; Loop finished - reset counter for potential re-entry
          (global.set $thread_${threadIndex}_loopCounter_${loopDepth} (i32.const -1))`;
    },

    'repeat_inf': (ctx, block, entityIndex, threadIndex) => {
        const loopDepth = ctx.loopDepth || 0;
        
        // In user functions (threadIndex === -1), infinite loop is dangerous
        // We limit to a maximum number of iterations to prevent browser freeze
        if (threadIndex === -1) {
            const loopId = ctx.generator.getNewLabel();
            const iterVar = ctx.generator.getNewLoopIterVar();
            const maxIterations = 1000000; // Safety limit
            
            ctx.generator.pushLoopLabels(`break_${loopId}`, `loop_${loopId}`);
            let innerCode = '';
            const innerStatements = block.statements?.[0] || [];
            for (const innerBlock of innerStatements) {
                innerCode += ctx.transpile(innerBlock, entityIndex, threadIndex, loopDepth + 1);
            }
            ctx.generator.popLoopLabels();
            
            return `
          ;; repeat_inf (limited loop in user function - max ${maxIterations} iterations)
          (local.set $${iterVar} (i32.const ${maxIterations}))
          (block $break_${loopId}
            (loop $loop_${loopId}
              (br_if $break_${loopId} (i32.le_s (local.get $${iterVar}) (i32.const 0)))
              (local.set $${iterVar} (i32.sub (local.get $${iterVar}) (i32.const 1)))
              ${innerCode}
              (br $loop_${loopId})
            )
          )`;
        }
        
        const { innerCode, preLoopCode, fromLoopCode, foundNestedLoop } = splitLoopBody(ctx, block, entityIndex, threadIndex, loopDepth);
        
        // waitPhase reset: only outermost loop resets waitPhase for next iteration
        const waitPhaseReset = loopDepth === 0
            ? `\n          (global.set $thread_${threadIndex}_waitPhase (i32.const 0))`
            : '';
        
        // Thread-based path with nested loop: skip preamble when resuming
        if (foundNestedLoop) {
            const skipCond = `(i32.gt_s (global.get $thread_${threadIndex}_resumeDepth) (i32.const ${loopDepth + 1}))`;
            return `
          ;; repeat_inf (EntryJS-compatible: one iteration per tick, depth ${loopDepth}, has nested loop)
          ;; Only execute preamble when NOT resuming from deeper loop
          (if (i32.eqz ${skipCond})
            (then
              ${preLoopCode}))
          ;; Always execute from nested loop onwards
          ${fromLoopCode}${waitPhaseReset}
          ;; Yield (reached when nested loop finished and fell through)
          (global.set $thread_${threadIndex}_resumeDepth (i32.const ${loopDepth + 1}))
          (global.set $thread_${threadIndex}_waiting (f64.const 0.001))
          (return (i32.const 1))`;
        }
        
        // No nested loop - standard tick-based iteration
        return `
          ;; repeat_inf (EntryJS-compatible: one iteration per tick, depth ${loopDepth})
          ${innerCode}${waitPhaseReset}
          ;; Add tiny delay and stay at same PC for next iteration
          (global.set $thread_${threadIndex}_resumeDepth (i32.const ${loopDepth + 1}))
          (global.set $thread_${threadIndex}_waiting (f64.const 0.001))
          (return (i32.const 1))`;
    },

    '_if': (ctx, block, entityIndex, threadIndex) => {
        const condition = ctx.transpileBoolean(block.params?.[0], entityIndex);
        const loopDepth = ctx.loopDepth || 0;
        let thenCode = '';
        if (block.statements?.[0]) {
            for (const innerBlock of block.statements[0]) {
                thenCode += ctx.transpile(innerBlock, entityIndex, threadIndex, loopDepth);
            }
        }
        return `
          ;; _if
          (if ${condition}
            (then ${thenCode}
            ))`;
    },

    'if_else': (ctx, block, entityIndex, threadIndex) => {
        const condition = ctx.transpileBoolean(block.params?.[0], entityIndex);
        const loopDepth = ctx.loopDepth || 0;
        let thenCode = '';
        let elseCode = '';
        if (block.statements?.[0]) {
            for (const innerBlock of block.statements[0]) {
                thenCode += ctx.transpile(innerBlock, entityIndex, threadIndex, loopDepth);
            }
        }
        if (block.statements?.[1]) {
            for (const innerBlock of block.statements[1]) {
                elseCode += ctx.transpile(innerBlock, entityIndex, threadIndex, loopDepth);
            }
        }
        return `
          ;; if_else
          (if ${condition}
            (then ${thenCode}
            )
            (else ${elseCode}
            ))`;
    },

    'stop_repeat': (ctx, block, entityIndex, threadIndex) => {
        if (threadIndex === -1) {
            const breakLabel = ctx.generator.getCurrentBreakLabel();
            if (breakLabel) {
                return `
          ;; stop_repeat (break out of loop in user function)
          (br $${breakLabel})`;
            }
            return `
          ;; stop_repeat (in user function - no enclosing loop)
          (nop)`;
        }
        // Break out of loop by resetting counter and advancing PC
        // Note: This resets the current loop depth's counter
        const loopDepth = ctx.loopDepth || 0;
        // If we're inside a loop, reset the counter for that loop (loopDepth - 1 if inside, but we use current)
        // Actually, stop_repeat should reset the innermost loop counter which is loopDepth - 1
        // But since we're at the depth where stop_repeat is called, we should reset loopDepth - 1
        // However, the safer approach is to reset all counters from this depth down
        const targetDepth = loopDepth > 0 ? loopDepth - 1 : 0;
        return `
          ;; stop_repeat (break) - reset loop counter at depth ${targetDepth} and fall through
          (global.set $thread_${threadIndex}_loopCounter_${targetDepth} (i32.const -1))`;
    },

    'wait_until_true': (ctx, block, entityIndex, threadIndex) => {
        const condition = ctx.transpileBoolean(block.params?.[0], entityIndex);
        const loopDepth = ctx.loopDepth || 0;
        
        // In user functions (threadIndex === -1), we use a busy-wait loop with safety limit
        if (threadIndex === -1) {
            const loopId = ctx.generator.getNewLabel();
            // Use unique iteration variable for this loop to support nesting
            const iterVar = ctx.generator.getNewLoopIterVar();
            const maxIterations = 1000000; // Safety limit
            return `
          ;; wait_until_true (busy-wait in user function - max ${maxIterations} checks)
          (local.set $${iterVar} (i32.const ${maxIterations}))
          (block $break_${loopId}
            (loop $loop_${loopId}
              ;; Check if condition is true
              (br_if $break_${loopId} ${condition})
              ;; Safety check - break after max iterations
              (local.set $${iterVar} (i32.sub (local.get $${iterVar}) (i32.const 1)))
              (br_if $break_${loopId} (i32.le_s (local.get $${iterVar}) (i32.const 0)))
              ;; Continue waiting
              (br $loop_${loopId})
            )
          )`;
        }
        
        // Phase-aware wait: each wait_until_true in a PC block gets a unique phase.
        // When resuming after a yield, already-passed waits are skipped via phase check.
        const phase = ctx.generator.getNextWaitPhase();
        return `
          ;; wait_until_true (phase ${phase}, depth ${loopDepth})
          (if (i32.eq (global.get $thread_${threadIndex}_waitPhase) (i32.const ${phase}))
            (then
              (if (i32.eqz ${condition})
                (then
                  ;; Condition not met, wait and stay at same PC
                  (global.set $thread_${threadIndex}_waiting (f64.const 0.001))
                  (return (i32.const 1))))
              (global.set $thread_${threadIndex}_waitPhase (i32.const ${phase + 1}))))`;
    },

    'repeat_while_true': (ctx, block, entityIndex, threadIndex) => {
        const condition = ctx.transpileBoolean(block.params?.[0], entityIndex);
        const option = block.params?.[1] || 'until';  // 'until' or 'while'
        const loopDepth = ctx.loopDepth || 0;
        
        // EntryJS has two modes: 'until' (repeat until condition becomes true) and 'while' (repeat while condition is true)
        // For 'until': continue if condition is FALSE (i.e., negate the condition)
        // For 'while': continue if condition is TRUE
        const shouldContinue = option === 'until' 
            ? `(i32.eqz ${condition})`  // until: continue while condition is false
            : condition;                 // while: continue while condition is true
        
        // In user functions (threadIndex === -1), use traditional WASM loop
        if (threadIndex === -1) {
            const loopId = ctx.generator.getNewLabel();
            
            ctx.generator.pushLoopLabels(`break_${loopId}`, `loop_${loopId}`);
            let innerCode = '';
            const innerStatements = block.statements?.[0] || [];
            for (const innerBlock of innerStatements) {
                innerCode += ctx.transpile(innerBlock, entityIndex, threadIndex, loopDepth + 1);
            }
            ctx.generator.popLoopLabels();
            
            return `
          ;; repeat_while_true (mode: ${option}, traditional WASM loop in user function)
          (block $break_${loopId}
            (loop $loop_${loopId}
              (br_if $break_${loopId} (i32.eqz ${shouldContinue}))
              ${innerCode}
              (br $loop_${loopId})
            )
          )`;
        }
        
        const { innerCode, preLoopCode, fromLoopCode, foundNestedLoop } = splitLoopBody(ctx, block, entityIndex, threadIndex, loopDepth);
        
        // waitPhase reset: only outermost loop resets waitPhase for next iteration
        const waitPhaseReset = loopDepth === 0
            ? `\n              (global.set $thread_${threadIndex}_waitPhase (i32.const 0))`
            : '';
        
        // Thread-based path with nested loop: skip preamble when resuming
        if (foundNestedLoop) {
            const skipCond = `(i32.gt_s (global.get $thread_${threadIndex}_resumeDepth) (i32.const ${loopDepth + 1}))`;
            return `
          ;; repeat_while_true (mode: ${option}, EntryJS-compatible: one iteration per tick, depth ${loopDepth}, has nested loop)
          (if ${shouldContinue}
            (then
              ;; Only execute preamble when NOT resuming from deeper loop
              (if (i32.eqz ${skipCond})
                (then
                  ${preLoopCode}))
              ;; Always execute from nested loop onwards
              ${fromLoopCode}${waitPhaseReset}
              ;; Yield (reached when nested loop finished and fell through)
              (global.set $thread_${threadIndex}_resumeDepth (i32.const ${loopDepth + 1}))
              (global.set $thread_${threadIndex}_waiting (f64.const 0.001))
              (return (i32.const 1))))
          ;; Condition no longer met - fall through to advance PC`;
        }
        
        // No nested loop - standard tick-based iteration
        return `
          ;; repeat_while_true (mode: ${option}, EntryJS-compatible: one iteration per tick, depth ${loopDepth})
          (if ${shouldContinue}
            (then
              ${innerCode}${waitPhaseReset}
              ;; Add tiny delay and stay at same PC for next iteration
              (global.set $thread_${threadIndex}_resumeDepth (i32.const ${loopDepth + 1}))
              (global.set $thread_${threadIndex}_waiting (f64.const 0.001))
              (return (i32.const 1))))
          ;; Condition no longer met - fall through to advance PC`;
    },

    'stop_object': (ctx, block, entityIndex, threadIndex) => {
        const target = block.params?.[0] || 'self';
        
        // In user functions (threadIndex === -1), we can only return from the function
        if (threadIndex === -1) {
            if (ctx.generator.currentFuncIsValue) {
                return `
          ;; stop_object (in value function - returns default 0)
          (return (f64.const 0))`;
            }
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
        if (threadIndex === -1) {
            const continueLabel = ctx.generator.getCurrentContinueLabel();
            if (continueLabel) {
                return `
          ;; continue_repeat (continue loop in user function)
          (br $${continueLabel})`;
            }
            return `
          ;; continue_repeat (in user function - no enclosing loop)
          (nop)`;
        }
        const loopDepth = ctx.loopDepth || 0;
        // Continue to next iteration - just return to stay at same PC
        // The loop will continue on next tick
        return `
          ;; continue_repeat - skip rest of inner blocks, continue loop (depth ${loopDepth})
          (global.set $thread_${threadIndex}_waitPhase (i32.const 0))
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
