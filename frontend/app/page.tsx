'use client';

import Link from 'next/link';
import { ccc } from '@ckb-ccc/connector-react';
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import Wallet from './wallet';
import { listCountdownCells, extendSpecificCountdownCell, decodeCountdownState } from './countdown-actions';
import { scriptToHash } from '@nervosnetwork/ckb-sdk-utils';
import { UDT_CONFIG } from '../src/udt-config';

export default function Home() {
  const signer = ccc.useSigner();
  const { client } = ccc.useCcc();

  const [status, setStatus] = useState<ReactNode>('');
  const [page, setPage] = useState<number>(1);
  const [pageSize] = useState<number>(10);
  const [items, setItems] = useState<{ cell: any; state: ReturnType<typeof decodeCountdownState> }[]>([]);
  const [hasMore, setHasMore] = useState<boolean>(false);
  const [tipNumber, setTipNumber] = useState<bigint | null>(null);
  const [myLockHash, setMyLockHash] = useState<string | null>(null);
  const [myAddress, setMyAddress] = useState<string | null>(null);
  // Mint 弹窗状态
  const [mintOpen, setMintOpen] = useState<boolean>(false);
  const [mintTarget, setMintTarget] = useState<{ cell: any; state: ReturnType<typeof decodeCountdownState> } | null>(null);
  const [mintBlocks, setMintBlocks] = useState<number>(0);
  // 移除“最后付款人”解析与展示逻辑

  // 将 FairLaunchCell（symbol=FLC 的 xUDT）置顶显示
  const flTypeHashes = useMemo(() => {
    const hashes = Object.entries(UDT_CONFIG)
      .filter(([, info]) => info.symbol === 'FLC')
      .map(([hash]) => hash);
    return new Set(hashes);
  }, []);

  const sortedItems = useMemo(() => {
    const pinned: { cell: any; state: ReturnType<typeof decodeCountdownState> }[] = [];
    const others: { cell: any; state: ReturnType<typeof decodeCountdownState> }[] = [];
    for (const it of items) {
      const th = it.cell?.cellOutput?.type ? scriptToHash(it.cell.cellOutput.type) : null;
      if (th && flTypeHashes.has(th as `0x${string}`)) pinned.push(it); else others.push(it);
    }
    const sortedOthers = others.slice().sort((a, b) => {
      const ea = a.state.endBlock;
      const eb = b.state.endBlock;
      if (ea === eb) return 0;
      return ea > eb ? -1 : 1;
    });
    return [...pinned, ...sortedOthers];
  }, [items, flTypeHashes]);

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

  // 已移除：列表不再展示最后付款人地址/锁哈希

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
  // 将原子单位（u128）按默认 decimals 展示为人类可读（默认 8 位）
  const formatU128Display = (val: bigint, decimals: number = 8) => {
    const d = Math.max(0, decimals | 0);
    let base = BigInt(1);
    for (let i = 0; i < d; i++) base *= BigInt(10);
    const intPart = (val / base).toString();
    const fracRaw = (val % base).toString().padStart(d, '0');
    const frac = fracRaw.replace(/0+$/, '');
    return frac.length ? `${intPart}.${frac}` : intPart;
  };

  // 保留两位小数的格式化（字符串）
  const formatDecimalStrToFixed2 = (s: string) => {
    if (!s || typeof s !== 'string') return '0.00';
    const neg = s.startsWith('-');
    const raw = neg ? s.slice(1) : s;
    const [intStr = '0', fracRaw = ''] = raw.split('.');
    const frac3 = (fracRaw + '00').slice(0, 3); // 至少 3 位用于四舍五入
    let two = Number(frac3.slice(0, 2));
    const third = Number(frac3.slice(2, 3));
    if (third >= 5) two += 1;
    let intBig = BigInt(intStr);
    if (two >= 100) { intBig += BigInt(1); two = 0; }
    const out = two === 0 ? intBig.toString() : `${intBig.toString()}.${String(two).padStart(2, '0')}`;
    return neg ? '-' + out : out;
  };

  // 保留两位小数的格式化（原子单位 BigInt）
  const formatAtomicToFixed2DecimalStr = (val: bigint, decimals: number = 8) => {
    const d = Math.max(0, decimals | 0);
    let base = BigInt(1);
    for (let i = 0; i < d; i++) base *= BigInt(10);
    const scaled = val * BigInt(100);
    const rounded = (scaled + base / BigInt(2)) / base; // 四舍五入到 2 位
    const intPart = (rounded / BigInt(100)).toString();
    const frac2 = (rounded % BigInt(100)).toString().padStart(2, '0');
    return frac2 === '00' ? intPart : `${intPart}.${frac2}`;
  };

  // 统一入口：既支持 BigInt 原子值，也支持 fixedPoint 容量
  const formatToFixed2DecimalStr = (val: any, decimals: number = 8) => {
    if (typeof val === 'bigint') return formatAtomicToFixed2DecimalStr(val, decimals);
    try {
      const s = ccc.fixedPointToString(val);
      return formatDecimalStrToFixed2(s);
    } catch (_e) {
      const s = typeof val === 'string' ? val : String(val ?? '0');
      return formatDecimalStrToFixed2(s);
    }
  };

  // 解码 cell.outputData 中的 u128（池内 XUDT 原子单位）
  const fromU128LEHex = (hex: string): bigint => {
    const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
    const bytes = clean.match(/../g)?.map((b) => b) ?? [];
    const be = bytes.slice().reverse().join('');
    return BigInt('0x' + be);
  };

  // 当前弹窗目标可分发的最大区块数（受池余额与 minPoolXudt 限制）
  const mintMaxBlocks = useMemo(() => {
    if (!mintTarget) return 0;
    try {
      const currentAmt = fromU128LEHex(mintTarget.cell.outputData as string);
      const available = currentAmt - BigInt(mintTarget.state.minPoolXudt);
      if (available <= BigInt(0)) return 0;
      const per = BigInt(mintTarget.state.xudtPerBlock);
      if (per <= BigInt(0)) return 0;
      const maxBlocks = available / per; // floor
      const n = Number(maxBlocks);
      return Number.isFinite(n) && n > 0 ? Math.min(n, 100000) : 0;
    } catch (_e) {
      return 0;
    }
  }, [mintTarget]);

  // 需要支付的 CKB（整数），确保满足 minAdd 与 extBlocks 计算的向下取整
  const mintNeededCkb = useMemo(() => {
    if (!mintTarget) return 0;
    const rate = Number(mintTarget.state.rateBlocksPerCkb || 0);
    if (!rate) return 0;
    const minAdd = Math.ceil(Number(ccc.fixedPointToString(mintTarget.state.minAddShannons)) || 0);
    const byBlocks = Math.ceil((mintBlocks || 0) / rate);
    return Math.max(minAdd, byBlocks);
  }, [mintTarget, mintBlocks]);

  // 当弹窗目标变化时，初始化滑块选择为 1 CKB 对应的区块数，并不超过最大可分发区块
  useEffect(() => {
    if (mintOpen && mintTarget) {
      const rate = Number(mintTarget.state.rateBlocksPerCkb || 0);
      const defaultBlocks = rate > 0 ? rate : 0;
      const max = mintMaxBlocks || defaultBlocks;
      setMintBlocks(Math.min(defaultBlocks, max));
    }
  }, [mintOpen, mintTarget, mintMaxBlocks]);
  return (
    <>
      <header className="sticky top-0 z-10 bg-white/80 backdrop-blur border-b">
        <div className="max-w-screen-xl mx-auto flex items-center justify-between px-4 md:px-6 py-3">
          <div className="flex items-center gap-4">
            <Link href="/" className="font-bold text-2xl md:text-3xl tracking-tight no-underline">FairLaunchCell</Link>
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

      <main className="max-w-screen-xl mx-auto px-4 md:px-6 py-6">
        <div className="flex items-center justify-between mb-4">
          <div className="text-xl font-semibold">FairLaunch Cells</div>
          <button className="rounded-full border px-4 py-2" onClick={() => { setStatus(''); void refresh(); }} disabled={!client}>刷新</button>
        </div>
        <div className="text-sm text-gray-600 mb-2">当前区块: {tipNumber ? tipNumber.toString() : '-'}</div>

        {status ? <div className="mb-2 text-red-600 break-all">{status}</div> : null}

        <div className="overflow-x-auto">
          {sortedItems.length === 0 ? (
            <div className="text-sm text-gray-500">暂无数据</div>
          ) : (
            <table className="w-full text-sm border rounded-2xl overflow-hidden">
              <thead className="bg-gray-50">
                <tr className="text-left">
                  <th className="px-3 py-2">Token</th>
                  <th className="px-3 py-2">结束区块</th>
                  <th className="px-3 py-2">倒计时</th>
                  <th className="px-3 py-2">每块铸币</th>
                  <th className="px-3 py-2">池最低</th>
                  {/* <th className="px-3 py-2">每 CKB 增块</th> */}
                  {/* <th className="px-3 py-2">最小追加</th> */}
                  <th className="px-3 py-2">池子(CKB)/(XUDT)</th>
                  <th className="px-3 py-2 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {sortedItems.map(({ cell, state }) => {
                  const key = formatOutPoint(cell);
                  const expired = isExpired(state);
                  const remainingBlocks = tipNumber != null && state.endBlock > tipNumber ? (state.endBlock - tipNumber) : BigInt(0);
                  const countdownSec = Number(remainingBlocks) * BLOCK_SECONDS;
                  const typeHash = cell?.cellOutput?.type ? scriptToHash(cell.cellOutput.type) : null;
                  const udt = typeHash ? UDT_CONFIG[(typeHash as `0x${string}`)] : undefined;
                  const isPinned = typeHash ? flTypeHashes.has(typeHash as `0x${string}`) : false;
                  const displaySymbol = udt?.symbol ?? 'XUDT';
                  const displayDecimals = udt?.decimal;
                  return (
                    <tr key={key} className={`${isPinned ? 'bg-red-50' : ''}`}>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">

                          {typeHash ? (
                            <a
                              href={`https://testnet.explorer.nervos.org/xudt/${typeHash}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-blue-600 hover:underline"
                            ><span className="font-medium">{displaySymbol}</span></a>
                          ) : <span className="font-medium">{displaySymbol}</span>}
                          {isPinned ? (
                            <span className="px-2 py-0.5 text-xs rounded-full bg-red-100 text-red-700 border border-red-300">置顶</span>
                          ) : null}
                        </div>
                        <div className="text-[10px] text-gray-500">{key}</div>
                      </td>
                      <td className="px-3 py-2">{state.endBlock.toString()}</td>
                      <td className="px-3 py-2">{tipNumber != null ? formatDuration(countdownSec) : '-'}</td>
                      <td className="px-3 py-2">{formatU128Display(state.xudtPerBlock, displayDecimals)} {displaySymbol}</td>
                      <td className="px-3 py-2">{formatU128Display(state.minPoolXudt, displayDecimals)} {displaySymbol}</td>
                      {/* <td className="px-3 py-2">{state.rateBlocksPerCkb}</td> */}
                      {/* <td className="px-3 py-2">{ccc.fixedPointToString(state.minAddShannons)} CKB</td> */}
                      <td className="px-3 py-2">{formatToFixed2DecimalStr(cell.cellOutput.capacity as bigint, 8)}/{formatToFixed2DecimalStr(fromU128LEHex(cell.outputData as string), (displayDecimals ?? 8))}</td>
                      <td className="px-3 py-2 text-right">
                        {!expired ? (
                          <button
                            className="rounded-full bg-blue-600 text-white px-4 py-1 text-sm disabled:opacity-50"
                            disabled={!signer}
                            onClick={() => {
                              setMintTarget({ cell, state });
                              // 默认选择 1 CKB 对应的区块数
                              const rate = Number(state.rateBlocksPerCkb || 0);
                              const defaultBlocks = rate > 0 ? rate : 0;
                              setMintBlocks(Math.min(defaultBlocks, mintMaxBlocks || defaultBlocks));
                              setMintOpen(true);
                            }}
                          >Mint</button>
                        ) : (
                          <Link
                            className="rounded-full border px-4 py-1 text-sm"
                            href={`/swap?txHash=${cell.outPoint.txHash}&index=${cell.outPoint.index}`}
                          >Swap</Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
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

      {/* Mint 弹窗 */}
      {mintOpen && mintTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-lg w-[90%] max-w-md p-4">
            <div className="flex items-center justify-between">
              <div className="font-semibold">Mint</div>
              <button className="text-sm px-2 py-1" onClick={() => setMintOpen(false)}>关闭</button>
            </div>
            <div className="mt-3 text-sm">
              <div className="text-gray-600">Mint区块数</div>
              <input
                type="range"
                min={0}
                max={mintMaxBlocks}
                value={mintBlocks}
                onChange={(e) => setMintBlocks(Number(e.currentTarget.value))}
                className="w-full"
              />
              <div className="mt-1 flex items-center justify-between">
                <div>区块: {mintBlocks}</div>
                <div>需要 CKB: {mintNeededCkb}</div>
              </div>
              <div className="mt-1 text-gray-600">
                预计获得: {formatU128Display(BigInt(mintBlocks) * BigInt(mintTarget.state.xudtPerBlock), (mintTarget.cell?.cellOutput?.type ? (UDT_CONFIG[scriptToHash(mintTarget.cell.cellOutput.type) as `0x${string}`]?.decimal) : undefined))} {(mintTarget.cell?.cellOutput?.type ? (UDT_CONFIG[scriptToHash(mintTarget.cell.cellOutput.type) as `0x${string}`]?.symbol ?? 'XUDT') : 'XUDT')}
              </div>
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button className="rounded-full border px-4 py-2" onClick={() => setMintOpen(false)}>取消</button>
              <button
                className="rounded-full bg-blue-600 text-white px-4 py-2 disabled:opacity-50"
                disabled={!signer || mintNeededCkb <= 0}
                onClick={async () => {
                  if (!signer || !mintTarget) return;
                  try {
                    const txHash = await extendSpecificCountdownCell(signer, mintTarget.cell, String(mintNeededCkb));
                    setStatus(
                      <span>
                        Mint 成功: {""}
                        <a
                          href={`https://testnet.explorer.nervos.org/transaction/${txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline text-blue-600"
                        >{txHash}</a>
                      </span>
                    );
                    setMintOpen(false);
                    setMintTarget(null);
                    void refresh();
                  } catch (e: any) {
                    setStatus(`Mint 失败: ${e?.message ?? String(e)}`);
                  }
                }}
              >确认 Mint</button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
