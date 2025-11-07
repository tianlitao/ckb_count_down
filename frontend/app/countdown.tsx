"use client";

import React, { useEffect, useState } from 'react';
import { ccc } from '@ckb-ccc/connector-react';
import {
  createCountdownCell,
  extendCountdownCell,
  closeCountdownCell,
  findActiveCountdownCell,
  decodeCountdownState,
} from './countdown-actions';

function Button(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`flex items-center rounded-full bg-blue-600 px-5 py-2 text-white disabled:opacity-50 ${props.className}`}
    />
  );
}

export default function Countdown() {
  const signer = ccc.useSigner();
  const { client } = ccc.useCcc();

  const [status, setStatus] = useState<string>('');
  const [state, setState] = useState<ReturnType<typeof decodeCountdownState> | null>(null);

  // create params
  const [capacityCkb, setCapacityCkb] = useState<string>('150');
  const [rateBlocksPerCkb, setRateBlocksPerCkb] = useState<string>('100');
  const [minAddCkb, setMinAddCkb] = useState<string>('1');
  const [tipNumber, setTipNumber] = useState<bigint | null>(null);

  // extend params
  const [addedCkb, setAddedCkb] = useState<string>('1');

  const refreshState = async () => {
    setStatus('');
    if (!client) return;
    try {
      const header = await client.getTipHeader();
      setTipNumber(BigInt(header.number));
    } catch (_e) {
      setTipNumber(null);
    }
    const cell = await findActiveCountdownCell(client);
    if (!cell) {
      setState(null);
      setStatus('未找到 countdown cell');
      return;
    }
    try {
      const s = decodeCountdownState(cell.outputData);
      setState(s);
    } catch (e: any) {
      setStatus(`解析状态失败: ${e?.message ?? String(e)}`);
    }
  };

  // 预计结束区块预览（不用于链上，仅供参考）
  const estimatedEndBlock = tipNumber != null
    ? (tipNumber + ((BigInt(ccc.fixedPointFrom(capacityCkb || '0')) / BigInt(100000000)) * BigInt(Number(rateBlocksPerCkb || '0'))))
    : null;

  useEffect(() => {
    void refreshState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  return (
    <div className="my-6">
      <div className="text-xl font-semibold my-2">Countdown 合约操作</div>

      <div className="mb-2">
        <Button onClick={refreshState} disabled={!client}>刷新合约状态</Button>
      </div>

      {state ? (
        <div className="mb-4 text-sm">
          <div>version: {state.version}</div>
          <div>end_block: {state.endBlock.toString()}</div>
          <div>last_payer_lock_hash: {state.lastPayerLockHash}</div>
          <div>rate_blocks_per_ckb: {state.rateBlocksPerCkb}</div>
          <div>min_add_ckb: {ccc.fixedPointToString(state.minAddShannons)}</div>
        </div>
      ) : (
        <div className="mb-4 text-sm">状态不可用（未创建或数据缺失）</div>
      )}

      {status ? <div className="mb-2 text-red-600 break-all">{status}</div> : null}

      <div className="mt-4 p-4 border rounded-2xl">
        <div className="font-semibold mb-2">创建 countdown cell</div>
        <div className="flex items-center">
          <div className="flex flex-col">
            <input
              className="rounded-full border border-black px-4 py-2"
              type="text"
              value={capacityCkb}
              onInput={(e) => setCapacityCkb(e.currentTarget.value)}
              placeholder="容量 CKB（至少 130）"
            />
            {/* 合约公式：end_block = tip + floor(容量 CKB) * rate */}
            <input
              className="mt-1 rounded-full border border-black px-4 py-2"
              type="text"
              value={rateBlocksPerCkb}
              onInput={(e) => setRateBlocksPerCkb(e.currentTarget.value)}
              placeholder="每 CKB 延长的块数"
            />
            <input
              className="mt-1 rounded-full border border-black px-4 py-2"
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={rateBlocksPerCkb}
              onInput={(e) => setRateBlocksPerCkb(e.currentTarget.value)}
              placeholder="每 CKB 延长的块数（整数）"
            />
            <div className="text-xs text-gray-600 mt-1">
              预计 end_block: {estimatedEndBlock ? estimatedEndBlock.toString() : '-'}（基于当前 tip {tipNumber ? tipNumber.toString() : '-'}）
            </div>
            <input
              className="mt-1 rounded-full border border-black px-4 py-2"
              type="text"
              value={minAddCkb}
              onInput={(e) => setMinAddCkb(e.currentTarget.value)}
              placeholder="最小追加 CKB"
            />
          </div>
          <Button
            className="ml-2"
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
                void refreshState();
              } catch (e: any) {
                setStatus(`创建失败: ${e?.message ?? String(e)}`);
              }
            }}
          >创建</Button>
        </div>
      </div>

      <div className="mt-4 p-4 border rounded-2xl">
        <div className="font-semibold mb-2">延长 countdown cell</div>
        <div className="flex items-center">
          <div className="flex flex-col">
            <input
              className="rounded-full border border-black px-4 py-2"
              type="text"
              value={addedCkb}
              onInput={(e) => setAddedCkb(e.currentTarget.value)}
              placeholder="追加 CKB"
            />
          </div>
          <Button
            className="ml-2"
            disabled={!signer}
            onClick={async () => {
              if (!signer) return;
              try {
                const txHash = await extendCountdownCell(signer, addedCkb);
                setStatus(`延长成功: ${txHash}`);
                void refreshState();
              } catch (e: any) {
                setStatus(`延长失败: ${e?.message ?? String(e)}`);
              }
            }}
          >延长</Button>
        </div>
      </div>

      <div className="mt-4 p-4 border rounded-2xl">
        <div className="font-semibold mb-2">关闭 countdown cell</div>
        <div className="flex items-center">
          <Button
            disabled={!signer}
            onClick={async () => {
              if (!signer) return;
              try {
                const txHash = await closeCountdownCell(signer);
                setStatus(`关闭成功: ${txHash}`);
                void refreshState();
              } catch (e: any) {
                setStatus(`关闭失败: ${e?.message ?? String(e)}`);
              }
            }}
          >关闭</Button>
        </div>
      </div>
    </div>
  );
}