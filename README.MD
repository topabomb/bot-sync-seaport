### SeaportOrderFulfilled 样例 1 解读

- 标的为 offer[n].token，本例中为 Town Star，TYPE=ERC1155，TokenId=0x023300000000000000000000000000000000,amount=1。
- 对价为 consideration 全部，本例中分解为三个地址（recipient），交易 token 为 Gala，TYPE=ERC20，本例中 amount 按不同比例分配。

```json
{
  "_chainId": { "type": "BigNumber", "hex": "0x01" },
  "_tranHash": "0x03ef4f4b95f31b47e81240f0037d7e2e671262a59062b2e2899c5571fb27fe11",
  "_logIndex": { "type": "BigNumber", "hex": "0x6f" },
  "orderHash": "0xb4e53f0ff266bf348e22df12a611eaaff017df75fba86f32245219af7aac98b5",
  "offerer": "0x9d6cb1214A76E00252949C1972f02Fc43bd7F167",
  "zone": "0x004C00500000aD104D7DBd00e3ae0A5C00560C00",
  "recipient": "0x8b0e03f41cD3cFF70d72346C9e92A49b81720855",
  "offer": [
    [
      3,
      "0xc36cF0cFcb5d905B8B513860dB0CFE63F6Cf9F5c",
      { "type": "BigNumber", "hex": "0x023300000000000000000000000000000000" },
      { "type": "BigNumber", "hex": "0x01" }
    ]
  ],
  "consideration": [
    [
      1,
      "0x15D4c048F83bd7e37d49eA4C83a07267Ec4203dA",
      { "type": "BigNumber", "hex": "0x00" },
      { "type": "BigNumber", "hex": "0x0812fc1a10" },
      "0x9d6cb1214A76E00252949C1972f02Fc43bd7F167"
    ],
    [
      1,
      "0x15D4c048F83bd7e37d49eA4C83a07267Ec4203dA",
      { "type": "BigNumber", "hex": "0x00" },
      { "type": "BigNumber", "hex": "0x37dd4cd0" },
      "0x0000a26b00c1F0DF003000390027140000fAa719"
    ],
    [
      1,
      "0x15D4c048F83bd7e37d49eA4C83a07267Ec4203dA",
      { "type": "BigNumber", "hex": "0x00" },
      { "type": "BigNumber", "hex": "0x6fba99a0" },
      "0x5493518B4518D465aa61965a4f9510f39E6afa46"
    ]
  ]
}
```

### 普通样例解读

- 标的为 CryptoSimeji#0x1117，type=erc721，收款人为 offerer，收货人为 recipient；对价为三个接收人，TYPE=NATIVE(链本币)，三个地址分别为：owner(收款人)，opensea Fee3，CryptoSimeji Deployer（版税）

```json
{
  "_chainId": { "type": "BigNumber", "hex": "0x01" },
  "_tranHash": "0x95d74b096f69fd295afe2a0cd96298f0d50b19bcd87c9d2d80e2946986275e9d",
  "_logIndex": { "type": "BigNumber", "hex": "0x013f" },
  "orderHash": "0xe6edebde73ee54ce587f254ad426db87074aaa548f28aa28cc9de81fa653c3d7",
  "offerer": "0x55D7Ea1d1877A7e9d80A8e50256Ca98Fc57fB2AA",
  "zone": "0x004C00500000aD104D7DBd00e3ae0A5C00560C00",
  "recipient": "0xb02F3b87a26cc07Fa4A6534b2d68498e24D50c29",
  "offer": [
    [
      2,
      "0xcCA8050215E585E2a223C6eA9D1D1F9b30BEAf3e",
      { "type": "BigNumber", "hex": "0x1117" },
      { "type": "BigNumber", "hex": "0x01" }
    ]
  ],
  "consideration": [
    [
      0,
      "0x0000000000000000000000000000000000000000",
      { "type": "BigNumber", "hex": "0x00" },
      { "type": "BigNumber", "hex": "0xefe5a136755000" },
      "0x55D7Ea1d1877A7e9d80A8e50256Ca98Fc57fB2AA"
    ],
    [
      0,
      "0x0000000000000000000000000000000000000000",
      { "type": "BigNumber", "hex": "0x00" },
      { "type": "BigNumber", "hex": "0x067bd3ecb71000" },
      "0x0000a26b00c1F0DF003000390027140000fAa719"
    ],
    [
      0,
      "0x0000000000000000000000000000000000000000",
      { "type": "BigNumber", "hex": "0x00" },
      { "type": "BigNumber", "hex": "0x0cf7a7d96e2000" },
      "0x564d27AEa51b24d8aA807CB94678DF69db7705EB"
    ]
  ]
}
```
