'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ccc } from '@ckb-ccc/connector-react';
import Wallet from '../wallet';
import { createCountdownCell } from '../countdown-actions';

export default function CreatePage() {
  const signer = ccc.useSigner();
  const { client } = ccc.useCcc();

  const [status, setStatus] = useState<string>('');
  const [tipNumber, setTipNumber] = useState<bigint | null>(null);

  const [capacityCkb, setCapacityCkb] = useState<string>('150');
  const [rateBlocksPerCkb, setRateBlocksPerCkb] = useState<string>('1');
  const [minAddCkb, setMinAddCkb] = useState<string>('1');

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
        const header = await client.getTipHeader();
        setTipNumber(BigInt(header.number));
      } catch (_e) {
        setTipNumber(null);
      }
    };
    void run();
  }, [client]);

  const estimatedEndBlock = tipNumber != null
    ? (tipNumber + ((BigInt(ccc.fixedPointFrom(capacityCkb || '0')) / BigInt(100000000)) * BigInt(Number(rateBlocksPerCkb || '0'))))
    : null;

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
        <div className="text-xl font-semibold mb-4">创建 countdown cell</div>

        {status ? <div className="mb-2 text-red-600 break-all">{status}</div> : null}

        <div className="border rounded-2xl p-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col text-sm">
              <span className="mb-1">容量 CKB（至少 150）</span>
              <input
                className="rounded-full border px-4 py-2"
                type="number"
                inputMode="numeric"
                min={150}
                step={1}
                value={capacityCkb}
                onInput={(e) => setCapacityCkb(e.currentTarget.value)}
                placeholder="容量 CKB"
              />
            </label>
            <label className="flex flex-col text-sm">
              <span className="mb-1">每 CKB 延长的块数（整数）</span>
              <input
                className="rounded-full border px-4 py-2"
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={rateBlocksPerCkb}
                onInput={(e) => setRateBlocksPerCkb(e.currentTarget.value)}
                placeholder="速率"
              />
            </label>
            <label className="flex flex-col text-sm">
              <span className="mb-1">最小追加 CKB</span>
              <input
                className="rounded-full border px-4 py-2"
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                value={minAddCkb}
                onInput={(e) => setMinAddCkb(e.currentTarget.value)}
                placeholder="最小追加"
              />
            </label>
          </div>
          <div className="text-xs text-gray-600 mt-2">
            当前 tip: {tipNumber ? tipNumber.toString() : '-'}；预计 end_block: {estimatedEndBlock ? estimatedEndBlock.toString() : '-'}
          </div>
          <div className="mt-3">
            <button
              className="rounded-full bg-blue-600 text-white px-5 py-2 disabled:opacity-50"
              disabled={!signer}
              onClick={async () => {
                if (!signer) return;
                try {
                  const txHash = await createCountdownCell(signer, {
                    capacityCkb,
                    rateBlocksPerCkb: Number(rateBlocksPerCkb),
                    minAddCkb,
                  });
                  setStatus(`创建成功: ${txHash}`);
                } catch (e: any) {
                  setStatus(`创建失败: ${formatErr(e)}`);
                }
              }}
            >创建</button>
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
