# SAGA-U 微生物進化シミュレーター

リアルタイムで微生物の進化と相互作用を可視化するWebアプリケーション。

## プロジェクト構成

```
gabaithon2026-spring-saga-u-5/
├── backend/              # Pythonバックエンド（シミュレーションエンジン）
│   ├── core.py          # RK4数値積分カーネル
│   ├── engine.py        # 株管理・イベント処理
│   ├── manager.py       # シミュレーション管理
│   ├── main.py          # WebSocketサーバー
│   ├── test_backend.py  # 回帰テストスイート
│   └── verify_defaults.py # デフォルト値検証
├── src/                 # Next.jsフロントエンド
│   ├── app/            # ページとレイアウト
│   └── components/     # UIコンポーネント
└── docs/               # ドキュメント
    └── 変数チートシート.md  # 変数リファレンス
```

## セットアップ

### 必要な環境
- **Node.js** 18以降
- **Python** 3.9以降
- **npm/pnpm/yarn**（どれか1つ）

### インストール

#### 1. フロントエンド
```bash
npm install
# または
pnpm install
# または
yarn install
```

#### 2. バックエンド
```bash
# 仮想環境作成（推奨）
python -m venv .venv

# Windows
.venv\Scripts\activate

# macOS/Linux
source .venv/bin/activate

# 依存パッケージインストール
pip install numpy numba fastapi uvicorn websockets
```

## 起動方法

### 開発環境

#### ターミナル1: バックエンド起動
```bash
cd backend
python main.py
```
→ WebSocketサーバーが `ws://localhost:8765` で起動

#### ターミナル2: フロントエンド起動
```bash
npm run dev
# または
pnpm dev
# または
yarn dev
```
→ Webアプリが `http://localhost:3000` で起動

## テスト

### バックエンドテスト
```bash
cd backend

# 回帰テスト（全機能検証）
python test_backend.py

# デフォルト値検証（50,000ステップ）
python verify_defaults.py
```

## デフォルト設定（安定デモ用プリセット）

現在のデフォルト設定は**50,000ステップ以上の安定動作を検証済み**です。

### 重要なパラメータ

| パラメータ | 値 | 説明 |
|-----------|---|------|
| **初期株** |
| `mu_max` | 0.4 | 最大成長速度 |
| `Ks` | 1.0 | モノド定数 |
| `N0` | 500.0 | 初期個体数 |
| `T_opt` | 25.0 | 最適温度（常温） |
| `pH_opt` | 7.0 | 最適pH（中性） |
| **環境** |
| `S0` | 500.0 | 初期基質濃度 |
| `Y` | 100.0 | 収率（高収率で基質消費抑制） |
| `temp` | 25.0 | 環境温度 |
| `auto_feed_enabled` | True | 離散的自動供給使用 |
| `feed_per_batch` | 200.0 | バッチごとの基質追加量 |
| `feed_max_s` | 10000.0 | 基質上限 |

**注意**: このプリセットは実世界の生物学的値とは分離されており、シミュレーションの安定性と初心者向けの使いやすさを優先しています。

詳細は [`docs/変数チートシート.md`](docs/変数チートシート.md) を参照してください。

## 主要ファイル

### バックエンド
- **`backend/core.py`**: ODE系とRK4数値積分（Numba JIT最適化）
- **`backend/engine.py`**: 株のライフサイクル管理（spawn, division, reap）
- **`backend/manager.py`**: シミュレーション全体の制御、環境パラメータ管理
- **`backend/main.py`**: FastAPIベースのWebSocketサーバー

### フロントエンド
- **`src/app/page.tsx`**: メインページ（シミュレーション画面）
- **`src/app/login/page.tsx`**: ログイン画面
- **`src/components/ui/`**: shadcn/uiコンポーネント

## ドキュメント

- **[変数チートシート](docs/変数チートシート.md)**: 全変数の詳細リファレンス
  - 状態変数（N, S, T, pH）
  - 株の形質（traits配列）
  - 環境パラメータ（env_params）
  - WebSocketメッセージ型
  - 安定デモ用プリセット

## トラブルシューティング

### バックエンドが起動しない
- Python依存パッケージを確認: `pip list | grep -E "numpy|numba|fastapi"`
- ポート8765が使用中か確認: `netstat -an | grep 8765`

### フロントエンドが接続できない
- バックエンドが起動しているか確認
- WebSocketのURL (`ws://localhost:8765`) が正しいか確認

### シミュレーションがすぐに絶滅する
- `backend/manager.py` と `backend/engine.py` のデフォルト値が安定デモ用プリセットになっているか確認
- `verify_defaults.py` を実行して設定を検証

## 開発の前に

このプロジェクトはNext.js（フロントエンド）とPython（バックエンド）のハイブリッド構成です。変更を加える際は：

1. **バックエンド変更後**: `test_backend.py` でテスト実行
2. **重要な変更**: `verify_defaults.py` で安定性確認
3. **パラメータ調整**: `docs/変数チートシート.md` も更新

---

Built with [Next.js](https://nextjs.org) and Python (Numba)
