//! Executor module - handles block execution with call stack

use std::collections::HashMap;
use crate::{Block, Entity, Value, JsAction, FunctionData};

/// Result of block execution
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ExecuteResult {
    Continue,      // Continue to next block
    Wait,          // Wait (for timed blocks)
    Break,         // Break out of loop
    End,           // Execution ended
    JumpedToBlock, // Jumped to a new block list (don't increment block_index)
}

/// Executor manages the execution of a thread of blocks
#[derive(Clone, Debug)]
pub struct Executor {
    pub entity_idx: usize,
    blocks: Vec<Block>,
    block_index: usize,
    call_stack: Vec<StackFrame>,
    #[allow(dead_code)]
    register: HashMap<String, Value>,
    wait_frames: u32,
    iteration_count: u32,
    // Cached entity properties for value blocks
    cached_entity_x: f64,
    cached_entity_y: f64,
    cached_entity_rotation: f64,
    cached_entity_direction: f64,
    cached_entity_scale: f64,
    
    // Input state (set from JavaScript)
    pub cached_mouse_x: f64,
    pub cached_mouse_y: f64,
    pub mouse_clicked: bool,
    pub pressed_keys: Vec<u32>,
    
    // Timed animation state
    timed_animation_frames: u32,
    timed_dx: f64,
    timed_dy: f64,
    timed_d_rotation: f64,
    timed_d_direction: f64,
    timed_target_x: f64,
    timed_target_y: f64,
}

#[derive(Clone, Debug)]
struct StackFrame {
    blocks: Vec<Block>,
    block_index: usize,
    iteration_count: u32,
    is_loop: bool,
}

impl Executor {
    pub fn new(entity_idx: usize, blocks: Vec<Block>) -> Self {
        Executor {
            entity_idx,
            blocks,
            block_index: 0,
            call_stack: Vec::new(),
            register: HashMap::new(),
            wait_frames: 0,
            iteration_count: 0,
            cached_entity_x: 0.0,
            cached_entity_y: 0.0,
            cached_entity_rotation: 0.0,
            cached_entity_direction: 90.0,
            cached_entity_scale: 100.0,
            
            cached_mouse_x: 0.0,
            cached_mouse_y: 0.0,
            mouse_clicked: false,
            pressed_keys: Vec::new(),
            
            timed_animation_frames: 0,
            timed_dx: 0.0,
            timed_dy: 0.0,
            timed_d_rotation: 0.0,
            timed_d_direction: 0.0,
            timed_target_x: 0.0,
            timed_target_y: 0.0,
        }
    }
    
    /// Update cached entity properties from the entity
    fn update_cached_entity(&mut self, entity: Option<&Entity>) {
        if let Some(e) = entity {
            self.cached_entity_x = e.x;
            self.cached_entity_y = e.y;
            self.cached_entity_rotation = e.rotation;
            self.cached_entity_direction = e.direction;
            self.cached_entity_scale = e.get_scale();
        }
    }
    
    /// Helper to convert Value to String
    fn value_as_string(value: &Value) -> String {
        match value {
            Value::String(s) => s.clone(),
            Value::Number(n) => n.to_string(),
            Value::Bool(b) => if *b { "true".to_string() } else { "false".to_string() },
            Value::List(l) => format!("{:?}", l),
            Value::Null => String::new(),
        }
    }

    /// Execute one step
    pub fn execute(
        &mut self, 
        entities: &mut Vec<Entity>, 
        variables: &mut HashMap<String, Value>,
        js_actions: &mut Vec<JsAction>,
        functions: &HashMap<String, FunctionData>,
    ) -> ExecuteResult {
        // Log current state at start of execute
        web_sys::console::log_1(&format!(
            "[WASM] execute(): block_index={}, blocks.len()={}, wait_frames={}, iteration_count={}",
            self.block_index, self.blocks.len(), self.wait_frames, self.iteration_count
        ).into());
        
        // Update cached entity properties
        self.update_cached_entity(entities.get(self.entity_idx));
        
        // Check if waiting
        if self.wait_frames > 0 {
            self.wait_frames -= 1;
            return ExecuteResult::Wait;
        }

        // Get current block
        let block = match self.get_current_block() {
            Some(b) => b.clone(),
            None => {
                web_sys::console::log_1(&format!(
                    "[WASM] No current block at index {}, stack size: {}",
                    self.block_index, self.call_stack.len()
                ).into());
                
                // Try to pop from call stack
                if let Some(frame) = self.call_stack.pop() {
                    self.blocks = frame.blocks;
                    self.block_index = frame.block_index;
                    
                    web_sys::console::log_1(&format!(
                        "[WASM] Popped stack frame: is_loop={}, iteration_count={}, block_index={}",
                        frame.is_loop, frame.iteration_count, frame.block_index
                    ).into());
                    
                    if frame.is_loop && frame.iteration_count > 0 {
                        // For repeat_while_true (iteration_count == MAX), we need to re-evaluate
                        // the condition each time. For repeat_basic, we use the remaining count.
                        if frame.iteration_count == u32::MAX {
                            // repeat_while_true or repeat_inf - re-execute block to check condition
                            self.iteration_count = 0; // Reset so block re-evaluates condition
                            web_sys::console::log_1(&format!(
                                "[WASM] Conditional loop iteration complete, will re-check condition at block {}",
                                self.block_index
                            ).into());
                        } else {
                            // repeat_basic - use remaining count
                            self.iteration_count = frame.iteration_count;
                            web_sys::console::log_1(&format!(
                                "[WASM] Loop iteration complete, {} remaining, will re-execute block at index {}",
                                frame.iteration_count, self.block_index
                            ).into());
                        }
                        // Re-execute the loop block (don't increment block_index)
                        return ExecuteResult::Continue;
                    }
                    
                    // Loop finished or not a loop - move to next block
                    self.iteration_count = 0;
                    self.block_index += 1;
                    web_sys::console::log_1(&format!(
                        "[WASM] Stack frame popped, moving to block {}, blocks.len()={}",
                        self.block_index, self.blocks.len()
                    ).into());
                    return ExecuteResult::Continue;
                }
                web_sys::console::log_1(&"[WASM] No more blocks and stack empty, returning End".into());
                return ExecuteResult::End;
            }
        };

        // Execute block
        let entity = entities.get_mut(self.entity_idx);
        let result = self.execute_block(&block, entity, variables, js_actions, functions);

        match result {
            ExecuteResult::Continue => {
                self.block_index += 1;
            }
            ExecuteResult::JumpedToBlock => {
                // Don't increment block_index - we jumped to a new block list
            }
            ExecuteResult::Break => {
                // Pop loop from stack
                while let Some(frame) = self.call_stack.pop() {
                    if frame.is_loop {
                        self.blocks = frame.blocks;
                        self.block_index = frame.block_index + 1;
                        break;
                    }
                }
            }
            _ => {}
        }

        result
    }

    fn get_current_block(&self) -> Option<&Block> {
        self.blocks.get(self.block_index)
    }

    fn execute_block(
        &mut self,
        block: &Block,
        entity: Option<&mut Entity>,
        variables: &mut HashMap<String, Value>,
        js_actions: &mut Vec<JsAction>,
        functions: &HashMap<String, FunctionData>,
    ) -> ExecuteResult {
        let block_type = block.block_type.as_str();
        
        // Debug: Log every block type being executed
        web_sys::console::log_1(&format!(
            "[WASM] execute_block: type='{}'",
            block_type
        ).into());
        
        // Handle function calls (blocks starting with "func_")
        if block_type.starts_with("func_") {
            return self.execute_function_call(block, functions);
        }
        
        match block_type {
            // === Event blocks (just pass through) ===
            "when_run_button_click" | 
            "when_some_key_pressed" |
            "when_object_click" |
            "when_object_click_canceled" |
            "when_clone_start" |
            "when_message_cast" |
            "when_scene_start" |
            "mouse_clicked" |
            "mouse_click_cancled" => ExecuteResult::Continue,
            
            // === Function definition blocks ===
            // These are handled by execute_function_call which jumps directly to the function body
            // If we reach these blocks directly (e.g., in the function content), just pass through
            "function_create" | "function_create_value" => ExecuteResult::Continue,
            
            // === Function field blocks (used in function parameter definitions) ===
            "function_field_label" |
            "function_field_string" |
            "function_field_boolean" => ExecuteResult::Continue,

            // === Movement blocks ===
            "move_direction" => {
                if let Some(e) = entity {
                    let value = self.get_param_number(block, 0, variables);
                    let old_x = e.x;
                    let old_y = e.y;
                    e.move_direction(value);
                    web_sys::console::log_1(&format!(
                        "[WASM] move_direction({}) executed: ({:.1}, {:.1}) -> ({:.1}, {:.1})",
                        value, old_x, old_y, e.x, e.y
                    ).into());
                }
                ExecuteResult::Continue
            }
            
            "move_x" => {
                if let Some(e) = entity {
                    let value = self.get_param_number(block, 0, variables);
                    e.move_x(value);
                }
                ExecuteResult::Continue
            }
            
            "move_y" => {
                if let Some(e) = entity {
                    let value = self.get_param_number(block, 0, variables);
                    e.move_y(value);
                }
                ExecuteResult::Continue
            }
            
            "locate_x" => {
                if let Some(e) = entity {
                    let value = self.get_param_number(block, 0, variables);
                    e.set_x(value);
                }
                ExecuteResult::Continue
            }
            
            "locate_y" => {
                if let Some(e) = entity {
                    let value = self.get_param_number(block, 0, variables);
                    e.set_y(value);
                }
                ExecuteResult::Continue
            }
            
            "locate_xy" => {
                if let Some(e) = entity {
                    let x = self.get_param_number(block, 0, variables);
                    let y = self.get_param_number(block, 1, variables);
                    e.set_xy(x, y);
                }
                ExecuteResult::Continue
            }
            
            "rotate_relative" => {
                if let Some(e) = entity {
                    let value = self.get_param_number(block, 0, variables);
                    let old_rot = e.rotation;
                    e.rotate(value);
                    web_sys::console::log_1(&format!(
                        "[WASM] rotate_relative({}) executed: {:.1} -> {:.1}",
                        value, old_rot, e.rotation
                    ).into());
                }
                ExecuteResult::Continue
            }
            
            "direction_relative" => {
                if let Some(e) = entity {
                    let value = self.get_param_number(block, 0, variables);
                    e.add_direction(value);
                }
                ExecuteResult::Continue
            }
            
            "rotate_absolute" => {
                if let Some(e) = entity {
                    let value = self.get_param_number(block, 0, variables);
                    e.set_rotation(value);
                }
                ExecuteResult::Continue
            }
            
            "direction_absolute" => {
                if let Some(e) = entity {
                    let value = self.get_param_number(block, 0, variables);
                    e.set_direction(value);
                }
                ExecuteResult::Continue
            }
            
            "move_to_angle" => {
                if let Some(e) = entity {
                    let angle = self.get_param_number(block, 0, variables);
                    let distance = self.get_param_number(block, 1, variables);
                    let angle_rad = (angle - 90.0).to_radians();
                    e.x += distance * angle_rad.cos();
                    e.y -= distance * angle_rad.sin();
                }
                ExecuteResult::Continue
            }
            
            "move_xy_time" => {
                if let Some(e) = entity {
                    // Check if we're in the middle of a timed animation
                    if self.timed_animation_frames > 0 {
                        // Apply delta movement
                        e.x += self.timed_dx;
                        e.y += self.timed_dy;
                        self.timed_animation_frames -= 1;
                        
                        if self.timed_animation_frames == 0 {
                            // Animation complete, move to next block
                            return ExecuteResult::Continue;
                        } else {
                            return ExecuteResult::Wait;
                        }
                    } else {
                        // Start the timed animation
                        let time_value = self.get_param_number(block, 0, variables);
                        let x_value = self.get_param_number(block, 1, variables);
                        let y_value = self.get_param_number(block, 2, variables);
                        
                        let frame_count = (time_value * 60.0).floor().max(1.0) as u32;
                        self.timed_dx = x_value / frame_count as f64;
                        self.timed_dy = y_value / frame_count as f64;
                        self.timed_animation_frames = frame_count;
                        
                        // Apply first frame
                        e.x += self.timed_dx;
                        e.y += self.timed_dy;
                        self.timed_animation_frames -= 1;
                        
                        if self.timed_animation_frames == 0 {
                            return ExecuteResult::Continue;
                        }
                        return ExecuteResult::Wait;
                    }
                }
                ExecuteResult::Continue
            }
            
            "locate_xy_time" => {
                if let Some(e) = entity {
                    // Check if we're in the middle of a timed animation
                    if self.timed_animation_frames > 0 {
                        // Move towards target
                        let dx = (self.timed_target_x - e.x) / self.timed_animation_frames as f64;
                        let dy = (self.timed_target_y - e.y) / self.timed_animation_frames as f64;
                        e.x += dx;
                        e.y += dy;
                        self.timed_animation_frames -= 1;
                        
                        if self.timed_animation_frames == 0 {
                            // Snap to exact target
                            e.x = self.timed_target_x;
                            e.y = self.timed_target_y;
                            return ExecuteResult::Continue;
                        } else {
                            return ExecuteResult::Wait;
                        }
                    } else {
                        // Start the timed animation
                        let time_value = self.get_param_number(block, 0, variables);
                        let x_value = self.get_param_number(block, 1, variables);
                        let y_value = self.get_param_number(block, 2, variables);
                        
                        let frame_count = (time_value * 60.0).floor().max(1.0) as u32;
                        self.timed_target_x = x_value;
                        self.timed_target_y = y_value;
                        self.timed_animation_frames = frame_count;
                        
                        // Apply first frame
                        let dx = (self.timed_target_x - e.x) / frame_count as f64;
                        let dy = (self.timed_target_y - e.y) / frame_count as f64;
                        e.x += dx;
                        e.y += dy;
                        self.timed_animation_frames -= 1;
                        
                        if self.timed_animation_frames == 0 {
                            e.x = self.timed_target_x;
                            e.y = self.timed_target_y;
                            return ExecuteResult::Continue;
                        }
                        return ExecuteResult::Wait;
                    }
                }
                ExecuteResult::Continue
            }
            
            "rotate_by_time" => {
                if let Some(e) = entity {
                    // Check if we're in the middle of a timed animation
                    if self.timed_animation_frames > 0 {
                        // Apply delta rotation
                        e.rotation += self.timed_d_rotation;
                        self.timed_animation_frames -= 1;
                        
                        if self.timed_animation_frames == 0 {
                            return ExecuteResult::Continue;
                        } else {
                            return ExecuteResult::Wait;
                        }
                    } else {
                        // Start the timed animation
                        let time_value = self.get_param_number(block, 0, variables);
                        let angle_value = self.get_param_number(block, 1, variables);
                        
                        let frame_count = (time_value * 60.0).floor().max(1.0) as u32;
                        self.timed_d_rotation = angle_value / frame_count as f64;
                        self.timed_animation_frames = frame_count;
                        
                        // Apply first frame
                        e.rotation += self.timed_d_rotation;
                        self.timed_animation_frames -= 1;
                        
                        if self.timed_animation_frames == 0 {
                            return ExecuteResult::Continue;
                        }
                        return ExecuteResult::Wait;
                    }
                }
                ExecuteResult::Continue
            }
            
            "direction_relative_duration" => {
                if let Some(e) = entity {
                    // Check if we're in the middle of a timed animation
                    if self.timed_animation_frames > 0 {
                        // Apply delta direction
                        e.direction += self.timed_d_direction;
                        self.timed_animation_frames -= 1;
                        
                        if self.timed_animation_frames == 0 {
                            return ExecuteResult::Continue;
                        } else {
                            return ExecuteResult::Wait;
                        }
                    } else {
                        // Start the timed animation
                        let time_value = self.get_param_number(block, 0, variables);
                        let direction_value = self.get_param_number(block, 1, variables);
                        
                        let frame_count = (time_value * 60.0).floor().max(1.0) as u32;
                        self.timed_d_direction = direction_value / frame_count as f64;
                        self.timed_animation_frames = frame_count;
                        
                        // Apply first frame
                        e.direction += self.timed_d_direction;
                        self.timed_animation_frames -= 1;
                        
                        if self.timed_animation_frames == 0 {
                            return ExecuteResult::Continue;
                        }
                        return ExecuteResult::Wait;
                    }
                }
                ExecuteResult::Continue
            }
            
            "bounce_wall" => {
                if let Some(e) = entity {
                    // Screen boundaries: ±240 (x), ±180 (y)
                    let half_width = e.width * e.scale_x.abs() / 2.0;
                    let half_height = e.height * e.scale_y.abs() / 2.0;
                    
                    // Calculate current movement angle (reserved for future use)
                    let _angle = (e.rotation + e.direction) % 360.0;
                    
                    // Check wall collisions and bounce
                    let touches_right = e.x + half_width >= 240.0;
                    let touches_left = e.x - half_width <= -240.0;
                    let touches_up = e.y + half_height >= 180.0;
                    let touches_down = e.y - half_height <= -180.0;
                    
                    // Horizontal bounce (left/right walls)
                    if touches_left || touches_right {
                        // Reflect direction horizontally: new_direction = -direction + 360
                        e.direction = (-e.direction + 360.0) % 360.0;
                        
                        // Keep entity in bounds
                        if touches_right {
                            e.x = 240.0 - half_width - 1.0;
                        } else {
                            e.x = -240.0 + half_width + 1.0;
                        }
                    }
                    
                    // Vertical bounce (up/down walls)
                    if touches_up || touches_down {
                        // Reflect direction vertically: new_direction = -direction + 180
                        e.direction = (-e.direction + 180.0) % 360.0;
                        
                        // Keep entity in bounds
                        if touches_up {
                            e.y = 180.0 - half_height - 1.0;
                        } else {
                            e.y = -180.0 + half_height + 1.0;
                        }
                    }
                }
                ExecuteResult::Continue
            }
            
            "locate" => {
                // Move to another object or mouse position
                // This requires knowing target entity position - for now, move to mouse
                if let Some(e) = entity {
                    let target = self.get_param_string(block, 0);
                    if target == "mouse" {
                        e.x = self.cached_mouse_x;
                        e.y = self.cached_mouse_y;
                    }
                    // For other objects, we'd need access to all entities
                }
                ExecuteResult::Continue
            }
            
            "see_angle_object" => {
                // Look at another object or mouse
                if let Some(e) = entity {
                    let target = self.get_param_string(block, 0);
                    let target_x: f64;
                    let target_y: f64;
                    
                    if target == "mouse" {
                        target_x = self.cached_mouse_x;
                        target_y = self.cached_mouse_y;
                    } else {
                        // For other objects, we'd need entity lookup
                        // Default to current position (no change)
                        target_x = e.x;
                        target_y = e.y;
                    }
                    
                    let dx = target_x - e.x;
                    let dy = target_y - e.y;
                    
                    if dx != 0.0 || dy != 0.0 {
                        let angle = if dx >= 0.0 {
                            (-dy.atan2(dx)).to_degrees() + 90.0
                        } else {
                            (-dy.atan2(dx)).to_degrees() + 270.0
                        };
                        e.direction = angle;
                    }
                }
                ExecuteResult::Continue
            }
            
            "see_angle_direction" => {
                // Set direction to a specific angle
                if let Some(e) = entity {
                    let angle = self.get_param_number(block, 0, variables);
                    e.direction = angle;
                }
                ExecuteResult::Continue
            }
            
            "locate_object_time" => {
                // Move to another object over time
                if let Some(e) = entity {
                    if self.timed_animation_frames > 0 {
                        // Move towards target
                        e.x += self.timed_dx;
                        e.y += self.timed_dy;
                        self.timed_animation_frames -= 1;
                        
                        if self.timed_animation_frames == 0 {
                            e.x = self.timed_target_x;
                            e.y = self.timed_target_y;
                            return ExecuteResult::Continue;
                        }
                        return ExecuteResult::Wait;
                    } else {
                        let time_value = self.get_param_number(block, 0, variables);
                        let target = self.get_param_string(block, 1);
                        
                        let (target_x, target_y) = if target == "mouse" {
                            (self.cached_mouse_x, self.cached_mouse_y)
                        } else {
                            // For other objects, default to current position
                            (e.x, e.y)
                        };
                        
                        let frame_count = (time_value * 60.0).floor().max(1.0) as u32;
                        self.timed_target_x = target_x;
                        self.timed_target_y = target_y;
                        self.timed_dx = (target_x - e.x) / frame_count as f64;
                        self.timed_dy = (target_y - e.y) / frame_count as f64;
                        self.timed_animation_frames = frame_count;
                        
                        e.x += self.timed_dx;
                        e.y += self.timed_dy;
                        self.timed_animation_frames -= 1;
                        
                        if self.timed_animation_frames == 0 {
                            e.x = self.timed_target_x;
                            e.y = self.timed_target_y;
                            return ExecuteResult::Continue;
                        }
                        return ExecuteResult::Wait;
                    }
                }
                ExecuteResult::Continue
            }

            // === Looks blocks ===
            "show" => {
                if let Some(e) = entity {
                    e.show();
                }
                ExecuteResult::Continue
            }
            
            "hide" => {
                if let Some(e) = entity {
                    e.hide();
                }
                ExecuteResult::Continue
            }
            
            "change_to_next_shape" => {
                if let Some(e) = entity {
                    e.next_picture();
                }
                ExecuteResult::Continue
            }
            
            "change_to_previous_shape" => {
                if let Some(e) = entity {
                    e.prev_picture();
                }
                ExecuteResult::Continue
            }
            
            "change_to_some_shape" => {
                if let Some(e) = entity {
                    // Get the picture ID from params
                    let picture_id = self.get_param_string(block, 0);
                    if !picture_id.is_empty() {
                        e.set_picture(&picture_id);
                    }
                }
                ExecuteResult::Continue
            }
            
            "set_effect" => {
                if let Some(e) = entity {
                    let effect = self.get_param_string(block, 0);
                    let value = self.get_param_number(block, 1, variables);
                    e.set_effect(&effect, value);
                }
                ExecuteResult::Continue
            }
            
            "change_effect" => {
                if let Some(e) = entity {
                    let effect = self.get_param_string(block, 0);
                    let value = self.get_param_number(block, 1, variables);
                    e.change_effect(&effect, value);
                }
                ExecuteResult::Continue
            }
            
            "clear_effect" | "erase_all_effects" => {
                if let Some(e) = entity {
                    e.clear_effects();
                }
                ExecuteResult::Continue
            }
            
            "add_effect_amount" => {
                // This is different from change_effect - it adds to different effect types
                if let Some(e) = entity {
                    let effect = self.get_param_string(block, 0);
                    let value = self.get_param_number(block, 1, variables);
                    // In Entry.js, add_effect_amount works with color/brightness/transparency
                    // using a different mapping than set_effect
                    match effect.as_str() {
                        "color" => {
                            // color maps to hsv effect
                            e.color_effect += value;
                        }
                        "brightness" => {
                            e.brightness += value;
                        }
                        "transparency" => {
                            e.transparency = (e.transparency + value).clamp(0.0, 100.0);
                        }
                        _ => {}
                    }
                }
                ExecuteResult::Continue
            }
            
            "change_effect_amount" => {
                // This sets the effect to an absolute value
                if let Some(e) = entity {
                    let effect = self.get_param_string(block, 0);
                    let value = self.get_param_number(block, 1, variables);
                    match effect.as_str() {
                        "color" => {
                            e.color_effect = value;
                        }
                        "brightness" => {
                            e.brightness = value;
                        }
                        "transparency" => {
                            e.transparency = value.clamp(0.0, 100.0);
                        }
                        _ => {}
                    }
                }
                ExecuteResult::Continue
            }
            
            "change_scale_size" => {
                if let Some(e) = entity {
                    let value = self.get_param_number(block, 0, variables);
                    e.change_scale(value / 100.0);
                }
                ExecuteResult::Continue
            }
            
            "set_scale_size" => {
                if let Some(e) = entity {
                    let value = self.get_param_number(block, 0, variables);
                    e.set_scale(value / 100.0);
                }
                ExecuteResult::Continue
            }
            
            "flip_x" => {
                if let Some(e) = entity {
                    e.scale_y = -e.scale_y;
                }
                ExecuteResult::Continue
            }
            
            "flip_y" => {
                if let Some(e) = entity {
                    e.scale_x = -e.scale_x;
                }
                ExecuteResult::Continue
            }
            
            "change_object_index" => {
                // Change z-index (layer order) - handled by JavaScript side
                let location = self.get_param_string(block, 0);
                js_actions.push(JsAction::ChangeObjectIndex {
                    entity_id: self.entity_idx,
                    location,
                });
                ExecuteResult::Continue
            }
            
            "dialog" | "dialog_time" => {
                if let Some(e) = entity {
                    // Get message from params
                    let message = self.get_param_value(block, 0, variables);
                    let message_str = Self::value_as_string(&message);
                    
                    // Get mode (speak/think) - different param index for dialog vs dialog_time
                    let mode = if block_type == "dialog_time" {
                        self.get_param_string(block, 2)  // dialog_time: params[2] is option
                    } else {
                        self.get_param_string(block, 1)  // dialog: params[1] is option
                    };
                    let mode = if mode.is_empty() { "speak".to_string() } else { mode };
                    
                    // Set dialog state on entity
                    e.dialog_message = Some(message_str.clone());
                    e.dialog_mode = Some(mode.clone());
                    
                    web_sys::console::log_1(&format!(
                        "[WASM] Dialog({}): {}", mode, message_str
                    ).into());
                    
                    if block_type == "dialog_time" {
                        let seconds = self.get_param_number(block, 1, variables);
                        self.wait_frames = (seconds * 60.0) as u32;
                    }
                }
                ExecuteResult::Continue
            }
            
            "remove_dialog" => {
                if let Some(e) = entity {
                    e.dialog_message = None;
                    e.dialog_mode = None;
                    web_sys::console::log_1(&"[WASM] Dialog removed".into());
                }
                ExecuteResult::Continue
            }

            // === Flow control blocks ===
            "wait_second" => {
                let seconds = self.get_param_number(block, 0, variables);
                self.wait_frames = (seconds * 60.0) as u32; // Assuming 60 FPS
                // Note: We return Continue here so block_index increments.
                // The wait will happen on subsequent ticks via wait_frames check.
                ExecuteResult::Continue
            }
            
            "repeat_basic" => {
                // Check if we're resuming a loop (iteration_count was set by stack pop)
                // or starting fresh
                let count = if self.iteration_count > 0 {
                    // Resuming from stack pop - use remaining iterations
                    self.iteration_count
                } else {
                    // Fresh start - get count from params
                    self.get_param_number(block, 0, variables) as u32
                };
                
                web_sys::console::log_1(&format!(
                    "[WASM] repeat_basic: count={}, has_statements={}",
                    count,
                    block.statements.is_some()
                ).into());
                
                if count > 0 {
                    if let Some(statements) = &block.statements {
                        if let Some(inner_blocks) = statements.first() {
                            if !inner_blocks.is_empty() {
                                web_sys::console::log_1(&format!(
                                    "[WASM] repeat_basic: entering loop iteration, {} remaining",
                                    count
                                ).into());
                                // Save current state with remaining count
                                let frame = StackFrame {
                                    blocks: self.blocks.clone(),
                                    block_index: self.block_index,
                                    iteration_count: count - 1,
                                    is_loop: true,
                                };
                                self.call_stack.push(frame);
                                
                                // Enter loop body
                                self.blocks = inner_blocks.clone();
                                self.block_index = 0;
                                self.iteration_count = 0; // Reset for inner blocks
                                return ExecuteResult::JumpedToBlock;
                            }
                        }
                    }
                }
                // Loop finished or no statements
                self.iteration_count = 0;
                ExecuteResult::Continue
            }
            
            "repeat_inf" => {
                if let Some(statements) = &block.statements {
                    if let Some(inner_blocks) = statements.first() {
                        if !inner_blocks.is_empty() {
                            let frame = StackFrame {
                                blocks: self.blocks.clone(),
                                block_index: self.block_index,
                                iteration_count: u32::MAX,
                                is_loop: true,
                            };
                            self.call_stack.push(frame);
                            
                            self.blocks = inner_blocks.clone();
                            self.block_index = 0;
                            self.iteration_count = u32::MAX;
                            return ExecuteResult::JumpedToBlock;
                        }
                    }
                }
                ExecuteResult::Continue
            }
            
            "_if" => {
                let condition = self.get_param_bool(block, 0, variables);
                if condition {
                    if let Some(statements) = &block.statements {
                        if let Some(inner_blocks) = statements.first() {
                            if !inner_blocks.is_empty() {
                                let frame = StackFrame {
                                    blocks: self.blocks.clone(),
                                    block_index: self.block_index,
                                    iteration_count: 0,
                                    is_loop: false,
                                };
                                self.call_stack.push(frame);
                                
                                self.blocks = inner_blocks.clone();
                                self.block_index = 0;
                                return ExecuteResult::JumpedToBlock;
                            }
                        }
                    }
                }
                ExecuteResult::Continue
            }
            
            "if_else" => {
                let condition = self.get_param_bool(block, 0, variables);
                if let Some(statements) = &block.statements {
                    let branch_idx = if condition { 0 } else { 1 };
                    if let Some(inner_blocks) = statements.get(branch_idx) {
                        if !inner_blocks.is_empty() {
                            let frame = StackFrame {
                                blocks: self.blocks.clone(),
                                block_index: self.block_index,
                                iteration_count: 0,
                                is_loop: false,
                            };
                            self.call_stack.push(frame);
                            
                            self.blocks = inner_blocks.clone();
                            self.block_index = 0;
                            return ExecuteResult::JumpedToBlock;
                        }
                    }
                }
                ExecuteResult::Continue
            }
            
            "stop_repeat" => ExecuteResult::Break,
            
            "continue_repeat" => {
                // Continue to next iteration of loop - pop back to loop start
                while let Some(frame) = self.call_stack.pop() {
                    if frame.is_loop {
                        // Found the loop, restore and continue iteration
                        self.blocks = frame.blocks;
                        self.block_index = frame.block_index;
                        if frame.iteration_count > 0 {
                            self.iteration_count = frame.iteration_count;
                        }
                        return ExecuteResult::Continue;
                    }
                }
                // No loop found, just continue
                ExecuteResult::Continue
            }
            
            "repeat_while_true" => {
                // Get the condition and option (until/while)
                let condition = self.get_param_bool(block, 0, variables);
                let option = self.get_param_string(block, 1);
                
                // If option is "until", invert the condition
                // "until" means loop UNTIL condition becomes true (loop while condition is false)
                // "while" means loop WHILE condition is true
                let should_loop = if option == "until" { !condition } else { condition };
                
                web_sys::console::log_1(&format!(
                    "[WASM] repeat_while_true: condition={}, option='{}', should_loop={}",
                    condition, option, should_loop
                ).into());
                
                if should_loop {
                    if let Some(statements) = &block.statements {
                        if let Some(inner_blocks) = statements.first() {
                            if !inner_blocks.is_empty() {
                                let frame = StackFrame {
                                    blocks: self.blocks.clone(),
                                    block_index: self.block_index,
                                    iteration_count: u32::MAX, // Infinite until condition changes
                                    is_loop: true,
                                };
                                self.call_stack.push(frame);
                                
                                self.blocks = inner_blocks.clone();
                                self.block_index = 0;
                                self.iteration_count = 0;
                                return ExecuteResult::JumpedToBlock;
                            }
                        }
                    }
                }
                // Condition not met (or no longer met), exit loop
                self.iteration_count = 0;
                ExecuteResult::Continue
            }
            
            "wait_until_true" => {
                let condition = self.get_param_bool(block, 0, variables);
                if condition {
                    ExecuteResult::Continue
                } else {
                    // Stay on this block and wait
                    ExecuteResult::Wait
                }
            }
            
            "stop_object" => {
                // Stop execution
                ExecuteResult::End
            }
            
            "restart_project" => {
                js_actions.push(JsAction::RestartProject);
                ExecuteResult::End
            }
            
            "create_clone" => {
                let target = self.get_param_string(block, 0);
                js_actions.push(JsAction::CreateClone {
                    entity_id: self.entity_idx,
                    target,
                });
                ExecuteResult::Continue
            }
            
            "delete_clone" => {
                js_actions.push(JsAction::DeleteClone {
                    entity_id: self.entity_idx,
                });
                ExecuteResult::End
            }
            
            "remove_all_clones" => {
                js_actions.push(JsAction::RemoveAllClones);
                ExecuteResult::Continue
            }
            
            "message_cast" => {
                let message_id = self.get_param_string(block, 0);
                js_actions.push(JsAction::MessageCast { message_id });
                ExecuteResult::Continue
            }
            
            "message_cast_wait" => {
                let message_id = self.get_param_string(block, 0);
                js_actions.push(JsAction::MessageCastWait { message_id });
                // This would need to wait for message handlers to complete
                ExecuteResult::Continue
            }
            
            "start_scene" => {
                let scene_id = self.get_param_string(block, 0);
                js_actions.push(JsAction::StartScene { scene_id });
                ExecuteResult::End
            }
            
            "start_neighbor_scene" => {
                let direction = self.get_param_string(block, 0);
                if direction == "next" {
                    js_actions.push(JsAction::StartNextScene);
                } else {
                    js_actions.push(JsAction::StartPreviousScene);
                }
                ExecuteResult::End
            }
            
            // === List blocks ===
            "add_value_to_list" => {
                // Lists are handled via variables HashMap for now
                let list_id = self.get_param_string(block, 1);
                let value = self.get_param_value(block, 0, variables);
                
                if let Some(list_var) = variables.get_mut(&list_id) {
                    if let Value::List(list) = list_var {
                        list.push(value);
                    }
                }
                ExecuteResult::Continue
            }
            
            "remove_value_from_list" => {
                let list_id = self.get_param_string(block, 1);
                let index = self.get_param_number(block, 0, variables) as usize;
                
                if let Some(list_var) = variables.get_mut(&list_id) {
                    if let Value::List(list) = list_var {
                        if index > 0 && index <= list.len() {
                            list.remove(index - 1);
                        }
                    }
                }
                ExecuteResult::Continue
            }
            
            "insert_value_to_list" => {
                let list_id = self.get_param_string(block, 1);
                let value = self.get_param_value(block, 0, variables);
                let index = self.get_param_number(block, 2, variables) as usize;
                
                if let Some(list_var) = variables.get_mut(&list_id) {
                    if let Value::List(list) = list_var {
                        if index > 0 && index <= list.len() + 1 {
                            list.insert(index - 1, value);
                        }
                    }
                }
                ExecuteResult::Continue
            }
            
            "change_value_list_index" => {
                let list_id = self.get_param_string(block, 0);
                let index = self.get_param_number(block, 1, variables) as usize;
                let value = self.get_param_value(block, 2, variables);
                
                if let Some(list_var) = variables.get_mut(&list_id) {
                    if let Value::List(list) = list_var {
                        if index > 0 && index <= list.len() {
                            list[index - 1] = value;
                        }
                    }
                }
                ExecuteResult::Continue
            }
            
            "show_variable" => {
                let variable_id = self.get_param_string(block, 0);
                js_actions.push(JsAction::ShowVariable { variable_id });
                ExecuteResult::Continue
            }
            
            "hide_variable" => {
                let variable_id = self.get_param_string(block, 0);
                js_actions.push(JsAction::HideVariable { variable_id });
                ExecuteResult::Continue
            }
            
            "show_list" => {
                let list_id = self.get_param_string(block, 0);
                js_actions.push(JsAction::ShowList { list_id });
                ExecuteResult::Continue
            }
            
            "hide_list" => {
                let list_id = self.get_param_string(block, 0);
                js_actions.push(JsAction::HideList { list_id });
                ExecuteResult::Continue
            }
            
            "ask_and_wait" => {
                let message = self.get_param_value(block, 0, variables);
                let message_str = Self::value_as_string(&message);
                js_actions.push(JsAction::AskAndWait {
                    entity_id: self.entity_idx,
                    message: message_str,
                });
                // TODO: This should wait for user input - needs wait mechanism
                ExecuteResult::Continue
            }
            
            // === Sound blocks (require JS Audio handling) ===
            "sound_something" => {
                let sound_id = self.get_param_string(block, 0);
                js_actions.push(JsAction::PlaySound {
                    entity_id: self.entity_idx,
                    sound_id,
                });
                ExecuteResult::Continue
            }
            
            "sound_something_wait" => {
                let sound_id = self.get_param_string(block, 0);
                js_actions.push(JsAction::PlaySoundWait {
                    entity_id: self.entity_idx,
                    sound_id,
                });
                // TODO: Should wait for sound to finish playing
                ExecuteResult::Continue
            }
            
            "sound_something_second" => {
                let sound_id = self.get_param_string(block, 0);
                let start_second = self.get_param_number(block, 1, variables);
                js_actions.push(JsAction::PlaySoundFromSecond {
                    entity_id: self.entity_idx,
                    sound_id,
                    start_second,
                });
                ExecuteResult::Continue
            }
            
            "sound_something_with_block" => {
                let sound_id = self.get_param_string(block, 0);
                js_actions.push(JsAction::PlaySound {
                    entity_id: self.entity_idx,
                    sound_id,
                });
                ExecuteResult::Continue
            }
            
            "sound_something_second_with_block" => {
                let sound_id = self.get_param_string(block, 0);
                let duration = self.get_param_number(block, 1, variables);
                js_actions.push(JsAction::PlaySoundDuration {
                    entity_id: self.entity_idx,
                    sound_id,
                    duration,
                });
                ExecuteResult::Continue
            }
            
            "sound_something_wait_with_block" => {
                let sound_id = self.get_param_string(block, 0);
                js_actions.push(JsAction::PlaySoundWait {
                    entity_id: self.entity_idx,
                    sound_id,
                });
                // TODO: Should wait for sound to finish
                ExecuteResult::Continue
            }
            
            "sound_something_second_wait_with_block" => {
                let sound_id = self.get_param_string(block, 0);
                let duration = self.get_param_number(block, 1, variables);
                js_actions.push(JsAction::PlaySoundDurationWait {
                    entity_id: self.entity_idx,
                    sound_id,
                    duration,
                });
                // TODO: Should wait for duration
                ExecuteResult::Continue
            }
            
            "sound_from_to" => {
                let sound_id = self.get_param_string(block, 0);
                let start = self.get_param_number(block, 1, variables);
                let end = self.get_param_number(block, 2, variables);
                js_actions.push(JsAction::PlaySoundFromTo {
                    entity_id: self.entity_idx,
                    sound_id,
                    start,
                    end,
                });
                ExecuteResult::Continue
            }
            
            "sound_from_to_and_wait" => {
                let sound_id = self.get_param_string(block, 0);
                let start = self.get_param_number(block, 1, variables);
                let end = self.get_param_number(block, 2, variables);
                js_actions.push(JsAction::PlaySoundFromToWait {
                    entity_id: self.entity_idx,
                    sound_id,
                    start,
                    end,
                });
                // TODO: Should wait for sound to finish
                ExecuteResult::Continue
            }
            
            "sound_stop" => {
                js_actions.push(JsAction::StopSound);
                ExecuteResult::Continue
            }
            
            "sound_silent_all" => {
                js_actions.push(JsAction::StopAllSounds);
                ExecuteResult::Continue
            }
            
            "play_bgm" => {
                let sound_id = self.get_param_string(block, 0);
                js_actions.push(JsAction::PlayBGM {
                    entity_id: self.entity_idx,
                    sound_id,
                });
                ExecuteResult::Continue
            }
            
            "stop_bgm" => {
                js_actions.push(JsAction::StopBGM);
                ExecuteResult::Continue
            }
            
            "sound_volume_change" => {
                let delta = self.get_param_number(block, 0, variables);
                js_actions.push(JsAction::ChangeSoundVolume { delta });
                ExecuteResult::Continue
            }
            
            "sound_volume_set" => {
                let volume = self.get_param_number(block, 0, variables);
                js_actions.push(JsAction::SetSoundVolume { volume });
                ExecuteResult::Continue
            }
            
            "sound_speed_change" => {
                let delta = self.get_param_number(block, 0, variables);
                js_actions.push(JsAction::ChangeSoundSpeed { delta });
                ExecuteResult::Continue
            }
            
            "sound_speed_set" => {
                let speed = self.get_param_number(block, 0, variables);
                js_actions.push(JsAction::SetSoundSpeed { speed });
                ExecuteResult::Continue
            }
            
            // === Timer blocks ===
            "choose_project_timer_action" => {
                let action = self.get_param_string(block, 1);
                js_actions.push(JsAction::TimerAction { action });
                ExecuteResult::Continue
            }
            
            "set_visible_project_timer" => {
                let action = self.get_param_string(block, 1);
                let visible = action == "SHOW" || action == "show";
                js_actions.push(JsAction::SetTimerVisible { visible });
                ExecuteResult::Continue
            }
            
            // === Brush/Pen blocks ===
            "brush_stamp" => {
                js_actions.push(JsAction::BrushStamp {
                    entity_id: self.entity_idx,
                });
                ExecuteResult::Continue
            }
            
            "brush_down" | "brush_up" => {
                if let Some(e) = entity {
                    e.brush_down = block_type == "brush_down";
                }
                ExecuteResult::Continue
            }
            
            "set_brush_color" => {
                // Color can be a direct string or a nested "color" block
                let mut color = self.get_param_string(block, 0);
                if color.is_empty() {
                    // Try evaluating as a nested block (e.g., color picker block)
                    let color_value = self.get_param_value(block, 0, variables);
                    color = Self::value_as_string(&color_value);
                }
                web_sys::console::log_1(&format!(
                    "[WASM] set_brush_color: color='{}'", color
                ).into());
                if let Some(e) = entity {
                    if !color.is_empty() {
                        e.brush_color = color.clone();
                    }
                }
                if !color.is_empty() {
                    js_actions.push(JsAction::SetBrushColor {
                        entity_id: self.entity_idx,
                        color,
                    });
                }
                ExecuteResult::Continue
            }
            
            "set_brush_size" | "change_brush_size" => {
                if let Some(e) = entity {
                    let value = self.get_param_number(block, 0, variables);
                    if block_type == "set_brush_size" {
                        e.brush_size = value.max(1.0);
                    } else {
                        e.brush_size = (e.brush_size + value).max(1.0);
                    }
                }
                ExecuteResult::Continue
            }
            
            "brush_erase_all" | "brush_clear" => {
                js_actions.push(JsAction::BrushEraseAll);
                ExecuteResult::Continue
            }
            
            "start_drawing" => {
                if let Some(e) = entity {
                    e.brush_down = true;
                }
                js_actions.push(JsAction::StartDrawing {
                    entity_id: self.entity_idx,
                });
                ExecuteResult::Continue
            }
            
            "stop_drawing" => {
                if let Some(e) = entity {
                    e.brush_down = false;
                }
                js_actions.push(JsAction::StopDrawing {
                    entity_id: self.entity_idx,
                });
                ExecuteResult::Continue
            }
            
            "start_fill" => {
                web_sys::console::log_1(&"[WASM] start_fill".into());
                js_actions.push(JsAction::StartFill {
                    entity_id: self.entity_idx,
                });
                ExecuteResult::Continue
            }
            
            "stop_fill" => {
                web_sys::console::log_1(&"[WASM] stop_fill".into());
                js_actions.push(JsAction::StopFill {
                    entity_id: self.entity_idx,
                });
                ExecuteResult::Continue
            }
            
            "set_color" => {
                // Color can be a direct string or a nested "color" block
                let mut color = self.get_param_string(block, 0);
                if color.is_empty() {
                    // Try evaluating as a nested block (e.g., color picker block)
                    let color_value = self.get_param_value(block, 0, variables);
                    color = Self::value_as_string(&color_value);
                }
                web_sys::console::log_1(&format!(
                    "[WASM] set_color: color='{}'", color
                ).into());
                if let Some(e) = entity {
                    if !color.is_empty() {
                        e.brush_color = color.clone();
                    }
                }
                if !color.is_empty() {
                    js_actions.push(JsAction::SetBrushColor {
                        entity_id: self.entity_idx,
                        color,
                    });
                }
                ExecuteResult::Continue
            }
            
            "set_random_color" => {
                js_actions.push(JsAction::SetRandomColor {
                    entity_id: self.entity_idx,
                });
                ExecuteResult::Continue
            }
            
            "set_fill_color" => {
                // Color can be a direct string or a nested "color" block
                let mut color = self.get_param_string(block, 0);
                if color.is_empty() {
                    // Try evaluating as a nested block (e.g., color picker block)
                    let color_value = self.get_param_value(block, 0, variables);
                    color = Self::value_as_string(&color_value);
                }
                web_sys::console::log_1(&format!(
                    "[WASM] set_fill_color: color='{}'", color
                ).into());
                if !color.is_empty() {
                    js_actions.push(JsAction::SetFillColor {
                        entity_id: self.entity_idx,
                        color,
                    });
                }
                ExecuteResult::Continue
            }
            
            "change_thickness" => {
                if let Some(e) = entity {
                    let value = self.get_param_number(block, 0, variables);
                    e.brush_size = (e.brush_size + value).max(1.0);
                }
                ExecuteResult::Continue
            }
            
            "set_thickness" => {
                if let Some(e) = entity {
                    let value = self.get_param_number(block, 0, variables);
                    e.brush_size = value.max(1.0);
                }
                ExecuteResult::Continue
            }
            
            "change_brush_transparency" => {
                if let Some(e) = entity {
                    let value = self.get_param_number(block, 0, variables);
                    e.transparency = (e.transparency + value).clamp(0.0, 100.0);
                }
                ExecuteResult::Continue
            }
            
            "set_brush_tranparency" => {
                if let Some(e) = entity {
                    let value = self.get_param_number(block, 0, variables);
                    e.transparency = value.clamp(0.0, 100.0);
                }
                ExecuteResult::Continue
            }
            
            // === Additional Looks blocks ===
            "stretch_scale_size" => {
                if let Some(e) = entity {
                    let dimension = self.get_param_string(block, 0);
                    let value = self.get_param_number(block, 1, variables);
                    if dimension == "WIDTH" {
                        e.scale_x += value / 100.0;
                    } else {
                        e.scale_y += value / 100.0;
                    }
                }
                ExecuteResult::Continue
            }
            
            "reset_scale_size" => {
                if let Some(e) = entity {
                    e.scale_x = 1.0;
                    e.scale_y = 1.0;
                }
                ExecuteResult::Continue
            }

            // === Variable blocks ===
            "set_variable" => {
                let var_id = self.get_param_string(block, 0);
                let value = self.get_param_value(block, 1, variables);
                variables.insert(var_id, value);
                ExecuteResult::Continue
            }
            
            "set_visible_answer" => {
                let action = self.get_param_string(block, 0);
                let visible = action == "SHOW" || action == "show";
                js_actions.push(JsAction::SetAnswerVisible { visible });
                ExecuteResult::Continue
            }
            
            "change_variable" => {
                let var_id = self.get_param_string(block, 0);
                let delta = self.get_param_number(block, 1, variables);
                if let Some(var) = variables.get_mut(&var_id) {
                    let current = var.as_number();
                    *var = Value::Number(current + delta);
                }
                ExecuteResult::Continue
            }

            // === Calculation blocks (return values) ===
            "calc_basic" => {
                // This is handled in get_param_number for nested blocks
                ExecuteResult::Continue
            }

            // Default: unknown block, just continue
            _ => {
                // Log unknown block type in debug builds
                #[cfg(debug_assertions)]
                web_sys::console::log_1(&format!("Unknown block type: {}", block_type).into());
                ExecuteResult::Continue
            }
        }
    }

    /// Execute a function call (func_XXXX blocks)
    fn execute_function_call(
        &mut self,
        block: &Block,
        functions: &HashMap<String, FunctionData>,
    ) -> ExecuteResult {
        // Extract function ID from block type ("func_XXXX" -> "XXXX")
        let func_id = &block.block_type[5..]; // Skip "func_" prefix
        
        web_sys::console::log_1(&format!(
            "[WASM] execute_function_call: func_id='{}', block_type='{}', available_functions={:?}",
            func_id,
            block.block_type,
            functions.keys().collect::<Vec<_>>()
        ).into());
        
        // First check if the current block itself has statements (function body)
        // This handles the case where function is called and the body is in statements
        if let Some(statements) = &block.statements {
            web_sys::console::log_1(&format!(
                "[WASM] Current block has {} statement lists",
                statements.len()
            ).into());
            
            if let Some(body) = statements.first() {
                if !body.is_empty() {
                    web_sys::console::log_1(&format!(
                        "[WASM] Found function body in current block statements: {} blocks",
                        body.len()
                    ).into());
                    for (i, blk) in body.iter().enumerate() {
                        web_sys::console::log_1(&format!(
                            "[WASM]   Block {}: type='{}'",
                            i, blk.block_type
                        ).into());
                    }
                    
                    // Push current state to call stack
                    let frame = StackFrame {
                        blocks: self.blocks.clone(),
                        block_index: self.block_index,
                        iteration_count: 0,
                        is_loop: false,
                    };
                    self.call_stack.push(frame);
                    
                    // Set up execution of function body
                    self.blocks = body.clone();
                    self.block_index = 0;
                    self.iteration_count = 0;
                    
                    return ExecuteResult::JumpedToBlock;
                }
            }
        } else {
            web_sys::console::log_1(&"[WASM] Current block has NO statements".into());
        }
        
        // Look up the function
        if let Some(func_data) = functions.get(func_id) {
            web_sys::console::log_1(&format!(
                "[WASM] Found function: id={}, has_content={}",
                func_data.id,
                func_data.content.is_some()
            ).into());
            
            if let Some(content) = &func_data.content {
                web_sys::console::log_1(&format!(
                    "[WASM] Function content has {} threads",
                    content.len()
                ).into());
                
                // The function content is Vec<Vec<Block>> (threads of blocks)
                // We need to find the function_create block and get its statements
                if let Some(first_thread) = content.first() {
                    web_sys::console::log_1(&format!(
                        "[WASM] First thread has {} blocks",
                        first_thread.len()
                    ).into());
                    
                    if let Some(func_create_block) = first_thread.first() {
                        web_sys::console::log_1(&format!(
                            "[WASM] Function create block type: '{}', has_statements: {}",
                            func_create_block.block_type,
                            func_create_block.statements.is_some()
                        ).into());
                        
                        // Try to get function body from statements first
                        let mut func_body: Option<Vec<Block>> = None;
                        
                        if let Some(statements) = &func_create_block.statements {
                            web_sys::console::log_1(&format!(
                                "[WASM] Statements has {} statement lists",
                                statements.len()
                            ).into());
                            
                            if let Some(body) = statements.first() {
                                if !body.is_empty() {
                                    func_body = Some(body.clone());
                                    web_sys::console::log_1(&format!(
                                        "[WASM] Found function body in statements: {} blocks",
                                        body.len()
                                    ).into());
                                }
                            }
                        }
                        
                        // If statements is empty, check if the function body is stored
                        // as subsequent blocks in the thread (Entry.js format before load() processes it)
                        if func_body.is_none() && first_thread.len() > 1 {
                            // The function body blocks are stored after the function_create block
                            let body: Vec<Block> = first_thread.iter().skip(1).cloned().collect();
                            if !body.is_empty() {
                                func_body = Some(body.clone());
                                web_sys::console::log_1(&format!(
                                    "[WASM] Found function body as subsequent blocks: {} blocks",
                                    body.len()
                                ).into());
                                for (i, blk) in body.iter().enumerate() {
                                    web_sys::console::log_1(&format!(
                                        "[WASM]   Block {}: type='{}'",
                                        i, blk.block_type
                                    ).into());
                                }
                            }
                        }
                        
                        // Execute the function body if found
                        if let Some(body) = func_body {
                            web_sys::console::log_1(&format!(
                                "[WASM] Executing function body with {} blocks",
                                body.len()
                            ).into());
                            
                            // Push current state to call stack
                            let frame = StackFrame {
                                blocks: self.blocks.clone(),
                                block_index: self.block_index,
                                iteration_count: 0,
                                is_loop: false,
                            };
                            self.call_stack.push(frame);
                            
                            // Set up execution of function body
                            self.blocks = body;
                            self.block_index = 0;
                            self.iteration_count = 0;
                            
                            return ExecuteResult::JumpedToBlock;
                        } else {
                            web_sys::console::log_1(&"[WASM] Function body is empty or not found".into());
                        }
                    } else {
                        web_sys::console::log_1(&"[WASM] No function_create block in first thread".into());
                    }
                } else {
                    web_sys::console::log_1(&"[WASM] No first thread in content".into());
                }
            } else {
                web_sys::console::log_1(&"[WASM] Function content is None".into());
            }
            
            web_sys::console::log_1(&"[WASM] Function has no executable content".into());
        } else {
            web_sys::console::log_1(&format!(
                "[WASM] Function not found: '{}'. Available functions: {:?}",
                func_id,
                functions.keys().collect::<Vec<_>>()
            ).into());
        }
        
        // Function not found or empty - just continue
        ExecuteResult::Continue
    }

    // Parameter extraction helpers
    fn get_param_number(&self, block: &Block, index: usize, variables: &HashMap<String, Value>) -> f64 {
        if let Some(params) = &block.params {
            if let Some(param) = params.get(index) {
                let value = self.evaluate_value(param, variables);
                let num = value.as_number();
                // Debug log for troubleshooting
                web_sys::console::log_1(&format!(
                    "[WASM] get_param_number({}, {}): param={:?}, value={:?}, num={}",
                    block.block_type, index, param, value, num
                ).into());
                return num;
            }
        }
        0.0
    }

    fn get_param_string(&self, block: &Block, index: usize) -> String {
        if let Some(params) = &block.params {
            if let Some(param) = params.get(index) {
                if let Some(s) = param.as_str() {
                    return s.to_string();
                }
            }
        }
        String::new()
    }

    fn get_param_bool(&self, block: &Block, index: usize, variables: &HashMap<String, Value>) -> bool {
        if let Some(params) = &block.params {
            if let Some(param) = params.get(index) {
                return self.evaluate_value(param, variables).as_bool();
            }
        }
        false
    }

    fn get_param_value(&self, block: &Block, index: usize, variables: &HashMap<String, Value>) -> Value {
        if let Some(params) = &block.params {
            if let Some(param) = params.get(index) {
                return self.evaluate_value(param, variables);
            }
        }
        Value::Null
    }

    fn evaluate_value(&self, json: &serde_json::Value, variables: &HashMap<String, Value>) -> Value {
        match json {
            serde_json::Value::Number(n) => Value::Number(n.as_f64().unwrap_or(0.0)),
            serde_json::Value::String(s) => Value::String(s.clone()),
            serde_json::Value::Bool(b) => Value::Bool(*b),
            serde_json::Value::Object(obj) => {
                // This is a nested block
                if let Some(block_type) = obj.get("type").and_then(|v| v.as_str()) {
                    return self.evaluate_block(block_type, obj, variables);
                }
                Value::Null
            }
            serde_json::Value::Array(arr) => {
                Value::List(arr.iter().map(|v| self.evaluate_value(v, variables)).collect())
            }
            _ => Value::Null,
        }
    }

    fn evaluate_block(&self, block_type: &str, obj: &serde_json::Map<String, serde_json::Value>, variables: &HashMap<String, Value>) -> Value {
        match block_type {
            "number" | "angle" => {
                // Both "number" and "angle" blocks have the same structure
                if let Some(params) = obj.get("params").and_then(|v| v.as_array()) {
                    if let Some(val) = params.first() {
                        if let Some(s) = val.as_str() {
                            return Value::Number(s.parse().unwrap_or(0.0));
                        }
                        if let Some(n) = val.as_f64() {
                            return Value::Number(n);
                        }
                    }
                }
                Value::Number(0.0)
            }
            
            "text" => {
                if let Some(params) = obj.get("params").and_then(|v| v.as_array()) {
                    if let Some(val) = params.first() {
                        if let Some(s) = val.as_str() {
                            return Value::String(s.to_string());
                        }
                    }
                }
                Value::String(String::new())
            }
            
            "color" | "Color" => {
                // Color picker block - extract color value from params[0]
                if let Some(params) = obj.get("params").and_then(|v| v.as_array()) {
                    if let Some(val) = params.first() {
                        if let Some(s) = val.as_str() {
                            return Value::String(s.to_string());
                        }
                    }
                }
                Value::String(String::new())
            }
            
            "True" => Value::Bool(true),
            "False" => Value::Bool(false),
            
            "get_variable" => {
                if let Some(params) = obj.get("params").and_then(|v| v.as_array()) {
                    if let Some(var_id) = params.first().and_then(|v| v.as_str()) {
                        if let Some(val) = variables.get(var_id) {
                            return val.clone();
                        }
                    }
                }
                Value::Number(0.0)
            }
            
            "calc_basic" => {
                if let Some(params) = obj.get("params").and_then(|v| v.as_array()) {
                    let left = params.get(0).map(|v| self.evaluate_value(v, variables).as_number()).unwrap_or(0.0);
                    let op = params.get(1).and_then(|v| v.as_str()).unwrap_or("+");
                    let right = params.get(2).map(|v| self.evaluate_value(v, variables).as_number()).unwrap_or(0.0);
                    
                    let result = match op {
                        "PLUS" | "+" => left + right,
                        "MINUS" | "-" => left - right,
                        "MULTI" | "*" => left * right,
                        "DIVIDE" | "/" => if right != 0.0 { left / right } else { 0.0 },
                        _ => 0.0,
                    };
                    return Value::Number(result);
                }
                Value::Number(0.0)
            }
            
            "calc_rand" => {
                if let Some(params) = obj.get("params").and_then(|v| v.as_array()) {
                    let min = params.get(0).map(|v| self.evaluate_value(v, variables).as_number()).unwrap_or(0.0);
                    let max = params.get(1).map(|v| self.evaluate_value(v, variables).as_number()).unwrap_or(10.0);
                    
                    // Simple pseudo-random (not cryptographically secure)
                    let random = js_sys::Math::random();
                    let result = min + random * (max - min);
                    return Value::Number(result);
                }
                Value::Number(0.0)
            }
            
            "boolean_basic_operator" => {
                if let Some(params) = obj.get("params").and_then(|v| v.as_array()) {
                    let left = params.get(0).map(|v| self.evaluate_value(v, variables).as_number()).unwrap_or(0.0);
                    let op = params.get(1).and_then(|v| v.as_str()).unwrap_or("EQUAL");
                    let right = params.get(2).map(|v| self.evaluate_value(v, variables).as_number()).unwrap_or(0.0);
                    
                    let result = match op {
                        "EQUAL" | "==" => (left - right).abs() < f64::EPSILON,
                        "NOT_EQUAL" | "!=" => (left - right).abs() >= f64::EPSILON,
                        "GREATER" | ">" => left > right,
                        "GREATER_OR_EQUAL" | ">=" => left >= right,
                        "LESS" | "<" => left < right,
                        "LESS_OR_EQUAL" | "<=" => left <= right,
                        _ => false,
                    };
                    return Value::Bool(result);
                }
                Value::Bool(false)
            }
            
            "boolean_and_or" => {
                if let Some(params) = obj.get("params").and_then(|v| v.as_array()) {
                    let left = params.get(0).map(|v| self.evaluate_value(v, variables).as_bool()).unwrap_or(false);
                    let op = params.get(1).and_then(|v| v.as_str()).unwrap_or("AND");
                    let right = params.get(2).map(|v| self.evaluate_value(v, variables).as_bool()).unwrap_or(false);
                    
                    let result = match op {
                        "AND" => left && right,
                        "OR" => left || right,
                        _ => false,
                    };
                    return Value::Bool(result);
                }
                Value::Bool(false)
            }
            
            "boolean_not" => {
                if let Some(params) = obj.get("params").and_then(|v| v.as_array()) {
                    let val = params.get(0).map(|v| self.evaluate_value(v, variables).as_bool()).unwrap_or(false);
                    return Value::Bool(!val);
                }
                Value::Bool(true)
            }
            
            // Entity property blocks
            "get_x" => Value::Number(self.cached_entity_x),
            "get_y" => Value::Number(self.cached_entity_y),
            "get_rotation" => Value::Number(self.cached_entity_rotation),
            "get_direction" => Value::Number(self.cached_entity_direction),
            "get_scale" => Value::Number(self.cached_entity_scale),
            
            // Coordinate blocks
            "coordinate_mouse" => {
                // Return 0 for mouse coordinates since we don't have mouse in WASM
                // In a real implementation, this would get from JavaScript
                Value::Number(0.0)
            }
            
            "coordinate_object" => {
                // Get coordinate of another object - for now return cached values
                if let Some(params) = obj.get("params").and_then(|v| v.as_array()) {
                    let coord = params.get(3).and_then(|v| v.as_str()).unwrap_or("x");
                    match coord {
                        "x" => return Value::Number(self.cached_entity_x),
                        "y" => return Value::Number(self.cached_entity_y),
                        "rotation" => return Value::Number(self.cached_entity_rotation),
                        "direction" => return Value::Number(self.cached_entity_direction),
                        "size" => return Value::Number(self.cached_entity_scale),
                        _ => return Value::Number(0.0),
                    }
                }
                Value::Number(0.0)
            }
            
            // Math operations
            "calc_operation" => {
                if let Some(params) = obj.get("params").and_then(|v| v.as_array()) {
                    let value = params.get(1).map(|v| self.evaluate_value(v, variables).as_number()).unwrap_or(0.0);
                    let op = params.get(3).and_then(|v| v.as_str()).unwrap_or("round");
                    
                    let result = match op {
                        "square" => value * value,
                        "root" | "sqrt" => value.sqrt(),
                        "sin" => (value.to_radians()).sin(),
                        "cos" => (value.to_radians()).cos(),
                        "tan" => (value.to_radians()).tan(),
                        "asin" | "asin_radian" => value.asin().to_degrees(),
                        "acos" | "acos_radian" => value.acos().to_degrees(),
                        "atan" | "atan_radian" => value.atan().to_degrees(),
                        "log" => value.log10(),
                        "ln" => value.ln(),
                        "floor" => value.floor(),
                        "ceil" => value.ceil(),
                        "round" => value.round(),
                        "abs" => value.abs(),
                        "factorial" => {
                            let n = value as u64;
                            let mut result = 1u64;
                            for i in 2..=n {
                                result = result.saturating_mul(i);
                            }
                            result as f64
                        }
                        "unnatural" => value - value.floor(), // Decimal part
                        _ => value.round(),
                    };
                    return Value::Number(result);
                }
                Value::Number(0.0)
            }
            
            // String operations
            "length_of_string" => {
                if let Some(params) = obj.get("params").and_then(|v| v.as_array()) {
                    let val = params.get(1).map(|v| self.evaluate_value(v, variables)).unwrap_or(Value::Null);
                    let s = Self::value_as_string(&val);
                    return Value::Number(s.len() as f64);
                }
                Value::Number(0.0)
            }
            
            "char_at" => {
                if let Some(params) = obj.get("params").and_then(|v| v.as_array()) {
                    let val = params.get(1).map(|v| self.evaluate_value(v, variables)).unwrap_or(Value::Null);
                    let s = Self::value_as_string(&val);
                    let idx = params.get(3).map(|v| self.evaluate_value(v, variables).as_number()).unwrap_or(1.0) as usize;
                    if idx > 0 && idx <= s.len() {
                        return Value::String(s.chars().nth(idx - 1).map(|c| c.to_string()).unwrap_or_default());
                    }
                }
                Value::String(String::new())
            }
            
            "combine_something" => {
                if let Some(params) = obj.get("params").and_then(|v| v.as_array()) {
                    let val1 = params.get(1).map(|v| self.evaluate_value(v, variables)).unwrap_or(Value::Null);
                    let val2 = params.get(3).map(|v| self.evaluate_value(v, variables)).unwrap_or(Value::Null);
                    let s1 = Self::value_as_string(&val1);
                    let s2 = Self::value_as_string(&val2);
                    return Value::String(format!("{}{}", s1, s2));
                }
                Value::String(String::new())
            }
            
            "substring" => {
                if let Some(params) = obj.get("params").and_then(|v| v.as_array()) {
                    let val = params.get(1).map(|v| self.evaluate_value(v, variables)).unwrap_or(Value::Null);
                    let s = Self::value_as_string(&val);
                    let start = params.get(3).map(|v| self.evaluate_value(v, variables).as_number()).unwrap_or(1.0) as usize;
                    let end = params.get(5).map(|v| self.evaluate_value(v, variables).as_number()).unwrap_or(1.0) as usize;
                    
                    if start > 0 && end > 0 && start <= s.len() && end <= s.len() {
                        let min_idx = start.min(end) - 1;
                        let max_idx = start.max(end);
                        let chars: Vec<char> = s.chars().collect();
                        if max_idx <= chars.len() {
                            return Value::String(chars[min_idx..max_idx].iter().collect());
                        }
                    }
                }
                Value::String(String::new())
            }
            
            "index_of_string" => {
                if let Some(params) = obj.get("params").and_then(|v| v.as_array()) {
                    let val = params.get(1).map(|v| self.evaluate_value(v, variables)).unwrap_or(Value::Null);
                    let s = Self::value_as_string(&val);
                    let target_val = params.get(3).map(|v| self.evaluate_value(v, variables)).unwrap_or(Value::Null);
                    let target = Self::value_as_string(&target_val);
                    
                    if let Some(idx) = s.find(&target) {
                        return Value::Number((idx + 1) as f64);
                    }
                    return Value::Number(0.0);
                }
                Value::Number(0.0)
            }
            
            "replace_string" => {
                if let Some(params) = obj.get("params").and_then(|v| v.as_array()) {
                    let val = params.get(1).map(|v| self.evaluate_value(v, variables)).unwrap_or(Value::Null);
                    let s = Self::value_as_string(&val);
                    let old_val = params.get(3).map(|v| self.evaluate_value(v, variables)).unwrap_or(Value::Null);
                    let old_word = Self::value_as_string(&old_val);
                    let new_val = params.get(5).map(|v| self.evaluate_value(v, variables)).unwrap_or(Value::Null);
                    let new_word = Self::value_as_string(&new_val);
                    
                    return Value::String(s.replace(&old_word, &new_word));
                }
                Value::String(String::new())
            }
            
            "change_string_case" => {
                if let Some(params) = obj.get("params").and_then(|v| v.as_array()) {
                    let val = params.get(1).map(|v| self.evaluate_value(v, variables)).unwrap_or(Value::Null);
                    let s = Self::value_as_string(&val);
                    let case_type = params.get(3).and_then(|v| v.as_str()).unwrap_or("toUpperCase");
                    
                    return Value::String(match case_type {
                        "toUpperCase" => s.to_uppercase(),
                        "toLowerCase" => s.to_lowercase(),
                        _ => s,
                    });
                }
                Value::String(String::new())
            }
            
            "quotient_and_mod" => {
                if let Some(params) = obj.get("params").and_then(|v| v.as_array()) {
                    let left = params.get(1).map(|v| self.evaluate_value(v, variables).as_number()).unwrap_or(0.0);
                    let right = params.get(3).map(|v| self.evaluate_value(v, variables).as_number()).unwrap_or(1.0);
                    let op = params.get(5).and_then(|v| v.as_str()).unwrap_or("QUOTIENT");
                    
                    if right != 0.0 {
                        return Value::Number(match op {
                            "QUOTIENT" => (left / right).floor(),
                            "MOD" => left - right * (left / right).floor(),
                            _ => 0.0,
                        });
                    }
                }
                Value::Number(0.0)
            }
            
            "get_date" => {
                // Note: This requires JS Date - return placeholder
                // In real implementation, this would use js_sys::Date
                if let Some(params) = obj.get("params").and_then(|v| v.as_array()) {
                    let date_type = params.get(1).and_then(|v| v.as_str()).unwrap_or("YEAR");
                    let date = js_sys::Date::new_0();
                    
                    return Value::Number(match date_type {
                        "YEAR" => date.get_full_year() as f64,
                        "MONTH" => (date.get_month() + 1) as f64,
                        "DAY" => date.get_date() as f64,
                        "HOUR" => date.get_hours() as f64,
                        "MINUTE" => date.get_minutes() as f64,
                        "SECOND" => date.get_seconds() as f64,
                        "DAY_OF_WEEK" => date.get_day() as f64,
                        _ => 0.0,
                    });
                }
                Value::Number(0.0)
            }
            
            "distance_something" => {
                // Calculate distance to mouse or another object
                if let Some(params) = obj.get("params").and_then(|v| v.as_array()) {
                    let target = params.get(1).and_then(|v| v.as_str()).unwrap_or("mouse");
                    
                    let (target_x, target_y) = if target == "mouse" {
                        (self.cached_mouse_x, self.cached_mouse_y)
                    } else {
                        // For other objects, would need entity lookup
                        (self.cached_entity_x, self.cached_entity_y)
                    };
                    
                    let dx = self.cached_entity_x - target_x;
                    let dy = self.cached_entity_y - target_y;
                    return Value::Number((dx * dx + dy * dy).sqrt());
                }
                Value::Number(0.0)
            }
            
            "get_project_timer_value" => {
                // Timer value - requires JS Entry.engine access
                // Return 0 as placeholder
                Value::Number(0.0)
            }
            
            "get_sound_volume" => {
                // Sound volume - requires JS Entry.Utils.getVolume() access
                // Return 100.0 as default (100%)
                Value::Number(100.0)
            }
            
            "get_sound_speed" => {
                // Sound speed/playback rate - requires JS Entry.playbackRateValue access
                // Return 1.0 as default (normal speed)
                Value::Number(1.0)
            }
            
            "get_sound_duration" => {
                // Sound duration - requires JS sound object access
                // Return 0.0 as placeholder since we can't access sound metadata from WASM
                Value::Number(0.0)
            }
            
            "get_canvas_input_value" => {
                // Answer input value - requires JS Entry.container access
                Value::String(String::new())
            }
            
            // List value blocks
            "value_of_index_from_list" | "value_of_list_index" => {
                if let Some(params) = obj.get("params").and_then(|v| v.as_array()) {
                    let list_id = params.get(1).and_then(|v| v.as_str()).unwrap_or("");
                    let index = params.get(3).map(|v| self.evaluate_value(v, variables).as_number()).unwrap_or(1.0) as usize;
                    
                    if let Some(list_var) = variables.get(list_id) {
                        if let Value::List(list) = list_var {
                            if index > 0 && index <= list.len() {
                                return list[index - 1].clone();
                            }
                        }
                    }
                }
                Value::Null
            }
            
            "length_of_list" => {
                if let Some(params) = obj.get("params").and_then(|v| v.as_array()) {
                    let list_id = params.get(1).and_then(|v| v.as_str()).unwrap_or("");
                    
                    if let Some(list_var) = variables.get(list_id) {
                        if let Value::List(list) = list_var {
                            return Value::Number(list.len() as f64);
                        }
                    }
                }
                Value::Number(0.0)
            }
            
            "is_included_in_list" => {
                if let Some(params) = obj.get("params").and_then(|v| v.as_array()) {
                    let list_id = params.get(1).and_then(|v| v.as_str()).unwrap_or("");
                    let data = params.get(3).map(|v| self.evaluate_value(v, variables)).unwrap_or(Value::Null);
                    let data_str = Self::value_as_string(&data);
                    
                    if let Some(list_var) = variables.get(list_id) {
                        if let Value::List(list) = list_var {
                            for item in list {
                                if Self::value_as_string(item) == data_str {
                                    return Value::Bool(true);
                                }
                            }
                        }
                    }
                }
                Value::Bool(false)
            }
            
            "index_of_list" => {
                if let Some(params) = obj.get("params").and_then(|v| v.as_array()) {
                    let list_id = params.get(1).and_then(|v| v.as_str()).unwrap_or("");
                    let data = params.get(3).map(|v| self.evaluate_value(v, variables)).unwrap_or(Value::Null);
                    let data_str = Self::value_as_string(&data);
                    
                    if let Some(list_var) = variables.get(list_id) {
                        if let Value::List(list) = list_var {
                            for (idx, item) in list.iter().enumerate() {
                                if Self::value_as_string(item) == data_str {
                                    return Value::Number((idx + 1) as f64);
                                }
                            }
                        }
                    }
                }
                Value::Number(0.0)
            }
            
            // String blocks
            "reverse_of_string" => {
                if let Some(params) = obj.get("params").and_then(|v| v.as_array()) {
                    let val = params.get(1).map(|v| self.evaluate_value(v, variables)).unwrap_or(Value::Null);
                    let s = Self::value_as_string(&val);
                    return Value::String(s.chars().rev().collect());
                }
                Value::String(String::new())
            }
            
            "count_match_string" => {
                if let Some(params) = obj.get("params").and_then(|v| v.as_array()) {
                    let val = params.get(0).map(|v| self.evaluate_value(v, variables)).unwrap_or(Value::Null);
                    let s = Self::value_as_string(&val);
                    let target_val = params.get(2).map(|v| self.evaluate_value(v, variables)).unwrap_or(Value::Null);
                    let target = Self::value_as_string(&target_val);
                    
                    if target.is_empty() {
                        return Value::Number(0.0);
                    }
                    let count = s.matches(&target).count();
                    return Value::Number(count as f64);
                }
                Value::Number(0.0)
            }
            
            // User info blocks
            "get_user_name" => {
                // This would require JS access - return empty string
                Value::String(String::new())
            }
            
            "get_nickname" => {
                // This would require JS access - return empty string
                Value::String(String::new())
            }
            
            "get_block_count" => {
                // This would require JS access - return 0
                Value::Number(0.0)
            }
            
            // Color conversion blocks
            "change_rgb_to_hex" => {
                if let Some(params) = obj.get("params").and_then(|v| v.as_array()) {
                    let r = params.get(0).map(|v| self.evaluate_value(v, variables).as_number()).unwrap_or(0.0) as u8;
                    let g = params.get(1).map(|v| self.evaluate_value(v, variables).as_number()).unwrap_or(0.0) as u8;
                    let b = params.get(2).map(|v| self.evaluate_value(v, variables).as_number()).unwrap_or(0.0) as u8;
                    return Value::String(format!("#{:02x}{:02x}{:02x}", r, g, b));
                }
                Value::String("#000000".to_string())
            }
            
            "change_hex_to_rgb" => {
                if let Some(params) = obj.get("params").and_then(|v| v.as_array()) {
                    let hex_val = params.get(0).map(|v| self.evaluate_value(v, variables)).unwrap_or(Value::Null);
                    let hex = Self::value_as_string(&hex_val);
                    let color_type = params.get(1).and_then(|v| v.as_str()).unwrap_or("r");
                    
                    // Parse hex color
                    let hex = hex.trim_start_matches('#');
                    if hex.len() >= 6 {
                        let r = u8::from_str_radix(&hex[0..2], 16).unwrap_or(0) as f64;
                        let g = u8::from_str_radix(&hex[2..4], 16).unwrap_or(0) as f64;
                        let b = u8::from_str_radix(&hex[4..6], 16).unwrap_or(0) as f64;
                        
                        return Value::Number(match color_type {
                            "r" => r,
                            "g" => g,
                            "b" => b,
                            _ => r,
                        });
                    }
                }
                Value::Number(0.0)
            }
            
            "get_boolean_value" => {
                if let Some(params) = obj.get("params").and_then(|v| v.as_array()) {
                    let val = params.get(0).map(|v| self.evaluate_value(v, variables).as_bool()).unwrap_or(false);
                    return Value::String(if val { "TRUE".to_string() } else { "FALSE".to_string() });
                }
                Value::String("FALSE".to_string())
            }
            
            // Judgement blocks
            "is_type" => {
                if let Some(params) = obj.get("params").and_then(|v| v.as_array()) {
                    let val = params.get(0).map(|v| self.evaluate_value(v, variables)).unwrap_or(Value::Null);
                    let val_str = Self::value_as_string(&val);
                    let type_check = params.get(2).and_then(|v| v.as_str()).unwrap_or("number");
                    
                    let result = match type_check {
                        "number" => val_str.parse::<f64>().is_ok(),
                        "en" => val_str.chars().all(|c| c.is_ascii_alphabetic()),
                        "ko" => val_str.chars().all(|c| {
                            let code = c as u32;
                            (0x1100..=0x11FF).contains(&code) || // Hangul Jamo
                            (0x3130..=0x318F).contains(&code) || // Hangul Compatibility Jamo
                            (0xAC00..=0xD7AF).contains(&code)    // Hangul Syllables
                        }),
                        _ => false,
                    };
                    return Value::Bool(result);
                }
                Value::Bool(false)
            }
            
            "is_boost_mode" => {
                // WebGL mode - return false as we can't detect this
                Value::Bool(false)
            }
            
            "is_current_device_type" => {
                // Device type detection - return false (would need JS)
                Value::Bool(false)
            }
            
            "is_touch_supported" => {
                // Touch support detection - return false (would need JS)
                Value::Bool(false)
            }
            
            // Collision detection - reach_something
            "reach_something" => {
                if let Some(params) = obj.get("params").and_then(|v| v.as_array()) {
                    // params[1] contains the target (wall, wall_up, wall_down, wall_left, wall_right, mouse, or sprite ID)
                    let target = params.get(1).and_then(|v| v.as_str()).unwrap_or("");
                    
                    // Screen boundaries: ±240 (x), ±180 (y)
                    // Consider entity size (using cached values)
                    let half_width = 25.0;  // Default entity half-width
                    let half_height = 25.0; // Default entity half-height
                    
                    let x = self.cached_entity_x;
                    let y = self.cached_entity_y;
                    
                    let touches_left = x - half_width <= -240.0;
                    let touches_right = x + half_width >= 240.0;
                    let touches_up = y + half_height >= 180.0;
                    let touches_down = y - half_height <= -180.0;
                    
                    let result = match target {
                        "wall" => touches_left || touches_right || touches_up || touches_down,
                        "wall_up" => touches_up,
                        "wall_down" => touches_down,
                        "wall_left" => touches_left,
                        "wall_right" => touches_right,
                        "mouse" => {
                            // Check if mouse is within entity bounds (simple AABB)
                            let mx = self.cached_mouse_x;
                            let my = self.cached_mouse_y;
                            mx >= x - half_width && mx <= x + half_width &&
                            my >= y - half_height && my <= y + half_height
                        }
                        _ => {
                            // Assume it's a sprite/object ID - collision would need entities list
                            // For now, return false (would need to pass entities to evaluate_block)
                            false
                        }
                    };
                    
                    web_sys::console::log_1(&format!(
                        "[WASM] reach_something({}): x={:.1}, y={:.1}, result={}",
                        target, x, y, result
                    ).into());
                    
                    return Value::Bool(result);
                }
                Value::Bool(false)
            }
            
            // Input detection blocks
            "is_clicked" => {
                Value::Bool(self.mouse_clicked)
            }
            
            "is_object_clicked" => {
                // Check if mouse is clicked AND mouse is within entity bounds
                if self.mouse_clicked {
                    let half_width = 25.0;  // Default entity half-width
                    let half_height = 25.0; // Default entity half-height
                    let x = self.cached_entity_x;
                    let y = self.cached_entity_y;
                    let mx = self.cached_mouse_x;
                    let my = self.cached_mouse_y;
                    
                    let clicked = mx >= x - half_width && mx <= x + half_width &&
                                  my >= y - half_height && my <= y + half_height;
                    
                    if clicked {
                        web_sys::console::log_1(&format!(
                            "[WASM] is_object_clicked: true (mouse at {:.1},{:.1}, entity at {:.1},{:.1})",
                            mx, my, x, y
                        ).into());
                    }
                    
                    Value::Bool(clicked)
                } else {
                    Value::Bool(false)
                }
            }
            
            "is_press_some_key" => {
                if let Some(params) = obj.get("params").and_then(|v| v.as_array()) {
                    // Get key code from params
                    let keycode = params.get(0)
                        .and_then(|v| v.as_str())
                        .and_then(|s| s.parse::<u32>().ok())
                        .or_else(|| params.get(0).and_then(|v| v.as_f64()).map(|n| n as u32))
                        .unwrap_or(0);
                    
                    let pressed = self.pressed_keys.contains(&keycode);
                    return Value::Bool(pressed);
                }
                Value::Bool(false)
            }
            
            _ => Value::Null
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_executor_creation() {
        let executor = Executor::new(0, vec![]);
        assert_eq!(executor.entity_idx, 0);
        assert_eq!(executor.block_index, 0);
        assert_eq!(executor.cached_entity_x, 0.0);
        assert_eq!(executor.cached_entity_direction, 90.0);
        assert_eq!(executor.timed_animation_frames, 0);
        assert_eq!(executor.timed_dx, 0.0);
        assert_eq!(executor.timed_dy, 0.0);
    }
}
