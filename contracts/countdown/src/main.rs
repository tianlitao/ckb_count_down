#![no_std]
#![no_main]

mod definitions;
mod error;

use ckb_std::{
    ckb_constants::Source,
    ckb_types::{prelude::*},
    default_alloc, entry,
    high_level::{load_cell_data, load_cell_lock_hash, load_cell_type, load_header, load_script, QueryIter},
};
use alloc::vec::Vec;
use definitions::*;
use error::Error;

// 分配堆内存
default_alloc!();

entry!(program_entry);

fn program_entry() -> i8 {
    match verify() {
        Ok(_) => 0,
        Err(err) => err as i8,
    }
}

fn verify() -> Result<(), Error> {
    // 1. 获取当前脚本配置 (Args)
    let script = load_script()?;
    let args = script.args().raw_data();
    let config = GlobalConfig::from_slice(&args).ok_or(Error::InvalidArgs)?;

    // 校验配置合法性
    if config.house_edge_bp > 10000 || config.confirmations < 1 {
        return Err(Error::InvalidArgs);
    }

    // 2. 扫描输入 (Inputs)
    // 区分 Bet 和 Pot，并计算资金需求
    let mut input_pot_capacity: u128 = 0;
    let mut input_bets_capacity: u128 = 0;

    // 待支付列表
    let mut required_payouts: Vec<([u8; 32], u128)> = Vec::new(); // (LockHash, Amount)

    let script_hash = script.calc_script_hash();
    let inputs = QueryIter::new(load_cell_type, Source::Input);

    for (index, type_script_opt) in inputs.enumerate() {
        if let Some(ts) = type_script_opt {
            if ts.calc_script_hash() != script_hash { continue; }
        } else {
            continue;
        }

        let data = load_cell_data(index, Source::Input)?;
        let capacity = ckb_std::high_level::load_cell_capacity(index, Source::Input)?;

        if data.len() == POT_DATA_LEN && data[0] == POT_KIND {
            // ---> 这是一个 Pot Cell
            input_pot_capacity += capacity as u128;
        } else {
            // ---> 这是一个 Bet Cell (结算逻辑)
            let bet = BetData::from_slice(&data).ok_or(Error::InvalidBetData)?;
            input_bets_capacity += capacity as u128;

            let created_header = load_header(index, Source::Input)?;
            let created_number: u64 = created_header.raw().number().unpack();
            let target_block_number = created_number + config.confirmations as u64;

            let header = find_header_by_number(target_block_number)?;

            // 验证哈希最后一位（Raw Header blake2b，个性化为 ckb-default-hash，与 RPC header.hash 一致）
            let last_byte = header.calc_header_hash().as_slice()[31];
            let nibble = last_byte & 0x0F;
            let result = if nibble >= 0x08 { 1u8 } else { 0u8 };

            if result == bet.guess {
                // 中奖逻辑
                // payout = floor(state + (stake * (10000 - house_edge_bp)) / 10000)
                // 简化公式: stake * (20000 - edge) / 10000
                let stake_u128 = bet.stake as u128;
                let win_amount = (stake_u128 * (10000 - config.house_edge_bp as u128)) / 10000; // floor part of win

                let payout = stake_u128 + win_amount; // 本金 + 赢得部分

                let mut bettor_hash = [0u8; 32];
                bettor_hash.copy_from_slice(bet.bettor_lock_hash);

                required_payouts.push((bettor_hash, payout));
            } else {
                // 未中奖：资金自动流入 Pot (因为 input_bets_capacity 增加了，但 required_payouts 没增加)
            }
        }
    }

    // 3. 扫描输出 (Outputs)
    // 验证 Pot 的存续和 Payout/Fee 的支付
    let mut output_pot_capacity: u128 = 0;
    let mut created_bets_count: u64 = 0;

    // 遍历 GroupOutput 寻找新的 Pot/Bet
    let outputs = QueryIter::new(load_cell_type, Source::GroupOutput);
    for (index, _) in outputs.enumerate() {
        let data = load_cell_data(index, Source::GroupOutput)?;
        let capacity = ckb_std::high_level::load_cell_capacity(index, Source::GroupOutput)?;

        if data.len() == POT_DATA_LEN && data[0] == POT_KIND {
            // ---> Output Pot
            output_pot_capacity += capacity as u128;
        } else {
            // ---> Output Bet (创建下注)
            // 验证创建规则：stake ≤ capacity, data valid
            let bet = BetData::from_slice(&data).ok_or(Error::InvalidBetData)?;
            if (bet.stake as u128) > capacity as u128 {
                return Err(Error::InvalidBetData);
            }
            // 验证 bet_block_number (可选: 必须是当前 tip 附近，防止恶意操控?)
            // 这里主要依靠结算时的 header 校验，创建时不做严格限制，简化逻辑
            created_bets_count += 1;
        }
    }

    // 4. 核心资金平衡校验
    // 只有在进行“结算”操作时才严格校验 payouts。
    // 如果没有任何 Input Bet，说明这是纯粹的 Pot 调整或新下注，跳过结算校验。
    if input_bets_capacity > 0 && created_bets_count > 0 {
        return Err(Error::InvalidBetData);
    }
    if input_bets_capacity > 0 {
        // 计算期望的 Pot 余额
        // Pot_Out = Pot_In + All_Bet_In - Payouts - Fees
        let total_in = input_pot_capacity + input_bets_capacity;
        let total_out_demand = required_payouts.iter().map(|(_, amt)| *amt).sum::<u128>();

        if total_in < total_out_demand {
            return Err(Error::PotCapacityError); // 奖池破产，无法支付
        }

        let expected_pot_min = total_in - total_out_demand;

        // 校验 Pot 余额是否达标
        if output_pot_capacity < expected_pot_min {
            return Err(Error::CapacityMismatch);
        }

        // 校验收款人是否收到钱 (遍历所有 Outputs，不仅仅是 GroupOutput)
        // 因为收款人使用的是普通 Lock，没有 Lottery Type Script
        verify_payouts(&required_payouts, 0, &config.platform_hash)?;
    } else {
        if created_bets_count == 0 {
            let mut platform_involved = false;
            let iter = QueryIter::new(load_cell_lock_hash, Source::Input);
            for (_i, hash) in iter.enumerate() {
                if hash == config.platform_hash { platform_involved = true; break; }
            }
            if !platform_involved { return Err(Error::InvalidArgs); }
        }
    }

    Ok(())
}

// 辅助函数：在 header_deps 中查找特定高度的 Header
fn find_header_by_number(number: u64) -> Result<ckb_std::ckb_types::packed::Header, Error> {
    // header_deps 迭代器
    // 注意：load_header 索引是基于 header_deps 的
    // 这里我们需要一个循环查找，或者前端需要按顺序提供？
    // 为了鲁棒性，我们遍历查找。
    let mut i = 0;
    loop {
        match load_header(i, Source::HeaderDep) {
            Ok(header) => {
                let raw = header.raw();
                let n: u64 = raw.number().unpack();
                if n == number {
                    return Ok(header);
                }
                i += 1;
            },
            Err(ckb_std::error::SysError::IndexOutOfBound) => return Err(Error::HeaderNotFound),
            Err(_) => return Err(Error::Encoding),
        }
    }
}

// 辅助函数：验证普通转账输出 (User Payouts & Platform Fee)
fn verify_payouts(
    user_payouts: &Vec<([u8; 32], u128)>,
    fee_total: u128,
    platform_hash: &[u8; 32]
) -> Result<(), Error> {

    // 我们需要统计输出中对应 LockHash 的资金总额
    // 注意：可能有多个 Input Bet 中奖者是同一个人，或者中奖者就是 Platform
    // 所以需要聚合计算。

    // 这是一个简单的 O(N*M) 检查，考虑到 output 数量通常有限，是可以接受的。
    // 更优做法是将 Outputs 聚合到一个 HashMap 中。

    // 1. 检查 Platform Fee
    if fee_total > 0 {
        let mut found_fee = 0u128;
        let iter = QueryIter::new(load_cell_lock_hash, Source::Output);
        for (i, hash) in iter.enumerate() {
            // 必须是纯转账，不能带有 Type Script (防止将资金转入其他合约)
            if hash == *platform_hash && load_cell_type(i, Source::Output).unwrap().is_none() {
                 found_fee += ckb_std::high_level::load_cell_capacity(i, Source::Output)? as u128;
            }
        }
        if found_fee < fee_total {
            return Err(Error::FeeMissing);
        }
    }

    // 2. 检查 User Payouts
    for (target_hash, amount) in user_payouts {
        let mut found_amt = 0u128;
        let iter = QueryIter::new(load_cell_lock_hash, Source::Output);
        for (i, hash) in iter.enumerate() {
            if hash == *target_hash && load_cell_type(i, Source::Output).unwrap().is_none() {
                found_amt += ckb_std::high_level::load_cell_capacity(i, Source::Output)? as u128;
            }
        }
        if found_amt < *amount {
            return Err(Error::PayoutMissing);
        }
    }

    Ok(())
}
