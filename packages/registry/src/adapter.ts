import type {
  CheckResult,
  CreateInput,
  DeleteResult,
  DomainInfo,
  HelloResult,
  RegistryId,
  RenewInput,
  TransferResult,
  UpdateInput,
} from "@dopamin/shared";

/**
 * レジストリアダプタのインターフェース（docs/requirements.md §11.1）。
 * EPP 相当の 8 操作 + transferQuery + authCode に加え、疎通確認用の hello() を持つ。
 * レジストリ固有のフィールド名・日付形式・エラーコードは各実装の中で吸収する。
 */
export interface RegistryAdapter {
  readonly id: RegistryId;
  /** Swagger のバージョン or 取得日。/health に表示する。 */
  readonly specVersion: string;

  /** 疎通確認（`GET /sessions/hello`）。対応 TLD を返す。 */
  hello(): Promise<HelloResult>;
  check(names: string[]): Promise<CheckResult[]>;
  info(name: string): Promise<DomainInfo>;
  create(input: CreateInput): Promise<DomainInfo>;
  renew(name: string, input: RenewInput): Promise<DomainInfo>;
  update(name: string, input: UpdateInput): Promise<DomainInfo>;
  delete(name: string): Promise<DeleteResult>;
  restore(name: string): Promise<DomainInfo>;
  transferRequest(name: string, authCode: string): Promise<TransferResult>;
  /**
   * 移管状態の照会。レジストリに transfer query 専用エンドポイントが無いため、
   * `info` のステータス（pendingTransfer）から導出する。
   */
  transferQuery(name: string): Promise<TransferResult>;
  /**
   * 移管 OUT 用 AuthCode の取得。`info` には authInfo が含まれないため
   * `rotate-auth-info`（再生成）で取得する。呼ぶたびに値が変わる点に注意。
   */
  authCode(name: string): Promise<string>;
}
