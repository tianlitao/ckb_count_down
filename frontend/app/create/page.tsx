'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ccc } from '@ckb-ccc/connector-react';
import Wallet from '../wallet';
import { createAuctionCell } from '../countdown-actions';

export default function CreatePage() {
  const signer = ccc.useSigner();
  const { client } = ccc.useCcc();

  const [status, setStatus] = useState<string>('');
  const [tipNumber, setTipNumber] = useState<bigint | null>(null);

  const [capacityCkb, setCapacityCkb] = useState<string>('150');
  const [endBlock, setEndBlock] = useState<string>('0');
  const [priceStepCkb, setPriceStepCkb] = useState<string>('1');

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

  const estimatedEndBlock = null;

  return (
    <>
      <header className="sticky top-0 z-10 bg-white/80 backdrop-blur border-b">
        <div className="max-w-screen-md mx-auto flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-4">
            <Link href="/" className="font-bold text-2xl md:text-3xl tracking-tight no-underline">AuctionCell</Link>
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
        <div className="text-xl font-semibold mb-4">创建 auction cell</div>

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
              <span className="mb-1">距离截止的区块数</span>
              <input
                className="rounded-full border px-4 py-2"
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                value={endBlock}
                onInput={(e) => setEndBlock(e.currentTarget.value)}
                placeholder="距离截止的区块数"
              />
            </label>
            <label className="flex flex-col text-sm">
              <span className="mb-1">加价步长 CKB</span>
              <input
                className="rounded-full border px-4 py-2"
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                value={priceStepCkb}
                onInput={(e) => setPriceStepCkb(e.currentTarget.value)}
                placeholder="加价步长"
              />
            </label>
          </div>
          <div className="text-xs text-gray-600 mt-2">
            当前 tip: {tipNumber ? tipNumber.toString() : '-'}；预计 end_block: {tipNumber != null ? (tipNumber + BigInt(Number(endBlock || '0'))).toString() : '-'}
          </div>
          <div className="mt-3">
            <button
              className="rounded-full bg-blue-600 text-white px-5 py-2 disabled:opacity-50"
              disabled={!signer}
              onClick={async () => {
                if (!signer) return;
              try {
                const hdr = await client!.getTipHeader();
                const finalEndBlock = (BigInt(hdr.number) + BigInt(Number(endBlock || '0'))).toString();
                const txHash = await createAuctionCell(signer, { capacityCkb, endBlock: finalEndBlock, priceStepCkb });
                setStatus(`创建成功: ${txHash}`);
              } catch (e: any) {
                setStatus(`创建失败: ${e?.message ?? String(e)}`);
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
