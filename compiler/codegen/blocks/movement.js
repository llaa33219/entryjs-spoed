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
    },

    'bounce_wall': (ctx, block, entityIndex) => {
        // Bounce off wall by reflecting direction
        // When touching edge, reverse direction component based on which edge
        return `
          ;; bounce_wall
          ;; Check left/right edges and flip horizontal component
          (if (i32.or
                (f64.le (call $getX (i32.const ${entityIndex})) (f64.const -240))
                (f64.ge (call $getX (i32.const ${entityIndex})) (f64.const 240)))
            (then
              (call $setDirection (i32.const ${entityIndex})
                (f64.sub (f64.const 180) (call $getDirection (i32.const ${entityIndex}))))))
          ;; Check top/bottom edges and flip vertical component
          (if (i32.or
                (f64.le (call $getY (i32.const ${entityIndex})) (f64.const -135))
                (f64.ge (call $getY (i32.const ${entityIndex})) (f64.const 135)))
            (then
              (call $setDirection (i32.const ${entityIndex})
                (f64.mul (call $getDirection (i32.const ${entityIndex})) (f64.const -1)))))`;
    },

    'locate': (ctx, block, entityIndex) => {
        // Move to a specific location (mouse or random)
        const targetType = block.params?.[0];
        
        if (targetType === 'mouse' || targetType === 'mouse_pointer') {
            return `
          ;; locate: mouse pointer
          (call $setX (i32.const ${entityIndex}) (call $getMouseX))
          (call $setY (i32.const ${entityIndex}) (call $getMouseY))
          (call $brushNotifyPosition (i32.const ${entityIndex}) (call $getX (i32.const ${entityIndex})) (call $getY (i32.const ${entityIndex})))`;
        } else if (targetType === 'random') {
            return `
          ;; locate: random position
          (call $setX (i32.const ${entityIndex}) (call $randomRange (f64.const -240) (f64.const 240)))
          (call $setY (i32.const ${entityIndex}) (call $randomRange (f64.const -135) (f64.const 135)))
          (call $brushNotifyPosition (i32.const ${entityIndex}) (call $getX (i32.const ${entityIndex})) (call $getY (i32.const ${entityIndex})))`;
        }
        
        // Default: try to find object by ID
        let targetIndex = entityIndex;
        if (targetType) {
            const idx = ctx.generator.project.objects.findIndex(o => o.id === targetType);
            if (idx >= 0) targetIndex = idx;
        }
        return `
          ;; locate: to object ${targetIndex}
          (call $setX (i32.const ${entityIndex}) (call $getX (i32.const ${targetIndex})))
          (call $setY (i32.const ${entityIndex}) (call $getY (i32.const ${targetIndex})))
          (call $brushNotifyPosition (i32.const ${entityIndex}) (call $getX (i32.const ${entityIndex})) (call $getY (i32.const ${entityIndex})))`;
    },

    'locate_object': (ctx, block, entityIndex) => {
        // Move to another object's position
        const targetId = block.params?.[0];
        let targetIndex = entityIndex;
        if (targetId && targetId !== 'self') {
            const idx = ctx.generator.project.objects.findIndex(o => o.id === targetId);
            if (idx >= 0) targetIndex = idx;
        }
        return `
          ;; locate_object: to entity ${targetIndex}
          (call $setX (i32.const ${entityIndex}) (call $getX (i32.const ${targetIndex})))
          (call $setY (i32.const ${entityIndex}) (call $getY (i32.const ${targetIndex})))
          (call $brushNotifyPosition (i32.const ${entityIndex}) (call $getX (i32.const ${entityIndex})) (call $getY (i32.const ${entityIndex})))`;
    },

    'rotate_by_time': (ctx, block, entityIndex) => {
        // Rotate over time - simplified to instant rotation for now
        const angle = ctx.transpileValue(block.params?.[0], entityIndex);
        const time = ctx.transpileValue(block.params?.[1], entityIndex);
        return `
          ;; rotate_by_time (simplified to instant)
          (call $setRotation (i32.const ${entityIndex})
            (f64.add (call $getRotation (i32.const ${entityIndex})) ${angle}))
          (drop ${time})`;
    },

    'direction_relative_duration': (ctx, block, entityIndex) => {
        // Change direction over time - simplified to instant for now
        const angle = ctx.transpileValue(block.params?.[0], entityIndex);
        const time = ctx.transpileValue(block.params?.[1], entityIndex);
        return `
          ;; direction_relative_duration (simplified to instant)
          (call $setDirection (i32.const ${entityIndex})
            (f64.add (call $getDirection (i32.const ${entityIndex})) ${angle}))
          (drop ${time})`;
    },

    'see_angle_object': (ctx, block, entityIndex) => {
        // Look at another object (set direction to face it)
        const targetId = block.params?.[0];
        let targetIndex = entityIndex;
        if (targetId && targetId !== 'self') {
            const idx = ctx.generator.project.objects.findIndex(o => o.id === targetId);
            if (idx >= 0) targetIndex = idx;
        }
        // Calculate angle: atan2(dy, dx) converted to degrees
        // direction = atan2(targetY - thisY, targetX - thisX) * 180 / PI + 90
        return `
          ;; see_angle_object: look at entity ${targetIndex}
          (call $setDirection (i32.const ${entityIndex})
            (f64.add
              (f64.mul
                (call $atan2
                  (f64.sub (call $getY (i32.const ${targetIndex})) (call $getY (i32.const ${entityIndex})))
                  (f64.sub (call $getX (i32.const ${targetIndex})) (call $getX (i32.const ${entityIndex}))))
                (f64.const -57.29577951308232))
              (f64.const 90)))`;
    },

    'locate_xy_time': (ctx, block, entityIndex) => {
        // Move to x, y over time - simplified to instant move for now
        const time = ctx.transpileValue(block.params?.[0], entityIndex);
        const x = ctx.transpileValue(block.params?.[1], entityIndex);
        const y = ctx.transpileValue(block.params?.[2], entityIndex);
        return `
          ;; locate_xy_time (simplified to instant move)
          (call $setX (i32.const ${entityIndex}) ${x})
          (call $setY (i32.const ${entityIndex}) ${y})
          (drop ${time})
          (call $brushNotifyPosition (i32.const ${entityIndex}) (call $getX (i32.const ${entityIndex})) (call $getY (i32.const ${entityIndex})))`;
    },

    'locate_object_time': (ctx, block, entityIndex) => {
        // Move to another object's position over time - simplified to instant for now
        const time = ctx.transpileValue(block.params?.[0], entityIndex);
        const targetId = block.params?.[1];
        let targetIndex = entityIndex;
        if (targetId && targetId !== 'self') {
            const idx = ctx.generator.project.objects.findIndex(o => o.id === targetId);
            if (idx >= 0) targetIndex = idx;
        }
        return `
          ;; locate_object_time (simplified to instant)
          (call $setX (i32.const ${entityIndex}) (call $getX (i32.const ${targetIndex})))
          (call $setY (i32.const ${entityIndex}) (call $getY (i32.const ${targetIndex})))
          (drop ${time})
          (call $brushNotifyPosition (i32.const ${entityIndex}) (call $getX (i32.const ${entityIndex})) (call $getY (i32.const ${entityIndex})))`;
    },

    'see_angle': (ctx, block, entityIndex) => {
        // Set direction to a specific angle
        const angle = ctx.transpileValue(block.params?.[0], entityIndex);
        return `
          ;; see_angle
          (call $setDirection (i32.const ${entityIndex}) ${angle})`;
    },

    'see_angle_direction': (ctx, block, entityIndex) => {
        // Look at a direction (mouse pointer or specific angle)
        const targetType = block.params?.[0];
        
        if (targetType === 'mouse' || targetType === 'mouse_pointer') {
            return `
          ;; see_angle_direction: mouse pointer
          (call $setDirection (i32.const ${entityIndex})
            (f64.add
              (f64.mul
                (call $atan2
                  (f64.sub (call $getMouseY) (call $getY (i32.const ${entityIndex})))
                  (f64.sub (call $getMouseX) (call $getX (i32.const ${entityIndex}))))
                (f64.const -57.29577951308232))
              (f64.const 90)))`;
        }
        
        // Default: look at another object
        let targetIndex = entityIndex;
        if (targetType) {
            const idx = ctx.generator.project.objects.findIndex(o => o.id === targetType);
            if (idx >= 0) targetIndex = idx;
        }
        return `
          ;; see_angle_direction: to entity ${targetIndex}
          (call $setDirection (i32.const ${entityIndex})
            (f64.add
              (f64.mul
                (call $atan2
                  (f64.sub (call $getY (i32.const ${targetIndex})) (call $getY (i32.const ${entityIndex})))
                  (f64.sub (call $getX (i32.const ${targetIndex})) (call $getX (i32.const ${entityIndex}))))
                (f64.const -57.29577951308232))
              (f64.const 90)))`;
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
