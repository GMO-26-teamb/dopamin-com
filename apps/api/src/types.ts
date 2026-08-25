/** Hono の環境型。requestId ミドルウェアが設定する変数を全ルートで共有する。 */
export type AppEnv = {
  Variables: {
    requestId: string;
  };
};
