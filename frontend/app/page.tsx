'use client';

import Link from 'next/link';
import { ccc } from '@ckb-ccc/connector-react';
import { useEffect, useMemo, useState } from 'react';
import Wallet from './wallet';
import { listCountdownCells, extendSpecificCountdownCell, decodeCountdownState, closeSpecificCountdownCell, resolveLastPayerAddress } from './countdown-actions';
import { scriptToHash } from '@nervosnetwork/ckb-sdk-utils';

export default function Home() {
  const signer = ccc.useSigner();
  const { client } = ccc.useCcc();

  const [status, setStatus] = useState<string>('');
  const [page, setPage] = useState<number>(1);
  const [pageSize] = useState<number>(10);
  const [items, setItems] = useState<{ cell: any; state: ReturnType<typeof decodeCountdownState> }[]>([]);
  const [hasMore, setHasMore] = useState<boolean>(false);
  const [tipNumber, setTipNumber] = useState<bigint | null>(null);
  const [addedMap, setAddedMap] = useState<Record<string, string>>({});
  const [myLockHash, setMyLockHash] = useState<string | null>(null);
  const [myAddress, setMyAddress] = useState<string | null>(null);
  const [lastPayerAddrMap, setLastPayerAddrMap] = useState<Record<string, string | null>>({});

  const refresh = async () => {
    if (!client) return;
    try {
      const header = await client.getTipHeader();
      setTipNumber(BigInt(header.number));
    } catch (_e) {
      setTipNumber(null);
    }
    const res = await listCountdownCells(client, page, pageSize);
    setItems(res.items);
    setHasMore(res.hasMore);
  };

  useEffect(() => {
    setStatus('');
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, page]);

  // 每秒刷新一次当前区块高度
  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const header = await client.getTipHeader();
        if (!cancelled) setTipNumber(BigInt(header.number));
      } catch (_e) {
        if (!cancelled) setTipNumber(null);
      }
    };
    void tick();
    const id = setInterval(() => { void tick(); }, 1000);
    return () => { cancelled = true; clearInterval(id); };
  }, [client]);

  useEffect(() => {
    // Resolve last payer address for each listed cell
    let cancelled = false;
    const run = async () => {
      if (!client) return;
      const entries = await Promise.all(items.map(async ({ cell, state }) => {
        const key = formatOutPoint(cell);
        try {
          const addr = await resolveLastPayerAddress(client, cell, state.lastPayerLockHash);
          return [key, addr] as const;
        } catch (_e) {
          return [key, null] as const;
        }
      }));
      if (!cancelled) {
        const m: Record<string, string | null> = {};
        entries.forEach(([k, v]) => { m[k] = v; });
        setLastPayerAddrMap(m);
      }
    };
    void run();
    return () => { cancelled = true; };
  }, [items, client]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!signer || !client) { setMyLockHash(null); setMyAddress(null); return; }
      try {
        const addr = await signer.getRecommendedAddress();
        const lock = (await ccc.Address.fromString(addr, client)).script;
        const hash = scriptToHash(lock);
        if (!cancelled) { setMyLockHash(hash); setMyAddress(addr); }
      } catch (_e) {
        if (!cancelled) { setMyLockHash(null); setMyAddress(null); }
      }
    };
    void run();
    return () => { cancelled = true; };
  }, [signer, client]);

  const formatOutPoint = (cell: any) => `${cell.outPoint.txHash}:${cell.outPoint.index}`;
  const isExpired = (state: ReturnType<typeof decodeCountdownState>) => (tipNumber != null ? tipNumber >= state.endBlock : false);

  const BLOCK_SECONDS = 10;
  const formatDuration = (totalSeconds: number) => {
    const sec = Math.max(0, Math.floor(totalSeconds));
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (d > 0) return `${d}天 ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };
  return (
    <>
      <header className="sticky top-0 z-10 bg-white/80 backdrop-blur border-b">
        <div className="max-w-screen-md mx-auto flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-4">
            <Link href="/" className="font-bold text-2xl md:text-3xl tracking-tight no-underline">CountdownCell</Link>
            <nav className="flex items-center gap-4 md:gap-6 text-base md:text-lg">
              <Link href="/" className="hover:underline">首页</Link>
              <Link href="/create" className="hover:underline">创建</Link>
              <Link href="/about" className="hover:underline">关于</Link>
            </nav>
          </div>
          <div>
            <Wallet />
          </div>
        </div>
      </header>

      <main className="max-w-screen-md mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-4">
          <div className="text-xl font-semibold">倒计时 Cells</div>
          <button className="rounded-full border px-4 py-2" onClick={() => { setStatus(''); void refresh(); }} disabled={!client}>刷新</button>
        </div>
        <div className="text-sm text-gray-600 mb-2">当前区块: {tipNumber ? tipNumber.toString() : '-'}</div>

        {status ? <div className="mb-2 text-red-600 break-all">{status}</div> : null}

        <div className="space-y-3">
          {items.length === 0 ? (
            <div className="text-sm text-gray-500">暂无数据</div>
          ) : (
            items.map(({ cell, state }) => {
              const key = formatOutPoint(cell);
              const expired = isExpired(state);
              const remainingBlocks = tipNumber != null && state.endBlock > tipNumber ? (state.endBlock - tipNumber) : BigInt(0);
               const countdownSec = Number(remainingBlocks) * BLOCK_SECONDS;
              return (
                <div key={key} className="border rounded-2xl p-4">
                  <div className="text-xs text-gray-500">{key}</div>
                  <div className="grid grid-cols-2 gap-2 text-sm mt-2">
                    {/* <div>version: {state.version}</div> */}
                    <div>结束区块: {state.endBlock.toString()}</div>
                    <div className="text-right">倒计时: {tipNumber != null ? formatDuration(countdownSec) : '-'}</div>
                    <div className="col-span-2 break-all">
                      {lastPayerAddrMap[key]
                        ? <>最后付款人地址: {lastPayerAddrMap[key]}{myAddress && lastPayerAddrMap[key] && lastPayerAddrMap[key].toLowerCase() === myAddress.toLowerCase() ? ' (我)' : ''}</>
                        : <>最后付款人锁哈希: {state.lastPayerLockHash}</>}
                    </div>
                    <div>每 CKB 增加区块数: {state.rateBlocksPerCkb}</div>
                    <div>最小追加 CKB: {ccc.fixedPointToString(state.minAddShannons)}</div>
                    <div>当前Cell 容量: {ccc.fixedPointToString(cell.cellOutput.capacity)} CKB</div>
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <div className={expired ? 'text-green-700' : 'text-blue-700'}>
                      {expired ? '已到期' : '未到期'}
                    </div>
                    {!expired ? (
                      <div className="flex items-center gap-2">
                        <input
                          className="rounded-full border px-3 py-1 text-sm"
                          placeholder="追加 CKB"
                          type="number"
                          inputMode="numeric"
                          min={1}
                          step={1}
                          value={addedMap[key] ?? ''}
                          onInput={(e) => {
                            let v = e.currentTarget.value;
                            v = v.replace(/[^0-9]/g, '');
                            setAddedMap((m) => ({ ...m, [key]: v }));
                          }}
                        />
                        <button
                          className="rounded-full bg-blue-600 text-white px-4 py-1 text-sm disabled:opacity-50"
                          disabled={!signer}
                          onClick={async () => {
                            if (!signer) return;
                            try {
                              const txHash = await extendSpecificCountdownCell(signer, cell, addedMap[key] ?? '');
                              setStatus(`延长成功: ${txHash}`);
                              void refresh();
                            } catch (e: any) {
                              setStatus(`延长失败: ${e?.message ?? String(e)}`);
                            }
                          }}
                        >延长</button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <button
                          className="rounded-full bg-green-700 text-white px-4 py-1 text-sm disabled:opacity-50"
                          disabled={!signer || !myLockHash || myLockHash.toLowerCase() !== state.lastPayerLockHash.toLowerCase()}
                          onClick={async () => {
                            if (!signer) return;
                            try {
                              const txHash = await closeSpecificCountdownCell(signer, cell);
                              setStatus(`领取成功: ${txHash}`);
                              void refresh();
                            } catch (e: any) {
                              setStatus(`领取失败: ${e?.message ?? String(e)}`);
                            }
                          }}
                        >领取</button>
                        {!myLockHash || (myLockHash.toLowerCase() !== state.lastPayerLockHash.toLowerCase()) ? (
                          <span className="text-xs text-gray-500">仅最后出价者可领取</span>
                        ) : null}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between mt-6">
          <button
            className="rounded-full border px-4 py-2 disabled:opacity-50"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >上一页</button>
          <div className="text-sm text-gray-600">第 {page} 页</div>
          <button
            className="rounded-full border px-4 py-2 disabled:opacity-50"
            disabled={!hasMore}
            onClick={() => setPage((p) => p + 1)}
          >下一页</button>
        </div>

        <div className="my-12 text-gray-500 italic">
          <hr className="h-px my-4 bg-gray-200 border-0 dark:bg-gray-700" />
          该模板基于{' '}
          <a href="https://github.com/RetricSu/offckb" target="_blank" rel="noopener noreferrer" className="underline">offckb</a>
        </div>
      </main>
    </>
  );
}
