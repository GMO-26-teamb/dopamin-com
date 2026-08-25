// Drizzle スキーマ（docs/requirements.md §9）。テーブルごとにファイルを分け、ここから re-export する。
// 認証方式（パスキー / パスワード）確定後に passkey_credentials / webauthn_challenges を追加する。
export * from "./contacts";
export * from "./domains";
export * from "./sessions";
export * from "./users";
