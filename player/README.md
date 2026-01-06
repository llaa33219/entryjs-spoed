# Entry WASM Player

고성능 WebAssembly 기반 Entry 프로젝트 실행기

## 특징

- **WASM 기반 실행 엔진**: Rust로 작성된 고성능 블록 실행 엔진
- **전체화면 플레이어**: 개발 환경 없이 작품 실행에만 집중
- **playentry.org 연동**: URL 파라미터로 작품 ID를 전달받아 자동 로드
- **JS 폴백 지원**: WASM 로드 실패 시 JavaScript 엔진으로 폴백

## 사용법

### 1. 로컬에서 실행

```bash
# 빌드 (WASM 엔진 컴파일)
cd wasm-engine
./build.sh

# 웹 서버 실행 (예: Python)
cd ../player
python -m http.server 8080
```

### 2. 작품 실행

브라우저에서 다음 URL로 접속:
```
http://localhost:8080/?id=작품ID
```

예시:
```
http://localhost:8080/?id=693d755f18a22a7b8b7e7d41
```

### 3. 키보드 단축키

- `Space`: 시작/일시정지
- `R`: 다시 시작
- `F`: 전체화면

## 프로젝트 구조

```
player/
├── index.html          # 메인 플레이어 HTML
├── wasm/               # 빌드된 WASM 파일
│   ├── entry_wasm.js   # JS 바인딩
│   ├── entry_wasm_bg.wasm  # WASM 바이너리
│   └── ...
└── README.md

wasm-engine/
├── Cargo.toml          # Rust 프로젝트 설정
├── src/
│   ├── lib.rs          # 메인 엔진
│   ├── entity.rs       # 엔티티(스프라이트) 관리
│   ├── executor.rs     # 블록 실행 로직
│   └── blocks.rs       # 블록 타입 정의
└── build.sh            # 빌드 스크립트
```

## 지원 블록 타입

### 움직임 (Moving)
- `move_direction` - 방향으로 이동
- `move_x`, `move_y` - X/Y 좌표 이동
- `locate_x`, `locate_y`, `locate_xy` - 좌표 설정
- `rotate_relative`, `rotate_absolute` - 회전
- `direction_relative`, `direction_absolute` - 방향 설정

### 생김새 (Looks)
- `show`, `hide` - 보이기/숨기기
- `change_to_next_shape` - 다음 모양
- `set_effect`, `change_effect`, `clear_effect` - 효과
- `set_scale_size`, `change_scale_size` - 크기

### 흐름 (Flow)
- `wait_second` - 기다리기
- `repeat_basic`, `repeat_inf` - 반복
- `_if`, `if_else` - 조건문
- `stop_repeat`, `stop_object` - 정지

### 판단 (Judgement)
- `boolean_basic_operator` - 비교 연산
- `boolean_and_or` - 논리 AND/OR
- `boolean_not` - 논리 NOT

### 계산 (Calc)
- `calc_basic` - 사칙연산
- `calc_rand` - 무작위 수

### 변수 (Variable)
- `set_variable`, `change_variable` - 변수 설정/변경
- `get_variable` - 변수 값 가져오기

## 성능

WASM 엔진은 JavaScript 엔진 대비:
- **블록 실행**: ~3-5배 빠름
- **계산 로직**: ~5-10배 빠름
- **메모리 효율**: 더 예측 가능한 메모리 사용

## 제한사항

현재 버전에서 지원하지 않는 기능:
- 사운드 재생 (JS 브릿지 필요)
- 하드웨어 연동
- AI/ML 블록
- 복잡한 그래픽 효과 (필터 등)

## 개발

### WASM 엔진 수정

```bash
cd wasm-engine

# 수정 후 빌드
./build.sh

# 또는 직접 실행
source ~/.cargo/env
wasm-pack build --target web --out-dir ../player/wasm
```

### 새 블록 추가

1. `src/blocks.rs`에 블록 타입 추가
2. `src/executor.rs`의 `execute_block` 함수에 실행 로직 추가
3. 필요 시 `src/entity.rs`에 엔티티 메서드 추가

## Railway 배포

### 자동 배포 (권장)

1. [Railway](https://railway.app)에 로그인
2. "New Project" → "Deploy from GitHub repo" 선택
3. 이 저장소 연결
4. 자동으로 Dockerfile을 감지하여 배포됨

### 수동 배포

```bash
# Railway CLI 설치
npm install -g @railway/cli

# 로그인
railway login

# 새 프로젝트 생성 및 배포
railway init
railway up
```

### 배포 후 사용

배포된 URL에 `?id=작품ID`를 추가하여 접속:
```
https://your-app.railway.app/?id=693d755f18a22a7b8b7e7d41
```

### 환경 변수

Railway가 자동으로 `PORT` 환경 변수를 설정합니다. 추가 설정 불필요.

## 라이선스

MIT License
