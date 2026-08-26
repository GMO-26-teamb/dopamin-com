// corpus-denylist.mjs の型宣言。生成スクリプト（node 直実行）と
// src 側のテストの両方から同じ判定を使うために置いている。
export declare const EXCLUDE_KEYWORDS: readonly string[];
export declare const EXCLUDE_ALLOWLIST: ReadonlySet<string>;
export declare function isExcludedName(sld: string): boolean;
