// Verified StableSwap NG implementation ABI, Ethereum 0xDCc91f930b42619377C200BA05b7513f2958b202.
export const curveEvents=[
  {
    "name": "Transfer",
    "inputs": [
      {
        "name": "sender",
        "type": "address",
        "indexed": true
      },
      {
        "name": "receiver",
        "type": "address",
        "indexed": true
      },
      {
        "name": "value",
        "type": "uint256",
        "indexed": false
      }
    ],
    "anonymous": false,
    "type": "event"
  },
  {
    "name": "TokenExchange",
    "inputs": [
      {
        "name": "buyer",
        "type": "address",
        "indexed": true
      },
      {
        "name": "sold_id",
        "type": "int128",
        "indexed": false
      },
      {
        "name": "tokens_sold",
        "type": "uint256",
        "indexed": false
      },
      {
        "name": "bought_id",
        "type": "int128",
        "indexed": false
      },
      {
        "name": "tokens_bought",
        "type": "uint256",
        "indexed": false
      }
    ],
    "anonymous": false,
    "type": "event"
  },
  {
    "name": "TokenExchangeUnderlying",
    "inputs": [
      {
        "name": "buyer",
        "type": "address",
        "indexed": true
      },
      {
        "name": "sold_id",
        "type": "int128",
        "indexed": false
      },
      {
        "name": "tokens_sold",
        "type": "uint256",
        "indexed": false
      },
      {
        "name": "bought_id",
        "type": "int128",
        "indexed": false
      },
      {
        "name": "tokens_bought",
        "type": "uint256",
        "indexed": false
      }
    ],
    "anonymous": false,
    "type": "event"
  },
  {
    "name": "AddLiquidity",
    "inputs": [
      {
        "name": "provider",
        "type": "address",
        "indexed": true
      },
      {
        "name": "token_amounts",
        "type": "uint256[]",
        "indexed": false
      },
      {
        "name": "fees",
        "type": "uint256[]",
        "indexed": false
      },
      {
        "name": "invariant",
        "type": "uint256",
        "indexed": false
      },
      {
        "name": "token_supply",
        "type": "uint256",
        "indexed": false
      }
    ],
    "anonymous": false,
    "type": "event"
  },
  {
    "name": "RemoveLiquidity",
    "inputs": [
      {
        "name": "provider",
        "type": "address",
        "indexed": true
      },
      {
        "name": "token_amounts",
        "type": "uint256[]",
        "indexed": false
      },
      {
        "name": "fees",
        "type": "uint256[]",
        "indexed": false
      },
      {
        "name": "token_supply",
        "type": "uint256",
        "indexed": false
      }
    ],
    "anonymous": false,
    "type": "event"
  },
  {
    "name": "RemoveLiquidityOne",
    "inputs": [
      {
        "name": "provider",
        "type": "address",
        "indexed": true
      },
      {
        "name": "token_id",
        "type": "int128",
        "indexed": false
      },
      {
        "name": "token_amount",
        "type": "uint256",
        "indexed": false
      },
      {
        "name": "coin_amount",
        "type": "uint256",
        "indexed": false
      },
      {
        "name": "token_supply",
        "type": "uint256",
        "indexed": false
      }
    ],
    "anonymous": false,
    "type": "event"
  },
  {
    "name": "RemoveLiquidityImbalance",
    "inputs": [
      {
        "name": "provider",
        "type": "address",
        "indexed": true
      },
      {
        "name": "token_amounts",
        "type": "uint256[]",
        "indexed": false
      },
      {
        "name": "fees",
        "type": "uint256[]",
        "indexed": false
      },
      {
        "name": "invariant",
        "type": "uint256",
        "indexed": false
      },
      {
        "name": "token_supply",
        "type": "uint256",
        "indexed": false
      }
    ],
    "anonymous": false,
    "type": "event"
  },
  {
    "name": "RampA",
    "inputs": [
      {
        "name": "old_A",
        "type": "uint256",
        "indexed": false
      },
      {
        "name": "new_A",
        "type": "uint256",
        "indexed": false
      },
      {
        "name": "initial_time",
        "type": "uint256",
        "indexed": false
      },
      {
        "name": "future_time",
        "type": "uint256",
        "indexed": false
      }
    ],
    "anonymous": false,
    "type": "event"
  },
  {
    "name": "StopRampA",
    "inputs": [
      {
        "name": "A",
        "type": "uint256",
        "indexed": false
      },
      {
        "name": "t",
        "type": "uint256",
        "indexed": false
      }
    ],
    "anonymous": false,
    "type": "event"
  },
  {
    "name": "ApplyNewFee",
    "inputs": [
      {
        "name": "fee",
        "type": "uint256",
        "indexed": false
      },
      {
        "name": "offpeg_fee_multiplier",
        "type": "uint256",
        "indexed": false
      }
    ],
    "anonymous": false,
    "type": "event"
  },
  {
    "name": "SetNewMATime",
    "inputs": [
      {
        "name": "ma_exp_time",
        "type": "uint256",
        "indexed": false
      },
      {
        "name": "D_ma_time",
        "type": "uint256",
        "indexed": false
      }
    ],
    "anonymous": false,
    "type": "event"
  }
] as const;
