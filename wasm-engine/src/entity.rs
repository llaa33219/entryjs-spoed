//! Entity module - represents objects/sprites in the project

use crate::ObjectData;

/// Entity represents a single object/sprite with its state
#[derive(Clone, Debug)]
pub struct Entity {
    pub id: usize,
    pub object_id: String,
    pub name: String,
    
    // Position and transform
    pub x: f64,
    pub y: f64,
    pub rotation: f64,
    pub direction: f64,
    pub scale_x: f64,
    pub scale_y: f64,
    pub width: f64,
    pub height: f64,
    
    // Visibility
    pub visible: bool,
    
    // Graphics
    pub current_picture_id: Option<String>,
    pub pictures: Vec<String>,
    
    // Snapshot for reset
    snapshot: Option<EntitySnapshot>,
    
    // Effects
    pub brightness: f64,
    pub transparency: f64,
    pub color_effect: f64,
    
    // Brush/pen state
    pub brush_down: bool,
    pub brush_color: String,
    pub brush_size: f64,
    
    // Fill state
    pub fill_down: bool,
    pub fill_color: String,
    
    // Dialog state
    pub dialog_message: Option<String>,
    pub dialog_mode: Option<String>,  // "speak", "think", "yell"
    
    // Frame-based path buffers for brush/fill (accumulated during frame, flushed at frame end)
    pub frame_brush_path: Vec<(f64, f64)>,
    pub frame_fill_path: Vec<(f64, f64)>,
}

#[derive(Clone, Debug)]
struct EntitySnapshot {
    x: f64,
    y: f64,
    rotation: f64,
    direction: f64,
    scale_x: f64,
    scale_y: f64,
    visible: bool,
    current_picture_id: Option<String>,
    brightness: f64,
    transparency: f64,
    color_effect: f64,
}

impl Entity {
    /// Create a new entity from object data
    pub fn from_object(obj: &ObjectData, idx: usize) -> Self {
        let entity_data = obj.entity.as_ref();
        
        let mut pictures = Vec::new();
        if let Some(sprite) = &obj.sprite {
            if let Some(pics) = &sprite.pictures {
                for pic in pics {
                    pictures.push(pic.id.clone());
                }
            }
        }
        
        Entity {
            id: idx,
            object_id: obj.id.clone(),
            name: obj.name.clone().unwrap_or_else(|| format!("Object{}", idx)),
            
            x: entity_data.and_then(|e| e.x).unwrap_or(0.0),
            y: entity_data.and_then(|e| e.y).unwrap_or(0.0),
            rotation: entity_data.and_then(|e| e.rotation).unwrap_or(0.0),
            direction: entity_data.and_then(|e| e.direction).unwrap_or(90.0),
            scale_x: entity_data.and_then(|e| e.scale_x).unwrap_or(1.0),
            scale_y: entity_data.and_then(|e| e.scale_y).unwrap_or(1.0),
            width: entity_data.and_then(|e| e.width).unwrap_or(100.0),
            height: entity_data.and_then(|e| e.height).unwrap_or(100.0),
            
            visible: entity_data.and_then(|e| e.visible).unwrap_or(true),
            
            current_picture_id: obj.selected_picture_id.clone(),
            pictures,
            
            snapshot: None,
            
            brightness: 0.0,
            transparency: 0.0,
            color_effect: 0.0,
            
            brush_down: false,
            brush_color: "#ff0000".to_string(),
            brush_size: 1.0,
            
            fill_down: false,
            fill_color: "#ff0000".to_string(),
            
            dialog_message: None,
            dialog_mode: None,
            
            frame_brush_path: Vec::new(),
            frame_fill_path: Vec::new(),
        }
    }
    
    /// Take a snapshot of current state
    pub fn take_snapshot(&mut self) {
        self.snapshot = Some(EntitySnapshot {
            x: self.x,
            y: self.y,
            rotation: self.rotation,
            direction: self.direction,
            scale_x: self.scale_x,
            scale_y: self.scale_y,
            visible: self.visible,
            current_picture_id: self.current_picture_id.clone(),
            brightness: self.brightness,
            transparency: self.transparency,
            color_effect: self.color_effect,
        });
    }
    
    /// Restore from snapshot
    pub fn restore_snapshot(&mut self) {
        if let Some(snap) = &self.snapshot {
            self.x = snap.x;
            self.y = snap.y;
            self.rotation = snap.rotation;
            self.direction = snap.direction;
            self.scale_x = snap.scale_x;
            self.scale_y = snap.scale_y;
            self.visible = snap.visible;
            self.current_picture_id = snap.current_picture_id.clone();
            self.brightness = snap.brightness;
            self.transparency = snap.transparency;
            self.color_effect = snap.color_effect;
        }
    }
    
    // Movement methods
    pub fn move_direction(&mut self, distance: f64) {
        let angle_rad = (self.rotation + self.direction - 90.0).to_radians();
        self.x += distance * angle_rad.cos();
        self.y -= distance * angle_rad.sin();
    }
    
    pub fn move_x(&mut self, dx: f64) {
        self.x += dx;
    }
    
    pub fn move_y(&mut self, dy: f64) {
        self.y += dy;
    }
    
    pub fn set_x(&mut self, x: f64) {
        self.x = x;
    }
    
    pub fn set_y(&mut self, y: f64) {
        self.y = y;
    }
    
    pub fn set_xy(&mut self, x: f64, y: f64) {
        self.x = x;
        self.y = y;
    }
    
    // Rotation methods
    pub fn rotate(&mut self, angle: f64) {
        self.rotation = (self.rotation + angle) % 360.0;
    }
    
    pub fn set_rotation(&mut self, angle: f64) {
        self.rotation = angle % 360.0;
    }
    
    pub fn set_direction(&mut self, direction: f64) {
        self.direction = direction % 360.0;
    }
    
    pub fn add_direction(&mut self, delta: f64) {
        self.direction = (self.direction + delta) % 360.0;
    }
    
    // Look methods
    pub fn look_at(&mut self, target_x: f64, target_y: f64) {
        let dx = target_x - self.x;
        let dy = target_y - self.y;
        
        if dx == 0.0 && dy == 0.0 {
            return;
        }
        
        let angle = if dx >= 0.0 {
            (-dy.atan2(dx)).to_degrees() + 90.0
        } else {
            (-dy.atan2(dx)).to_degrees() + 270.0
        };
        
        self.direction = angle;
    }
    
    // Scale methods
    pub fn set_scale(&mut self, scale: f64) {
        self.scale_x = scale;
        self.scale_y = scale;
    }
    
    pub fn change_scale(&mut self, delta: f64) {
        self.scale_x += delta;
        self.scale_y += delta;
    }
    
    // Visibility
    pub fn show(&mut self) {
        self.visible = true;
    }
    
    pub fn hide(&mut self) {
        self.visible = false;
    }
    
    // Effects
    pub fn set_effect(&mut self, effect_type: &str, value: f64) {
        match effect_type {
            "brightness" => self.brightness = value,
            "transparency" => self.transparency = value.clamp(0.0, 100.0),
            "color" => self.color_effect = value,
            _ => {}
        }
    }
    
    pub fn change_effect(&mut self, effect_type: &str, delta: f64) {
        match effect_type {
            "brightness" => self.brightness += delta,
            "transparency" => self.transparency = (self.transparency + delta).clamp(0.0, 100.0),
            "color" => self.color_effect += delta,
            _ => {}
        }
    }
    
    pub fn clear_effects(&mut self) {
        self.brightness = 0.0;
        self.transparency = 0.0;
        self.color_effect = 0.0;
    }
    
    // Shape/costume
    pub fn set_picture(&mut self, picture_id: &str) {
        if self.pictures.contains(&picture_id.to_string()) {
            self.current_picture_id = Some(picture_id.to_string());
        }
    }
    
    pub fn next_picture(&mut self) {
        if self.pictures.is_empty() {
            return;
        }
        
        let current_idx = self.current_picture_id
            .as_ref()
            .and_then(|id| self.pictures.iter().position(|p| p == id))
            .unwrap_or(0);
        
        let next_idx = (current_idx + 1) % self.pictures.len();
        // Use safe access with get() instead of direct indexing
        if let Some(picture) = self.pictures.get(next_idx) {
            self.current_picture_id = Some(picture.clone());
        }
    }
    
    pub fn prev_picture(&mut self) {
        if self.pictures.is_empty() {
            return;
        }
        
        let current_idx = self.current_picture_id
            .as_ref()
            .and_then(|id| self.pictures.iter().position(|p| p == id))
            .unwrap_or(0);
        
        let prev_idx = if current_idx == 0 {
            self.pictures.len() - 1
        } else {
            current_idx - 1
        };
        // Use safe access with get() instead of direct indexing
        if let Some(picture) = self.pictures.get(prev_idx) {
            self.current_picture_id = Some(picture.clone());
        }
    }
    
    // Getters for blocks
    pub fn get_x(&self) -> f64 {
        self.x
    }
    
    pub fn get_y(&self) -> f64 {
        self.y
    }
    
    pub fn get_rotation(&self) -> f64 {
        self.rotation
    }
    
    pub fn get_direction(&self) -> f64 {
        self.direction
    }
    
    pub fn get_scale(&self) -> f64 {
        (self.scale_x + self.scale_y) / 2.0 * 100.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_entity() -> Entity {
        Entity {
            id: 0,
            object_id: "test".to_string(),
            name: "Test".to_string(),
            x: 0.0,
            y: 0.0,
            rotation: 0.0,
            direction: 90.0,
            scale_x: 1.0,
            scale_y: 1.0,
            width: 100.0,
            height: 100.0,
            visible: true,
            current_picture_id: None,
            pictures: vec!["pic1".to_string(), "pic2".to_string()],
            snapshot: None,
            brightness: 0.0,
            transparency: 0.0,
            color_effect: 0.0,
            brush_down: false,
            brush_color: "#ff0000".to_string(),
            brush_size: 1.0,
            fill_down: false,
            fill_color: "#ff0000".to_string(),
            dialog_message: None,
            dialog_mode: None,
            frame_brush_path: Vec::new(),
            frame_fill_path: Vec::new(),
        }
    }

    #[test]
    fn test_move_direction() {
        let mut entity = create_test_entity();
        entity.direction = 90.0;
        entity.move_direction(10.0);
        assert!((entity.x - 10.0).abs() < 0.001);
        assert!(entity.y.abs() < 0.001);
    }

    #[test]
    fn test_snapshot() {
        let mut entity = create_test_entity();
        entity.x = 100.0;
        entity.take_snapshot();
        entity.x = 200.0;
        entity.restore_snapshot();
        assert_eq!(entity.x, 100.0);
    }
}
