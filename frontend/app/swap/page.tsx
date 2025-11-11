'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { ccc } from '@ckb-ccc/connector-react';
import Wallet from '../wallet';
import { decodeCountdownState, swapCkbForXudt, swapXudtForCkb } from '../countdown-actions';
import { scriptToHash } from '@nervosnetwork/ckb-sdk-utils';
import { UDT_CONFIG } from '../../src/udt-config';

// u128 格式化（默认 8 位小数，仅用于展示）
const formatU128Display = (val: bigint, decimals: number = 8) => {
  const d = Math.max(0, decimals | 0);
  let base = BigInt(1);
  for (let i = 0; i < d; i++) base *= BigInt(10);
  const intPart = (val / base).toString();
  const fracRaw = (val % base).toString().padStart(d, '0');
  const frac = fracRaw.replace(/0+$/, '');
  return frac.length ? `${intPart}.${frac}` : intPart;
};

// 将带小数的字符串（人类单位）转换为原子单位（u128 BigInt）
function decimalStrToAtomicBigInt(input: string, decimals: number): bigint {
  const s = (input || '').trim();
  if (!s) return BigInt(0);
  if (!/^\d*(?:\.\d*)?$/.test(s)) throw new Error('数值格式错误');
  const [intStr, fracRaw = ''] = s.split('.');
  const d = Math.max(0, decimals | 0);
  let base = BigInt(1);
  for (let i = 0; i < d; i++) base *= BigInt(10);
  const intPart = intStr ? BigInt(intStr) : BigInt(0);
  const fracPadded = (fracRaw || '').slice(0, d).padEnd(d, '0');
  const fracPart = fracPadded ? BigInt(fracPadded) : BigInt(0);
  return intPart * base + fracPart;
}

export default function SwapPage() {
  const search = useSearchParams();
  const signer = ccc.useSigner();
  const { client } = ccc.useCcc();

  const [status, setStatus] = useState<string>('');
  const [cell, setCell] = useState<ccc.Cell | null>(null);
  const [state, setState] = useState<ReturnType<typeof decodeCountdownState> | null>(null);
  const [tipNumber, setTipNumber] = useState<bigint | null>(null);

  const [ckbIn, setCkbIn] = useState<string>('1');
  const [xudtIn, setXudtIn] = useState<string>('0'); // 原子单位（u128）

  const outPoint = useMemo(() => {
    const txHash = search.get('txHash') ?? '';
    const indexStr = search.get('index') ?? '0';
    const index = Number(indexStr);
    if (!txHash || Number.isNaN(index)) return null;
    return { txHash, index } as { txHash: `0x${string}`; index: number };
  }, [search]);

  useEffect(() => {
    if (!client || !outPoint) return;
    let cancelled = false;
    const run = async () => {
      try {
        const header = await client.getTipHeader();
        if (!cancelled) setTipNumber(BigInt(header.number));
      } catch (_e) {
        if (!cancelled) setTipNumber(null);
      }
      try {
        const c = await client.getCell(outPoint);
        if (!c) throw new Error('未找到目标 cell');
        const s = decodeCountdownState(c.cellOutput.lock.args);
        if (!cancelled) { setCell(c); setState(s); }
      } catch (e: any) {
        if (!cancelled) setStatus(e?.message ?? String(e));
      }
    };
    void run();
    return () => { cancelled = true; };
  }, [client, outPoint]);

  const isExpired = useMemo(() => (state && tipNumber != null ? tipNumber >= state.endBlock : false), [state, tipNumber]);

  // 预估（仅展示）
  const preview = useMemo(() => {
    if (!cell) return null;
    const typeHash = cell?.cellOutput?.type ? scriptToHash(cell.cellOutput.type) as `0x${string}` : undefined;
    const tokenDecimals = (typeHash ? UDT_CONFIG[typeHash]?.decimal : undefined) ?? 8;
    const x_in_ckb_str = ccc.fixedPointToString(cell.cellOutput.capacity);
    const x_in = BigInt(ccc.fixedPointFrom(x_in_ckb_str));
    const y_in_hex = cell.outputData as string;
    const clean = y_in_hex.startsWith('0x') ? y_in_hex.slice(2) : y_in_hex;
    const be = clean.match(/../g)?.reverse().join('') ?? '0'.repeat(32);
    const y_in = BigInt('0x' + be);
    // ckb -> xudt
    const dx = BigInt(ccc.fixedPointFrom(ckbIn || '0'));
    const x_out1 = x_in + (dx > BigInt(0) ? dx : BigInt(0));
    const y_out1 = x_out1 > BigInt(0) ? (x_in * y_in) / x_out1 : y_in;
    const userXudt = y_in > y_out1 ? y_in - y_out1 : BigInt(0);
    // xudt -> ckb
    const dy = decimalStrToAtomicBigInt(xudtIn || '0', tokenDecimals);
    const y_out2 = y_in + (dy > BigInt(0) ? dy : BigInt(0));
    const x_out2 = y_out2 > BigInt(0) ? (x_in * y_in) / y_out2 : x_in;
    const userCkbShannons = x_in > x_out2 ? x_in - x_out2 : BigInt(0);
    return {
      x_in, y_in, x_out1, y_out1, userXudt, x_out2, y_out2, userCkbShannons, tokenDecimals,
    };
  }, [cell, ckbIn, xudtIn]);

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
          <div className="text-xl font-semibold">兑换 Swap（到期后）</div>
          <div className="text-sm text-gray-600">{isExpired ? '已到期' : '未到期'}</div>
        </div>
        {status ? <div className="mb-2 text-red-600 break-all">{status}</div> : null}
        {!cell || !state ? (
          <div className="text-sm text-gray-500">加载中或未找到目标 Cell</div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>结束区块: {state.endBlock.toString()}</div>
              <div className="text-right">当前区块: {tipNumber ? tipNumber.toString() : '-'}</div>
              <div>池内 CKB 容量: {ccc.fixedPointToString(cell.cellOutput.capacity)} CKB</div>
              <div>
                池内 {(cell?.cellOutput?.type ? (UDT_CONFIG[scriptToHash(cell.cellOutput.type) as `0x${string}`]?.symbol ?? 'XUDT') : 'XUDT')}: {formatU128Display(preview?.y_in ?? BigInt(0), preview?.tokenDecimals ?? 8)}
              </div>
            </div>

            <div className="mt-4 p-4 border rounded-2xl">
              <div className="font-semibold mb-2">用 CKB 兑换 {(cell?.cellOutput?.type ? (UDT_CONFIG[scriptToHash(cell.cellOutput.type) as `0x${string}`]?.symbol ?? 'XUDT') : 'XUDT')}</div>
              <div className="flex items-center gap-2">
                <input
                  className="rounded-full border px-3 py-1 text-sm"
                  placeholder="输入 CKB"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  step={1}
                  value={ckbIn}
                  onInput={(e) => setCkbIn(e.currentTarget.value.replace(/[^0-9.]/g, ''))}
                />
                <button
                  className="rounded-full bg-blue-600 text-white px-4 py-1 text-sm disabled:opacity-50"
                  disabled={!signer || !isExpired}
                  onClick={async () => {
                    if (!signer || !cell) return;
                    setStatus('');
                    try {
                      const txHash = await swapCkbForXudt(signer, cell, ckbIn || '0');
                      setStatus(`兑换成功: ${txHash}`);
                    } catch (e: any) {
                      setStatus(`兑换失败: ${e?.message ?? String(e)}`);
                    }
                  }}
                >兑换</button>
              </div>
              <div className="text-xs text-gray-600 mt-2">
                预计获得 {(cell?.cellOutput?.type ? (UDT_CONFIG[scriptToHash(cell.cellOutput.type) as `0x${string}`]?.symbol ?? 'XUDT') : 'XUDT')}: {formatU128Display(preview?.userXudt ?? BigInt(0), preview?.tokenDecimals ?? 8)}
              </div>
            </div>

            <div className="mt-4 p-4 border rounded-2xl">
              <div className="font-semibold mb-2">用 {(cell?.cellOutput?.type ? (UDT_CONFIG[scriptToHash(cell.cellOutput.type) as `0x${string}`]?.symbol ?? 'XUDT') : 'XUDT')} 兑换 CKB</div>
              <div className="flex items-center gap-2">
                <input
                  className="rounded-full border px-3 py-1 text-sm"
                  placeholder={`输入 ${(cell?.cellOutput?.type ? (UDT_CONFIG[scriptToHash(cell.cellOutput.type) as `0x${string}`]?.symbol ?? 'XUDT') : 'XUDT')}（按 ${(cell?.cellOutput?.type ? (UDT_CONFIG[scriptToHash(cell.cellOutput.type) as `0x${string}`]?.decimal ?? 8) : 8)} 小数)`}
                  type="text"
                  inputMode="numeric"
                  min={0}
                  step="any"
                  value={xudtIn}
                  onInput={(e) => setXudtIn(e.currentTarget.value.replace(/[^0-9.]/g, ''))}
                />
                <button
                  className="rounded-full bg-blue-600 text-white px-4 py-1 text-sm disabled:opacity-50"
                  disabled={!signer || !isExpired}
                  onClick={async () => {
                    if (!signer || !cell) return;
                    setStatus('');
                    try {
                      const typeHash = cell?.cellOutput?.type ? scriptToHash(cell.cellOutput.type) as `0x${string}` : undefined;
                      const tokenDecimals = (typeHash ? UDT_CONFIG[typeHash]?.decimal : undefined) ?? 8;
                      const dy = decimalStrToAtomicBigInt(xudtIn || '0', tokenDecimals);
                      const txHash = await swapXudtForCkb(signer, cell, dy);
                      setStatus(`兑换成功: ${txHash}`);
                    } catch (e: any) {
                      setStatus(`兑换失败: ${e?.message ?? String(e)}`);
                    }
                  }}
                >兑换</button>
              </div>
              <div className="text-xs text-gray-600 mt-2">
                预计获得 CKB: {ccc.fixedPointToString(preview?.userCkbShannons ?? BigInt(0))} CKB
              </div>
            </div>
          </div>
        )}
      </main>
    </>
  );
}
