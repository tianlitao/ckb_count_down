'use client';

import { ccc } from '@ckb-ccc/connector-react';
import './page.css';
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { createLotteryBet, listLotteryCells, decodeLotteryBetData, settleLotteryMyWins, getCellCreationBlockNumber, checkBetResultByTipHeader, getLotteryTypeScript } from './countdown-actions';
import { scriptToHash } from '@nervosnetwork/ckb-sdk-utils';
import offckb, { platformAddress as PLATFORM_ADDRESS, alwaysSuccessAddress as ALWAYS_SUCCESS_ADDRESS } from '@/offckb.config';

export default function Home() {
  const signer = ccc.useSigner();
  const { client, open } = ccc.useCcc();

  const [status, setStatus] = useState<string>('');
  const [tipNumber, setTipNumber] = useState<bigint | null>(null);
  const [betNibbles, setBetNibbles] = useState<Record<string, number | null>>({});
  const [betCreatedBlocks, setBetCreatedBlocks] = useState<Record<string, bigint | null>>({});
  const [betTargetNumbers, setBetTargetNumbers] = useState<Record<string, bigint | null>>({});
  const [myLockHash, setMyLockHash] = useState<string | null>(null);
  const [myAddress, setMyAddress] = useState<string | null>(null);
  const [lotBets, setLotBets] = useState<any[]>([]);
  const [lotPots, setLotPots] = useState<any[]>([]);
  const [platformAddress] = useState<string>(PLATFORM_ADDRESS);
  const [houseEdgeBp] = useState<number>(700);
  const [confirmations] = useState<number>(1);
  const [stakeCkb, setStakeCkb] = useState<string>('500');
  const [balance, setBalance] = useState<number>(0);
  const [pendingWinnings, setPendingWinnings] = useState<number>(0);
  const [isBetting, setIsBetting] = useState<boolean>(false);
  const [hashChars, setHashChars] = useState<string[]>(['?', '?', '?', '?', '', '?', '?', '?']);
  const [scrambleInterval, setScrambleInterval] = useState<NodeJS.Timeout | null>(null);
  const [isScrambling, setIsScrambling] = useState<boolean>(true);
  const isScramblingRef = useRef<boolean>(true);
  const [historyItems, setHistoryItems] = useState<any[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState<boolean>(true);
  const [resultOverlay, setResultOverlay] = useState<'win' | 'lose' | null>(null);
  const [toasts, setToasts] = useState<Array<{ id: number; title: string; msg: string; type: 'success' | 'error' | 'info'; duration: number; txHash?: string }>>([]);
  const [historyCursor, setHistoryCursor] = useState<any>(null);
  const [historyHasMore, setHistoryHasMore] = useState<boolean>(false);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const historyListRef = useRef<HTMLDivElement | null>(null);
  const bgCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const hasPendingBet = useMemo(() => historyItems.some(it => it.type === 'bet' && it.status === 'pending'), [historyItems]);



  const explorerBase = offckb.explorerApiBase;
  const parseCapToBigInt = (s: any): bigint => {
    if (typeof s === 'string') {
      const i = s.indexOf('.');
      const raw = i >= 0 ? s.slice(0, i) : s;
      try { return BigInt(raw); } catch { return BigInt(0); }
    }
    if (typeof s === 'number') return BigInt(Math.floor(s));
    if (typeof s === 'bigint') return s;
    return BigInt(0);
  };
  const getExplorerAddressTxs = async (address: string, page: number, pageSize: number) => {
    const url = `${explorerBase}/api/v1/address_transactions/${address}?page=${page}&page_size=${pageSize}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'accept': 'application/vnd.api+json',
        'content-type': 'application/vnd.api+json',
      },
    });
    return await res.json();
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

  // Calculate unclaimed winnings from history
  const unclaimedWinnings = useMemo(() => {
    return historyItems
      .filter(item => item.won && !item.claimed && item.status === 'confirmed')
      .reduce((total, item) => total + item.amount, 0);
  }, [historyItems]);

  const chainUnclaimedWinnings = useMemo(() => {
    if (!myLockHash || tipNumber == null) return 0;
    let total = 0;
    for (const c of lotBets) {
      let info: any = null;
      try { info = decodeLotteryBetData(c.outputData); } catch { continue; }
      if (info.bettorLockHash.toLowerCase() !== myLockHash.toLowerCase()) continue;
      const key = `${c.outPoint.txHash}:${c.outPoint.index}`;
      const nib = betNibbles[key];
      const target = betTargetNumbers[key];
      if (nib == null || target == null || tipNumber < target) continue;
      const isWin = (info.guess === 0 && nib < 8) || (info.guess === 1 && nib >= 8);
      if (isWin) {
        const claimShannons = (info.stakeShannons * BigInt(20000 - houseEdgeBp)) / BigInt(10000);
        total += Number(ccc.fixedPointToString(claimShannons));
      }
    }
    return total;
  }, [lotBets, betNibbles, betTargetNumbers, tipNumber, myLockHash, houseEdgeBp]);

  const claimedWinsTotal = useMemo(() => {
    return historyItems
      .filter(it => it.won && it.claimed)
      .reduce((sum, it) => sum + (Number(it.amount) || 0), 0);
  }, [historyItems]);

  const uiUnclaimedTotal = Math.max(0, (pendingWinnings + chainUnclaimedWinnings) - claimedWinsTotal);

  const hexChars = '0123456789ABCDEF';

  const startScramble = () => {
    if (!isScramblingRef.current) return;
    if (scrambleInterval) clearInterval(scrambleInterval);
    const interval = setInterval(() => {
      if (!isScramblingRef.current) return;
      const newChars = [...hashChars];
      for (let i = 0; i < newChars.length; i++) {
        if (newChars[i] !== '.') {
          newChars[i] = hexChars[Math.floor(Math.random() * 16)];
        }
      }
      setHashChars(newChars);
    }, 50);
    setScrambleInterval(interval);
  };

  const showToast = (title: string, msg: string, type: 'success' | 'error' | 'info' = 'info', duration = 3000, txHash?: string) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts(prev => [...prev, { id, title, msg, type, duration, txHash }]);
    setTimeout(() => { setToasts(prev => prev.filter(t => t.id !== id)); }, duration + 500);
  };

  const stopScramble = (finalChar: string) => {
    if (scrambleInterval) {
      clearInterval(scrambleInterval);
      setScrambleInterval(null);
    }
    const newChars = [...hashChars];
    newChars[7] = finalChar;
    for (let i = 0; i < newChars.length; i++) {
      if (newChars[i] === '?' || (i === 7 && newChars[i] !== finalChar)) {
        newChars[i] = hexChars[Math.floor(Math.random() * 16)];
      }
    }
    setHashChars(newChars);
  };

  const refreshWalletBalance = async () => {
    if (!client || !myAddress) return;
    try {
      const lock = (await ccc.Address.fromString(myAddress, client)).script;
      const bal = await client.getBalanceSingle(lock);
      const ckb = Math.floor(Number(ccc.fixedPointToString(bal)) || 0);
      setBalance(ckb);
    } catch (_e) {}
  };

  const refresh = async (opts?: { silent?: boolean }) => {
    if (!client) return;
    const silent = !!opts?.silent;
    if (!silent) setIsLoadingHistory(true);
    try {
      const header = await client.getTipHeader();
      setTipNumber(BigInt(header.number));

    } catch (_e) {
      setTipNumber(null);

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


      try {
        const type = getLotteryTypeScript();
        const resp = await getExplorerAddressTxs(ALWAYS_SUCCESS_ADDRESS, 1, 10);
        const items: any[] = [];
        const data: any[] = Array.isArray(resp?.data) ? resp.data : [];
        for (const entry of data) {
          const attrs = (entry as any)?.attributes ?? {};
          const txHash: string = attrs?.transaction_hash ?? (entry as any)?.id ?? '0x';
          if (!txHash || txHash === '0x') continue;
          const dispOutputs: any[] = Array.isArray(attrs?.display_outputs) ? attrs.display_outputs : [];
          let isBet = false;
          for (const o of dispOutputs) {
            const ts = o?.type_script;
            if (ts && String(ts.code_hash).toLowerCase() === type.codeHash.toLowerCase() && String(ts.hash_type).toLowerCase() === type.hashType.toLowerCase()) {
              isBet = true;
            }
          }
          const incB = parseCapToBigInt((attrs as any)?.income);
          const amount = Number.isFinite(Number(incB) / 100_000_000) ? Math.abs(Number(incB) / 100_000_000) : 0;
          const tag = incB > BigInt(0) ? 'bet' : incB < BigInt(0) ? 'settle' : (isBet ? 'bet' : 'settle');
          items.push({ key: txHash, txHash, type: tag, won: tag === 'settle', amount, hex: '', claimed: false, timestamp: Number(attrs?.block_timestamp ?? Date.now()), status: 'confirmed' });
        }
        setHistoryItems(items.slice(0, 10));
        setHistoryCursor(2);
        setHistoryHasMore(data.length === 10);
      } catch (_e3) {}

    } catch (_e) {
      setLotBets([]);
      setLotPots([]);
      setBetNibbles({});

    } finally {
      if (!silent) setIsLoadingHistory(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [client]); // Refresh when client changes

  useEffect(() => {
    // Load user transactions when wallet connects
    if (myLockHash && client) {
      void refresh();
    }
  }, [myLockHash, client]); // Refresh when wallet connects

  // Load initial data when component mounts
  useEffect(() => {
    if (client && !myLockHash) {
      void refresh();
    }
  }, [client]); // Load blockchain data on mount

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const header = await client.getTipHeader();
        if (!cancelled) {
          setTipNumber(BigInt(header.number));

        }
      } catch (_e) {
        if (!cancelled) { setTipNumber(null); }
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

    };
    void run();
    return () => { cancelled = true; };
  }, [client, tipNumber, lotBets, confirmations]);

  useEffect(() => {
    const run = async () => {
      if (!client) return;
      try {
        const type = getLotteryTypeScript();
        const items: any[] = [];
        const resp = await getExplorerAddressTxs(ALWAYS_SUCCESS_ADDRESS, 1, 10);
        const data: any[] = Array.isArray(resp?.data) ? resp.data : [];
        for (const entry of data) {
          const attrs = (entry as any)?.attributes ?? {};
          const txHash: string = attrs?.transaction_hash ?? (entry as any)?.id ?? '0x';
          if (!txHash || txHash === '0x') continue;
          const dispOutputs: any[] = Array.isArray(attrs?.display_outputs) ? attrs.display_outputs : [];
          let isBet = false;
          for (const o of dispOutputs) {
            const ts = o?.type_script;
            if (ts && String(ts.code_hash).toLowerCase() === type.codeHash.toLowerCase() && String(ts.hash_type).toLowerCase() === type.hashType.toLowerCase()) {
              isBet = true;
            }
          }
          const incB = parseCapToBigInt((attrs as any)?.income);
          const amount = Number.isFinite(Number(incB) / 100_000_000) ? Math.abs(Number(incB) / 100_000_000) : 0;
          const tag = incB > BigInt(0) ? 'bet' : incB < BigInt(0) ? 'settle' : (isBet ? 'bet' : 'settle');
          items.push({ key: txHash, txHash, type: tag, won: tag === 'settle', amount, hex: '', claimed: false, timestamp: Number(attrs?.block_timestamp ?? Date.now()), status: 'confirmed' });
        }
        setHistoryItems(items.slice(0, 10));
        setHistoryCursor(2);
        setHistoryHasMore(data.length === 10);
      } catch (e: any) {
        console.error('load recent tx failed', e);
      }
    };
    void run();
  }, [client, signer, houseEdgeBp]);


  const loadMoreHistory = useCallback(async () => {
    if (!client || isLoadingMore || !historyHasMore) return;
    setIsLoadingMore(true);
    try {
      const type = getLotteryTypeScript();
      let added = 0;
      let page = typeof historyCursor === 'number' ? historyCursor : 2;
      let pages = 0;
      const MAX_PAGES = 5;
      const seenExisting = new Set<string>(historyItems.map((i) => i.txHash));
      while (true) {
        if (!historyHasMore) break;
        pages++;
        if (pages > MAX_PAGES) break;
        const resp = await getExplorerAddressTxs(ALWAYS_SUCCESS_ADDRESS, page, 10);
        const list: any[] = Array.isArray(resp?.data) ? resp.data : [];
        const newItems: any[] = [];
        const seen = new Set<string>();
        for (const tx of list) {
          const attrs = (tx as any)?.attributes ?? {};
          const txHash: string = attrs?.transaction_hash ?? (tx as any)?.id ?? '0x';
          if (!txHash || txHash === '0x' || seen.has(txHash) || seenExisting.has(txHash)) continue;
          seen.add(txHash);
          let tag: 'bet' | 'settle' | null = null;
          let amount = 0;
          let isBet = false;
          const dispOutputs: any[] = Array.isArray(attrs?.display_outputs) ? attrs.display_outputs : [];
          for (const o of dispOutputs) {
            const ts = o?.type_script;
            if (ts && String(ts.code_hash).toLowerCase() === type.codeHash.toLowerCase() && String(ts.hash_type).toLowerCase() === type.hashType.toLowerCase()) isBet = true;
          }
          const incB = parseCapToBigInt((attrs as any)?.income);
          const amt2 = Number(incB) / 100_000_000;
          amount = Number.isFinite(amt2) ? Math.abs(amt2) : 0;
          tag = incB > BigInt(0) ? 'bet' : incB < BigInt(0) ? 'settle' : (isBet ? 'bet' : 'settle');
          if (!tag) continue;
          newItems.push({ key: txHash, txHash, type: tag, won: tag === 'settle', amount, hex: '', claimed: false, timestamp: Number(attrs?.block_timestamp ?? Date.now()), status: 'confirmed' });
          added++;
          if (added >= 10) break;
        }
        setHistoryItems((prev) => [...prev, ...newItems]);
        const hasNext = Array.isArray(resp?.data) && resp.data.length === 10;
        setHistoryHasMore(hasNext);
        setHistoryCursor(hasNext ? page + 1 : null);
        if (added >= 10 || !hasNext) break;
        page = page + 1;
      }
    } finally {
      setIsLoadingMore(false);
    }
  }, [client, isLoadingMore, historyHasMore, historyCursor, historyItems, houseEdgeBp]);

  useEffect(() => {
    const el = sentinelRef.current;
    const rootEl = historyListRef.current;
    if (!el || !historyHasMore) return;
    const obs = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting && !isLoadingMore && historyHasMore) {
          void loadMoreHistory();
        }
      }
    }, { root: rootEl ?? null, rootMargin: '0px', threshold: 0.1 });
    obs.observe(el);
    return () => { obs.disconnect(); };
  }, [historyHasMore, isLoadingMore, loadMoreHistory]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!signer || !client) { setMyLockHash(null); setMyAddress(null); return; }
      try {
        const addr = await signer.getRecommendedAddress();
        const lock = (await ccc.Address.fromString(addr, client)).script;
        const hash = scriptToHash(lock);
        if (!cancelled) { setMyLockHash(hash); setMyAddress(addr); }
        await refreshWalletBalance();
      } catch (_e) {
        if (!cancelled) { setMyLockHash(null); setMyAddress(null); }
      }
    };
    void run();
    return () => { cancelled = true; };
  }, [signer, client]);

  useEffect(() => {
    startScramble();
    return () => {
      if (scrambleInterval) clearInterval(scrambleInterval);
    };
  }, []);

  useEffect(() => {
    const canvas = bgCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    ctx.globalCompositeOperation = 'screen';
    let width = 0;
    let height = 0;
    let cx = 0;
    let cy = 0;
    const isMobile = window.innerWidth < 640;
    const STAR_COUNT = isMobile ? 220 : 220;
    const SPEED = isMobile ? 2.2 : 2.2;
    const MAX_DEPTH = 2000;
    let rafId = 0;
    const resize = () => {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
      cx = width / 2;
      cy = height / 2;
    };
    resize();
    const onResize = () => resize();
    window.addEventListener('resize', onResize);
    class Star {
      x!: number;
      y!: number;
      z!: number;
      color!: string;
      baseSize!: number;
      constructor() { this.reset(true); }
      reset(randomZ = false) {
        this.x = (Math.random() * 2 - 1) * width;
        this.y = (Math.random() * 2 - 1) * height;
        this.z = randomZ ? Math.random() * MAX_DEPTH : MAX_DEPTH;
        const isGold = Math.random() > 0.95;
        this.color = isGold ? '#ffd700' : '#00ffcc';
        this.baseSize = isGold ? 1.5 : 1;
      }
      update() {
        this.z -= SPEED * 5;
        if (this.z <= 0) this.reset();
      }
      draw() {
        const dz = SPEED * 5;
        const preZ = this.z + dz;
        const scale = 800 / this.z;
        const prevScale = 800 / preZ;
        const x2d = this.x * scale + cx;
        const y2d = this.y * scale + cy;
        const px = this.x * prevScale + cx;
        const py = this.y * prevScale + cy;
        const lw = Math.max(1, this.baseSize * scale * 0.7);
        ctx.strokeStyle = this.color;
        ctx.lineWidth = lw;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(x2d, y2d);
        ctx.stroke();
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(x2d, y2d, lw * 0.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    const stars = Array.from({ length: STAR_COUNT }, () => new Star());
    let targetCx = cx;
    let targetCy = cy;
    const onMouseMove = (e: MouseEvent) => {
      targetCx = width / 2 + (e.clientX - width / 2) * 0.1;
      targetCy = height / 2 + (e.clientY - height / 2) * 0.1;
    };
    document.addEventListener('mousemove', onMouseMove);
    const drawGrid = () => {
      ctx.strokeStyle = 'rgba(0,255,204,0.03)';
      ctx.lineWidth = 1;
      const gridSize = 50;
      ctx.beginPath();
      for (let x = 0; x < width; x += gridSize) {
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, height);
      }
      for (let y = 0; y < height; y += gridSize) {
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(width, y + 0.5);
      }
      ctx.stroke();
    };
    let frame = 0;
    const animate = () => {
      ctx.fillStyle = 'rgba(5,5,5,0.25)';
      ctx.fillRect(0, 0, width, height);
      frame++;
      if (!isMobile || frame % 3 === 0) drawGrid();
      cx += (targetCx - cx) * 0.1;
      cy += (targetCy - cy) * 0.1;
      for (const s of stars) { s.update(); s.draw(); }
      rafId = requestAnimationFrame(animate);
    };
    animate();
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('mousemove', onMouseMove);
    };
  }, []);

  useEffect(() => {
    if (resultOverlay != null) {
      setIsScrambling(false);
      isScramblingRef.current = false;
      if (scrambleInterval) {
        clearInterval(scrambleInterval);
        setScrambleInterval(null);
      }
    } else {
      if (!isBetting) {
        setIsScrambling(true);
        isScramblingRef.current = true;
        startScramble();
      }
    }
  }, [resultOverlay, isBetting]);


  useEffect(() => {
    void refreshWalletBalance();
  }, [client, myAddress, tipNumber]);

  const connectWallet = async () => {
    // Use the CCC connector to open wallet selection modal
    if (open) {
      try {
        open();
        showToast('SYSTEM CONNECTED', 'Wallet modal opened.', 'success');
      } catch (e) {
        console.error('Wallet connection failed:', e);
      }
    }
  };

  const placeBet = async (type: 'low' | 'high') => {
    if (!signer || !client) {
      showToast('ACCESS DENIED', 'Please connect wallet first.', 'error');
      return;
    }
    if (isBetting || hasPendingBet) { showToast('TX PENDING', '上一个下注交易未确认，请稍候…', 'info'); return; }

    const amount = parseInt(stakeCkb);
    if (amount < 200) { showToast('INVALID AMOUNT', 'Minimum bet is 200 CKB.', 'error'); return; }
    if (amount > balance) { showToast('INSUFFICIENT FUNDS', 'Insufficient balance.', 'error'); return; }

    setIsBetting(true);
    setBalance(prev => prev - amount);

    try {
      const addr = await ccc.Address.fromString(platformAddress, client);
      const ph = scriptToHash(addr.script) as `0x${string}`;
      const guess = type === 'low' ? 0 : 1;

      // Create the bet transaction
      setStatus("TX PENDING... WAITING FOR BLOCK");
      const tx = await createLotteryBet(signer, { platformLockHash: ph, houseEdgeBp, confirmations }, { stakeCkb, guess });
      showToast('TX SUBMITTED', `Bet tx ${tx.slice(-8)} pending...`, 'info', 3500, tx);

      // Add pending transaction to history immediately
      const pendingHistoryItem = {
        key: `pending:${tx}:${Date.now()}`,
        txHash: tx,
        type: 'bet',
        won: false,
        amount: amount,
        hex: '?',
        claimed: false,
        timestamp: Date.now(),
        status: 'pending'
      };
      setHistoryItems(prev => [pendingHistoryItem, ...prev.slice(0, 9)]);

      // Fast scramble during transaction processing
      const fastScramble = setInterval(() => {
        if (!isScramblingRef.current) return;
        const newChars = [...hashChars];
        for (let i = 0; i < newChars.length; i++) {
          if (newChars[i] !== '.') {
            newChars[i] = hexChars[Math.floor(Math.random() * 16)];
          }
        }
        setHashChars(newChars);
      }, 30);

      // Wait for the bet to be included in a block and get the result
      let attempts = 0;
      const maxAttempts = 30; // Wait up to 30 seconds

      const checkResult = async () => {
        attempts++;

        // Refresh blockchain data silently to avoid UI flicker
        await refresh({ silent: true });

        // Fetch latest bets directly to avoid stale state during polling
        const platformAddr = await ccc.Address.fromString(platformAddress, client);
        const platformLockHash = scriptToHash(platformAddr.script) as `0x${string}`;
        const latestLot = await listLotteryCells(client, { platformLockHash, houseEdgeBp, confirmations }, 50);
        const recentBets = latestLot.bets.filter(bet => {
          try {
            const info = decodeLotteryBetData(bet.outputData);
            return info.bettorLockHash.toLowerCase() === myLockHash?.toLowerCase();
          } catch {
            return false;
          }
        });

        // 优先找当前这笔 bet，找不到就继续轮询
        const myBet = recentBets.find(b => b.outPoint.txHash === tx);
        if (myBet) {
          const nowHeader = await client.getTipHeader();   // ✅ 补上
          const r = await checkBetResultByTipHeader(client, myBet, { confirmations });
          if (r && BigInt(nowHeader.number) >= r.target) {
            // ✅ 真正确认，显示结果
            const won = r.win;
            setResultOverlay(won ? 'win' : 'lose');
            setIsScrambling(false);
            isScramblingRef.current = false;
            if (scrambleInterval) { clearInterval(scrambleInterval); setScrambleInterval(null); }
            clearInterval(fastScramble);
            setTimeout(() => setResultOverlay(null), 2500);

            // 更新历史并同步未领取金额
            const payoutCkb = Number(ccc.fixedPointToString(
              won ? (myBet.cellOutput.capacity * BigInt(20000 - houseEdgeBp) / BigInt(10000)) : myBet.cellOutput.capacity
            ));
            setHistoryItems(prev => {
              const copy = prev.filter(i => i.txHash !== tx);
              return [{
                key: `${myBet.outPoint.txHash}:${myBet.outPoint.index}`,
                txHash: tx,
                won,
                amount: payoutCkb,
                hex: r.nibble.toString(16).toUpperCase(),
                claimed: false,
                timestamp: Date.now(),
                status: 'confirmed',
              }, ...copy].slice(0, 10);
            });
            // 依赖链上数据计算未领取金额，避免与历史临时累加重复

            setIsBetting(false);
            setStatus('WAITING FOR NEXT BET...');
            clearInterval(fastScramble);
            stopScramble(r.nibble.toString(16).toUpperCase());
            return; // 真正结束轮询
          }
        }

        // 未确认或还没出现在列表里，继续下一轮
        if (attempts < maxAttempts) {
          setTimeout(checkResult, 1000);
        } else {
          // 超时处理
          clearInterval(fastScramble);
          setStatus('Timeout waiting for result');
          setIsBetting(false);
          setBalance(prev => prev + amount);
          setTimeout(() => startScramble(), 2000);
        }
      };

      // Start checking for results (initial delay to allow tx to propagate)
      setTimeout(checkResult, 2000);

    } catch (e: any) {
      setStatus(`创建失败: ${formatErr(e)}`);
      showToast('TX FAILED', formatErr(e), 'error');
      setIsBetting(false);
      setBalance(prev => prev + amount); // Refund on error
    }
  };

  const claimWinnings = async () => {
    if (!signer || !client || uiUnclaimedTotal <= 0) return;

    try {
      const my = [] as any[];
      lotBets.forEach((c) => {
        try {
          const d = decodeLotteryBetData(c.outputData);
          if (myLockHash && d.bettorLockHash.toLowerCase() === myLockHash.toLowerCase()) my.push(c);
        } catch (_e) {}
      });

      const randPot = lotPots.length > 0 ? lotPots[Math.floor(Math.random() * lotPots.length)] : undefined;
      const tx = await settleLotteryMyWins(signer, { platformAddress, confirmations, houseEdgeBp }, my, lotBets, randPot);
      showToast('CLAIM TX SUBMITTED', `Tx ${tx.slice(-8)} pending...`, 'info', 3500, tx);

      // Optimistic UI update: decrease unclaimed and mark wins as claimed
      setStatus('CLAIM TX PENDING... WAITING FOR CONFIRMATION...');
      await refreshWalletBalance();
      setPendingWinnings(0);
      setHistoryItems(prev => {
        const claimedMarked = prev.map(item => item.won ? { ...item, claimed: true } : item);
        const entry = { key: `claim:${tx}`, txHash: tx, type: 'settle', won: true, amount: uiUnclaimedTotal, hex: '?', claimed: true, timestamp: Date.now(), status: 'pending' };
        return [entry, ...claimedMarked].slice(0, 10);
      });

      // Poll for settlement tx inclusion, then refresh history from chain
      let attempts = 0;
      const maxAttempts = 60;
      const poll = async () => {
        attempts++;
        try {
          const res: any = await client.getTransaction(tx);
          const bh: string | undefined = res?.txStatus?.blockHash ?? res?.tx_status?.block_hash ?? res?.transaction?.blockHash ?? res?.transaction?.txStatus?.blockHash ?? res?.transaction?.tx_status?.block_hash;
          if (bh) {
            setHistoryItems(prev => prev.map(it => it.txHash === tx ? { ...it, status: 'confirmed' } : it));
            await refresh({ silent: true });
            await refreshWalletBalance();
            setStatus('WAITING FOR NEXT BET...');
            showToast('TRANSFER COMPLETE', 'Winnings claimed to wallet.', 'info');
            return;
          }
        } catch (_e) {}
        if (attempts < maxAttempts) {
          setTimeout(poll, 1000);
        } else {
          setStatus('Claim tx timeout');
        }
      };
      setTimeout(poll, 1000);

    } catch (e: any) {
      showToast('Claim failed', formatErr(e), 'error');
    }
  };

  const updateWalletUI = () => {
    return myAddress ? `ckt1...${myAddress.slice(-4)} | ${balance.toLocaleString()} CKB` : 'CONNECT WALLET';
  };

  return (
    <>


      <canvas id="bg-canvas" ref={bgCanvasRef}></canvas>
      <div className="bg-orb"></div>

      <header>
        <div className="logo">
          NERVOS <span>HASH LOTTERY</span>
        </div>
        <button className="wallet-btn" onClick={connectWallet}>
          {updateWalletUI()}
        </button>
      </header>

      <div className="toast-container">
        {toasts.map(t => (
          <div key={t.id} className={`toast ${t.type}`}>
            <div className="toast-title">{t.title}</div>
            <div className="toast-msg">
              {t.msg}
              {t.txHash ? (
                <a href={`${offckb.explorerWebBase}/transaction/${t.txHash}`} target="_blank" rel="noreferrer" style={{ marginLeft: 8 }}>
                  View
                </a>
              ) : null}
            </div>
            <div className="toast-progress" style={{ animation: `progress ${t.duration}ms linear forwards` }}></div>
          </div>
        ))}
      </div>

      <div className="main-container">
        {/* 待领取面板 */}
        <div className={`claim-panel ${(uiUnclaimedTotal > 0) ? 'active' : ''}`}>
          <div className="claim-info">
            <span className="claim-label">UNCLAIMED WINNINGS（待领取）</span>
            <span className="claim-amount">+{uiUnclaimedTotal.toLocaleString()} CKB</span>
          </div>
          <button className="claim-btn" onClick={claimWinnings}>CLAIM NOW</button>
        </div>

        {/* 结果动画层 */}
        <div id="winMsg" className={`result-msg win-text ${resultOverlay === 'win' ? 'show' : ''}`}>YOU WON</div>
        <div id="loseMsg" className={`result-msg lose-text ${resultOverlay === 'lose' ? 'show' : ''}`}>YOU LOST</div>

        <div className="hash-display">
          {hashChars.map((char, index) => (
            <span
              key={index}
              className={`hash-char ${index === 7 ? `target ${resultOverlay === 'win' ? 'highlight' : resultOverlay === 'lose' ? 'fail' : ''}` : ''}`}
              style={{ opacity: char === '.' ? 0.5 : 1 }}
            >
              {char}
            </span>
          ))}
        </div>

        <div className="status-text">{status || (tipNumber ? `Block #${tipNumber.toString()}` : 'CONNECTING...')} {isBetting && ' • WAITING FOR CONFIRMATION...'}</div>

        <div className="control-panel">
          <div className={`loader ${isBetting ? 'active' : ''}`}></div>

          <div className="input-group">
            <div>
              <label>BET AMOUNT</label>
              <br />
              <input
                type="number"
                value={stakeCkb}
                onInput={(e) => {
                  const raw = e.currentTarget.value;
                  const n = Math.floor(Number(raw));
                  setStakeCkb(Number.isFinite(n) ? String(n) : '');
                }}
                min="200"
                step="1"
                inputMode="numeric"
                pattern="[0-9]*"
                disabled={isBetting}
              />
            </div>
            <div className="ckb-unit">CKB</div>
          </div>

          <div className="bet-actions">
            <button
              className={`bet-btn low`}
              onClick={() => placeBet('low')}
              disabled={!signer || !client}
            >
              SMALL (小)
              <span>0 - 7</span>
            </button>
            <button
              className={`bet-btn high`}
              onClick={() => placeBet('high')}
              disabled={!signer || !client}
            >
              BIG (大)
              <span>8 - F</span>
            </button>
            {hasPendingBet ? (
              <div style={{ marginTop: 8, fontSize: 12, color: '#999' }}>上一个下注交易未确认，请稍候…</div>
            ) : null}
          </div>
        </div>

        <div className="history">
          <div className="history-title">
            <span>RECENT TRANSACTIONS</span>
            <span>Live on CKB Testnet</span>
          </div>
          <div className="history-list" ref={historyListRef}>
            {isLoadingHistory ? (
              <div className="history-item">
                <span>Loading transactions...</span>
                <span>-</span>
              </div>
            ) : (
              <>
                {historyItems.map((item, index) => (
                  <div key={index} className={`history-item ${item.type === 'settle' ? 'win' : ''}`}>
                    <span>Tx <a href={`${offckb.explorerWebBase}/transaction/${item.txHash}`} target="_blank" rel="noreferrer">{item.txHash.slice(-8)}</a></span>

                    <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                      {item.type === 'bet' ? (
                        <span>BET {item.amount} CKB</span>
                      ) : (
                        <span>SETTLE {item.amount} CKB</span>
                      )}
                      {item.type === 'settle' && (
                        <span className={`history-tag ${item.claimed ? 'tag-claimed' : 'tag-win'}`}>
                          {item.claimed ? 'CLAIMED' : 'WIN'}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
                {historyItems.length === 0 && (
                  <div className="history-item">
                    <span>No recent transactions</span>
                    <span>-</span>
                  </div>
                )}
                {historyHasMore && (
                  <div ref={sentinelRef} className="history-item">
                    <span>{isLoadingMore ? 'Loading more...' : 'Scroll to load more'}</span>
                    <span>-</span>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <div className="manual-section">
          <div className="manual-title">SYSTEM MANUAL & RULES</div>
          <div className="grid-box">
            <div className="info-card">
              <div className="info-icon">🎲</div>
              <div className="info-head">HOW TO PLAY (玩法)</div>
              <div className="info-desc">
                Based on the last character of the CKB block hash.<br />
                <span className="code-snippet">0-7</span> is SMALL (小)<br />
                <span className="code-snippet">8-F</span> is BIG (大)<br />
                Pick a side and wait for the block confirmation.
              </div>
            </div>
            <div className="info-card">
              <div className="info-icon">⚖️</div>
              <div className="info-head">FAIRNESS (公平性)</div>
              <div className="info-desc">
                Provably fair. The result depends on PoW mining (Block Hash).<br />
                No one, including the developer, can predict the next block hash.
              </div>
            </div>
            <div className="info-card">
              <div className="info-icon">💰</div>
              <div className="info-head">PAYOUT (赔率)</div>
              <div className="info-desc">
                Winning payout is <span className="code-snippet">1.93x</span>.<br />
                5% goes to house edge/maintenance.<br />
                Example: Bet 100 CKB, win 195 CKB.
              </div>
            </div>
            <div className="info-card">
              <div className="info-icon">📥</div>
              <div className="info-head">CLAIM (领取机制)</div>
              <div className="info-desc">
                To optimize transaction fees and cell management, winnings are stored in a temporary pool.<br />
                You must click the golden &quot;CLAIM&quot; button to withdraw to your wallet.
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
