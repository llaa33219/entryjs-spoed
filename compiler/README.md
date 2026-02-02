# EntryJS to WASM Compiler

EntryJS 작품을 WebAssembly로 컴파일하는 컴파일러입니다.

## 특징

- **완전한 WASM 실행**: 모든 로직이 WASM에서 실행됩니다
- **최소한의 JS**: PixiJS를 통한 렌더링만 담당합니다
- **장면(Scene) 지원**: 여러 장면 간 전환을 지원합니다

## 사용법

```bash
# 컴파일
node compiler/index.js project.json ./compiler/output

# WAT → WASM 변환 (wat2wasm 필요)
wat2wasm compiler/output/project.wat -o compiler/output/project.wasm

# 실행
node compiler/output/server.js
```

## 출력 파일

- `project.wat` - WebAssembly Text Format 파일
- `renderer.js` - PixiJS 렌더러
- `index.html` - HTML 래퍼

## 지원하는 블록

### 이벤트/시작
- `when_run_button_click` - 시작하기 버튼 클릭
- `when_some_key_pressed` - 키 눌렀을 때
- `when_scene_start` - 장면이 시작되었을 때
- `start_scene` - 장면 시작하기
- `start_neighbor_scene` - 다음/이전 장면 시작하기

### 이동
- `move_direction` - 방향으로 이동
- `move_x`, `move_y` - X/Y 좌표 변경
- `locate_x`, `locate_y`, `locate_xy` - 좌표 설정
- `rotate_relative`, `rotate_absolute` - 회전
- `direction_relative`, `direction_absolute` - 이동 방향

### 형태
- `show`, `hide` - 보이기/숨기기
- `change_size`, `set_size` - 크기 변경
- `change_to_next_shape` - 다음 모양으로 변경

### 흐름제어
- `wait_second` - 초 기다리기
- `repeat_basic` - 반복하기
- `repeat_inf` - 계속 반복하기
- `_if`, `if_else` - 조건문
- `stop_repeat` - 반복 중단하기

### 판단
- `boolean_basic_operator` - 비교 연산
- `boolean_and`, `boolean_or`, `boolean_not` - 논리 연산
- `is_key_pressed` - 키 눌림 확인
- `is_clicked` - 마우스 클릭 확인

### 계산
- `calc_basic` - 사칙연산
- `calc_rand` - 랜덤 숫자
- `calc_operation` - 수학 함수
- `coordinate_object` - 오브젝트 좌표

### 변수
- `get_variable`, `set_variable`, `change_variable` - 변수 조작
- `show_variable`, `hide_variable` - 변수 표시

## 오브젝트 렌더링 순서 (Z-Order)

EntryJS와 동일한 렌더링 순서를 유지합니다:
- `objects` 배열의 첫 번째 오브젝트(`objects[0]`)가 **가장 위(앞)**에 렌더링됩니다
- `objects` 배열의 마지막 오브젝트가 **가장 아래(뒤)**에 렌더링됩니다
- PixiJS는 나중에 추가된 child가 위에 렌더링되므로, 컴파일러는 엔티티 컨테이너를 **역순으로** stage에 추가합니다

## 브러시/채우기 (Brush/Fill) 처리

EntryJS와 동일한 브러시/채우기 동작을 구현합니다:
- **Brush**: 선 그리기 (`start_drawing`, `stop_drawing`)
- **Fill**: 도형 채우기 (`start_fill`, `stop_fill`)
- `set_random_color`: brush와 fill 모두 각각 다른 랜덤 색상으로 설정
- `stop_fill`: `closePath()` 호출 후 `endFill()` 호출 (EntryJS PIXIPaintAdaptor와 동일)

## 장면(Scene) 기능

### 작동 방식
1. 각 오브젝트는 특정 장면에 속합니다 (`obj.scene` 속성)
2. 시작 시 첫 번째 장면의 오브젝트만 보입니다
3. `start_scene` 또는 `start_neighbor_scene` 블록으로 장면 전환
4. 장면 전환 시:
   - 이전 장면의 오브젝트들이 숨겨집니다
   - 새 장면의 오브젝트들이 보입니다
   - `when_scene_start` 이벤트가 발생합니다

### 예제

```json
{
    "scenes": [
        { "id": "scene1", "name": "장면 1" },
        { "id": "scene2", "name": "장면 2" }
    ],
    "objects": [
        {
            "id": "obj1",
            "name": "장면1 캐릭터",
            "scene": "scene1",
            "script": [
                [
                    { "type": "when_run_button_click" },
                    { "type": "wait_second", "params": [2] },
                    { "type": "start_scene", "params": ["scene2"] }
                ]
            ]
        },
        {
            "id": "obj2",
            "name": "장면2 캐릭터",
            "scene": "scene2",
            "script": [
                [
                    { "type": "when_scene_start" },
                    { "type": "move_direction", "params": [100] }
                ]
            ]
        }
    ]
}
```

## 메모리 레이아웃

### 시스템 영역 (0-1023)
- 0-3: frame count (i32)
- 4-7: running (i32)
- 8-15: current time ms (f64)
- 16-23: mouse x (f64)
- 24-31: mouse y (f64)
- 32-35: mouse clicked (i32)
- 36-99: key states (64 bytes)

### 엔티티 데이터 (1024+, 각 72 bytes)
- 0-7: x (f64)
- 8-15: y (f64)
- 16-23: rotation (f64)
- 24-31: direction (f64)
- 32-39: scaleX (f64)
- 40-47: scaleY (f64)
- 48-55: size (f64)
- 56-59: visible (i32)
- 60-63: pictureIndex (i32)
- 64-67: sceneIndex (i32)
- 68-71: reserved (i32)

### 변수 데이터 (엔티티 다음, 각 8 bytes)
- 각 변수당 f64 값

## 파일 구조

```
compiler/
├── index.js              # 메인 진입점
├── parser.js             # JSON 파서
├── codegen/
│   ├── wat-generator.js  # WAT 코드 생성
│   ├── renderer-generator.js  # PixiJS 렌더러 생성
│   ├── block-transpiler.js    # 블록 트랜스파일러
│   └── blocks/           # 블록별 핸들러
│       ├── movement.js
│       ├── looks.js
│       ├── flow.js
│       ├── variable.js
│       ├── calc.js
│       ├── judgement.js
│       ├── sound.js
│       ├── event.js
│       ├── brush.js
│       └── index.js
└── examples/
    └── sample-project.json
```
