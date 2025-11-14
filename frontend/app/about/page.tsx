'use client';

import Link from 'next/link';
import Wallet from '../wallet';

export default function About() {
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
        <div className="text-2xl font-bold mb-4">关于倒计时合约（Countdown）</div>

        <section className="space-y-3">
          <p>
            本项目基于 Nervos CKB 的 Cell 模型实现一个「倒计时」玩法：任意人都可以向该 Cell 出价 CKB 来延长倒计时；当倒计时结束后，最后一次成功出价的人（最后出价者）可以关闭并领取该 Cell 的全部容量作为奖励。
          </p>
          <p>
            前端使用 Next.js + TailwindCSS，钱包连接与交易构建基于 <code>@ckb-ccc/connector-react</code>。当前网络：<code>{process.env.NEXT_PUBLIC_NETWORK ?? 'testnet'}</code>。
          </p>
        </section>

        <hr className="my-6" />

        <section>
          <h2 className="text-xl font-semibold mb-2">核心概念</h2>
          <ul className="list-disc pl-5 space-y-2">
            <li>
              结束区块（<code>endBlock</code>）：当当前区块高度达到或超过该值，倒计时结束。
            </li>
            <li>
              最后出价者锁哈希（<code>lastPayerLockHash</code>）：记录最后一次成功出价的账户的锁哈希。
            </li>
            <li>
              每 CKB 增加区块数（<code>rateBlocksPerCkb</code>）：每出价 1 CKB，增加的区块数量。
            </li>
            <li>
              最小出价金额（<code>minAddShannons</code>）：每次出价的最小 CKB 金额（Shannons）。
            </li>
          </ul>
        </section>

        <section className="mt-6">
          <h2 className="text-xl font-semibold mb-2">玩法规则</h2>
          <ul className="list-disc pl-5 space-y-2">
            <li>
              创建：在「创建」页设定 <code>rateBlocksPerCkb</code> 与 <code>minAddCkb</code>，并为 Cell 充值初始容量。创建后结束区块将按初始容量自动计算（<code>capacity</code> × <code>rateBlocksPerCkb</code>），初始 <code>lastPayerLockHash</code> 为创建人。
            </li>
            <li>
              出价（未到期时）：输入出价的 CKB 数量。每次出价会按比例延长 <code>endBlock</code>，并把你记为「最后出价者」。
            </li>
            <li>
              领取（到期后）：仅最后出价者可以关闭并领取 Cell 的全部容量。
            </li>
            <li>
              费用：交易需要足够的手续费（fee rate 满足矿池要求），否则会被拒绝。
            </li>
          </ul>
        </section>

        <section className="mt-6">
          <h2 className="text-xl font-semibold mb-2">操作指引</h2>
          <ol className="list-decimal pl-5 space-y-2">
            <li>在右上角连接钱包（如 JoyID 或其他 CKB 钱包）。</li>
            <li>在首页列表选择一个未到期的 Cell，输入出价金额点击「延长」。</li>
            <li>等待到期后（显示「已到期」），若你是最后出价者，点击「领取」。</li>
            <li>在「创建」页可以创建新的倒计时 Cell 并设置参数。</li>
          </ol>
        </section>

        <section className="mt-6">
          <h2 className="text-xl font-semibold mb-2">免责声明</h2>
          <p className="text-sm text-gray-600">
            本项目为示例与实验性玩法，请谨慎参与。区块链交易不可逆，请确保理解相关风险与规则。若启用测试模式，仅代表前端行为变化，链上验证仍以合约为准。
          </p>
        </section>
      </main>
    </>
  );
}
