//! Executor module - handles block execution with call stack
//! 
//! This module uses a fully iterative execution model:
//! - All execution state is stored on the heap (not the Rust call stack)
//! - The call_stack Vec is the only stack used for function calls/loops
//! - evaluate_value uses an iterative algorithm with heap-based eval stack
//! - This allows unlimited recursion depth without WASM stack overflow

use std::collections::HashMap;
use std::rc::Rc;
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

const MAX_CALL_STACK_DEPTH: usize = 1_000_000;
const MAX_EVAL_ITERATIONS: usize = 100_000;

/// Executor manages the execution of a thread of blocks
#[derive(Clone, Debug)]
pub struct Executor {
    pub entity_idx: usize,
    blocks: Rc<Vec<Block>>,
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
    cached_entity_scale_x: f64,
    cached_entity_scale_y: f64,
    cached_entity_width: f64,
    cached_entity_height: f64,
    cached_entity_reg_x: f64,
    cached_entity_reg_y: f64,
    
    // Input state (set from JavaScript)
    pub cached_mouse_x: f64,
    pub cached_mouse_y: f64,
    pub mouse_clicked: bool,
    pub pressed_keys: Vec<u32>,
    
    timed_animation_frames: u32,
    timed_dx: f64,
    timed_dy: f64,
    timed_d_rotation: f64,
    timed_d_direction: f64,
    timed_target_x: f64,
    timed_target_y: f64,
    func_params: HashMap<String, Value>,
}

#[derive(Clone, Debug)]
struct StackFrame {
    blocks: Rc<Vec<Block>>,
    block_index: usize,
    iteration_count: u32,
    is_loop: bool,
    func_params: Option<HashMap<String, Value>>,
}

impl Executor {
    pub fn new(entity_idx: usize, blocks: Vec<Block>) -> Self {
        Executor {
            entity_idx,
            blocks: Rc::new(blocks),
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
            cached_entity_scale_x: 1.0,
            cached_entity_scale_y: 1.0,
            cached_entity_width: 0.0,
            cached_entity_height: 0.0,
            cached_entity_reg_x: 0.0,
            cached_entity_reg_y: 0.0,
            
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
            func_params: HashMap::new(),
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
            self.cached_entity_scale_x = e.scale_x;
            self.cached_entity_scale_y = e.scale_y;
            self.cached_entity_width = e.width;
            self.cached_entity_height = e.height;
            self.cached_entity_reg_x = e.reg_x;
            self.cached_entity_reg_y = e.reg_y;
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
    
    pub fn get_current_block_type(&self) -> String {
        self.blocks.get(self.block_index)
            .map(|b| b.block_type.clone())
            .unwrap_or_default()
    }
    
    pub fn call_stack_len(&self) -> usize {
        self.call_stack.len()
    }
    
    pub fn current_block_index(&self) -> usize {
        self.block_index
    }

    pub fn execute(
        &mut self, 
        entities: &mut Vec<Entity>, 
        variables: &mut HashMap<String, Value>,
        js_actions: &mut Vec<JsAction>,
        functions: &HashMap<String, FunctionData>,
    ) -> ExecuteResult {
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
                if let Some(frame) = self.call_stack.pop() {
                    self.blocks = Rc::clone(&frame.blocks);
                    self.block_index = frame.block_index;
                    
                    if let Some(prev_params) = frame.func_params {
                        self.func_params = prev_params;
                    }
                    
                    if frame.is_loop && frame.iteration_count > 0 {
                        if frame.iteration_count == u32::MAX {
                            self.iteration_count = 0;
                        } else {
                            self.iteration_count = frame.iteration_count;
                        }
                        return ExecuteResult::Wait;
                    }
                    
                    self.iteration_count = 0;
                    self.block_index += 1;
                    return ExecuteResult::Continue;
                }
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
                        self.blocks = Rc::clone(&frame.blocks);
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
        
        if block_type.starts_with("func_") {
            return self.execute_function_call(block, functions, variables);
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
                    e.move_direction(value);
                    self.accumulate_brush_and_fill_path(e);
                }
                ExecuteResult::Continue
            }
            
            "move_x" => {
                if let Some(e) = entity {
                    let value = self.get_param_number(block, 0, variables);
                    e.move_x(value);
                    self.accumulate_brush_and_fill_path(e);
                }
                ExecuteResult::Continue
            }
            
            "move_y" => {
                if let Some(e) = entity {
                    let value = self.get_param_number(block, 0, variables);
                    e.move_y(value);
                    self.accumulate_brush_and_fill_path(e);
                }
                ExecuteResult::Continue
            }
            
            "locate_x" => {
                if let Some(e) = entity {
                    let value = self.get_param_number(block, 0, variables);
                    e.set_x(value);
                    self.accumulate_brush_and_fill_path(e);
                }
                ExecuteResult::Continue
            }
            
            "locate_y" => {
                if let Some(e) = entity {
                    let value = self.get_param_number(block, 0, variables);
                    e.set_y(value);
                    self.accumulate_brush_and_fill_path(e);
                }
                ExecuteResult::Continue
            }
            
            "locate_xy" => {
                if let Some(e) = entity {
                    let x = self.get_param_number(block, 0, variables);
                    let y = self.get_param_number(block, 1, variables);
                    e.set_xy(x, y);
                    self.accumulate_brush_and_fill_path(e);
                }
                ExecuteResult::Continue
            }
            
            "rotate_relative" => {
                if let Some(e) = entity {
                    let value = self.get_param_number(block, 0, variables);
                    e.rotate(value);
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
                    e.dialog_message = Some(message_str);
                    e.dialog_mode = Some(mode);
                    
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
                
                if count > 0 {
                    if let Some(statements) = &block.statements {
                        if let Some(inner_blocks) = statements.first() {
                            if !inner_blocks.is_empty() {
                                let frame = StackFrame {
                                    blocks: Rc::clone(&self.blocks),
                                    block_index: self.block_index,
                                    iteration_count: count - 1,
                                    is_loop: true,
                                    func_params: None,
                                };
                                self.call_stack.push(frame);
                                
                                // Enter loop body
                                self.blocks = Rc::new(inner_blocks.clone());
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
                                blocks: Rc::clone(&self.blocks),
                                block_index: self.block_index,
                                iteration_count: u32::MAX,
                                is_loop: true,
                                func_params: None,
                            };
                            self.call_stack.push(frame);
                            
                            self.blocks = Rc::new(inner_blocks.clone());
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
                                    blocks: Rc::clone(&self.blocks),
                                    block_index: self.block_index,
                                    iteration_count: 0,
                                    is_loop: false,
                                    func_params: None,
                                };
                                self.call_stack.push(frame);
                                
                                self.blocks = Rc::new(inner_blocks.clone());
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
                                blocks: Rc::clone(&self.blocks),
                                block_index: self.block_index,
                                iteration_count: 0,
                                is_loop: false,
                                func_params: None,
                            };
                            self.call_stack.push(frame);
                            
                            self.blocks = Rc::new(inner_blocks.clone());
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
                        self.blocks = Rc::clone(&frame.blocks);
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
                
                if should_loop {
                    if let Some(statements) = &block.statements {
                        if let Some(inner_blocks) = statements.first() {
                            if !inner_blocks.is_empty() {
                                let frame = StackFrame {
                                    blocks: Rc::clone(&self.blocks),
                                    block_index: self.block_index,
                                    iteration_count: u32::MAX,
                                    is_loop: true,
                                    func_params: None,
                                };
                                self.call_stack.push(frame);
                                
                                self.blocks = Rc::new(inner_blocks.clone());
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
                let index_f64 = self.get_param_number(block, 0, variables);
                
                if index_f64.is_finite() && index_f64 >= 1.0 {
                    let index = index_f64 as usize;
                    if let Some(list_var) = variables.get_mut(&list_id) {
                        if let Value::List(list) = list_var {
                            // Safe bounds check: index is 1-based, so index-1 must be < list.len()
                            if index >= 1 && index <= list.len() {
                                // Double-check with get() before remove to prevent panic
                                if list.get(index - 1).is_some() {
                                    list.remove(index - 1);
                                }
                            }
                        }
                    }
                }
                ExecuteResult::Continue
            }
            
            "insert_value_to_list" => {
                let list_id = self.get_param_string(block, 1);
                let value = self.get_param_value(block, 0, variables);
                let index_f64 = self.get_param_number(block, 2, variables);
                
                if index_f64.is_finite() && index_f64 >= 1.0 {
                    let index = index_f64 as usize;
                    if let Some(list_var) = variables.get_mut(&list_id) {
                        if let Value::List(list) = list_var {
                            let insert_pos = index - 1;
                            if insert_pos <= list.len() {
                                list.insert(insert_pos, value);
                            }
                        }
                    }
                }
                ExecuteResult::Continue
            }
            
            "change_value_list_index" => {
                let list_id = self.get_param_string(block, 0);
                let index_f64 = self.get_param_number(block, 1, variables);
                let value = self.get_param_value(block, 2, variables);
                
                // Safe conversion: check for valid positive integer before casting
                if index_f64.is_finite() && index_f64 >= 1.0 {
                    let index = index_f64 as usize;
                    if let Some(list_var) = variables.get_mut(&list_id) {
                        if let Value::List(list) = list_var {
                            // Use safe get_mut() instead of direct indexing to prevent panic
                            if let Some(item) = list.get_mut(index - 1) {
                                *item = value;
                            }
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
                js_actions.push(JsAction::BrushEraseAll { entity_id: self.entity_idx });
                ExecuteResult::Continue
            }
            
            "start_drawing" => {
                if let Some(e) = entity {
                    e.brush_down = true;
                    e.frame_brush_path.push((e.x, e.y));
                    js_actions.push(JsAction::StartDrawing {
                        entity_id: self.entity_idx,
                        x: e.x,
                        y: e.y,
                    });
                }
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
                if let Some(e) = entity {
                    e.fill_down = true;
                    e.frame_fill_path.push((e.x, e.y));
                    js_actions.push(JsAction::StartFill {
                        entity_id: self.entity_idx,
                        x: e.x,
                        y: e.y,
                    });
                }
                ExecuteResult::Continue
            }
            
            "stop_fill" => {
                if let Some(e) = entity {
                    e.fill_down = false;
                }
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
            _ => ExecuteResult::Continue,
        }
    }

    fn execute_function_call(
        &mut self,
        block: &Block,
        functions: &HashMap<String, FunctionData>,
        variables: &HashMap<String, Value>,
    ) -> ExecuteResult {
        let func_id = if block.block_type.len() > 5 {
            &block.block_type[5..]
        } else {
            return ExecuteResult::Continue;
        };
        
        if self.call_stack.len() >= MAX_CALL_STACK_DEPTH {
            return ExecuteResult::End;
        }
        
        if let Some(func_data) = functions.get(func_id) {
            if let Some(content) = &func_data.content {
                if let Some(first_thread) = content.first() {
                    if let Some(func_create_block) = first_thread.first() {
                        let mut func_body: Option<Vec<Block>> = None;
                        
                        if let Some(statements) = &func_create_block.statements {
                            if let Some(body) = statements.first() {
                                if !body.is_empty() {
                                    func_body = Some(body.clone());
                                }
                            }
                        }
                        
                        if func_body.is_none() && first_thread.len() > 1 {
                            let body: Vec<Block> = first_thread.iter().skip(1).cloned().collect();
                            if !body.is_empty() {
                                func_body = Some(body);
                            }
                        }
                        
                        if let Some(body) = func_body {
                            let param_types = self.extract_func_param_types(func_create_block);
                            let mut new_params = HashMap::new();
                            
                            if let Some(call_params) = &block.params {
                                for (i, param_type) in param_types.iter().enumerate() {
                                    if let Some(param_value) = call_params.get(i) {
                                        let value = self.evaluate_value(param_value, variables);
                                        new_params.insert(param_type.clone(), value);
                                    }
                                }
                            }
                            
                            let frame = StackFrame {
                                blocks: Rc::clone(&self.blocks),
                                block_index: self.block_index,
                                iteration_count: 0,
                                is_loop: false,
                                func_params: Some(std::mem::replace(&mut self.func_params, new_params)),
                            };
                            self.call_stack.push(frame);
                            
                            self.blocks = Rc::new(body);
                            self.block_index = 0;
                            self.iteration_count = 0;
                            
                            return ExecuteResult::JumpedToBlock;
                        }
                    }
                }
            }
        }
        
        ExecuteResult::Continue
    }
    
    fn extract_func_param_types(&self, func_create_block: &Block) -> Vec<String> {
        let mut param_types = Vec::new();
        
        if let Some(params) = &func_create_block.params {
            if let Some(first_param) = params.first() {
                self.collect_param_types_from_chain(first_param, &mut param_types);
            }
        }
        
        param_types
    }
    
    fn collect_param_types_from_chain(&self, json: &serde_json::Value, param_types: &mut Vec<String>) {
        if let Some(obj) = json.as_object() {
            if let Some(block_type) = obj.get("type").and_then(|v| v.as_str()) {
                if block_type.starts_with("stringParam_") || block_type.starts_with("booleanParam_") {
                    param_types.push(block_type.to_string());
                }
            }
            
            if let Some(params) = obj.get("params").and_then(|v| v.as_array()) {
                for param in params {
                    self.collect_param_types_from_chain(param, param_types);
                }
            }
        }
    }

    fn accumulate_brush_and_fill_path(&self, entity: &mut Entity) {
        if entity.brush_down {
            entity.frame_brush_path.push((entity.x, entity.y));
        }
        if entity.fill_down {
            entity.frame_fill_path.push((entity.x, entity.y));
        }
    }

    fn get_param_number(&self, block: &Block, index: usize, variables: &HashMap<String, Value>) -> f64 {
        if let Some(params) = &block.params {
            if let Some(param) = params.get(index) {
                return self.evaluate_value(param, variables).as_number();
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
            serde_json::Value::Null => Value::Null,
            serde_json::Value::Array(arr) => {
                let list: Vec<Value> = arr.iter().map(|v| self.evaluate_leaf_value(v, variables)).collect();
                Value::List(list)
            }
            serde_json::Value::Object(obj) => {
                if let Some(block_type) = obj.get("type").and_then(|v| v.as_str()) {
                    if block_type.starts_with("stringParam_") || block_type.starts_with("booleanParam_") {
                        return self.func_params.get(block_type).cloned().unwrap_or(Value::Number(0.0));
                    }
                    return self.evaluate_block_iterative(block_type, obj, variables);
                }
                Value::Null
            }
        }
    }
    
    fn evaluate_leaf_value(&self, json: &serde_json::Value, variables: &HashMap<String, Value>) -> Value {
        match json {
            serde_json::Value::Number(n) => Value::Number(n.as_f64().unwrap_or(0.0)),
            serde_json::Value::String(s) => Value::String(s.clone()),
            serde_json::Value::Bool(b) => Value::Bool(*b),
            serde_json::Value::Null => Value::Null,
            serde_json::Value::Array(arr) => {
                let list: Vec<Value> = arr.iter().map(|v| {
                    match v {
                        serde_json::Value::Number(n) => Value::Number(n.as_f64().unwrap_or(0.0)),
                        serde_json::Value::String(s) => Value::String(s.clone()),
                        serde_json::Value::Bool(b) => Value::Bool(*b),
                        _ => Value::Null,
                    }
                }).collect();
                Value::List(list)
            }
            serde_json::Value::Object(obj) => {
                if let Some(block_type) = obj.get("type").and_then(|v| v.as_str()) {
                    if block_type == "get_variable" {
                        if let Some(params) = obj.get("params").and_then(|v| v.as_array()) {
                            if let Some(var_id) = params.first().and_then(|v| v.as_str()) {
                                return variables.get(var_id).cloned().unwrap_or(Value::Number(0.0));
                            }
                        }
                    }
                }
                Value::Null
            }
        }
    }
    
    fn evaluate_block_iterative(&self, _block_type: &str, obj: &serde_json::Map<String, serde_json::Value>, variables: &HashMap<String, Value>) -> Value {
        #[derive(Clone)]
        enum EvalTask {
            Evaluate(serde_json::Value),
            ApplyOp { op: String, arg_count: usize },
        }
        
        let mut task_stack: Vec<EvalTask> = Vec::with_capacity(64);
        let mut value_stack: Vec<Value> = Vec::with_capacity(64);
        
        task_stack.push(EvalTask::Evaluate(serde_json::Value::Object(obj.clone())));
        
        let mut iterations = 0usize;
        
        while let Some(task) = task_stack.pop() {
            iterations += 1;
            if iterations > MAX_EVAL_ITERATIONS {
                return Value::Null;
            }
            
            match task {
                EvalTask::Evaluate(json) => {
                    match json {
                        serde_json::Value::Number(n) => {
                            value_stack.push(Value::Number(n.as_f64().unwrap_or(0.0)));
                        }
                        serde_json::Value::String(s) => {
                            value_stack.push(Value::String(s));
                        }
                        serde_json::Value::Bool(b) => {
                            value_stack.push(Value::Bool(b));
                        }
                        serde_json::Value::Null => {
                            value_stack.push(Value::Null);
                        }
                        serde_json::Value::Array(arr) => {
                            let list: Vec<Value> = arr.iter().map(|v| {
                                match v {
                                    serde_json::Value::Number(n) => Value::Number(n.as_f64().unwrap_or(0.0)),
                                    serde_json::Value::String(s) => Value::String(s.clone()),
                                    serde_json::Value::Bool(b) => Value::Bool(*b),
                                    _ => Value::Null,
                                }
                            }).collect();
                            value_stack.push(Value::List(list));
                        }
                        serde_json::Value::Object(obj_map) => {
                            if let Some(bt) = obj_map.get("type").and_then(|v| v.as_str()) {
                                let params = obj_map.get("params").and_then(|v| v.as_array());
                                
                                match bt {
                                    "number" | "angle" => {
                                        if let Some(p) = params.and_then(|p| p.first()) {
                                            let val = p.as_str().and_then(|s| s.parse().ok())
                                                .or_else(|| p.as_f64())
                                                .unwrap_or(0.0);
                                            value_stack.push(Value::Number(val));
                                        } else {
                                            value_stack.push(Value::Number(0.0));
                                        }
                                    }
                                    "text" => {
                                        let val = params.and_then(|p| p.first())
                                            .and_then(|v| v.as_str())
                                            .unwrap_or("");
                                        value_stack.push(Value::String(val.to_string()));
                                    }
                                    "color" | "Color" => {
                                        let val = params.and_then(|p| p.first())
                                            .and_then(|v| v.as_str())
                                            .unwrap_or("");
                                        value_stack.push(Value::String(val.to_string()));
                                    }
                                    "True" => value_stack.push(Value::Bool(true)),
                                    "False" => value_stack.push(Value::Bool(false)),
                                    "get_variable" => {
                                        if let Some(var_id) = params.and_then(|p| p.first()).and_then(|v| v.as_str()) {
                                            let val = variables.get(var_id).cloned().unwrap_or(Value::Number(0.0));
                                            value_stack.push(val);
                                        } else {
                                            value_stack.push(Value::Number(0.0));
                                        }
                                    }
                                    _ if bt.starts_with("stringParam_") || bt.starts_with("booleanParam_") => {
                                        let val = self.func_params.get(bt).cloned().unwrap_or(Value::Number(0.0));
                                        value_stack.push(val);
                                    }
                                    "calc_basic" => {
                                        if let Some(p) = params {
                                            let op = p.get(1).and_then(|v| v.as_str()).unwrap_or("").to_string();
                                            task_stack.push(EvalTask::ApplyOp { op: format!("calc_basic:{}", op), arg_count: 2 });
                                            if let Some(right) = p.get(2) { task_stack.push(EvalTask::Evaluate(right.clone())); }
                                            else { value_stack.push(Value::Number(0.0)); }
                                            if let Some(left) = p.get(0) { task_stack.push(EvalTask::Evaluate(left.clone())); }
                                            else { value_stack.push(Value::Number(0.0)); }
                                        } else {
                                            value_stack.push(Value::Number(0.0));
                                        }
                                    }
                                    "calc_rand" => {
                                        if let Some(p) = params {
                                            task_stack.push(EvalTask::ApplyOp { op: "calc_rand".to_string(), arg_count: 2 });
                                            if let Some(max) = p.get(1) { task_stack.push(EvalTask::Evaluate(max.clone())); }
                                            else { value_stack.push(Value::Number(0.0)); }
                                            if let Some(min) = p.get(0) { task_stack.push(EvalTask::Evaluate(min.clone())); }
                                            else { value_stack.push(Value::Number(0.0)); }
                                        } else {
                                            value_stack.push(Value::Number(0.0));
                                        }
                                    }
                                    "boolean_basic_operator" => {
                                        if let Some(p) = params {
                                            let op = p.get(1).and_then(|v| v.as_str()).unwrap_or("").to_string();
                                            task_stack.push(EvalTask::ApplyOp { op: format!("boolean_basic:{}", op), arg_count: 2 });
                                            if let Some(right) = p.get(2) { task_stack.push(EvalTask::Evaluate(right.clone())); }
                                            else { value_stack.push(Value::Number(0.0)); }
                                            if let Some(left) = p.get(0) { task_stack.push(EvalTask::Evaluate(left.clone())); }
                                            else { value_stack.push(Value::Number(0.0)); }
                                        } else {
                                            value_stack.push(Value::Bool(false));
                                        }
                                    }
                                    "boolean_and_or" => {
                                        if let Some(p) = params {
                                            let op = p.get(1).and_then(|v| v.as_str()).unwrap_or("").to_string();
                                            task_stack.push(EvalTask::ApplyOp { op: format!("boolean_and_or:{}", op), arg_count: 2 });
                                            if let Some(right) = p.get(2) { task_stack.push(EvalTask::Evaluate(right.clone())); }
                                            else { value_stack.push(Value::Bool(false)); }
                                            if let Some(left) = p.get(0) { task_stack.push(EvalTask::Evaluate(left.clone())); }
                                            else { value_stack.push(Value::Bool(false)); }
                                        } else {
                                            value_stack.push(Value::Bool(false));
                                        }
                                    }
                                    "boolean_not" => {
                                        if let Some(p) = params {
                                            task_stack.push(EvalTask::ApplyOp { op: "boolean_not".to_string(), arg_count: 1 });
                                            if let Some(val) = p.get(0) { task_stack.push(EvalTask::Evaluate(val.clone())); }
                                            else { value_stack.push(Value::Bool(false)); }
                                        } else {
                                            value_stack.push(Value::Bool(true));
                                        }
                                    }
                                    "calc_operation" => {
                                        if let Some(p) = params {
                                            let op = p.get(3).and_then(|v| v.as_str()).unwrap_or("").to_string();
                                            task_stack.push(EvalTask::ApplyOp { op: format!("calc_op:{}", op), arg_count: 1 });
                                            if let Some(val) = p.get(1) { task_stack.push(EvalTask::Evaluate(val.clone())); }
                                            else { value_stack.push(Value::Number(0.0)); }
                                        } else {
                                            value_stack.push(Value::Number(0.0));
                                        }
                                    }
                                    "combine_something" => {
                                        if let Some(p) = params {
                                            task_stack.push(EvalTask::ApplyOp { op: "combine".to_string(), arg_count: 2 });
                                            if let Some(v2) = p.get(3) { task_stack.push(EvalTask::Evaluate(v2.clone())); }
                                            else { value_stack.push(Value::String(String::new())); }
                                            if let Some(v1) = p.get(1) { task_stack.push(EvalTask::Evaluate(v1.clone())); }
                                            else { value_stack.push(Value::String(String::new())); }
                                        } else {
                                            value_stack.push(Value::String(String::new()));
                                        }
                                    }
                                    "length_of_string" => {
                                        if let Some(p) = params {
                                            task_stack.push(EvalTask::ApplyOp { op: "strlen".to_string(), arg_count: 1 });
                                            if let Some(val) = p.get(1) { task_stack.push(EvalTask::Evaluate(val.clone())); }
                                            else { value_stack.push(Value::String(String::new())); }
                                        } else {
                                            value_stack.push(Value::Number(0.0));
                                        }
                                    }
                                    "get_x" => value_stack.push(Value::Number(self.cached_entity_x)),
                                    "get_y" => value_stack.push(Value::Number(self.cached_entity_y)),
                                    "get_rotation" => value_stack.push(Value::Number(self.cached_entity_rotation)),
                                    "get_direction" => value_stack.push(Value::Number(self.cached_entity_direction)),
                                    "get_scale" => value_stack.push(Value::Number(self.cached_entity_scale)),
                                    "coordinate_mouse" => {
                                        let coord = params.and_then(|p| p.get(1)).and_then(|v| v.as_str()).unwrap_or("x");
                                        let value = if coord == "y" { self.cached_mouse_y } else { self.cached_mouse_x };
                                        value_stack.push(Value::Number(value));
                                    }
                                    "mouse_x" => value_stack.push(Value::Number(self.cached_mouse_x)),
                                    "mouse_y" => value_stack.push(Value::Number(self.cached_mouse_y)),
                                    "is_clicked" => value_stack.push(Value::Bool(self.mouse_clicked)),
                                    "is_object_clicked" => {
                                        let clicked = self.mouse_clicked;
                                        let mx = self.cached_mouse_x;
                                        let my = self.cached_mouse_y;
                                        let x = self.cached_entity_x;
                                        let y = self.cached_entity_y;
                                        
                                        let x1 = x - (self.cached_entity_reg_x * self.cached_entity_scale_x);
                                        let x2 = x + ((self.cached_entity_width - self.cached_entity_reg_x) * self.cached_entity_scale_x);
                                        let min_x = x1.min(x2);
                                        let max_x = x1.max(x2);
                                        
                                        let y1 = y + (self.cached_entity_reg_y * self.cached_entity_scale_y);
                                        let y2 = y - ((self.cached_entity_height - self.cached_entity_reg_y) * self.cached_entity_scale_y);
                                        let min_y = y1.min(y2);
                                        let max_y = y1.max(y2);
                                        
                                        let touching = mx >= min_x && mx <= max_x && my >= min_y && my <= max_y;
                                        
                                        if clicked {
                                             web_sys::console::log_1(&format!(
                                                "is_object_clicked Check: Mouse({},{}) vs Entity[X:{:.1}~{:.1}, Y:{:.1}~{:.1}] => Touching: {}", 
                                                mx, my, min_x, max_x, min_y, max_y, touching
                                            ).into());
                                        }
                                        
                                        value_stack.push(Value::Bool(clicked && touching));
                                    }
                                    "is_included_in_list" => {
                                        if let Some(p) = params {
                                            let list_id = p.get(1).and_then(|v| v.as_str()).unwrap_or("").to_string();
                                            task_stack.push(EvalTask::ApplyOp { op: format!("is_included:{}", list_id), arg_count: 1 });
                                            if let Some(val) = p.get(0) { task_stack.push(EvalTask::Evaluate(val.clone())); }
                                            else { value_stack.push(Value::Null); }
                                        } else {
                                            value_stack.push(Value::Bool(false));
                                        }
                                    }
                                    "index_of_list" => {
                                        if let Some(p) = params {
                                            let list_id = p.get(1).and_then(|v| v.as_str()).unwrap_or("").to_string();
                                            task_stack.push(EvalTask::ApplyOp { op: format!("index_of_list:{}", list_id), arg_count: 1 });
                                            if let Some(val) = p.get(0) { task_stack.push(EvalTask::Evaluate(val.clone())); }
                                            else { value_stack.push(Value::Null); }
                                        } else {
                                            value_stack.push(Value::Number(0.0));
                                        }
                                    }
                                    _ => {
                                        let result = self.evaluate_block_simple(bt, &obj_map, variables);
                                        value_stack.push(result);
                                    }
                                }
                            } else {
                                value_stack.push(Value::Null);
                            }
                        }
                    }
                }
                EvalTask::ApplyOp { op, arg_count } => {
                    if value_stack.len() < arg_count {
                        value_stack.push(Value::Null);
                        continue;
                    }
                    
                    let result = if let Some(op_type) = op.strip_prefix("calc_basic:") {
                        let right = value_stack.pop().unwrap_or(Value::Number(0.0)).as_number();
                        let left = value_stack.pop().unwrap_or(Value::Number(0.0)).as_number();
                        Value::Number(match op_type {
                            "PLUS" | "+" => left + right,
                            "MINUS" | "-" => left - right,
                            "MULTI" | "*" => left * right,
                            "DIVIDE" | "/" => if right != 0.0 { left / right } else { 0.0 },
                            _ => 0.0,
                        })
                    } else if op == "calc_rand" {
                        let max = value_stack.pop().unwrap_or(Value::Number(0.0)).as_number();
                        let min = value_stack.pop().unwrap_or(Value::Number(0.0)).as_number();
                        let random = js_sys::Math::random();
                        Value::Number(min + random * (max - min))
                    } else if let Some(op_type) = op.strip_prefix("boolean_basic:") {
                        let right = value_stack.pop().unwrap_or(Value::Number(0.0)).as_number();
                        let left = value_stack.pop().unwrap_or(Value::Number(0.0)).as_number();
                        Value::Bool(match op_type {
                            "EQUAL" | "==" => (left - right).abs() < f64::EPSILON,
                            "NOT_EQUAL" | "!=" => (left - right).abs() >= f64::EPSILON,
                            "GREATER" | ">" => left > right,
                            "GREATER_OR_EQUAL" | ">=" => left >= right,
                            "LESS" | "<" => left < right,
                            "LESS_OR_EQUAL" | "<=" => left <= right,
                            _ => false,
                        })
                    } else if let Some(op_type) = op.strip_prefix("boolean_and_or:") {
                        let right = value_stack.pop().unwrap_or(Value::Bool(false)).as_bool();
                        let left = value_stack.pop().unwrap_or(Value::Bool(false)).as_bool();
                        Value::Bool(match op_type {
                            "AND" => left && right,
                            "OR" => left || right,
                            _ => false,
                        })
                    } else if op == "boolean_not" {
                        let val = value_stack.pop().unwrap_or(Value::Bool(false)).as_bool();
                        Value::Bool(!val)
                    } else if let Some(op_type) = op.strip_prefix("calc_op:") {
                        let val = value_stack.pop().unwrap_or(Value::Number(0.0)).as_number();
                        Value::Number(match op_type {
                            "square" => val * val,
                            "root" | "sqrt" => val.sqrt(),
                            "sin" => val.to_radians().sin(),
                            "cos" => val.to_radians().cos(),
                            "tan" => val.to_radians().tan(),
                            "asin" | "asin_radian" => val.asin().to_degrees(),
                            "acos" | "acos_radian" => val.acos().to_degrees(),
                            "atan" | "atan_radian" => val.atan().to_degrees(),
                            "log" => val.log10(),
                            "ln" => val.ln(),
                            "floor" => val.floor(),
                            "ceil" => val.ceil(),
                            "round" => val.round(),
                            "abs" => val.abs(),
                            _ => val,
                        })
                    } else if op == "combine" {
                        let v2 = value_stack.pop().unwrap_or(Value::String(String::new()));
                        let v1 = value_stack.pop().unwrap_or(Value::String(String::new()));
                        Value::String(format!("{}{}", Self::value_as_string(&v1), Self::value_as_string(&v2)))
                    } else if op == "strlen" {
                        let val = value_stack.pop().unwrap_or(Value::String(String::new()));
                        Value::Number(Self::value_as_string(&val).chars().count() as f64)
                    } else if let Some(list_id) = op.strip_prefix("is_included:") {
                        let val = value_stack.pop().unwrap_or(Value::Null);
                        let result = if let Some(Value::List(list)) = variables.get(list_id) {
                            let val_str = Self::value_as_string(&val);
                            list.iter().any(|v| Self::value_as_string(v) == val_str)
                        } else {
                            false
                        };
                        Value::Bool(result)
                    } else if let Some(list_id) = op.strip_prefix("index_of_list:") {
                        let val = value_stack.pop().unwrap_or(Value::Null);
                        let result = if let Some(Value::List(list)) = variables.get(list_id) {
                            let val_str = Self::value_as_string(&val);
                            list.iter().position(|v| Self::value_as_string(v) == val_str)
                                .map(|i| (i + 1) as f64)
                                .unwrap_or(0.0)
                        } else {
                            0.0
                        };
                        Value::Number(result)
                    } else {
                        Value::Null
                    };
                    
                    value_stack.push(result);
                }
            }
        }
        
        value_stack.pop().unwrap_or(Value::Null)
    }
    
    fn evaluate_block_simple(&self, block_type: &str, obj: &serde_json::Map<String, serde_json::Value>, variables: &HashMap<String, Value>) -> Value {
        let params = obj.get("params").and_then(|v| v.as_array());
        
        let get_param_str = |idx: usize| -> String {
            params.and_then(|p| p.get(idx)).and_then(|v| v.as_str()).unwrap_or("").to_string()
        };
        
        let get_param_num = |idx: usize| -> f64 {
            params.and_then(|p| p.get(idx)).and_then(|v| {
                v.as_f64().or_else(|| v.as_str().and_then(|s| s.parse().ok()))
            }).unwrap_or(0.0)
        };
        
        match block_type {
            "coordinate_object" => {
                let coord = params.and_then(|p| p.get(3)).and_then(|v| v.as_str()).unwrap_or("x");
                Value::Number(match coord {
                    "x" => self.cached_entity_x,
                    "y" => self.cached_entity_y,
                    "rotation" => self.cached_entity_rotation,
                    "direction" => self.cached_entity_direction,
                    "size" => self.cached_entity_scale,
                    _ => 0.0,
                })
            }
            "get_date" => {
                let date_type = get_param_str(1);
                let date = js_sys::Date::new_0();
                Value::Number(match date_type.as_str() {
                    "YEAR" => date.get_full_year() as f64,
                    "MONTH" => (date.get_month() + 1) as f64,
                    "DAY" => date.get_date() as f64,
                    "HOUR" => date.get_hours() as f64,
                    "MINUTE" => date.get_minutes() as f64,
                    "SECOND" => date.get_seconds() as f64,
                    "DAY_OF_WEEK" => date.get_day() as f64,
                    _ => 0.0,
                })
            }
            "quotient_and_mod" => {
                let left = get_param_num(1);
                let right = get_param_num(3);
                let op = get_param_str(5);
                if right != 0.0 {
                    Value::Number(match op.as_str() {
                        "QUOTIENT" => (left / right).floor(),
                        "MOD" => left - right * (left / right).floor(),
                        _ => 0.0,
                    })
                } else {
                    Value::Number(0.0)
                }
            }
            "value_of_index_from_list" | "value_of_list_index" => {
                let list_id = get_param_str(1);
                let index = get_param_num(3) as usize;
                if index >= 1 {
                    if let Some(Value::List(list)) = variables.get(&list_id) {
                        return list.get(index - 1).cloned().unwrap_or(Value::Null);
                    }
                }
                Value::Null
            }
            "length_of_list" => {
                let list_id = get_param_str(1);
                if let Some(Value::List(list)) = variables.get(&list_id) {
                    Value::Number(list.len() as f64)
                } else {
                    Value::Number(0.0)
                }
            }
            "reach_something" => {
                let target = get_param_str(1);
                let x = self.cached_entity_x;
                let y = self.cached_entity_y;
                let x1 = x - (self.cached_entity_reg_x * self.cached_entity_scale_x);
                let x2 = x + ((self.cached_entity_width - self.cached_entity_reg_x) * self.cached_entity_scale_x);
                let min_x = x1.min(x2);
                let max_x = x1.max(x2);
                
                let y1 = y + (self.cached_entity_reg_y * self.cached_entity_scale_y);
                let y2 = y - ((self.cached_entity_height - self.cached_entity_reg_y) * self.cached_entity_scale_y);
                let min_y = y1.min(y2);
                let max_y = y1.max(y2);
                
                let result = match target.as_str() {
                    "wall" => min_x <= -240.0 || max_x >= 240.0 || max_y >= 135.0 || min_y <= -135.0,
                    "wall_up" => max_y >= 135.0,
                    "wall_down" => min_y <= -135.0,
                    "wall_left" => min_x <= -240.0,
                    "wall_right" => max_x >= 240.0,
                    "mouse" => {
                        let mx = self.cached_mouse_x;
                        let my = self.cached_mouse_y;
                        mx >= min_x && mx <= max_x && my >= min_y && my <= max_y
                    }
                    _ => false,
                };
                Value::Bool(result)
            }
            "is_press_some_key" => {
                let keycode = params.and_then(|p| p.get(0))
                    .and_then(|v| v.as_str().and_then(|s| s.parse::<u32>().ok()).or_else(|| v.as_f64().map(|n| n as u32)))
                    .unwrap_or(0);
                Value::Bool(self.pressed_keys.contains(&keycode))
            }
            "get_project_timer_value" => Value::Number(0.0),
            "get_sound_volume" => Value::Number(100.0),
            _ => Value::Null,
        }
    }
    
    fn evaluate_json_iterative(&self, json: &serde_json::Value, variables: &HashMap<String, Value>) -> Value {
        match json {
            serde_json::Value::Number(n) => Value::Number(n.as_f64().unwrap_or(0.0)),
            serde_json::Value::String(s) => Value::String(s.clone()),
            serde_json::Value::Bool(b) => Value::Bool(*b),
            serde_json::Value::Null => Value::Null,
            serde_json::Value::Array(arr) => {
                let list: Vec<Value> = arr.iter().map(|v| self.evaluate_leaf_value(v, variables)).collect();
                Value::List(list)
            }
            serde_json::Value::Object(obj) => {
                if let Some(block_type) = obj.get("type").and_then(|v| v.as_str()) {
                    return self.evaluate_block_iterative(block_type, obj, variables);
                }
                Value::Null
            }
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
