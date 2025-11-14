"use client";

import React, { useEffect, useState } from 'react';
import { ccc } from '@ckb-ccc/connector-react';
import {
  createAuctionCell,
  bidAuctionCell,
  claimAuctionCell,
  findActiveAuctionCell,
  decodeAuctionArgs,
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
  const [state, setState] = useState<ReturnType<typeof decodeAuctionArgs> | null>(null);

  // create params
  const [capacityCkb, setCapacityCkb] = useState<string>('150');
  const [endBlock, setEndBlock] = useState<string>('0');
  const [priceStepCkb, setPriceStepCkb] = useState<string>('1');
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
    const cell = await findActiveAuctionCell(client);
    if (!cell) {
      setState(null);
      setStatus('未找到 countdown cell');
      return;
    }
    try {
      const s = decodeAuctionArgs((cell as any).cellOutput.lock.args);
      setState(s);
    } catch (e: any) {
      setStatus(`解析状态失败: ${e?.message ?? String(e)}`);
    }
  };

  // 预计结束区块预览（不用于链上，仅供参考）
  const estimatedEndBlock = null;

  useEffect(() => {
    void refreshState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  return (
    <div className="my-6">
      <div className="text-xl font-semibold my-2">竞价拍卖 合约操作</div>

      <div className="mb-2">
        <Button onClick={refreshState} disabled={!client}>刷新合约状态</Button>
      </div>

      {state ? (
        <div className="mb-4 text-sm">
          <div>end_block: {state.endBlock.toString()}</div>
          <div>price_step_ckb: {ccc.fixedPointToString(state.priceStepShannons)}</div>
          <div>bidder_lock_hash: {state.bidderLockHash}</div>
          <div>current_bid_ckb: {ccc.fixedPointToString(state.bidShannons)}</div>
        </div>
      ) : (
        <div className="mb-4 text-sm">状态不可用（未创建或数据缺失）</div>
      )}

      {status ? <div className="mb-2 text-red-600 break-all">{status}</div> : null}

      <div className="mt-4 p-4 border rounded-2xl">
        <div className="font-semibold mb-2">创建 auction cell</div>
        <div className="flex items-center">
          <div className="flex flex-col">
            <input
              className="rounded-full border border-black px-4 py-2"
              type="text"
              value={capacityCkb}
              onInput={(e) => setCapacityCkb(e.currentTarget.value)}
              placeholder="容量 CKB（至少 130）"
            />
            <input
              className="mt-1 rounded-full border border-black px-4 py-2"
              type="text"
              value={endBlock}
              onInput={(e) => setEndBlock(e.currentTarget.value)}
              placeholder="距离截止的区块数"
            />
            <input
              className="mt-1 rounded-full border border-black px-4 py-2"
              type="text"
              value={priceStepCkb}
              onInput={(e) => setPriceStepCkb(e.currentTarget.value)}
              placeholder="加价步长 CKB"
            />
          </div>
          <Button
            className="ml-2"
            disabled={!signer}
            onClick={async () => {
              if (!signer) return;
              try {
                const hdr = await client!.getTipHeader();
                const finalEndBlock = (BigInt(hdr.number) + BigInt(Number(endBlock || '0'))).toString();
                const txHash = await createAuctionCell(signer, { capacityCkb, endBlock: finalEndBlock, priceStepCkb });
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
        <div className="font-semibold mb-2">出价 auction cell</div>
        <div className="flex items-center">
          <div className="flex flex-col">
            <input
              className="rounded-full border border-black px-4 py-2"
              type="text"
              value={addedCkb}
              onInput={(e) => setAddedCkb(e.currentTarget.value)}
              placeholder="出价 CKB"
            />
          </div>
          <Button
            className="ml-2"
            disabled={!signer}
            onClick={async () => {
              if (!signer) return;
              try {
                const txHash = await bidAuctionCell(signer, addedCkb);
                setStatus(`出价成功: ${txHash}`);
                void refreshState();
              } catch (e: any) {
                setStatus(`出价失败: ${e?.message ?? String(e)}`);
              }
            }}
          >出价</Button>
        </div>
      </div>

      <div className="mt-4 p-4 border rounded-2xl">
        <div className="font-semibold mb-2">领取 auction cell</div>
        <div className="flex items-center">
          <Button
            disabled={!signer}
            onClick={async () => {
              if (!signer) return;
              try {
                const txHash = await claimAuctionCell(signer);
                setStatus(`领取成功: ${txHash}`);
                void refreshState();
              } catch (e: any) {
                setStatus(`领取失败: ${e?.message ?? String(e)}`);
              }
            }}
          >领取</Button>
        </div>
      </div>
    </div>
  );
}