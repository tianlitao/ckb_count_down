'use client';

import { ccc } from '@ckb-ccc/connector-react';
import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createPortal } from 'react-dom';
import { readEnvNetwork } from '@/offckb.config';
import { buildCccClient } from './wallet-client';

function WalletIcon({ wallet, className }: { wallet: ccc.Wallet; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={wallet.icon} alt={wallet.name} className={`h-8 w-8 rounded-full ${className}`} />
  );
}

function Button(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`flex items-center rounded-full bg-orange-600 px-5 py-3 text-white ${props.className}`}
    />
  );
}

export default function Wallet() {
  const { wallet, open, disconnect, setClient } = ccc.useCcc();
  const signer = ccc.useSigner();
  const router = useRouter();
  const [refreshKey, setRefreshKey] = useState(0);

  const [internalAddress, setInternalAddress] = useState('');
  const [address, setAddress] = useState('');
  const [showConnector, setShowConnector] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!signer) {
      setInternalAddress('');
      setAddress('');
      return;
    }

    (async () => {
      setInternalAddress(await signer.getInternalAddress());
      setAddress(await signer.getRecommendedAddress());
    })();
  }, [signer]);

  useEffect(() => {
    const network = readEnvNetwork();
    setClient(buildCccClient(network));
  }, [setClient]);

  // 监听连接/断开，强制刷新页面所有元素
  useEffect(() => {
    setRefreshKey((k) => k + 1);
    try {
      router.refresh();
    } catch {}
  }, [wallet, signer]);

  return (
    <div key={refreshKey}>
      {/* 移除自定义 Portal 弹窗，使用 Provider 内置 Connector */}
      {wallet ? (
        <>
          <Button className="mt-4" onClick={open}>
            Open Connector
          </Button>
          {/* Disconnect 外部按钮已移除，使用弹窗中的断开入口 */}
        </>
      ) : (
        <Button onClick={open}>Connect Wallet</Button>
      )}
    </div>
  );
}
