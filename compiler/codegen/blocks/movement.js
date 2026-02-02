/**
 * Movement Block Handlers
 * 
 * Handles blocks related to movement, position, and rotation.
 */

const statementBlocks = {
    'move_direction': (ctx, block, entityIndex) => {
        const distance = ctx.transpileValue(block.params?.[0], entityIndex);
        return `
          ;; move_direction
          (call $moveInDirection (i32.const ${entityIndex}) ${distance})
          (call $brushNotifyPosition (i32.const ${entityIndex}) (call $getX (i32.const ${entityIndex})) (call $getY (i32.const ${entityIndex})))`;
    },

    'move_x': (ctx, block, entityIndex) => {
        const value = ctx.transpileValue(block.params?.[0], entityIndex);
        return `
          ;; move_x
          (call $setX (i32.const ${entityIndex})
            (f64.add (call $getX (i32.const ${entityIndex})) ${value}))
          (call $brushNotifyPosition (i32.const ${entityIndex}) (call $getX (i32.const ${entityIndex})) (call $getY (i32.const ${entityIndex})))`;
    },

    'move_y': (ctx, block, entityIndex) => {
        const value = ctx.transpileValue(block.params?.[0], entityIndex);
        return `
          ;; move_y
          (call $setY (i32.const ${entityIndex})
            (f64.add (call $getY (i32.const ${entityIndex})) ${value}))
          (call $brushNotifyPosition (i32.const ${entityIndex}) (call $getX (i32.const ${entityIndex})) (call $getY (i32.const ${entityIndex})))`;
    },

    'locate_x': (ctx, block, entityIndex) => {
        const value = ctx.transpileValue(block.params?.[0], entityIndex);
        return `
          ;; locate_x
          (call $setX (i32.const ${entityIndex}) ${value})
          (call $brushNotifyPosition (i32.const ${entityIndex}) (call $getX (i32.const ${entityIndex})) (call $getY (i32.const ${entityIndex})))`;
    },

    'locate_y': (ctx, block, entityIndex) => {
        const value = ctx.transpileValue(block.params?.[0], entityIndex);
        return `
          ;; locate_y
          (call $setY (i32.const ${entityIndex}) ${value})
          (call $brushNotifyPosition (i32.const ${entityIndex}) (call $getX (i32.const ${entityIndex})) (call $getY (i32.const ${entityIndex})))`;
    },

    'locate_xy': (ctx, block, entityIndex) => {
        const x = ctx.transpileValue(block.params?.[0], entityIndex);
        const y = ctx.transpileValue(block.params?.[1], entityIndex);
        return `
          ;; locate_xy
          (call $setX (i32.const ${entityIndex}) ${x})
          (call $setY (i32.const ${entityIndex}) ${y})
          (call $brushNotifyPosition (i32.const ${entityIndex}) (call $getX (i32.const ${entityIndex})) (call $getY (i32.const ${entityIndex})))`;
    },

    'rotate_relative': (ctx, block, entityIndex) => {
        const angle = ctx.transpileValue(block.params?.[0], entityIndex);
        return `
          ;; rotate_relative
          (call $setRotation (i32.const ${entityIndex})
            (f64.add (call $getRotation (i32.const ${entityIndex})) ${angle}))`;
    },

    'direction_relative': (ctx, block, entityIndex) => {
        const angle = ctx.transpileValue(block.params?.[0], entityIndex);
        return `
          ;; direction_relative
          (call $setDirection (i32.const ${entityIndex})
            (f64.add (call $getDirection (i32.const ${entityIndex})) ${angle}))`;
    },

    'rotate_absolute': (ctx, block, entityIndex) => {
        const angle = ctx.transpileValue(block.params?.[0], entityIndex);
        return `
          ;; rotate_absolute
          (call $setRotation (i32.const ${entityIndex}) ${angle})`;
    },

    'direction_absolute': (ctx, block, entityIndex) => {
        const angle = ctx.transpileValue(block.params?.[0], entityIndex);
        return `
          ;; direction_absolute
          (call $setDirection (i32.const ${entityIndex}) ${angle})`;
    },

    'move_to_angle': (ctx, block, entityIndex) => {
        const angle = ctx.transpileValue(block.params?.[0], entityIndex);
        const distance = ctx.transpileValue(block.params?.[1], entityIndex);
        // Note: Original EntryJS subtracts 90 from the angle before converting to radians
        // angle_rad = (angle - 90) * PI / 180
        return `
          ;; move_to_angle
          (local.set $temp (f64.mul (f64.sub ${angle} (f64.const 90)) (f64.const 0.017453292519943295)))
          (call $setX (i32.const ${entityIndex})
            (f64.add (call $getX (i32.const ${entityIndex}))
              (f64.mul ${distance} (call $cos (local.get $temp)))))
          (call $setY (i32.const ${entityIndex})
            (f64.sub (call $getY (i32.const ${entityIndex}))
              (f64.mul ${distance} (call $sin (local.get $temp)))))
          (call $brushNotifyPosition (i32.const ${entityIndex}) (call $getX (i32.const ${entityIndex})) (call $getY (i32.const ${entityIndex})))`;
    },

    'move_xy_time': (ctx, block, entityIndex) => {
        // Move by x, y over time - simplified to instant move for now
        const time = ctx.transpileValue(block.params?.[0], entityIndex);
        const x = ctx.transpileValue(block.params?.[1], entityIndex);
        const y = ctx.transpileValue(block.params?.[2], entityIndex);
        return `
          ;; move_xy_time (simplified to instant move)
          (call $setX (i32.const ${entityIndex})
            (f64.add (call $getX (i32.const ${entityIndex})) ${x}))
          (call $setY (i32.const ${entityIndex})
            (f64.add (call $getY (i32.const ${entityIndex})) ${y}))
          (drop ${time})
          (call $brushNotifyPosition (i32.const ${entityIndex}) (call $getX (i32.const ${entityIndex})) (call $getY (i32.const ${entityIndex})))`;
    }
};

const valueBlocks = {
    'get_rotation_direction': (ctx, block, entityIndex) => {
        const property = block.params?.[0];
        if (property === 'DIRECTION') {
            return `(call $getDirection (i32.const ${entityIndex}))`;
        }
        return `(call $getRotation (i32.const ${entityIndex}))`;
    },

    'get_x': (ctx, block, entityIndex) => {
        return `(call $getX (i32.const ${entityIndex}))`;
    },

    'get_y': (ctx, block, entityIndex) => {
        return `(call $getY (i32.const ${entityIndex}))`;
    }
};

const booleanBlocks = {};

module.exports = { statementBlocks, valueBlocks, booleanBlocks };
