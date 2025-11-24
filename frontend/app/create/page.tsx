'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ccc } from '@ckb-ccc/connector-react';
import { scriptToHash } from '@nervosnetwork/ckb-sdk-utils';
import Wallet from '../wallet';
import { createPotCell, listLotteryCells, transferPotToNormalCell, getLotteryTypeScript } from '../countdown-actions';
import { platformAddress as PLATFORM_ADDRESS } from '@/offckb.config';

export default function CreatePage() {
  const signer = ccc.useSigner();
  const { client } = ccc.useCcc();

  const [status, setStatus] = useState<string>('');
  const [capacityCkb, setCapacityCkb] = useState<string>('1000');
  const [houseEdgeBp, setHouseEdgeBp] = useState<string>('700');
  const [confirmations, setConfirmations] = useState<string>('1');
  const [platformAddress, setPlatformAddress] = useState<string>(PLATFORM_ADDRESS);
  const [pots, setPots] = useState<any[]>([]);
  const [destAddr, setDestAddr] = useState<string>(PLATFORM_ADDRESS);

  const stringify = (obj: any) => {
    try {
      return JSON.stringify(obj, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2);
    } catch {
      return String(obj);
    }
  };

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

  useEffect(() => {
    const run = async () => {
      if (!client) return;
      try {
        const addr = await ccc.Address.fromString(platformAddress, client);
        const ph = scriptToHash(addr.script) as `0x${string}`;
        const cfg = {
          platformLockHash: ph,
          houseEdgeBp: Number(houseEdgeBp),
          confirmations: Number(confirmations),
        };
        const res = await listLotteryCells(client, cfg as any, 50);
        let ps = res.pots;
        if (!ps || ps.length === 0) {
          try {
            const type = getLotteryTypeScript();
            const fallback: any[] = [];
            let count = 0;
            for await (const cell of client.findCellsByType(type, true, 'desc', 50)) {
              const d = (cell as any).outputData as `0x${string}`;
              if (d && d.length >= 2 && d.slice(0, 4).toLowerCase() === '0x01') {
                fallback.push(cell);
              }
              count++;
              if (count >= 50) break;
            }
            ps = fallback;
          } catch (_e2) {}
        }
        setPots(ps ?? []);
      } catch (_e) {
        setPots([]);
      }
    };
    void run();
  }, [client, platformAddress, houseEdgeBp, confirmations]);

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
        <div className="text-xl font-semibold mb-4">创建 Pot Cell</div>

        {status ? <div className="mb-2 text-red-600 break-all">{status}</div> : null}

        <div className="border rounded-2xl p-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col text-sm">
              <span className="mb-1">容量 CKB</span>
              <input
                className="rounded-full border px-4 py-2"
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={capacityCkb}
                onInput={(e) => setCapacityCkb(e.currentTarget.value)}
                placeholder="容量 CKB"
              />
            </label>
            <label className="flex flex-col text-sm">
              <span className="mb-1">抽水基点（BPS）</span>
              <input
                className="rounded-full border px-4 py-2"
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={houseEdgeBp}
                onInput={(e) => setHouseEdgeBp(e.currentTarget.value)}
                placeholder="house edge"
              />
            </label>
            <label className="flex flex-col text-sm">
              <span className="mb-1">确认块数</span>
              <input
                className="rounded-full border px-4 py-2"
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                value={confirmations}
                onInput={(e) => setConfirmations(e.currentTarget.value)}
                placeholder="confirmations"
              />
            </label>
            <label className="flex flex-col text-sm col-span-2">
              <span className="mb-1">平台地址</span>
              <input
                className="rounded-full border px-4 py-2"
                type="text"
                value={platformAddress}
                onInput={(e) => setPlatformAddress(e.currentTarget.value)}
                placeholder="平台地址"
              />
            </label>
          </div>
        <div className="text-xs text-gray-600 mt-2"></div>
        <div className="mt-3">
          <button
            className="rounded-full bg-blue-600 text-white px-5 py-2 disabled:opacity-50"
            disabled={!signer}
            onClick={async () => {
              if (!signer) return;
              try {
                const txHash = await createPotCell(signer, {
                  platformAddress,
                  houseEdgeBp: Number(houseEdgeBp),
                  confirmations: Number(confirmations),
                }, capacityCkb);
                setStatus(`创建成功: ${txHash}`);
              } catch (e: any) {
                setStatus(`创建失败: ${formatErr(e)}`);
              }
            }}
          >创建</button>
        </div>
      </div>

      <div className="mt-8 border rounded-2xl p-4">
        <div className="text-lg font-semibold mb-2">管理 Pot Cell</div>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <label className="flex flex-col text-sm">
            <span className="mb-1">转移目标地址</span>
            <input
              className="rounded-full border px-4 py-2"
              type="text"
              value={destAddr}
              onInput={(e) => setDestAddr(e.currentTarget.value)}
              placeholder="目标地址"
            />
          </label>
        </div>
        <div className="space-y-2">
          {pots.length === 0 ? (
            <div className="text-sm text-gray-600">暂无 Pot</div>
          ) : (
            pots.map((p, idx) => (
              <div key={idx} className="flex items-center justify-between border rounded-xl px-3 py-2">
                <div className="text-sm">容量 {ccc.fixedPointToString(p.cellOutput.capacity)} CKB</div>
                <div className="flex gap-2">
                  <button
                    className="rounded-full border px-3 py-1"
                    onClick={() => setStatus(stringify({
                      outPoint: p.outPoint,
                      capacityCKB: ccc.fixedPointToString(p.cellOutput.capacity),
                      lock: p.cellOutput.lock,
                      type: (p as any)?.cellOutput?.type,
                      data: (p as any)?.outputData,
                    }))}
                  >查看</button>
                  <button
                    className="rounded-full bg-red-600 text-white px-3 py-1 disabled:opacity-50"
                    disabled={!signer}
                    onClick={async () => {
                      if (!signer) return;
                      try {
                        const tx = await transferPotToNormalCell(signer, p, destAddr);
                        setStatus(`转移成功: ${tx}`);
                      } catch (e: any) {
                        setStatus(`转移失败: ${formatErr(e)}`);
                      }
                    }}
                  >转移成普通cell</button>
                </div>
              </div>
            ))
          )}
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
