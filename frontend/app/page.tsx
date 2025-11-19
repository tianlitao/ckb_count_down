'use client';

import Link from 'next/link';
import { ccc } from '@ckb-ccc/connector-react';
import { useEffect, useMemo, useState } from 'react';
import Wallet from './wallet';
import { createLotteryBet, listLotteryCells, decodeLotteryBetData, settleLotteryMyWins, decodeCountdownState, getCellCreationBlockNumber, checkBetResultByTipHeader } from './countdown-actions';
import { scriptToHash } from '@nervosnetwork/ckb-sdk-utils';

export default function Home() {
  const signer = ccc.useSigner();
  const { client } = ccc.useCcc();

  const [status, setStatus] = useState<string>('');
  const [lotStatus, setLotStatus] = useState<string>('');
  const [page, setPage] = useState<number>(1);
  const [pageSize] = useState<number>(10);
  const [items, setItems] = useState<{ cell: any; state: ReturnType<typeof decodeCountdownState> }[]>([]);
  const [hasMore, setHasMore] = useState<boolean>(false);
  const [tipNumber, setTipNumber] = useState<bigint | null>(null);
  const [tipHash, setTipHash] = useState<string | null>(null);
  const [tipNibble, setTipNibble] = useState<number | null>(null);
  const [betNibbles, setBetNibbles] = useState<Record<string, number | null>>({});
  const [betTargetHashes, setBetTargetHashes] = useState<Record<string, string | null>>({});
  const [betCreatedBlocks, setBetCreatedBlocks] = useState<Record<string, bigint | null>>({});
  const [betTargetNumbers, setBetTargetNumbers] = useState<Record<string, bigint | null>>({});
  const [addedMap, setAddedMap] = useState<Record<string, string>>({});
  const [myLockHash, setMyLockHash] = useState<string | null>(null);
  const [myAddress, setMyAddress] = useState<string | null>(null);
  const [lastPayerAddrMap, setLastPayerAddrMap] = useState<Record<string, string | null>>({});
  const [lotBets, setLotBets] = useState<any[]>([]);
  const [lotPots, setLotPots] = useState<any[]>([]);
  const [platformAddress] = useState<string>('ckt1qrfrwcdnvssswdwpn3s9v8fp87emat306ctjwsm3nmlkjg8qyza2cqgqq8zvwkzd4t6agl826lj7f5e04epyrs6u9ykejvss');
  const [houseEdgeBp] = useState<number>(700);
  const [confirmations] = useState<number>(1);
  const [stakeCkb] = useState<string>('1000');
  const [guess, setGuess] = useState<0 | 1>(0);

  function formatErr(e: any): string {
    try {
      if (e == null) return '未知错误';
      if (typeof e === 'string') return e;
      if (typeof e === 'object') {
        const d = (e as any).data;
        if (typeof d === 'string' && d.length > 0) return d;
        if ('message' in (e as any)) {
          const m = (e as any).message;
          if (typeof m === 'string' && m.length > 0) {
            const lower = m.toLowerCase();
            if (lower.includes('cannot read properties of undefined')) {
              return '未知错误：错误对象不合法，请刷新页面或重试';
            }
            return m;
          }
        }
      }
      try { return JSON.stringify(e); } catch { return String(e); }
    } catch { return String(e); }
  }

  const canSettle = useMemo(() => {
    if (!myLockHash) return false;
    let win = 0;
    for (const c of lotBets) {
      const key = `${c.outPoint.txHash}:${c.outPoint.index}`;
      let info: any = null;
      try { info = decodeLotteryBetData(c.outputData); } catch { continue; }
      const nib = betNibbles[key];
      const isWin = nib != null ? ((info.guess === 0 && nib < 8) || (info.guess === 1 && nib >= 8)) : null;
      if (isWin && info.bettorLockHash.toLowerCase() === myLockHash.toLowerCase()) win++;
    }
    return win > 0;
  }, [lotBets, betNibbles, myLockHash]);

  const refresh = async () => {
    if (!client) return;
    try {
      const header = await client.getTipHeader();
      setTipNumber(BigInt(header.number));
      setTipHash(header.hash);
      const nib = parseInt(header.hash.slice(-1), 16);
      setTipNibble(Number.isNaN(nib) ? null : nib);
    } catch (_e) {
      setTipNumber(null);
      setTipHash(null);
      setTipNibble(null);
    }
    try {
      const addr = await ccc.Address.fromString(platformAddress, client);
      const ph = scriptToHash(addr.script) as `0x${string}`;
      const lot = await listLotteryCells(client, { platformLockHash: ph, houseEdgeBp, confirmations }, 50);
      setLotBets(lot.bets);
      setLotPots(lot.pots);
      const tipNum = BigInt((await client.getTipHeader()).number);
      const pairsCreated = await Promise.all(lot.bets.map(async (c) => {
        const key = `${c.outPoint.txHash}:${c.outPoint.index}`;
        try {
          const created = await getCellCreationBlockNumber(client, c);
          return [key, created] as const;
        } catch (_e) {
          return [key, null] as const;
        }
      }));
      setBetCreatedBlocks(Object.fromEntries(pairsCreated));

      const pairsTarget = await Promise.all(lot.bets.map(async (c) => {
        const key = `${c.outPoint.txHash}:${c.outPoint.index}`;
        try {
          const created = await getCellCreationBlockNumber(client, c);
          if (created == null) return [key, null] as const;
          return [key, created + BigInt(confirmations)] as const;
        } catch (_e) {
          return [key, null] as const;
        }
      }));
      setBetTargetNumbers(Object.fromEntries(pairsTarget));

      const pairsNib = await Promise.all(lot.bets.map(async (c) => {
        const key = `${c.outPoint.txHash}:${c.outPoint.index}`;
        try {
          const r = await checkBetResultByTipHeader(client, c, { confirmations });
          return [key, r.nibble] as const;
        } catch (_e) {
          return [key, null] as const;
        }
      }));
      setBetNibbles(Object.fromEntries(pairsNib));
      const pairsHash = await Promise.all(lot.bets.map(async (c) => {
        const key = `${c.outPoint.txHash}:${c.outPoint.index}`;
        try {
          const r = await checkBetResultByTipHeader(client, c, { confirmations });
          return [key, r.headerHash] as const;
        } catch (_e) {
          return [key, null] as const;
        }
      }));
      setBetTargetHashes(Object.fromEntries(pairsHash));
    } catch (_e) {
      setLotBets([]);
      setLotPots([]);
      setBetNibbles({});
      setBetTargetHashes({});
    }
  };

  useEffect(() => {
    void refresh();
  }, [client]);

  // 每秒刷新一次当前区块高度
  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const header = await client.getTipHeader();
        if (!cancelled) {
          setTipNumber(BigInt(header.number));
          setTipHash(header.hash);
          const nib = parseInt(header.hash.slice(-1), 16);
          setTipNibble(Number.isNaN(nib) ? null : nib);
        }
      } catch (_e) {
        if (!cancelled) { setTipNumber(null); setTipHash(null); setTipNibble(null); }
      }
    };
    void tick();
    const id = setInterval(() => { void tick(); }, 1000);
    return () => { cancelled = true; clearInterval(id); };
  }, [client]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!client || tipNumber == null) return;
      const pairs = await Promise.all(lotBets.map(async (c) => {
        const key = `${c.outPoint.txHash}:${c.outPoint.index}`;
        try {
          const r = await checkBetResultByTipHeader(client, c, { confirmations });
          return [key, r.nibble] as const;
        } catch (_e) {
          return [key, null] as const;
        }
      }));
      if (!cancelled) setBetNibbles(Object.fromEntries(pairs));
      const pairsHash = await Promise.all(lotBets.map(async (c) => {
        const key = `${c.outPoint.txHash}:${c.outPoint.index}`;
        try {
          const r = await checkBetResultByTipHeader(client, c, { confirmations });
          return [key, r.headerHash] as const;
        } catch (_e) {
          return [key, null] as const;
        }
      }));
      if (!cancelled) setBetTargetHashes(Object.fromEntries(pairsHash));
    };
    void run();
    return () => { cancelled = true; };
  }, [client, tipNumber, lotBets, confirmations]);

  

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

  const BLOCK_SECONDS = 10;
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
        <div className="text-sm text-gray-600 mb-2">当前区块: {tipNumber ? tipNumber.toString() : '-'}</div>

        <div className="mt-10">
          <div className="text-xl font-semibold mb-2">Lottery</div>
          {lotStatus ? <div className="mb-2 text-red-600 break-all">{lotStatus}</div> : null}
          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2 text-sm text-gray-600">
              平台地址固定：{platformAddress}
            </div>
            <div className="col-span-2 text-sm text-gray-600">
              平台手续费固定：{houseEdgeBp} 基点；确认数固定：{confirmations}；下注金额固定：{stakeCkb} CKB
            </div>
            <div className="flex items-center gap-2">
              <select className="rounded-full border px-3 py-2" value={guess} onChange={(e) => setGuess(Number(e.currentTarget.value) as 0 | 1)}>
                <option value={0}>小(0-7)</option>
                <option value={1}>大(8-f)</option>
              </select>
              <button className="rounded-full bg-blue-600 text-white px-4 py-2 disabled:opacity-50" disabled={!signer || !client} onClick={async () => {
                if (!signer || !client) return;
                try {
                  const addr = await ccc.Address.fromString(platformAddress, client);
                  const ph = scriptToHash(addr.script) as `0x${string}`;
                  const tx = await createLotteryBet(signer, { platformLockHash: ph, houseEdgeBp, confirmations }, { stakeCkb, guess });
                  setLotStatus(`创建成功: ${tx}`);
                  void refresh();
                } catch (e: any) {
                  setLotStatus(`创建失败: ${formatErr(e)}`);
                }
              }}>创建下注</button>
              <button className="rounded-full border px-4 py-2" onClick={() => { setLotStatus(''); void refresh(); }} disabled={!client}>刷新下注</button>
            </div>
          </div>
          <div className="mt-4 space-y-3">
            {lotBets.length === 0 ? <div className="text-sm text-gray-500">暂无下注</div> : (
              lotBets.map((c) => {
                const key = `${c.outPoint.txHash}:${c.outPoint.index}`;
                let info: any = null;
                try { info = decodeLotteryBetData(c.outputData); } catch (_e) {}
                const target = betTargetNumbers[key] ?? null;
                const targetReached = tipNumber != null && target != null && (target <= tipNumber);
                const nib = betNibbles[key];
                const win = targetReached && nib != null ? ((info.guess === 0 && nib < 8) || (info.guess === 1 && nib >= 8)) : null;
                const statusText = !info ? '' : (!targetReached ? '待确认' : (win ? '已中奖' : '未中奖'));
                return (
                  <div key={key} className="border rounded-2xl p-4">
                    <div className="text-xs text-gray-500">{key}</div>
                    {info ? (
                      <div className="grid grid-cols-2 gap-2 text-sm mt-2">
                        <div>下注: {ccc.fixedPointToString(info.stakeShannons)} CKB</div>
                        <div className="text-right">猜: {info.guess === 0 ? '小' : '大'}</div>
                        <div>下注区块: {betCreatedBlocks[key] ? betCreatedBlocks[key]!.toString() : '-'}</div>
                        <div className="text-right">下注者: {info.bettorLockHash}</div>
                        <div>目标区块: {betTargetNumbers[key] ? betTargetNumbers[key]!.toString() : '-'}</div>
                        {targetReached ? <div className="text-right">目标哈希: {betTargetHashes[key] ?? '-'}</div> : null}
                        {targetReached ? <div className="col-span-2">目标哈希最低位: {nib ?? '-'}</div> : null}
                        <div className="col-span-2">是否中奖: {statusText}</div>
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button className="rounded-full bg-green-700 text-white px-4 py-2 disabled:opacity-50" disabled={!signer || !client || !platformAddress || lotBets.length === 0 || !canSettle} onClick={async () => {
              if (!signer || !client) return;
              if (!canSettle) { setLotStatus('暂无可结算中奖'); return; }
              const my = [] as any[];
              lotBets.forEach((c) => {
                try {
                  const d = decodeLotteryBetData(c.outputData);
                  if (myLockHash && d.bettorLockHash.toLowerCase() === myLockHash.toLowerCase()) my.push(c);
                } catch (_e) {}
              });
              const tx = await settleLotteryMyWins(signer, { platformAddress, confirmations, houseEdgeBp }, my, lotBets, lotPots[0]);
              setLotStatus(`结算成功: ${tx}`);
              void refresh();
            }}>结算我的中奖</button>
          </div>
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
