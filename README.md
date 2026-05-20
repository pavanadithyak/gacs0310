# GACS — Generative Affective Coordinate System

감성 좌표 기반 영상 콘텐츠 분석·생성·실험 파이프라인.

YouTube 영상의 감성을 다차원 좌표로 매핑하고, 특정 감성 좌표를 타겟으로 영상을 생성한 뒤, A/B 테스트를 통해 CTR·시청시간 등 성과를 검증한다.

- **이론 기반**: "From Visuals to Value" (JBR 2025) — Expectancy Violation Theory
- **회사**: GenTA Inc.
- **환경**: Ubuntu WSL2, RTX 4090, Python 3.12

---

## Quick Start

```bash
# 1. 가상환경
python -m venv .venv && source .venv/bin/activate

# 2. 의존성
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121
pip install -r requirements.txt

# 3. 환경변수
cp .env.example .env
# .env 파일에 ANTHROPIC_API_KEY 설정

# 4. 확인
python run_pipeline.py info
python -m pytest tests/ -q
```

---

## 프로젝트 구조

```
gacs0310/
│
├── src/                            핵심 파이프라인 모듈
├── scripts/                        유틸리티 스크립트 (카테고리별)
├── data/                           모든 데이터
├── research/                       연구 결과 (날짜별)
├── docs/                           참고 문서
├── notebooks/                      레거시 Jupyter 노트북
└── tests/                          유닛 테스트
```

### `src/` — 핵심 파이프라인

| 파일 | 역할 |
|---|---|
| `dataset_builder.py` | **Stage 1**: 원본 영상 → 씬 감지 → 키프레임 추출 → Vision AI 라벨링 → SBERT 임베딩 |
| `video_generator.py` | **Stage 2**: 감성 클러스터링 → 씬 선택 → MoviePy 영상 합성 |
| `experiment_runner.py` | **Stage 3**: YouTube 업로드 → 메트릭 수집 → 통계 분석 |
| `labeling_backend.py` | 듀얼 라벨링 백엔드 (Claude Vision API / LLaVA 로컬) |
| `coordinate_analyzer.py` | **Stage 4**: PCA 좌표계 분석 |

### `scripts/` — 유틸리티 스크립트

| 폴더 | 내용 | 파일 수 |
|---|---|---|
| `data_collection/` | YouTube 영상 다운로드, 씬 메타데이터 생성 | 5 |
| `labeling/` | 멀티모델 라벨링 (Claude+GPT-4o+Gemini), 실패 재시도 | 3 |
| `coordinate/` | PCA/KMeans 학습, 축 해석, 안정성 검증, 클러스터 비교 | 16 |
| `generation/` | 좌표 기반 영상 생성 (cluster/traverse/target 모드) | 1 |
| `migration/` | Kushi 데이터 → GACS 스키마 변환 | 1 |

### `data/` — 데이터

| 폴더 | 내용 | 크기 |
|---|---|---|
| `raw_videos/` | 원본 MP4 파일 (4 카테고리: trailers, ads, emotional shorts, animations) | 1.9GB, 246개 (gitignored) |
| `scenes/` | 씬별 키프레임 이미지 (JPG) | 308MB, 3,507개 |
| `annotations/` | 라벨링 결과 캐시 (JSON). `*_multi.json`=3모델 합의, `*_embeddings.json`=임베딩 | 108MB, 4,222개 |
| `embeddings/gacs_dataset.csv` | **메인 데이터셋**. 3,355씬 × (mood_1~5 + style_1~3 + object_1~5 + mood_embedding 384d) | 28MB |
| `models/` | 학습된 좌표계. `gacs_coordinate_system_v2.pkl` = PCA(14) + KMeans(k=5) + scaler | 96KB |
| `intermediate/` | 연구 중간 산출물. step2(임베딩), step3(모델비교), step4(클러스터), step5(축발견) | 36MB |
| `kushi_original/` | 이전 개발자(Kushi) 원본 데이터. Gemini Flash 라벨링, 1,275씬 | 8MB |
| `generated/` | 생성된 영상 (gacs/baseline/coordinate 하위 폴더) | gitignored |

### `research/` — 연구 결과

| 폴더 | 내용 |
|---|---|
| `2026-03-10_coordinate_discovery/` | v1 좌표계 (1,275씬 기반). PCA, 클러스터링, 2D/3D scatter |
| `2026-03-12_model_comparison/` | 임베딩 모델 5종 비교 (L6v2, distilroberta 등) |
| `2026-03-12_coordinate_stabilization/` | 축 안정성 검증 (bootstrap, split-half, category dropout) |
| `2026-03-12_per_model_coordinates/` | Claude/GPT-4o/Gemini 각각의 좌표계 비교 |
| `2026-03-16_coordinate_v2/` | **v2 좌표계 (3,355씬, 최종)**. axis_interpretation, cluster_profiles, stability |
| `reports/` | 연구 리포트 (멀티모델 비교, 좌표계 분석, 종합 보고서) |

### `docs/` — 참고 문서

| 파일 | 내용 |
|---|---|
| `GACS_Roadmap_2026.pdf` | 프로젝트 로드맵 |
| `영준이형_From visuals to value.pdf` | 이론 기반 논문 (JBR 2025) |
| `prompts/` | Claude 프롬프트 이력 (연구 설계, 마이그레이션, 임베딩, 감정분석) |

### `notebooks/` — 레거시

Sprint 1에서 사용한 원본 Jupyter 노트북. `src/`로 모듈화 완료되어 참고용으로만 보관.

### `tests/` — 유닛 테스트

91개 테스트 (100% pass). `python -m pytest tests/ -q`

---

## 현재 연구 진행 상황

### Phase 1: 좌표계 구축 — 완료

- 3,355개 씬 라벨링 (3-모델 합의: Claude Sonnet 4 + GPT-4o + Gemini Flash)
- emotion-english-distilroberta-base 768d 임베딩 (normalized)
- PCA 14 components → **7개 안정 축** (bootstrap cosine sim > 0.85)
- KMeans **k=5 클러스터**: Joyful(745), Somber(346), Serene(759), Mysterious(662), Intense(843)
- Russell Circumplex Model 정합: PC1=Valence (r=0.76), PC2=Arousal (r=0.57)

### Phase 2: 좌표 기반 생성 제어 — 진행 중

- PC1 축 트래버설 영상 생성 완료 (5단계)
- 좌표 지정 → 가장 가까운 씬 선택 → 영상 합성 파이프라인 구축

### Phase 3: YouTube A/B 테스트 — 미착수

### Phase 4: 좌표 최적화 — 미착수

---

## 파이프라인 실행

```bash
# 전체 파이프라인
python run_pipeline.py all --quick-test

# 개별 단계
python run_pipeline.py dataset      # Stage 1: 라벨링
python run_pipeline.py generate     # Stage 2: 영상 생성
python run_pipeline.py upload       # Stage 3: YouTube 업로드
python run_pipeline.py metrics      # 메트릭 수집
python run_pipeline.py analyze      # 통계 분석

# 좌표 기반 영상 생성
python scripts/generation/coordinate_video_generator.py --mode cluster
python scripts/generation/coordinate_video_generator.py --mode traverse --axis PC1 --steps 5
python scripts/generation/coordinate_video_generator.py --mode target --pc1 10 --pc2 -5
```

---

## License

Research use only. GenTA Inc.