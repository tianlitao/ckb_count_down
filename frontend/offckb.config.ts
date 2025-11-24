export type Network = 'devnet' | 'testnet' | 'mainnet';
export type AddressPrefix = 'ckb' | 'ckt';

export enum SystemScriptName {
  secp256k1_blake160_sighash_all = 'secp256k1_blake160_sighash_all',
  secp256k1_blake160_multisig_all = 'secp256k1_blake160_multisig_all',
  dao = 'dao',
  sudt = 'sudt',
  xudt = 'xudt',
  omnilock = 'omnilock',
  anyone_can_pay = 'anyone_can_pay',
  always_success = 'always_success',
  spore = 'spore',
  spore_cluster = 'spore_cluster',
  spore_cluster_agent = 'spore_cluster_agent',
  spore_cluster_proxy = 'spore_cluster_proxy',
  spore_extension_lua = 'spore_extension_lua',
}

export interface ScriptInfo {
  codeHash: `0x${string}`;
  hashType: 'type' | 'data' | 'data1';
  cellDeps: {
    cellDep: {
      outPoint: {
        txHash: `0x${string}`;
        index: number;
      };
      depType: 'code' | 'dep_group';
    };
    type?: {
      codeHash: `0x${string}`;
      hashType: 'type' | 'data' | 'data1';
      args: `0x${string}`;
    };
  }[];
}

export interface SystemScript {
  name: string;
  file?: string;
  script: ScriptInfo;
}

export type SystemScriptsRecord = Record<SystemScriptName, SystemScript | undefined>;

export interface NetworkSystemScripts {
  devnet: SystemScriptsRecord;
  testnet: SystemScriptsRecord;
  mainnet: SystemScriptsRecord;
}

export type MyScriptsRecord = Record<string, ScriptInfo | undefined>;

export interface NetworkMyScripts {
  devnet: MyScriptsRecord;
  testnet: MyScriptsRecord;
  mainnet: MyScriptsRecord;
}

export interface NetworkConfig {
  rpc_url: string;
  addressPrefix: AddressPrefix;
  explorer_api_base: string;
  explorer_web_base: string;
}

export interface OffCKBConfig {
  readonly version: string;
  readonly contractBinFolder: string;
  readonly contractInfoFolder: string;
  readonly networks: {
    devnet: NetworkConfig;
    testnet: NetworkConfig;
    mainnet: NetworkConfig;
  };
  readonly currentNetwork: Network;
  readonly addressPrefix: AddressPrefix;
  readonly rpcUrl: string;
  readonly explorerApiBase: string;
  readonly explorerWebBase: string;
  readonly systemScripts: SystemScriptsRecord;
  readonly myScripts: MyScriptsRecord;
}

export function readEnvNetwork(): Network {
  // you may need to update the env method
  // according to your frontend framework
  const network = process.env.NEXT_PUBLIC_NETWORK;
  const defaultNetwork: Network = 'devnet';
  if (!network) return defaultNetwork;

  if (!['devnet', 'testnet', 'mainnet'].includes(network)) {
    return defaultNetwork;
  }

  return network as Network;
}

const offCKBConfig: OffCKBConfig = {
  version: '0.3.5',
  contractBinFolder: '../build/release',
  // this folder record the script deployment information
  // If you change this folder, you need to update the following get systemScripts and get myScripts method
  contractInfoFolder: './offckb',
  networks: {
    devnet: {
      rpc_url: 'http://127.0.0.1:9000',
      addressPrefix: 'ckt',
      explorer_api_base: 'https://testnet-api.explorer.nervos.org',
      explorer_web_base: 'https://testnet.explorer.nervos.org',
    },
    testnet: {
      rpc_url: 'https://testnet.ckb.dev/rpc',
      addressPrefix: 'ckt',
      explorer_api_base: 'https://testnet-api.nervosscan.com',
      explorer_web_base: 'https://testnet.explorer.nervos.org',
    },
    mainnet: {
      rpc_url: 'https://mainnet.ckb.dev/rpc',
      addressPrefix: 'ckb',
      explorer_api_base: 'https://api.explorer.nervos.org',
      explorer_web_base: 'https://explorer.nervos.org',
    },
  },

  get currentNetwork() {
    const network = readEnvNetwork();
    return network;
  },

  get addressPrefix() {
    const network = readEnvNetwork();
    return this.networks[network].addressPrefix;
  },

  get rpcUrl() {
    const network = readEnvNetwork();
    return this.networks[network].rpc_url;
  },

  get explorerApiBase() {
    const network = readEnvNetwork();
    return this.networks[network].explorer_api_base;
  },

  get explorerWebBase() {
    const network = readEnvNetwork();
    return this.networks[network].explorer_web_base;
  },

  get systemScripts() {
    const network = readEnvNetwork();
    const networkSystemScripts: NetworkSystemScripts = require('./offckb/system-scripts.json');
    const systemScripts = networkSystemScripts[network];
    return systemScripts;
  },

  get myScripts() {
    const network = readEnvNetwork();
    const networkMyScripts: NetworkMyScripts = require('./offckb/my-scripts.json');
    const myScripts = networkMyScripts[network];
    return myScripts;
  },
};

export default offCKBConfig;
export const platformAddress = 'ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsqvswq2x8n3yg4ed2gmu0kquncp7g2yuz2cxp9gz9';
export const alwaysSuccessAddress = 'ckt1qr2g8yj3vrjzx2evk20szt5rszmmvykhrn6w0xv3ga4khnmpqu6lvqsemjs0q';
