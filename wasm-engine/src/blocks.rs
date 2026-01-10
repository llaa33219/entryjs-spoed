//! Block type definitions with compile-time perfect hashing for O(1) dispatch

use phf::phf_map;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum BlockTypeId {
    Unknown = 0,
    
    // Events (1-20)
    WhenRunButtonClick = 1,
    WhenSomeKeyPressed = 2,
    WhenObjectClick = 3,
    WhenObjectClickCanceled = 4,
    WhenCloneStart = 5,
    WhenMessageCast = 6,
    WhenSceneStart = 7,
    MouseClicked = 8,
    MouseClickCancled = 9,
    
    // Flow (21-50)
    WaitSecond = 21,
    RepeatBasic = 22,
    RepeatInf = 23,
    RepeatWhileTrue = 24,
    StopRepeat = 25,
    ContinueRepeat = 26,
    If = 27,
    IfElse = 28,
    WaitUntilTrue = 29,
    StopObject = 30,
    RestartProject = 31,
    CreateClone = 32,
    DeleteClone = 33,
    RemoveAllClones = 34,
    MessageCast = 35,
    MessageCastWait = 36,
    StartScene = 37,
    StartNeighborScene = 38,
    
    // Movement (51-80)
    MoveDirection = 51,
    MoveX = 52,
    MoveY = 53,
    LocateX = 54,
    LocateY = 55,
    LocateXy = 56,
    RotateRelative = 57,
    DirectionRelative = 58,
    RotateAbsolute = 59,
    DirectionAbsolute = 60,
    MoveToAngle = 61,
    MoveXyTime = 62,
    LocateXyTime = 63,
    RotateByTime = 64,
    DirectionRelativeDuration = 65,
    BounceWall = 66,
    Locate = 67,
    SeeAngleObject = 68,
    SeeAngleDirection = 69,
    LocateObjectTime = 70,
    
    // Looks (81-120)
    Show = 81,
    Hide = 82,
    ChangeToNextShape = 83,
    ChangeToPreviousShape = 84,
    ChangeToSomeShape = 85,
    SetEffect = 86,
    ChangeEffect = 87,
    ClearEffect = 88,
    EraseAllEffects = 89,
    AddEffectAmount = 90,
    ChangeEffectAmount = 91,
    ChangeScaleSize = 92,
    SetScaleSize = 93,
    FlipX = 94,
    FlipY = 95,
    ChangeObjectIndex = 96,
    Dialog = 97,
    DialogTime = 98,
    RemoveDialog = 99,
    StretchScaleSize = 100,
    ResetScaleSize = 101,
    
    // Sound (121-150)
    SoundSomething = 121,
    SoundSomethingWithBlock = 122,
    SoundSomethingSecond = 123,
    SoundSomethingSecondWithBlock = 124,
    SoundSomethingWait = 125,
    SoundSomethingWaitWithBlock = 126,
    SoundSomethingSecondWaitWithBlock = 127,
    SoundFromTo = 128,
    SoundFromToAndWait = 129,
    SoundVolumeChange = 130,
    SoundVolumeSet = 131,
    SoundSpeedChange = 132,
    SoundSpeedSet = 133,
    SoundStop = 134,
    SoundSilentAll = 135,
    PlayBgm = 136,
    StopBgm = 137,
    
    // Brush (151-180)
    BrushStamp = 151,
    BrushDown = 152,
    BrushUp = 153,
    SetBrushColor = 154,
    SetBrushSize = 155,
    ChangeBrushSize = 156,
    BrushEraseAll = 157,
    BrushClear = 158,
    StartDrawing = 159,
    StopDrawing = 160,
    StartFill = 161,
    StopFill = 162,
    SetColor = 163,
    SetRandomColor = 164,
    SetFillColor = 165,
    ChangeThickness = 166,
    SetThickness = 167,
    ChangeBrushTransparency = 168,
    SetBrushTranparency = 169,
    
    // Timer (181-190)
    ChooseProjectTimerAction = 181,
    SetVisibleProjectTimer = 182,
    
    // Variable (191-220)
    SetVariable = 191,
    ChangeVariable = 192,
    ShowVariable = 193,
    HideVariable = 194,
    AddValueToList = 195,
    RemoveValueFromList = 196,
    InsertValueToList = 197,
    ChangeValueListIndex = 198,
    ShowList = 199,
    HideList = 200,
    AskAndWait = 201,
    SetVisibleAnswer = 202,
    SetFuncVariable = 203,
    
    // Function (221-230)
    FunctionCreate = 221,
    FunctionCreateValue = 222,
    FunctionFieldLabel = 223,
    FunctionFieldString = 224,
    FunctionFieldBoolean = 225,
    
    // Calc (231-250)
    CalcBasic = 231,
}

static BLOCK_TYPE_MAP: phf::Map<&'static str, BlockTypeId> = phf_map! {
    // Events
    "when_run_button_click" => BlockTypeId::WhenRunButtonClick,
    "when_some_key_pressed" => BlockTypeId::WhenSomeKeyPressed,
    "when_object_click" => BlockTypeId::WhenObjectClick,
    "when_object_click_canceled" => BlockTypeId::WhenObjectClickCanceled,
    "when_clone_start" => BlockTypeId::WhenCloneStart,
    "when_message_cast" => BlockTypeId::WhenMessageCast,
    "when_scene_start" => BlockTypeId::WhenSceneStart,
    "mouse_clicked" => BlockTypeId::MouseClicked,
    "mouse_click_cancled" => BlockTypeId::MouseClickCancled,
    
    // Flow
    "wait_second" => BlockTypeId::WaitSecond,
    "repeat_basic" => BlockTypeId::RepeatBasic,
    "repeat_inf" => BlockTypeId::RepeatInf,
    "repeat_while_true" => BlockTypeId::RepeatWhileTrue,
    "stop_repeat" => BlockTypeId::StopRepeat,
    "continue_repeat" => BlockTypeId::ContinueRepeat,
    "_if" => BlockTypeId::If,
    "if_else" => BlockTypeId::IfElse,
    "wait_until_true" => BlockTypeId::WaitUntilTrue,
    "stop_object" => BlockTypeId::StopObject,
    "restart_project" => BlockTypeId::RestartProject,
    "create_clone" => BlockTypeId::CreateClone,
    "delete_clone" => BlockTypeId::DeleteClone,
    "remove_all_clones" => BlockTypeId::RemoveAllClones,
    "message_cast" => BlockTypeId::MessageCast,
    "message_cast_wait" => BlockTypeId::MessageCastWait,
    "start_scene" => BlockTypeId::StartScene,
    "start_neighbor_scene" => BlockTypeId::StartNeighborScene,
    
    // Movement
    "move_direction" => BlockTypeId::MoveDirection,
    "move_x" => BlockTypeId::MoveX,
    "move_y" => BlockTypeId::MoveY,
    "locate_x" => BlockTypeId::LocateX,
    "locate_y" => BlockTypeId::LocateY,
    "locate_xy" => BlockTypeId::LocateXy,
    "rotate_relative" => BlockTypeId::RotateRelative,
    "direction_relative" => BlockTypeId::DirectionRelative,
    "rotate_absolute" => BlockTypeId::RotateAbsolute,
    "direction_absolute" => BlockTypeId::DirectionAbsolute,
    "move_to_angle" => BlockTypeId::MoveToAngle,
    "move_xy_time" => BlockTypeId::MoveXyTime,
    "locate_xy_time" => BlockTypeId::LocateXyTime,
    "rotate_by_time" => BlockTypeId::RotateByTime,
    "direction_relative_duration" => BlockTypeId::DirectionRelativeDuration,
    "bounce_wall" => BlockTypeId::BounceWall,
    "locate" => BlockTypeId::Locate,
    "see_angle_object" => BlockTypeId::SeeAngleObject,
    "see_angle_direction" => BlockTypeId::SeeAngleDirection,
    "locate_object_time" => BlockTypeId::LocateObjectTime,
    
    // Looks
    "show" => BlockTypeId::Show,
    "hide" => BlockTypeId::Hide,
    "change_to_next_shape" => BlockTypeId::ChangeToNextShape,
    "change_to_previous_shape" => BlockTypeId::ChangeToPreviousShape,
    "change_to_some_shape" => BlockTypeId::ChangeToSomeShape,
    "set_effect" => BlockTypeId::SetEffect,
    "change_effect" => BlockTypeId::ChangeEffect,
    "clear_effect" => BlockTypeId::ClearEffect,
    "erase_all_effects" => BlockTypeId::EraseAllEffects,
    "add_effect_amount" => BlockTypeId::AddEffectAmount,
    "change_effect_amount" => BlockTypeId::ChangeEffectAmount,
    "change_scale_size" => BlockTypeId::ChangeScaleSize,
    "set_scale_size" => BlockTypeId::SetScaleSize,
    "flip_x" => BlockTypeId::FlipX,
    "flip_y" => BlockTypeId::FlipY,
    "change_object_index" => BlockTypeId::ChangeObjectIndex,
    "dialog" => BlockTypeId::Dialog,
    "dialog_time" => BlockTypeId::DialogTime,
    "remove_dialog" => BlockTypeId::RemoveDialog,
    "stretch_scale_size" => BlockTypeId::StretchScaleSize,
    "reset_scale_size" => BlockTypeId::ResetScaleSize,
    
    // Sound
    "sound_something" => BlockTypeId::SoundSomething,
    "sound_something_with_block" => BlockTypeId::SoundSomethingWithBlock,
    "sound_something_second" => BlockTypeId::SoundSomethingSecond,
    "sound_something_second_with_block" => BlockTypeId::SoundSomethingSecondWithBlock,
    "sound_something_wait" => BlockTypeId::SoundSomethingWait,
    "sound_something_wait_with_block" => BlockTypeId::SoundSomethingWaitWithBlock,
    "sound_something_second_wait_with_block" => BlockTypeId::SoundSomethingSecondWaitWithBlock,
    "sound_from_to" => BlockTypeId::SoundFromTo,
    "sound_from_to_and_wait" => BlockTypeId::SoundFromToAndWait,
    "sound_volume_change" => BlockTypeId::SoundVolumeChange,
    "sound_volume_set" => BlockTypeId::SoundVolumeSet,
    "sound_speed_change" => BlockTypeId::SoundSpeedChange,
    "sound_speed_set" => BlockTypeId::SoundSpeedSet,
    "sound_stop" => BlockTypeId::SoundStop,
    "sound_silent_all" => BlockTypeId::SoundSilentAll,
    "play_bgm" => BlockTypeId::PlayBgm,
    "stop_bgm" => BlockTypeId::StopBgm,
    
    // Brush
    "brush_stamp" => BlockTypeId::BrushStamp,
    "brush_down" => BlockTypeId::BrushDown,
    "brush_up" => BlockTypeId::BrushUp,
    "set_brush_color" => BlockTypeId::SetBrushColor,
    "set_brush_size" => BlockTypeId::SetBrushSize,
    "change_brush_size" => BlockTypeId::ChangeBrushSize,
    "brush_erase_all" => BlockTypeId::BrushEraseAll,
    "brush_clear" => BlockTypeId::BrushClear,
    "start_drawing" => BlockTypeId::StartDrawing,
    "stop_drawing" => BlockTypeId::StopDrawing,
    "start_fill" => BlockTypeId::StartFill,
    "stop_fill" => BlockTypeId::StopFill,
    "set_color" => BlockTypeId::SetColor,
    "set_random_color" => BlockTypeId::SetRandomColor,
    "set_fill_color" => BlockTypeId::SetFillColor,
    "change_thickness" => BlockTypeId::ChangeThickness,
    "set_thickness" => BlockTypeId::SetThickness,
    "change_brush_transparency" => BlockTypeId::ChangeBrushTransparency,
    "set_brush_tranparency" => BlockTypeId::SetBrushTranparency,
    
    // Timer
    "choose_project_timer_action" => BlockTypeId::ChooseProjectTimerAction,
    "set_visible_project_timer" => BlockTypeId::SetVisibleProjectTimer,
    
    // Variable
    "set_variable" => BlockTypeId::SetVariable,
    "change_variable" => BlockTypeId::ChangeVariable,
    "show_variable" => BlockTypeId::ShowVariable,
    "hide_variable" => BlockTypeId::HideVariable,
    "add_value_to_list" => BlockTypeId::AddValueToList,
    "remove_value_from_list" => BlockTypeId::RemoveValueFromList,
    "insert_value_to_list" => BlockTypeId::InsertValueToList,
    "change_value_list_index" => BlockTypeId::ChangeValueListIndex,
    "show_list" => BlockTypeId::ShowList,
    "hide_list" => BlockTypeId::HideList,
    "ask_and_wait" => BlockTypeId::AskAndWait,
    "set_visible_answer" => BlockTypeId::SetVisibleAnswer,
    "set_func_variable" => BlockTypeId::SetFuncVariable,
    
    // Function
    "function_create" => BlockTypeId::FunctionCreate,
    "function_create_value" => BlockTypeId::FunctionCreateValue,
    "function_field_label" => BlockTypeId::FunctionFieldLabel,
    "function_field_string" => BlockTypeId::FunctionFieldString,
    "function_field_boolean" => BlockTypeId::FunctionFieldBoolean,
    
    // Calc
    "calc_basic" => BlockTypeId::CalcBasic,
};

#[inline(always)]
pub fn get_block_type_id(block_type: &str) -> BlockTypeId {
    if block_type.starts_with("func_") {
        return BlockTypeId::Unknown;
    }
    *BLOCK_TYPE_MAP.get(block_type).unwrap_or(&BlockTypeId::Unknown)
}

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

pub fn get_block_category(block_type: &str) -> Option<BlockCategory> {
    match block_type {
        "when_run_button_click" |
        "when_some_key_pressed" |
        "when_object_click" |
        "when_object_click_canceled" |
        "when_message_cast" |
        "when_scene_start" |
        "when_clone_start" |
        "mouse_clicked" |
        "mouse_click_cancled" => Some(BlockCategory::Start),

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
        "remove_all_clones" |
        "message_cast" |
        "message_cast_wait" |
        "start_scene" |
        "start_neighbor_scene" => Some(BlockCategory::Flow),

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
        "see_angle_direction" |
        "move_to_angle" |
        "bounce_wall" => Some(BlockCategory::Moving),

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
        "erase_all_effects" |
        "add_effect_amount" |
        "change_effect_amount" |
        "change_scale_size" |
        "set_scale_size" |
        "flip_x" |
        "flip_y" |
        "stretch_scale_size" |
        "reset_scale_size" |
        "change_object_index" => Some(BlockCategory::Looks),

        "sound_something" |
        "sound_something_with_block" |
        "sound_something_second" |
        "sound_something_second_with_block" |
        "sound_something_wait" |
        "sound_something_wait_with_block" |
        "sound_something_second_wait_with_block" |
        "sound_from_to" |
        "sound_from_to_and_wait" |
        "sound_volume_change" |
        "sound_volume_set" |
        "sound_speed_change" |
        "sound_speed_set" |
        "sound_stop" |
        "sound_silent_all" |
        "play_bgm" |
        "stop_bgm" => Some(BlockCategory::Sound),
        
        "brush_stamp" |
        "brush_down" |
        "brush_up" |
        "start_drawing" |
        "stop_drawing" |
        "start_fill" |
        "stop_fill" |
        "set_color" |
        "set_brush_color" |
        "set_random_color" |
        "set_fill_color" |
        "set_brush_size" |
        "change_brush_size" |
        "change_thickness" |
        "set_thickness" |
        "change_brush_transparency" |
        "set_brush_tranparency" |
        "brush_erase_all" |
        "brush_clear" => Some(BlockCategory::Looks),
        
        "choose_project_timer_action" |
        "set_visible_project_timer" => Some(BlockCategory::Calc),

        "is_clicked" |
        "is_object_clicked" |
        "is_press_some_key" |
        "reach_something" |
        "boolean_basic_operator" |
        "boolean_and_or" |
        "boolean_not" |
        "is_type" |
        "is_boost_mode" |
        "is_current_device_type" |
        "is_touch_supported" => Some(BlockCategory::Judgement),

        "calc_basic" |
        "calc_rand" |
        "coordinate_mouse" |
        "coordinate_object" |
        "get_sound_volume" |
        "get_sound_speed" |
        "get_sound_duration" |
        "length_of_string" |
        "reverse_of_string" |
        "combine_something" |
        "char_at" |
        "substring" |
        "count_match_string" |
        "index_of_string" |
        "replace_string" |
        "change_string_case" |
        "calc_operation" |
        "quotient_and_mod" |
        "get_date" |
        "get_project_timer_value" |
        "distance_something" |
        "change_rgb_to_hex" |
        "change_hex_to_rgb" |
        "get_boolean_value" |
        "get_user_name" |
        "get_nickname" |
        "get_block_count" |
        "get_x" |
        "get_y" |
        "get_rotation" |
        "get_direction" |
        "get_scale" => Some(BlockCategory::Calc),

        "set_variable" |
        "change_variable" |
        "show_variable" |
        "hide_variable" |
        "get_variable" |
        "value_of_list_index" |
        "value_of_index_from_list" |
        "add_value_to_list" |
        "remove_value_from_list" |
        "insert_value_to_list" |
        "change_value_list_index" |
        "length_of_list" |
        "show_list" |
        "hide_list" |
        "is_included_in_list" |
        "ask_and_wait" |
        "get_canvas_input_value" |
        "set_visible_answer" |
        "index_of_list" => Some(BlockCategory::Variable),

        "function_create" |
        "function_create_value" |
        "function_call" |
        "function_value" |
        "function_field_label" |
        "function_field_string" |
        "function_field_boolean" => Some(BlockCategory::Func),

        _ => None,
    }
}

pub fn is_executable_block(block_type: &str) -> bool {
    !matches!(block_type, 
        "when_run_button_click" |
        "when_some_key_pressed" |
        "when_object_click" |
        "when_message_cast" |
        "when_scene_start" |
        "when_clone_start"
    )
}

pub fn is_value_block(block_type: &str) -> bool {
    matches!(block_type,
        "number" |
        "angle" |
        "text" |
        "True" |
        "False" |
        "calc_basic" |
        "calc_rand" |
        "calc_operation" |
        "quotient_and_mod" |
        "get_variable" |
        "coordinate_mouse" |
        "coordinate_object" |
        "get_x" |
        "get_y" |
        "get_rotation" |
        "get_direction" |
        "get_scale" |
        "get_sound_volume" |
        "get_sound_speed" |
        "get_sound_duration" |
        "get_project_timer_value" |
        "get_date" |
        "distance_something" |
        "length_of_string" |
        "reverse_of_string" |
        "count_match_string" |
        "combine_something" |
        "char_at" |
        "substring" |
        "index_of_string" |
        "replace_string" |
        "change_string_case" |
        "change_rgb_to_hex" |
        "change_hex_to_rgb" |
        "get_boolean_value" |
        "get_user_name" |
        "get_nickname" |
        "value_of_list_index" |
        "value_of_index_from_list" |
        "length_of_list" |
        "is_included_in_list" |
        "index_of_list" |
        "get_canvas_input_value" |
        "boolean_basic_operator" |
        "boolean_and_or" |
        "boolean_not" |
        "is_clicked" |
        "is_object_clicked" |
        "is_press_some_key" |
        "reach_something" |
        "get_func_variable"
    )
}

pub fn is_func_value_block(block_type: &str) -> bool {
    block_type.starts_with("func_")
}
