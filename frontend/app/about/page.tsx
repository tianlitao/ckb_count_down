'use client';

import Link from 'next/link';
import Wallet from '../wallet';

export default function About() {
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
        <div className="text-2xl font-bold mb-4">关于公平发射平台（Fair Launch）</div>

        <section className="space-y-3">
          <p>
            本项目基于 Nervos CKB 的 Cell 模型实现一个「公平发射」流程：创建者将 xUDT 代币配置并铸造到 <code>Fair Launch Lock</code>，在 Mint 期间按区块持续分发；到期后开启 Swap（常数乘积池），用户即可在固定池中按 <code>k = x * y</code> 的规则与 CKB 进行兑换。
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
              xUDT 代币：包含 <code>symbol</code> 与 <code>decimals</code>（当前固定为 8），用于展示与换算。
            </li>
            <li>
              xUDT 通过一次性密封（Single‑Use‑Seals，SUS）机制实现总量不可增发，参考：
              <a href="https://talk.nervos.org/t/en-cn-misc-single-use-seals/8279" target="_blank" rel="noopener noreferrer" className="underline">Single‑Use‑Seals（一次性密封）</a>
            </li>
            <li>
              发射结束区块（<code>endBlock</code>）：到达该区块后，Mint 结束，Swap 开启。
            </li>
            <li>
              每块铸币（<code>mintPerBlock</code>）：在 Mint 期间，每个区块分发的 xUDT（展示单位，按 <code>decimals</code> 转为原子单位）。
            </li>
            <li>
              池最低余额（<code>minPoolXudt</code>）：为常数乘积池预留的 xUDT 最小余额（展示单位）。
            </li>
            <li>
              常数乘积池（<code>k = x * y</code>）：Swap 采用固定乘积做市，价格由池内 xUDT 与 CKB 的相对数量决定。
            </li>
            <li>
              Mint（未到期）：任意人可追加 CKB 获取对应数量 xUDT，<code>endBlock</code> 随支付的 CKB 对应增加。
            </li>
          </ul>
        </section>

        <section className="mt-6">
          <h2 className="text-xl font-semibold mb-2">流程与规则</h2>
          <ul className="list-disc pl-5 space-y-2">
            <li>
              创建：在「创建」页配置 xUDT 基本信息（<code>symbol</code>、<code>name</code>、<code>decimals</code> 当前固定为 8），设置 <code>mintPerBlock</code> 与 <code>minPoolXudt</code>，并准备初始资金。
            </li>
            <li>
              Mint（未到期）：当用户追加 CKB 进行 Mint 时，按「增加的区块数 × <code>mintPerBlock</code>」实时分发对应数量的 xUDT 到该用户地址，<code>endBlock</code> 相应增加。
            </li>
            <li>
              开启兑换（到期后）：到达 <code>endBlock</code> 即开启 Swap，采用常数乘积池 <code>k = x * y</code> 进行 xUDT 与 CKB 的兑换，价格随池内资产比例动态变化。
            </li>
            <li>
              费用：交易需要足够的手续费（fee rate 满足矿池要求），否则会被拒绝。平台不收取任何手续费费用。
            </li>
          </ul>
        </section>

        <section className="mt-6">
          <h2 className="text-xl font-semibold mb-2">操作指引</h2>
          <ol className="list-decimal pl-5 space-y-2">
            <li>在右上角连接钱包（如 JoyID 或其他 CKB 钱包）。</li>
            <li>在「创建」页配置代币信息并设置每块铸币与池最低余额（展示单位，按 8 位小数换算）。</li>
            <li>在首页选择未到期的条目，点击 Mint，设置区块数并支付相应 CKB，即时获取对应数量的 xUDT，同时 <code>endBlock</code> 相应增加。</li>
            <li>当到期后，前往「Swap」页面按常数乘积池规则进行 xUDT ↔ CKB 兑换。</li>
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
