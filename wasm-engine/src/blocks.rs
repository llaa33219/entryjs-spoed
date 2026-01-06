//! Block type definitions and utilities

/// Block categories
pub enum BlockCategory {
    Start,
    Flow,
    Moving,
    Looks,
    Sound,
    Judgement,
    Calc,
    Variable,
    Func,
}

/// Get the category for a block type
pub fn get_block_category(block_type: &str) -> Option<BlockCategory> {
    match block_type {
        // Start blocks
        "when_run_button_click" |
        "when_some_key_pressed" |
        "when_object_click" |
        "when_object_click_canceled" |
        "when_message_cast" |
        "when_scene_start" |
        "when_clone_start" => Some(BlockCategory::Start),

        // Flow blocks
        "wait_second" |
        "repeat_basic" |
        "repeat_inf" |
        "repeat_while_true" |
        "stop_repeat" |
        "continue_repeat" |
        "_if" |
        "if_else" |
        "wait_until_true" |
        "stop_object" |
        "restart_project" |
        "create_clone" |
        "delete_clone" |
        "remove_all_clones" => Some(BlockCategory::Flow),

        // Moving blocks
        "move_direction" |
        "move_x" |
        "move_y" |
        "move_xy_time" |
        "locate_x" |
        "locate_y" |
        "locate_xy" |
        "locate_xy_time" |
        "locate" |
        "locate_object_time" |
        "rotate_relative" |
        "direction_relative" |
        "rotate_by_time" |
        "direction_relative_duration" |
        "rotate_absolute" |
        "direction_absolute" |
        "see_angle_object" |
        "move_to_angle" |
        "bounce_wall" => Some(BlockCategory::Moving),

        // Looks blocks
        "show" |
        "hide" |
        "dialog_time" |
        "dialog" |
        "remove_dialog" |
        "change_to_some_shape" |
        "change_to_next_shape" |
        "change_to_previous_shape" |
        "set_effect" |
        "change_effect" |
        "clear_effect" |
        "change_scale_size" |
        "set_scale_size" |
        "flip_x" |
        "flip_y" |
        "change_object_index" => Some(BlockCategory::Looks),

        // Sound blocks
        "sound_something" |
        "sound_something_second" |
        "sound_something_wait" |
        "sound_volume_change" |
        "sound_volume_set" |
        "sound_speed_change" |
        "sound_speed_set" |
        "sound_stop" => Some(BlockCategory::Sound),

        // Judgement blocks
        "is_clicked" |
        "is_object_clicked" |
        "is_press_some_key" |
        "reach_something" |
        "boolean_basic_operator" |
        "boolean_and_or" |
        "boolean_not" => Some(BlockCategory::Judgement),

        // Calc blocks
        "calc_basic" |
        "calc_rand" |
        "coordinate_mouse" |
        "coordinate_object" |
        "get_sound_volume" |
        "get_sound_speed" |
        "length_of_string" |
        "combine_something" |
        "char_at" |
        "substring" |
        "index_of_string" |
        "replace_string" |
        "change_string_case" |
        "calc_operation" |
        "get_date" |
        "get_project_timer_value" |
        "get_x" |
        "get_y" |
        "get_rotation" |
        "get_direction" |
        "get_scale" => Some(BlockCategory::Calc),

        // Variable blocks
        "set_variable" |
        "change_variable" |
        "show_variable" |
        "hide_variable" |
        "get_variable" |
        "value_of_list_index" |
        "add_value_to_list" |
        "remove_value_from_list" |
        "insert_value_to_list" |
        "change_value_list_index" |
        "length_of_list" |
        "show_list" |
        "hide_list" |
        "is_included_in_list" => Some(BlockCategory::Variable),

        // Function blocks
        "function_create" |
        "function_call" |
        "function_field_label" |
        "function_field_string" |
        "function_field_boolean" => Some(BlockCategory::Func),

        _ => None,
    }
}

/// Check if a block is executable (has a func)
pub fn is_executable_block(block_type: &str) -> bool {
    // Event blocks are entry points, not directly executable
    !matches!(block_type, 
        "when_run_button_click" |
        "when_some_key_pressed" |
        "when_object_click" |
        "when_message_cast" |
        "when_scene_start" |
        "when_clone_start"
    )
}

/// Check if a block returns a value
pub fn is_value_block(block_type: &str) -> bool {
    matches!(block_type,
        "number" |
        "text" |
        "True" |
        "False" |
        "calc_basic" |
        "calc_rand" |
        "calc_operation" |
        "get_variable" |
        "coordinate_mouse" |
        "coordinate_object" |
        "get_x" |
        "get_y" |
        "get_rotation" |
        "get_direction" |
        "get_scale" |
        "get_sound_volume" |
        "get_project_timer_value" |
        "length_of_string" |
        "combine_something" |
        "char_at" |
        "substring" |
        "value_of_list_index" |
        "length_of_list" |
        "boolean_basic_operator" |
        "boolean_and_or" |
        "boolean_not" |
        "is_clicked" |
        "is_press_some_key" |
        "reach_something"
    )
}
