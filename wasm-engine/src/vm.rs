use crate::bytecode::{Instruction, Program};
use crate::blocks::BlockTypeId;
use crate::{Entity, Value, JsAction};
use std::collections::HashMap;

pub struct VM<'a> {
    program: &'a Program,
    stack: Vec<Value>,
    entities: &'a mut Vec<Entity>,
    variables: &'a mut HashMap<String, Value>,
    _js_actions: &'a mut Vec<JsAction>,
}

impl<'a> VM<'a> {
    pub fn new(
        program: &'a Program,
        entities: &'a mut Vec<Entity>,
        variables: &'a mut HashMap<String, Value>,
        js_actions: &'a mut Vec<JsAction>,
    ) -> Self {
        VM {
            program,
            stack: Vec::with_capacity(1024),
            entities,
            variables,
            _js_actions: js_actions,
        }
    }
    
    pub fn execute_script(&mut self, entity_idx: usize, start_pc: usize) {
        let mut pc = start_pc;
        
        loop {
            if pc >= self.program.instructions.len() {
                break;
            }
            
            let instr = &self.program.instructions[pc];
            pc += 1;
            
            match instr {
                Instruction::Nop => {},
                Instruction::End | Instruction::Return => {
                    break;
                },
                Instruction::PushConst(idx) => {
                    if let Some(val) = self.program.constants.get(*idx as usize) {
                        self.stack.push(val.clone());
                    }
                },
                Instruction::Exec(type_id) => {
                    self.execute_block(*type_id, entity_idx);
                },
                Instruction::SetVar(idx) => {
                    if let Some(val) = self.stack.pop() {
                        if let Some(var_name) = self.program.string_pool.get(*idx as usize) {
                            if let Some(var) = self.variables.get_mut(var_name) {
                                *var = val;
                            }
                        }
                    }
                },
                Instruction::PushVar(idx) => {
                    if let Some(var_name) = self.program.string_pool.get(*idx as usize) {
                        if let Some(var) = self.variables.get(var_name) {
                            self.stack.push(var.clone());
                        } else {
                            self.stack.push(Value::Null);
                        }
                    } else {
                        self.stack.push(Value::Null);
                    }
                },
                _ => {}
            }
        }
    }
    
    fn execute_block(&mut self, type_id: BlockTypeId, entity_idx: usize) {
        match type_id {
            BlockTypeId::MoveX => {
                let val = self.pop_number();
                if let Some(e) = self.entities.get_mut(entity_idx) {
                    e.move_x(val);
                }
            },
            BlockTypeId::MoveY => {
                let val = self.pop_number();
                if let Some(e) = self.entities.get_mut(entity_idx) {
                    e.move_y(val);
                }
            },
            _ => {}
        }
    }
    
    fn pop_number(&mut self) -> f64 {
        if let Some(val) = self.stack.pop() {
            val.as_number()
        } else {
            0.0
        }
    }
}
