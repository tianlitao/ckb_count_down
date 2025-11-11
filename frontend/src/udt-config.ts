export type UdtInfo = {
  decimal: number;
  name: string;
  symbol: string;
  amount: string; // total_amount as string
};

// Keyed by type script hash (type_hash)
export const UDT_CONFIG: Record<`0x${string}`, UdtInfo> = {
  // Example: fill with your actual metadata
  '0xf6e7be35aeddd6c8b9e5f6de7616bf749269fcdad0b80c1841ba1e1c61c4b7b2': {
    decimal: 8,
    name: '',
    symbol: 'UUU',
    amount: '1000',
  },
  //
  '0x95aeb921bdd986a76fa3662772320726fdffe0dc94f25691be8787541737f934': {
    decimal: 8,
    name: '',
    symbol: 'IIII',
    amount: '1000000',
  },
  // FairLaunchCell
  '0x2f7142a1f0f81894679a974ebbde4b344cb43f8f9c30d501ceb0c11b2f4340c9': {
    decimal: 8,
    name: '',
    symbol: 'FLC',
    amount: '10000000',
  },
  '0x0266f19836fff80df7a3af5ef347de10e474c29b70de8fe5ba7c1bc52c99bce2': {
    decimal: 8,
    name: '',
    symbol: 'TALK',
    amount: '10000000',
  },
  '0x1de9b4d0ac698604d4e8d4bfc72188bc3928924f0b98581123fca00bed6f754a': {
    decimal: 8,
    name: '',
    symbol: 'DAO',
    amount: '100000000',
  },

};
