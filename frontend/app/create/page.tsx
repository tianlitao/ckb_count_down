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

  const [capacityCkb, setCapacityCkb] = useState<string>('200');
  const [rateBlocksPerCkb, setRateBlocksPerCkb] = useState<string>('1');
  const [minAddCkb, setMinAddCkb] = useState<string>('1');
  // 展示单位输入：每块铸币与池最低余额（按 decimals 展示，提交时转换为原子单位）
  const [xudtPerBlockDisplay, setXudtPerBlockDisplay] = useState<string>('0');
  const [minPoolXudtDisplay, setMinPoolXudtDisplay] = useState<string>('0');
  // xUDT 发行信息（SUS 参考）：amount/decimals/symbol/name（amount 为展示单位，自动转换为原子单位）
  const [xudtAmountDisplay, setXudtAmountDisplay] = useState<string>('0');
  const [xudtDecimals, setXudtDecimals] = useState<string>('8');
  const [xudtSymbol, setXudtSymbol] = useState<string>('XUDT');
  const [xudtName, setXudtName] = useState<string>('DemoToken');
  const [xudtAmountAtomic, setXudtAmountAtomic] = useState<bigint>(BigInt(0));

  // 将展示单位转换为原子单位（u128）
  const recomputeAtomic = (amountStr: string, decimalsStr: string) => {
    try {
      const d = Math.max(0, Number(decimalsStr || '0')) | 0;
      const pow10 = (n: number) => {
        let r = BigInt(1);
        for (let i = 0; i < n; i++) r *= BigInt(10);
        return r;
      };
      const parts = (amountStr || '0').trim();
      if (!parts || parts === '.') { setXudtAmountAtomic(BigInt(0)); return; }
      const [intPart, fracPartRaw] = parts.split('.');
      const fracPart = (fracPartRaw || '').slice(0, d); // 截断到 decimals 位
      const intBI = BigInt(intPart || '0');
      const fracBI = BigInt((fracPart || '0').padEnd(d, '0'));
      const atomic = intBI * pow10(d) + fracBI;
      setXudtAmountAtomic(atomic);
    } catch (_e) {
      setXudtAmountAtomic(BigInt(0));
    }
  };

  useEffect(() => {
    recomputeAtomic(xudtAmountDisplay, xudtDecimals);
  }, [xudtAmountDisplay, xudtDecimals]);

  // 通用转换：将展示单位的字符串按 decimals 转为原子单位（u128）
  const toAtomicByDecimals = (amountStr: string, decimalsStr: string): bigint => {
    try {
      const d = Math.max(0, Number(decimalsStr || '0')) | 0;
      const pow10 = (n: number) => {
        let r = BigInt(1);
        for (let i = 0; i < n; i++) r *= BigInt(10);
        return r;
      };
      const s = (amountStr || '').trim();
      if (!s || s === '.') return BigInt(0);
      if (!/^\d*(?:\.\d*)?$/.test(s)) return BigInt(0);
      const [intPart, fracRaw = ''] = s.split('.');
      const intBI = BigInt(intPart || '0');
      const fracPadded = fracRaw.slice(0, d).padEnd(d, '0');
      const fracBI = BigInt(fracPadded || '0');
      return intBI * pow10(d) + fracBI;
    } catch (_e) {
      return BigInt(0);
    }
  };

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
        <div className="max-w-screen-xl mx-auto flex items-center justify-between px-4 md:px-6 py-3">
          <div className="flex items-center gap-4">
  <Link
    href="/"
    className="font-bold text-2xl md:text-3xl tracking-tight no-underline bg-gradient-to-r from-cyan-400 via-fuchsia-500 to-indigo-500 bg-clip-text text-transparent drop-shadow-[0_0_18px_rgba(0,255,255,0.25)]"
  >
    FairLaunchCell
  </Link>
            <nav className="flex items-center gap-4 md:gap-6 text-base md:text-lg">
  <Link href="/" className="no-underline hover:no-underline transition-colors hover:text-cyan-300">首页</Link>
  <Link href="/create" className="no-underline hover:no-underline transition-colors hover:text-cyan-300">创建</Link>
  <Link href="/about" className="no-underline hover:no-underline transition-colors hover:text-cyan-300">关于</Link>
            </nav>
          </div>
          <div>
            <Wallet />
          </div>
        </div>
      </header>

      <main className="max-w-screen-xl mx-auto px-4 md:px-6 py-6">
        <div className="text-xl font-semibold mb-2">创建 FairLaunch Cell</div>
        <div className="mb-4 text-sm text-gray-600">
          提示：本流程使用一次性密封（SingleUseLock），创建将分三步执行（锚点、SUS owner、铸造），因此需要连续签名三次。
        </div>

        {status ? <div className="mb-2 text-red-600 break-all">{status}</div> : null}

        <div className="border rounded-2xl p-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col text-sm">
              <span className="mb-1">容量 CKB（至少满足占用，推荐 ≥ 190）</span>
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
              <span className="mb-1">每 CKB 增加区块数（整数）</span>
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
            <label className="flex flex-col text-sm">
              <span className="mb-1">每块铸币 {xudtSymbol}（展示单位，按 {xudtDecimals} 小数）</span>
              <input
                className="rounded-full border px-4 py-2"
                type="text"
                inputMode="decimal"
                value={xudtPerBlockDisplay}
                onInput={(e) => setXudtPerBlockDisplay(e.currentTarget.value.replace(/[^0-9.]/g, ''))}
                placeholder="例如 0.1234"
              />
            </label>
            <label className="flex flex-col text-sm">
              <span className="mb-1">池最低 {xudtSymbol}（展示单位，按 {xudtDecimals} 小数）</span>
              <input
                className="rounded-full border px-4 py-2"
                type="text"
                inputMode="decimal"
                value={minPoolXudtDisplay}
                onInput={(e) => setMinPoolXudtDisplay(e.currentTarget.value.replace(/[^0-9.]/g, ''))}
                placeholder="例如 100.00"
              />
            </label>
            {/* 发行 xUDT 的展示参数 */}
            <label className="flex flex-col text-sm">
              <span className="mb-1">发行总量 amount（展示单位）</span>
              <input
                className="rounded-full border px-4 py-2"
                type="text"
                inputMode="decimal"
                value={xudtAmountDisplay}
                onInput={(e) => setXudtAmountDisplay(e.currentTarget.value)}
                placeholder="例如 1234.5678"
              />
            </label>
            <label className="flex flex-col text-sm">
              <span className="mb-1">decimals（每个单位的小数位，默认为 8）</span>
              <input
                className="rounded-full border px-4 py-2"
                type="number"
                inputMode="numeric"
                min={0}
                max={38}
                step={1}
                value={xudtDecimals}
                disabled
                readOnly
                placeholder="默认为 8"
              />
            </label>
            <label className="flex flex-col text-sm">
              <span className="mb-1">symbol（符号）</span>
              <input
                className="rounded-full border px-4 py-2"
                type="text"
                value={xudtSymbol}
                onInput={(e) => setXudtSymbol(e.currentTarget.value)}
                placeholder="例如 XDT"
              />
            </label>
            <label className="flex flex-col text-sm">
              <span className="mb-1">name（名称）</span>
              <input
                className="rounded-full border px-4 py-2"
                type="text"
                value={xudtName}
                onInput={(e) => setXudtName(e.currentTarget.value)}
                placeholder="例如 Example Token"
              />
            </label>
          </div>
          <div className="text-xs text-gray-600 mt-2">
            发行总量（原子单位，u128）预览：{xudtAmountAtomic.toString()}
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
                  const perBlockAtomic = toAtomicByDecimals(xudtPerBlockDisplay, xudtDecimals);
                  const minPoolAtomic = toAtomicByDecimals(minPoolXudtDisplay, xudtDecimals);
                  const txHash = await createCountdownCell(signer, {
                    capacityCkb,
                    rateBlocksPerCkb: Number(rateBlocksPerCkb),
                    minAddCkb,
                    xudtPerBlock: perBlockAtomic,
                    minPoolXudt: minPoolAtomic,
                    xudtAmount: xudtAmountAtomic,
                    xudtDecimals: Number(xudtDecimals || '0'),
                    xudtSymbol,
                    xudtName,
                  });
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
