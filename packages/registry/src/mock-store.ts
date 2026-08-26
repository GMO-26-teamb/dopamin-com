import type {
  ClientStatus,
  PollMessageType,
  RegistrantProfile,
  TransferResult,
} from "@dopamin/shared";

/**
 * mock アダプタの状態の永続化（docs/requirements.md §11.1「インメモリ + DB」/ §16.1）。
 *
 * `MockRegistryAdapter` の状態はプロセス内 Map なので、Vercel Functions では
 * インスタンスが変わったりコールドスタートしたりすると消える。`REGISTRY_MODE=mock` の
 * 本番デモ（FR-16 のサンプル投入、他チームが捕まらない場合のフォールバック）では
 * 「create したのに次のリクエストの info が 2303」になって成立しない。
 *
 * ストアを注入するとリクエストごとに状態を読み書きする（既定は注入なし = 従来のプロセス内 Map）。
 */

/** 進行中の移管申請（`MockRegistryAdapter` の内部状態）。 */
export interface MockPendingTransfer {
  requestingRegistrarId: string;
  actingRegistrarId: string;
  requestedAt: string;
  actByAt: string;
}

/** Poll キューに積まれた通知 1 件（正規化前の内部表現）。 */
export interface MockPollMessage {
  id: string;
  type: PollMessageType;
  domainName: string;
  queuedAt: string;
  transfer: TransferResult;
}

/** mock が保持するドメイン 1 件の状態。 */
export interface MockDomainState {
  name: string;
  sponsoringRegistrarId: string;
  registrant: string;
  contacts: Record<string, string>;
  nameservers: string[];
  clientStatuses: ClientStatus[];
  crDate: string;
  upDate: string | null;
  exDate: string;
  trDate: string | null;
  rgpStatuses: string[];
  authInfo: string;
  pendingDelete: boolean;
  pendingTransfer: MockPendingTransfer | null;
}

/**
 * mock の状態一式。JSON 化できるプレーン値だけで構成する
 * （そのまま jsonb に入れて読み戻せるように）。
 */
export interface MockStateSnapshot {
  domains: MockDomainState[];
  /** レジストラ ID → Poll キュー（FIFO）。 */
  queues: Record<string, MockPollMessage[]>;
  /** コンタクト ID → プロファイル（#72）。 */
  contacts: Record<string, RegistrantProfile>;
  /** Poll メッセージ ID の採番カウンタ。 */
  nextMessageId: number;
}

/**
 * 状態の読み書き。**スナップショット全体**を 1 回で往復する。
 *
 * 行単位の細かい API にしないのは、mock の各操作が複数のドメイン・キューをまたいで
 * 状態を変える（移管の確定は両当事者のキューに積む）ため。デモ用途で扱う件数は
 * 小さいので、単純さと正しさを優先する。
 *
 * **同時実行は後勝ち**（トランザクションを張らない）。実レジストリの代替ではなく
 * デモ・検証用の再現なので、ここは割り切る。
 */
export interface MockStateStore {
  /** 保存済みの状態。未保存なら null（アダプタは空の状態から始める）。 */
  load(): Promise<MockStateSnapshot | null>;
  save(snapshot: MockStateSnapshot): Promise<void>;
}

/**
 * プロセス内に閉じたストア（テスト用）。
 * 「ストアを挟んでも挙動が変わらない」ことを確かめるのに使う。
 */
export function createInMemoryMockStore(): MockStateStore {
  let saved: MockStateSnapshot | null = null;
  return {
    load: () =>
      Promise.resolve(
        saved === null
          ? null
          : (JSON.parse(JSON.stringify(saved)) as MockStateSnapshot),
      ),
    save: (snapshot) => {
      saved = JSON.parse(JSON.stringify(snapshot)) as MockStateSnapshot;
      return Promise.resolve();
    },
  };
}
