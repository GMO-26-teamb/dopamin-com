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
 * EPP 相当の 8 操作 + transferQuery / transferApprove / transferReject / transferCancel +
 * authCode に加え、疎通確認用の hello() を持つ。
 * レジストリ固有のフィールド名・日付形式・エラーコードは各実装の中で吸収する。
 */
export interface RegistryAdapter {
  readonly id: RegistryId;
  /**
   * 自レジストラ ID（`X-Registrar-Id` に送る値）。
   * 移管の direction（IN / OUT）は `TransferResult.requestingRegistrarId` /
   * `actingRegistrarId` との比較で導出するため、アダプタの外から参照できる必要がある
   * （ADR-0002 決定 3）。将来 `DomainInfo.sponsoringRegistrarId` が埋まれば
   * スポンサー判定（§6.5 の移管 OUT 検知）にも使う。
   */
  readonly registrarId: string;
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
   * 移管の承認。losing（自レジストラがスポンサー）側だけが実行できる。
   * 承認するとドメインは申請側へ移り、自レジストラの保有から外れる（AC-12-4 / AC-12-5）。
   */
  transferApprove(name: string): Promise<TransferResult>;
  /** 移管の拒否。losing 側だけが実行できる（AC-12-4）。 */
  transferReject(name: string): Promise<TransferResult>;
  /** 自分が出した移管申請の取消。gaining（申請側）が承認前にだけ実行できる。 */
  transferCancel(name: string): Promise<TransferResult>;
  /**
   * 移管 OUT 用 AuthCode の取得。`info` には authInfo が含まれないため
   * `rotate-auth-info`（再生成）で取得する。呼ぶたびに値が変わる点に注意。
   */
  authCode(name: string): Promise<string>;
}
