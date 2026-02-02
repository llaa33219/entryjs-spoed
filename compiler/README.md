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

### 함수
- `func_<id>` - 사용자 정의 함수 호출
- `function_create` - 일반 함수 정의 (반환값 없음)
- `function_create_value` - 값 반환 함수 정의
- `stringParam_*`, `booleanParam_*` - 함수 파라미터

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

### 엔티티 데이터 (1024+, 각 120 bytes)
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
- 68-75: brushColorR (f64)
- 76-83: brushColorG (f64)
- 84-91: brushColorB (f64)
- 92-99: fillColorR (f64)
- 100-107: fillColorG (f64)
- 108-115: fillColorB (f64)
- 116-119: initialVisible (i32) - 프로젝트 JSON의 원래 visible 상태 저장

### 변수 데이터 (엔티티 다음, 각 8 bytes)
- 각 변수당 f64 값

## 함수 (Function) 기능

사용자 정의 함수를 WASM 함수로 컴파일합니다.

### 지원 기능
- **일반 함수**: 반환값이 없는 함수 (`function_create`)
- **값 함수**: f64 값을 반환하는 함수 (`function_create_value`)
- **파라미터**: 문자열/숫자 파라미터 (`stringParam_*`) 및 불리언 파라미터 (`booleanParam_*`)
- **재귀 호출**: 함수 내에서 자신을 호출 가능

### 작동 방식
1. 각 사용자 함수는 `$user_func_<id>` 형태의 WASM 함수로 컴파일됩니다
2. 함수 파라미터는 WASM 함수의 로컬 변수로 전달됩니다
3. 함수 호출 블록 (`func_<id>`)은 해당 WASM 함수를 호출합니다
4. 값 함수는 마지막 표현식의 값을 반환합니다

### 예제

```json
{
    "functions": [
        {
            "id": "moveForward",
            "name": "앞으로 이동",
            "type": "normal",
            "content": [
                [{
                    "type": "function_create",
                    "params": [
                        {
                            "type": "function_field_label",
                            "params": ["앞으로", {
                                "type": "function_field_string",
                                "params": [
                                    { "type": "stringParam_dist" },
                                    null
                                ]
                            }]
                        }
                    ],
                    "statements": [[
                        {
                            "type": "move_direction",
                            "params": [{ "type": "stringParam_dist" }]
                        }
                    ]]
                }]
            ]
        }
    ]
}
```

위 함수 정의는 다음과 같은 WASM 함수로 컴파일됩니다:

```wat
(func $user_func_moveForward (param $entityIdx i32) (param $param_0 f64)
    ;; move_direction
    (call $moveInDirection (local.get $entityIdx) (local.get $param_0))
)
```

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
│       ├── func.js       # 함수 블록 핸들러
│       └── index.js
└── examples/
    ├── sample-project.json
    └── test-functions.json  # 함수 테스트 프로젝트
```
