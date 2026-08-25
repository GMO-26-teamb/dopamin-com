import { MockRegistryAdapter, RegistryError } from "@dopamin/registry";
import type {
  CreateInput,
  DeleteResult,
  DomainInfo,
  RegistryId,
  RenewInput,
  TransferResult,
  UpdateInput,
} from "@dopamin/shared";

/** 更新系コマンドのタイムアウトの再現モード。 */
export type TimeoutMode =
  /** タイムアウトさせない（通常動作） */
  | "off"
  /** コマンドはレジストリに到達して成立したが、応答がタイムアウトした */
  | "after-success"
  /** コマンドがレジストリに到達せずタイムアウトした（状態は変わらない） */
  | "before-reach";

/**
 * AC-06-2 / AC-18-2（タイムアウト時の info 照合）検証用モック。
 * 更新系コマンドだけを REGISTRY_TIMEOUT で失敗させ、参照系（info / check /
 * transferQuery 等)は正常に動かすことで、「タイムアウト後に info で結果を
 * 照合する」経路をテストできるようにする。
 */
export class TimeoutMockAdapter extends MockRegistryAdapter {
  timeoutMode: TimeoutMode = "off";
  /** 実レジストリの既知制約: status 更新は成功応答でも反映されない。 */
  ignoreStatusUpdates = false;

  constructor(id: RegistryId) {
    super({ id });
  }

  private async withTimeout<T>(
    command: string,
    op: () => Promise<T>,
  ): Promise<T> {
    if (this.timeoutMode === "off") {
      return op();
    }
    if (this.timeoutMode === "after-success") {
      await op();
    }
    throw new RegistryError({
      code: "REGISTRY_TIMEOUT",
      registry: this.id,
      message: `${command}: レジストリが応答しませんでした（テスト用シミュレーション）`,
    });
  }

  override create(input: CreateInput): Promise<DomainInfo> {
    return this.withTimeout("create", () => super.create(input));
  }

  override renew(name: string, input: RenewInput): Promise<DomainInfo> {
    return this.withTimeout("renew", () => super.renew(name, input));
  }

  override update(name: string, input: UpdateInput): Promise<DomainInfo> {
    const effectiveInput = this.ignoreStatusUpdates
      ? {
          ...input,
          addStatuses: undefined,
          removeStatuses: undefined,
        }
      : input;
    return this.withTimeout("update", () => super.update(name, effectiveInput));
  }

  override delete(name: string): Promise<DeleteResult> {
    return this.withTimeout("delete", () => super.delete(name));
  }

  override restore(name: string): Promise<DomainInfo> {
    return this.withTimeout("restore", () => super.restore(name));
  }

  override transferRequest(
    name: string,
    authCode: string,
  ): Promise<TransferResult> {
    return this.withTimeout("transfer:request", () =>
      super.transferRequest(name, authCode),
    );
  }
}
