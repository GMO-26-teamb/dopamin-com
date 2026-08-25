import { serverApi } from "@/lib/server-api";

// API の状態を毎回取得するため静的化しない
export const dynamic = "force-dynamic";

async function fetchHealth(): Promise<string> {
  try {
    const res = await serverApi.api.v1.health.$get();
    if (!res.ok) return `error (${res.status})`;
    const body = await res.json();
    return body.status;
  } catch {
    return "unreachable";
  }
}

export default async function Home() {
  const status = await fetchHealth();
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
      <h1 className="font-semibold text-3xl">ドパ民.com</h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        考えるのは楽しく、設定は考えなくていい。
      </p>
      <p className="font-mono text-sm">API health: {status}</p>
    </main>
  );
}
