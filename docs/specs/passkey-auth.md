# FR-01 パスキー認証 — 実装仕様

対応要件: `docs/requirements.md` FR-01 / §9.1（users, passkey_credentials, webauthn_challenges, sessions）/ §10.1–10.3 / §12 / NFR-03。
本書は要件を実装単位に噛み砕いたもので、要件と矛盾する場合は `docs/requirements.md` が正。

---

## 0. 最初に共有したい結論（よくある誤解）

| 誤解 | 実際 |
|---|---|
| 「パスキーでもメールアドレスは必要」 | **不要**。WebAuthn がユーザー識別に使うのはサーバー発行のランダム ID（`user.id`）だけ。本プロダクトはメール・パスワード・ユーザー名入力を一切持たない |
| 「ログイン時にユーザー名を入れて、そのユーザーのパスキーを探す」 | **やらない**。Discoverable Credential（resident key）を使い、`allowCredentials` を空で送る。どのパスキーで入るかはブラウザ/OS のダイアログでユーザーが選ぶ |
| 「Supabase Auth のパスキー機能を使う」 | **使わない**。Supabase は Postgres としてのみ使う。Relying Party は `apps/api`（Hono + `@simplewebauthn/server`） |
| 「パスキーは 1 ユーザー 1 つ」 | **複数登録できる**。むしろ復旧手段がメールに無い分、複数登録を推奨する。最後の 1 つは削除不可 |
| 「パスキーを失ったらメールで復旧」 | **復旧手段は無い**（仕様どおり）。同期パスキー（iCloud Keychain / Google Password Manager）と複数登録が唯一の緩和策 |
| 「チャレンジはメモリに持てばよい」 | **DB に持つ**。Vercel Functions はリクエストごとに別インスタンスになりうるため、`webauthn_challenges` テーブルで 1 回限り・5 分失効で管理する |
| 「localhost と本番で同じ設定」 | RP ID / Origin は**環境ごとに違う**。`WEBAUTHN_RP_ID` / `WEBAUTHN_ORIGIN` で切り替える（§6 参照） |
| 「セッションは JWT」 | **DB 管理の不透明トークン**。Cookie 値 = `sessions.id`（32 byte ランダム）。JWT は使わない |

---

## 1. 用語

| 用語 | 意味 |
|---|---|
| パスキー | WebAuthn の Discoverable Credential（resident key）を指す一般名。生体認証 / PIN で使う公開鍵クレデンシャル |
| RP（Relying Party） | 認証を受ける側 = 本サービス（`apps/api`）。**RP ID** はその「ドメイン」（例: `localhost`, `dopamin.vercel.app`）。スキームやポートは含まない |
| Origin | ブラウザが検証に使う完全なオリジン（例: `http://localhost:3000`, `https://dopamin.vercel.app`）。RP ID と整合していなければブラウザが拒否する |
| user handle (`user.id`) | RP がパスキー作成時に渡す不透明なバイト列（≤64 byte）。認証時に authenticator から `userHandle` として返ってくる。**本プロダクトでは `users.id`（UUID）をバイト化したものを使う** |
| challenge | リプレイ防止のためサーバーが毎回発行するランダム値。1 回使ったら破棄 |
| attestation | 登録時に authenticator が返す「新しい公開鍵」の応答 |
| assertion | 認証時に authenticator が返す「秘密鍵で署名した」応答 |
| signature counter | authenticator が署名ごとに増やすカウンタ。保存値以下ならクローンの疑いで拒否（AC-01-4） |

---

## 2. 全体像

```mermaid
flowchart LR
  subgraph Browser["apps/web (ブラウザ)"]
    UI[ログイン / サインアップ画面]
    WB["lib/webauthn.ts<br/>@simplewebauthn/browser"]
  end
  subgraph API["apps/api (Hono, Vercel Functions)"]
    R["routes/auth.ts"]
    S["services/auth.ts<br/>@simplewebauthn/server"]
    M["middleware: originCheck / session"]
  end
  DB[("Postgres<br/>users / passkey_credentials /<br/>webauthn_challenges / sessions")]
  UI --> WB -->|"/api/v1/auth/*"| R --> S --> DB
  M --> R
```

責務の境界:

- **`apps/web`**: `navigator.credentials.*` の呼び出し（`startRegistration` / `startAuthentication`）と画面遷移だけ。検証ロジックを持たない。
- **`apps/api`**: options 生成・検証・DB 更新・セッション発行。秘密情報と検証はすべてここ。
- **`packages/shared`**: リクエスト/レスポンスの zod スキーマ（`displayName` の 1〜32 文字制約など）。
- **`packages/db`**: 4 テーブルの Drizzle スキーマ。

---

## 3. フロー

### 3.1 サインアップ（新規ユーザー + 最初のパスキー）

```mermaid
sequenceDiagram
  participant U as ユーザー
  participant B as apps/web
  participant A as apps/api
  participant D as Postgres
  U->>B: 表示名を入力して「パスキーを作成」
  B->>A: POST /auth/passkey/register/options { displayName }
  A->>A: userId = uuid() を事前採番
  A->>D: INSERT webauthn_challenges(type=registration, user_id, display_name, expires_at=+5min)
  A-->>B: { challengeId, options: PublicKeyCredentialCreationOptionsJSON }
  B->>U: startRegistration(options) → OS の生体認証 / PIN
  B->>A: POST /auth/passkey/register/verify { challengeId, response }
  A->>D: SELECT challenge WHERE id AND expires_at > now()
  A->>A: verifyRegistrationResponse(expectedChallenge, expectedOrigin, expectedRPID)
  A->>D: TX: INSERT users / INSERT passkey_credentials / DELETE challenge / INSERT sessions
  A-->>B: 200 { user } + Set-Cookie: dopamin_session
  B->>U: /dashboard へ遷移
```

ポイント:

- `users` 行はこの時点まで**作らない**（verify 成功時に作る）。途中離脱しても空ユーザーが残らない。
- `options.user.id` には事前採番した UUID を使う。`options.user.name` / `displayName` には `displayName` をそのまま入れる（OS のパスキー一覧に出る名前になる）。
- `excludeCredentials` は空（新規なので）。

### 3.2 ログイン

```mermaid
sequenceDiagram
  participant U as ユーザー
  participant B as apps/web
  participant A as apps/api
  participant D as Postgres
  U->>B: 「パスキーでログイン」ボタン（入力欄なし）
  B->>A: POST /auth/passkey/login/options {}
  A->>D: INSERT webauthn_challenges(type=authentication, user_id=NULL)
  A-->>B: { challengeId, options } (allowCredentials: [])
  B->>U: startAuthentication(options) → OS がパスキー一覧を表示、選択 + 生体認証
  B->>A: POST /auth/passkey/login/verify { challengeId, response }
  A->>D: SELECT challenge / SELECT passkey_credentials WHERE id = response.id
  A->>A: verifyAuthenticationResponse(credential.publicKey, credential.counter, ...)
  alt newCounter <= stored counter (かつ どちらかが 0 でない)
    A->>A: ログ出力（クローン疑い）
    A-->>B: 401 UNAUTHORIZED
  else OK
    A->>D: TX: UPDATE counter, last_used_at / DELETE challenge / INSERT sessions
    A-->>B: 200 { user } + Set-Cookie
  end
```

ポイント:

- **誰がログインするかサーバーは事前に知らない**。`response.id`（credential ID）で `passkey_credentials` を引き、その `user_id` がログインユーザー。
- `response.response.userHandle` が返ってきた場合は `credential.user_id` と一致することを確認する（不一致は 401）。
- `userVerification: 'preferred'` なので、検証側の `requireUserVerification` は `false`。

### 3.3 パスキー追加登録（ログイン済み）

サインアップと同じ流れだが:

- `session` ミドルウェア必須。`user.id` は `c.get('user').id`。
- `excludeCredentials` に**そのユーザーの既存 credential ID をすべて**渡す（同じ authenticator での二重登録を防ぐ）。
- verify 成功時は `passkey_credentials` の INSERT のみ（users / sessions は触らない）。

### 3.4 削除・ログアウト

- `DELETE /auth/passkeys/:id`: 自分のものでなければ 404。残り 1 件なら 409（`LAST_PASSKEY`）。
- `POST /auth/logout`: `sessions` から該当行を削除し、Cookie を `Max-Age=0` で消す。

---

## 4. API 契約

ベースパス `/api/v1`。エラーは §10.3 の統一形式。

| メソッド | パス | 認証 | Body | 200 レスポンス |
|---|---|---|---|---|
| POST | `/auth/passkey/register/options` | 不要 | `{ displayName: string(1..32) }` | `{ challengeId: uuid, options: PublicKeyCredentialCreationOptionsJSON }` |
| POST | `/auth/passkey/register/verify` | 不要 | `{ challengeId, response: RegistrationResponseJSON }` | `{ user: { id, displayName } }` + Set-Cookie |
| POST | `/auth/passkey/login/options` | 不要 | `{}` | `{ challengeId, options: PublicKeyCredentialRequestOptionsJSON }` |
| POST | `/auth/passkey/login/verify` | 不要 | `{ challengeId, response: AuthenticationResponseJSON }` | `{ user }` + Set-Cookie |
| POST | `/auth/logout` | 要 | — | `{ ok: true }` + Cookie 削除 |
| GET | `/auth/me` | 要 | — | `{ user }` |
| GET | `/auth/passkeys` | 要 | — | `{ passkeys: [{ id, name, deviceType, backedUp, createdAt, lastUsedAt }] }` |
| POST | `/auth/passkeys/register/options` | 要 | `{}` | 登録 options（`excludeCredentials` 付き） |
| POST | `/auth/passkeys/register/verify` | 要 | `{ challengeId, response }` | `{ passkey }` |
| DELETE | `/auth/passkeys/:id` | 要 | — | `{ ok: true }` |

`*JSON` 型は `@simplewebauthn/types` のものをそのまま使う。zod スキーマは `packages/shared/src/schemas/auth.ts` に置き、`response` は最低限 `{ id: string, rawId: string, type: 'public-key', response: object }` の形を検証してから SimpleWebAuthn に渡す。

エラーコード（§10.3 に追加）:

| code | status | 場面 |
|---|---|---|
| `CHALLENGE_NOT_FOUND` | 400 | challengeId 不明・期限切れ・使用済み |
| `VERIFICATION_FAILED` | 401 | attestation / assertion 検証失敗、counter 後退、userHandle 不一致 |
| `CREDENTIAL_NOT_FOUND` | 401 | ログイン時に credential ID が DB に無い（別環境で登録したパスキー等） |
| `LAST_PASSKEY` | 409 | 最後の 1 件を削除しようとした |

---

## 5. SimpleWebAuthn の呼び出し規約

```ts
// 登録 options
generateRegistrationOptions({
  rpName: env.WEBAUTHN_RP_NAME,
  rpID: env.WEBAUTHN_RP_ID,
  userID: uuidToBytes(userId),          // Uint8Array, ≤64 byte
  userName: displayName,
  userDisplayName: displayName,
  attestationType: 'none',
  excludeCredentials: existing.map(c => ({ id: c.id, transports: c.transports })),
  authenticatorSelection: {
    residentKey: 'required',            // Discoverable にする
    userVerification: 'preferred',
  },
});

// 登録 verify
verifyRegistrationResponse({
  response,
  expectedChallenge: challenge.challenge,
  expectedOrigin: env.WEBAUTHN_ORIGIN,
  expectedRPID: env.WEBAUTHN_RP_ID,
  requireUserVerification: false,
});
// → registrationInfo.credential.{ id, publicKey, counter, transports }, credentialDeviceType, credentialBackedUp, aaguid を保存

// 認証 options
generateAuthenticationOptions({
  rpID: env.WEBAUTHN_RP_ID,
  allowCredentials: [],                 // 空 = Discoverable
  userVerification: 'preferred',
});

// 認証 verify
verifyAuthenticationResponse({
  response,
  expectedChallenge: challenge.challenge,
  expectedOrigin: env.WEBAUTHN_ORIGIN,
  expectedRPID: env.WEBAUTHN_RP_ID,
  credential: { id: cred.id, publicKey: cred.publicKey, counter: Number(cred.counter), transports: cred.transports },
  requireUserVerification: false,
});
// → authenticationInfo.newCounter を保存
```

ブラウザ側は `@simplewebauthn/browser` の `startRegistration({ optionsJSON })` / `startAuthentication({ optionsJSON })` を `apps/web/src/lib/webauthn.ts` でラップし、`browserSupportsWebAuthn()` が false なら非対応案内を出す（AC-01-5）。

バージョンは `@simplewebauthn/server` / `browser` ともに **v13 系**に固定する（v13 で引数名が `optionsJSON` / `credential` に変わっているため、古い記事のコードをそのまま貼らない）。

---

## 6. 環境変数と RP ID / Origin

| 環境 | `WEBAUTHN_RP_ID` | `WEBAUTHN_ORIGIN` | 備考 |
|---|---|---|---|
| ローカル | `localhost` | `http://localhost:3000` | `localhost` は http でも secure context 扱い。**`127.0.0.1` でアクセスすると RP ID 不一致で失敗する**ので必ず `localhost` |
| Vercel Preview | そのプレビューの host | `https://<host>` | URL が毎回変わるのでパスキーはプレビューごとに登録し直す（許容） |
| 本番 | `dopamin.vercel.app`（独自ドメイン取得後は変更） | `https://dopamin.vercel.app` | `*.vercel.app` は Public Suffix なのでサブドメイン共有不可。web と api は**同一オリジン**（`next.config.ts` の rewrites で `/api/*` → api）に揃える |

- `WEBAUTHN_RP_NAME` は表示用（例: `ドパ民.com`）。
- Origin は Cookie（`Secure`, `SameSite=Lax`）と `originCheck` ミドルウェアでも使うため、3 者（Cookie / WebAuthn / originCheck）が必ず同じオリジンを指す。
- 開発時は `pnpm dev` で web(:3000) が api(:8787) に rewrites するので、ブラウザから見えるオリジンは常に `:3000`。api 側の `WEBAUTHN_ORIGIN` に `:8787` を書かない。

---

## 7. データの扱い

- `passkey_credentials.id`: SimpleWebAuthn が返す base64url 文字列をそのまま PK にする。
- `passkey_credentials.public_key`: `Uint8Array` を `bytea` に保存。**更新しない**（改竄検出）。
- `passkey_credentials.counter`: `bigint`。多くのプラットフォーム認証器は常に 0 を返すので、**「保存値 > 0 かつ newCounter ≤ 保存値」のときだけ拒否**する（両方 0 は正常）。
- `passkey_credentials.name`: 初期値は AAGUID から推定（不明なら `deviceType` に応じて「このデバイス」/「同期パスキー」）。ユーザーが設定画面で変更可。
- `webauthn_challenges`: 検証成功時に必ず削除。期限切れ行は verify 時に `expires_at < now()` を掃除するか、DELETE を cron に任せる（P2）。
- `sessions.id`: `crypto.getRandomValues` 32 byte → base64url。Cookie 値そのもの。7 日、残り 3 日を切ったらアクセス時に延長（§10.2）。

---

## 8. 画面（apps/web）

| パス | 内容 |
|---|---|
| `/login` | ボタン 1 つ「パスキーでログイン」＋「初めての方はこちら」リンク。**テキスト入力欄なし**（AC-01-2）。非対応ブラウザは案内文に差し替え |
| `/signup` | 表示名入力（1〜32 文字、zod で共有）→「パスキーを作成」 |
| `/settings/passkeys` | 一覧（名前 / 作成日 / 最終利用日 / 同期の有無）、「パスキーを追加」、各行の削除。1 件のときは削除ボタン無効＋説明 |

未認証で `/dashboard` 以下へ来た場合は `proxy.ts`（旧 middleware）で Cookie の有無だけ見て `/login` へリダイレクト。実際の有効性検証は API 側（AC-01-3）。

---

## 9. テスト観点

| 種別 | 内容 |
|---|---|
| unit（api） | challenge 期限切れ → 400 / counter 後退 → 401 + ログ / userHandle 不一致 → 401 / 最後の 1 件削除 → 409 |
| unit（shared） | `displayName` 0 文字・33 文字・空白のみ → reject |
| 契約 | SimpleWebAuthn の `verify*` はモックし、API ルートが DB を正しく更新することを検証（`users`・`passkey_credentials`・`sessions` の行数、challenge 削除） |
| 手動（AC-01-1） | Chrome / Safari / Edge 最新で サインアップ → ログアウト → 再ログイン。`localhost` で実施 |
| 手動（AC-01-4） | 同一 credential で counter を DB 上で手動で大きくしてからログイン → 拒否されることを確認 |

WebAuthn の実ブラウザ動作は自動化しない（Playwright の virtual authenticator は P2）。

---

## 10. 実装順序（1 PR 想定、`feat/fr-01-passkey-auth`）

1. `packages/db`: 4 テーブルの Drizzle スキーマ + マイグレーション
2. `packages/shared`: auth 用 zod スキーマ・エラーコード
3. `apps/api`: env 検証 → `services/auth.ts`（options / verify / session）→ `routes/auth.ts` → `session` / `originCheck` ミドルウェア → unit テスト
4. `apps/web`: `lib/webauthn.ts` → `/login` `/signup` → `proxy.ts` のリダイレクト → `/settings/passkeys`
5. 手動で AC-01-1〜5 を確認し、結果を PR に記載

---

## 11. 未確定・要確認

- 本番の RP ID（独自ドメインを取るか）【要確認】— 取る場合は登録済みパスキーが全て無効になるため、デモ前に確定する。
- AAGUID → 名前の対応表をどこまで持つか（`passkeydeveloper/passkey-authenticator-aaguids` の JSON を同梱するか、最小限にするか）。
