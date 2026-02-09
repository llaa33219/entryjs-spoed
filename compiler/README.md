# EntryJS to WASM Compiler

EntryJS 작품을 WebAssembly로 컴파일하는 컴파일러입니다.

## 특징

- **완전한 WASM 실행**: 모든 로직이 WASM에서 실행됩니다
- **최소한의 JS**: PixiJS를 통한 렌더링만 담당합니다
- **장면(Scene) 지원**: 여러 장면 간 전환을 지원합니다
- **동적 틱 레이트**: WASM 로직은 초당 최대 1,000,000틱까지 CPU 부하에 따라 동적으로 조정됩니다

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
- `mouse_clicked` - 마우스를 클릭했을 때
- `mouse_click_cancled` - 마우스 클릭을 해제했을 때
- `when_object_click` - 오브젝트를 클릭했을 때
- `when_object_click_canceled` - 오브젝트 클릭을 해제했을 때
- `when_message_cast` - 신호를 받았을 때
- `message_cast` - 신호 보내기
- `message_cast_wait` - 신호 보내고 기다리기
- `when_scene_start` - 장면이 시작되었을 때
- `start_scene` - 장면 시작하기
- `start_neighbor_scene` - 다음/이전 장면 시작하기

### 이동
- `move_direction` - 방향으로 이동
- `bounce_wall` - 벽에 닿으면 튕기기
- `move_x`, `move_y` - X/Y 좌표 변경
- `move_xy_time` - 시간 동안 X/Y만큼 이동
- `locate_x`, `locate_y`, `locate_xy` - 좌표 설정
- `locate_xy_time` - 시간 동안 좌표로 이동
- `locate` - 마우스 포인터 위치로 이동
- `locate_object_time` - 시간 동안 오브젝트 위치로 이동
- `rotate_relative`, `rotate_absolute` - 회전
- `rotate_by_time` - 시간 동안 회전
- `direction_relative`, `direction_absolute` - 이동 방향
- `direction_relative_duration` - 시간 동안 이동 방향 변경
- `see_angle_object` - 오브젝트를 향해 방향 설정
- `move_to_angle` - 각도 방향으로 이동

### 형태
- `show`, `hide` - 보이기/숨기기
- `dialog` - 말풍선 표시 (말하기/생각하기)
- `dialog_time` - 지정 시간 동안 말풍선 표시 후 자동 제거
- `remove_dialog` - 말풍선 지우기
- `change_to_some_shape` - 모양 바꾸기
- `change_to_next_shape` - 다음/이전 모양으로 변경
- `add_effect_amount` - 효과 변경하기 (투명도 상대 변경)
- `change_effect_amount` - 효과 정하기 (투명도 절대값 설정)
- `set_effect_amount` - 효과 값 변경하기 (투명도 상대 변경)
- `erase_all_effects` - 효과 모두 지우기
- `change_effect_volume` - 효과 변경 (투명도/불투명도, 레거시)
- `set_effect_volume` - 효과 정하기 (투명도/불투명도, deprecated)
- `clear_effect` - 효과 지우기 (레거시)
- `set_effect` - 효과 정하기 (불투명도/투명도)
- `change_effect` - 효과 변경하기 (불투명도/투명도, 레거시)
- `change_scale_size` - 크기 변경하기
- `set_scale_size` - 크기 정하기
- `stretch_scale_size` - 가로/세로 크기 변경하기
- `reset_scale_size` - 크기 원래대로
- `flip_x` - 좌우 뒤집기
- `flip_y` - 상하 뒤집기
- `change_object_index` - 순서 변경하기
- `change_object_index_to` - 순서 정하기
- `get_size` - 크기 값
- `get_pictures` - 모양 값
- `get_effect_value` - 효과 값
- `current_picture_name` - 현재 모양 이름

### 흐름제어
- `wait_second` - 초 기다리기
- `repeat_basic` - 반복하기 (EntryJS와 동일하게 한 번 반복당 한 틱 대기)
- `repeat_inf` - 계속 반복하기 (EntryJS와 동일하게 한 번 반복당 한 틱 대기)
- `repeat_while_true` - 조건 만족할 때까지 반복 (EntryJS와 동일하게 한 번 반복당 한 틱 대기)
- `_if`, `if_else` - 조건문
- `wait_until_true` - 조건이 참이 될 때까지 기다리기
- `stop_repeat` - 반복 중단하기
- `continue_repeat` - 다음 반복으로 건너뛰기
- `stop_object` - 오브젝트 실행 중단
- `stop_run` - 프로젝트 실행 중단
- `restart_project` - 프로젝트 다시 시작
- `when_clone_start` - 복제되었을 때
- `create_clone` - 복제하기
- `delete_clone` - 복제본 삭제
- `remove_all_clones` - 모든 복제본 삭제

### 판단
- `boolean_basic_operator` - 비교 연산 (=, ≠, >, <, ≥, ≤)
- `boolean_comparison` - 비교 연산 (문자열 비교 포함)
- `boolean_and_or` - 논리 AND/OR 연산
- `boolean_not` - 논리 NOT 연산
- `boolean_shell` - 불리언 래퍼
- `boolean_contain` - 문자열 포함 여부
- `boolean_start_with` - 문자열 시작 여부
- `boolean_between` - 값이 범위 내에 있는지
- `is_clicked` - 마우스 클릭 확인
- `is_clicked_mouse` - 마우스 버튼 클릭 확인
- `is_press_some_key` - 키 눌림 확인
- `is_object_clicked` - 오브젝트 클릭 확인
- `is_touched` - 오브젝트 접촉 확인
- `reach_something` - 벽/마우스/오브젝트에 닿았는지
- `object_is_visible` - 오브젝트 보이기 상태 확인
- `is_type` - 값 타입 확인
- `is_boost_mode` - 부스트 모드 여부 (항상 true)
- `is_current_device_type` - 현재 기기 타입 확인 (데스크탑/태블릿/모바일)
- `is_touch_supported` - 터치 지원 여부 확인

### 계산
- `number`, `text`, `angle` - 숫자/문자/각도 리터럴
- `calc_basic` - 사칙연산
- `calc_rand` - 랜덤 숫자
- `calc_operation` - 수학 함수 (제곱, 루트, 절대값, 올림, 내림, 반올림, 삼각함수, 로그 등)
- `calc_mod` - 나머지 연산
- `quotient_and_mod` - 몫과 나머지
- `coordinate_mouse` - 마우스 좌표
- `coordinate_object` - 오브젝트 좌표/속성
- `distance_something` - 거리 측정
- `get_date` - 현재 날짜/시간 (년/월/일/시/분/초)
- `get_project_timer_value` - 초시계 값
- `choose_project_timer_action` - 초시계 시작/정지/리셋
- `set_visible_project_timer` - 초시계 표시/숨기기
- `get_sound_duration` - 소리 길이
- `get_boolean_value` - 불리언 값을 숫자로 변환
- `color` - 색상 블록 (hex 색상을 packed RGB 값으로 변환)
- `change_rgb_to_hex` - RGB를 hex로 변환
- `change_hex_to_rgb` - hex를 RGB 컴포넌트로 변환
- `get_user_name` - 사용자 이름
- `get_nickname` - 사용자 닉네임
- `get_block_count` - 블록 수

### 문자열
- `combine_something` - 문자열 결합
- `char_at` - 특정 위치 문자 (1-based)
- `substring` - 부분 문자열 (1-based start, end)
- `index_of_string` - 문자열 검색 (발견시 1-based 인덱스, 없으면 0)
- `replace_string` - 문자열 치환 (첫 번째만)
- `length_of_string` - 문자열 길이
- `change_string_case` - 대소문자 변환 (upper/lower)
- `count_of_string` - 문자열 포함 횟수
- `count_match_string` - 문자열 일치 횟수
- `reverse_of_string` - 문자열 뒤집기

### 소리
- `sound_something_with_block` - 소리 재생하기
- `sound_something_second_with_block` - 소리를 초 동안 재생하기
- `sound_from_to` - 소리 구간 재생하기
- `sound_something_wait_with_block` - 소리 재생하고 기다리기
- `sound_something_second_wait_with_block` - 소리를 초 동안 재생하고 기다리기
- `sound_from_to_and_wait` - 소리 구간 재생하고 기다리기
- `sound_volume_change` - 소리 크기 변경
- `sound_volume_set` - 소리 크기 정하기
- `get_sound_volume` - 소리 크기 값
- `sound_speed_change` - 소리 빠르기 변경
- `sound_speed_set` - 소리 빠르기 정하기
- `get_sound_speed` - 소리 빠르기 값
- `sound_silent_all` - 모든 소리 멈추기
- `play_bgm` - 배경음악 재생
- `stop_bgm` - 배경음악 멈추기
- `get_sound_duration` - 소리 길이

### 붓
- `start_drawing` - 그리기 시작
- `stop_drawing` - 그리기 멈추기
- `set_color` - 붓 색상 정하기
- `set_random_color` - 붓 랜덤 색상
- `set_fill_color` - 채우기 색상 정하기
- `change_thickness` - 굵기 변경
- `set_thickness` - 굵기 정하기
- `set_brush_color_to` - 붓 색상 설정
- `set_brush_thickness` - 붓 굵기 설정
- `change_brush_thickness` - 붓 굵기 변경
- `change_brush_transparency` - 붓 투명도 변경
- `set_brush_tranparency` / `set_brush_transparency` - 붓 투명도 정하기
- `start_fill` - 채우기 시작
- `stop_fill` - 채우기 멈추기
- `brush_stamp` - 도장 찍기
- `brush_erase_all` / `brush_clear` - 모두 지우기

### 변수
- `get_variable`, `set_variable`, `change_variable` - 변수 조작
- `show_variable`, `hide_variable` - 변수 표시 (화면에 변수명과 값 표시)
- `set_visible_answer` - 대답 표시/숨기기
- `ask_and_wait` - 묻고 기다리기
- `get_canvas_input_value` - 대답 값
- `get_func_variable`, `set_func_variable` - 함수 지역변수 조작

### 리스트
- `add_value_to_list` - 리스트에 값 추가
- `value_of_index_from_list` - 리스트에서 값 가져오기 (FIRST/LAST/RANDOM 지원)
- `length_of_list` - 리스트 길이
- `remove_value_from_list` - 리스트에서 값 제거 (FIRST/LAST/RANDOM 지원)
- `insert_value_to_list` - 리스트에 값 삽입 (FIRST/LAST/RANDOM 지원)
- `change_value_list_index` - 리스트 값 변경 (FIRST/LAST/RANDOM 지원)
- `is_included_in_list` - 리스트에 값 포함 여부
- `delete_all_list` - 리스트 비우기
- `show_list`, `hide_list` - 리스트 표시 (화면에 리스트명과 항목 표시)

### 글상자
- `text_write` - 글상자에 쓰기 (스텁)
- `text_append` - 글상자에 추가 (스텁)
- `text_prepend` - 글상자 앞에 추가 (스텁)
- `text_flush` - 글상자 비우기 (스텁)
- `text_read` - 글상자 읽기 (스텁)
- `text_change_effect` - 글상자 효과 변경 (스텁)
- `text_change_font` - 글상자 글꼴 변경 (스텁)
- `text_change_font_color` - 글상자 글자색 변경 (스텁)
- `text_change_bg_color` - 글상자 배경색 변경 (스텁)

**글상자 렌더링**: `objectType: 'textBox'` 오브젝트는 PixiJS `PIXI.Text` + `PIXI.Graphics` 배경으로 렌더링됩니다.
- 텍스트 정렬 (textAlign: 0=가운데, 1=왼쪽, 2=오른쪽) 지원
- `lineBreak` 모드: 텍스트 줄바꿈 + 오버플로 마스크 클리핑
- `bgColor: 'transparent'` 지원 (투명 배경)
- 글꼴 굵기 (font 문자열에서 'bold' 감지)

### 함수
- `func_<id>` - 사용자 정의 함수 호출
- `function_create` - 일반 함수 정의 (반환값 없음)
- `function_create_value` - 값 반환 함수 정의
- `stringParam_*`, `booleanParam_*` - 함수 파라미터

## 반복문 딜레이 처리 (Loop Tick Delay)

EntryJS와 동일한 실행 동작을 위해, 반복문은 **한 번 반복할 때마다 의도적인 딜레이(0.001초)**를 추가합니다.

### 작동 방식
1. **`repeat_basic` (N번 반복)**: 각 반복마다 내부 블록 실행 후 다음 틱으로 넘어감
2. **`repeat_inf` (무한 반복)**: 내부 블록 실행 후 다음 틱에서 다시 실행
3. **`repeat_while_true` (조건 반복)**: 조건이 참이면 내부 블록 실행 후 다음 틱에서 다시 확인
4. **`wait_until_true` (조건 대기)**: 조건이 거짓이면 다음 틱에서 다시 확인

### 이점
- 무한 루프가 브라우저를 멈추지 않음
- WASM 틱이 초당 최대 100만 회 실행되어 EntryJS 대비 훨씬 빠른 연산 속도 (동적 조정)
- 렌더링은 디스플레이 주사율(~60fps)에 맞춰 한 번만 수행되어 효율적
- 사용자가 실행 과정을 볼 수 있음

### 기술적 구현
- 각 쓰레드는 `$thread_N_loopCounter` 글로벌 변수로 반복 횟수를 추적
- 반복문은 `waiting`에 0.001초를 설정하고 PC를 유지하여 같은 블록에서 계속 실행
- 반복이 끝나면 `loopCounter`를 -1로 리셋하고 다음 블록으로 진행

## 실행 아키텍처 (Tick Rate)

WASM 로직은 고정 시간 간격(Fixed Timestep) 방식으로 실행되며, CPU 부하에 따라 초당 최대 1,000,000틱까지 동적으로 조정됩니다.

### 작동 방식
1. `requestAnimationFrame`으로 디스플레이 주사율(~60fps)에 맞춰 렌더 루프 실행
2. 각 렌더 프레임에서 경과된 실시간만큼의 WASM 틱을 일괄 실행
3. 각 틱의 deltaTime은 고정값 `1/1,000,000` = `0.000001`초
4. 프레임당 실행 가능한 최대 틱 수는 CPU 부하에 따라 동적으로 조정됨
5. 렌더링(PixiJS 스프라이트 업데이트)은 프레임당 1회만 수행

### 주요 상수 및 변수
- `TICK_RATE = 1,000,000` — 초당 최대 틱 수
- `FIXED_DT = 0.000001` — 틱당 고정 deltaTime
- `MAX_TICKS_PER_FRAME = 50,000` — 프레임당 최대 틱 수 상한
- `dynamicMaxTicks` — 실제 프레임당 최대 틱 수 (부하에 따라 100~50,000 사이에서 동적 조정)
- `TARGET_TICK_MS = 10` — 틱 실행에 할당할 목표 시간 (프레임 예산 ~16.7ms 중 ~10ms)
- `MAX_ACCUMULATOR = 0.05` — 최대 누적 시간 (탭 비활성화 복귀 시 과도한 catch-up 방지)

### 동적 틱 레이트 조정
- 매 프레임마다 실제 틱 실행 시간을 측정
- 틱당 소요 시간을 기반으로 목표 시간(10ms) 내에 실행 가능한 이상적 틱 수 계산
- 지수 평활법(exponential smoothing)으로 급격한 변동 방지: `dynamicMaxTicks = 0.8 * old + 0.2 * ideal`
- 최소 100틱, 최대 50,000틱 사이에서 조정

### EntryJS와의 속도 비교
- **반복문 1회 iteration**: EntryJS ~16.7ms vs WASM 1ms (0.001초 대기 = 1000틱)
- **wait_second(1)**: 정확히 1초 (1,000,000틱)
- 전체적으로 EntryJS 대비 약 16배 빠른 로직 실행 (CPU 부하에 따라 가변)

### 제한사항
- **중첩 반복문 지원**: 각 쓰레드당 루프 깊이별 별도 `loopCounter`를 사용하여 중첩 반복문을 지원합니다. 컴파일 시 최대 중첩 깊이를 분석하여 필요한 만큼의 카운터를 생성합니다.
- **음수 반복 횟수**: EntryJS는 에러를 발생시키지만, WASM 컴파일러는 0회 반복으로 처리합니다.
- **리스트 최대 용량**: 각 리스트당 최대 1,000,000개 요소 지원 (약 8MB/리스트)
- **리스트 값 타입**: 숫자와 문자열 값 모두 지원 (타입 태깅으로 구분)
- **문자열 풀**: 64MB 문자열 풀 (bump allocator, 가비지 컬렉션 없음)
- **숫자→문자열 변환**: JS 위임 (정수/소수 모두 지원)
- **문자열→숫자 변환**: WASM 내부 구현 (정수 및 소수점 지원)

## 복제본 (Clone) 기능

### 지원 블록
- `create_clone` - 자신 또는 특정 오브젝트의 복제본 생성
- `delete_clone` - 현재 복제본 삭제 (스레드 종료)
- `remove_all_clones` - 모든 복제본 삭제
- `when_clone_start` - 복제되었을 때 이벤트

### 작동 방식
1. `create_clone` 호출 시 WASM에서 `clone_requested` 플래그 설정 + JS `createCloneVisual` 호출
2. 렌더러에서 부모 엔티티의 현재 상태(위치/회전/크기/텍스처)를 복사한 **스냅샷 클론** 생성
3. 클론은 생성 시점의 위치에 고정됨 (정적 스냅샷)
4. `when_clone_start` 스레드는 부모 엔티티에서 실행됨
5. 장면 전환/재시작 시 모든 클론 자동 정리

### 제한사항
- **클론 독립 상태 미지원**: 현재 클론은 WASM에서 독립적인 엔티티 슬롯을 갖지 않으므로, 클론별 독립 이동/상태 변경은 불가능합니다. 클론은 생성 시점의 스냅샷으로 표시됩니다.
- **최대 클론 수**: 300개
- 향후 WASM 엔티티 풀을 확장하여 독립 클론 지원 예정

## 오브젝트 렌더링 순서 (Z-Order)

EntryJS와 동일한 렌더링 순서를 유지합니다:
- `objects` 배열의 첫 번째 오브젝트(`objects[0]`)가 **가장 위(앞)**에 렌더링됩니다
- `objects` 배열의 마지막 오브젝트가 **가장 아래(뒤)**에 렌더링됩니다
- PixiJS는 나중에 추가된 child가 위에 렌더링되므로, 컴파일러는 엔티티 컨테이너를 **역순으로** stage에 추가합니다

## 변수/리스트 표시 (Variable/List Display)

EntryJS와 동일하게 변수와 리스트를 화면에 표시합니다:

### 변수 표시
- `show_variable` / `hide_variable` 블록으로 변수 표시 제어
- 화면 좌측 상단에 주황색 박스로 표시
- 변수명과 현재 값이 함께 표시됨
- 여러 변수가 있으면 세로로 쌓임

### 리스트 표시
- `show_list` / `hide_list` 블록으로 리스트 표시 제어
- 화면 좌측 상단 (변수 오른쪽)에 박스로 표시
- 리스트명과 최대 5개 항목, 길이 표시
- 여러 리스트가 있으면 세로로 쌓임

## 말풍선 (Dialog/Speech Bubble)

EntryJS와 동일하게 오브젝트의 말풍선을 표시합니다:

### 지원 블록
- `dialog` - 말하기/생각하기 (계속 표시)
- `dialog_time` - 지정 시간 동안 말하기/생각하기
- `remove_dialog` - 말풍선 지우기

### 말풍선 스타일
- **말하기 (speak)**: 파란색 테두리의 말풍선 + 꼬리
- **생각하기 (think)**: 회색 테두리의 말풍선 + 작은 원

### 동작 방식
1. 오브젝트 위에 말풍선이 표시됨
2. 오브젝트가 이동하면 말풍선도 따라감
3. 화면 경계를 벗어나지 않도록 자동 조정
4. 텍스트 길이에 따라 말풍선 크기 자동 조정

## 브러시/채우기 (Brush/Fill) 처리

EntryJS와 동일한 브러시/채우기 동작을 구현합니다:
- **Brush**: 선 그리기 (`start_drawing`, `stop_drawing`)
- **Fill**: 도형 채우기 (`start_fill`, `stop_fill`)
- `set_random_color`: brush와 fill 모두 각각 다른 랜덤 색상으로 설정
- `stop_fill`: `closePath()` 호출 후 `endFill()` 호출 (EntryJS PIXIPaintAdaptor와 동일)

## 장면(Scene) 기능

### 작동 방식
1. 각 오브젝트는 특정 장면에 속합니다 (`obj.scene` 속성)
2. 시작 시 첫 번째 장면의 오브젝트만 보이고, `when_scene_start` 이벤트가 발생합니다
3. `start_scene` 또는 `start_neighbor_scene` 블록으로 장면 전환
4. 장면 전환 시 (EntryJS `resetSceneDuringRun` 동작과 동일):
   - **모든 실행 중인 쓰레드가 즉시 중지됩니다** (이전 장면뿐만 아니라 전체)
   - 이전 장면의 오브젝트들이 숨겨집니다
   - 새 장면의 오브젝트들이 보입니다
   - 모든 말풍선이 초기화됩니다
   - `when_scene_start` 이벤트가 새 장면의 오브젝트에 대해 발생합니다
5. `show`/`hide` 블록은 `visible`과 함께 `initialVisible`도 업데이트하여, 장면 전환 후 돌아왔을 때 올바른 표시 상태를 유지합니다

### 초기 장면 시작
- 프로그램 시작 시 `$init`에서 `sceneJustChanged`를 1로 설정합니다
- 첫 번째 틱에서 `when_scene_start`와 `when_run_button_click` 이벤트가 모두 발생합니다
- 이는 EntryJS에서 초기 장면의 `when_scene_start`가 실행되는 것과 동일합니다

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

### 엔티티 데이터 (1024+, 각 152 bytes)
- 0-7: x (f64)
- 8-15: y (f64)
- 16-23: rotation (f64)
- 24-31: direction (f64)
- 32-39: scaleX (f64)
- 40-47: scaleY (f64)
- 48-55: (reserved, formerly size)
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
- 120-127: width (f64) - 원본 이미지 너비 (바운딩 박스 계산용)
- 128-135: height (f64) - 원본 이미지 높이 (바운딩 박스 계산용)
- 136-143: scaleOriginX (f64) - 초기 scaleX 값 (크기 원래대로 복원용)
- 144-151: scaleOriginY (f64) - 초기 scaleY 값 (크기 원래대로 복원용)

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
│       ├── text.js       # 글상자 블록 핸들러
│       └── index.js
│   └── server-generator.js    # Express 서버 생성
└── examples/
    ├── sample-project.json
    └── test-functions.json  # 함수 테스트 프로젝트
```
