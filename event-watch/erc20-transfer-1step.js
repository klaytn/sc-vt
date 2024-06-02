const Caver = require('caver-js');
const fs = require('fs');

const conf = JSON.parse(fs.readFileSync('transfer_conf.json', 'utf8'));
const bridgeAbi = JSON.parse(fs.readFileSync('../build/Bridge.abi', 'utf8'));
const tokenAbi = JSON.parse(fs.readFileSync('../build/ServiceChainToken.abi', 'utf8'));

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

(async function TokenTransfer() {
  const testcase = process.argv[1].substring(process.argv[1].lastIndexOf('/') + 1).replace(/\.[^/.]+$/, "");
  console.log(`------------------------- ${testcase} START -------------------------`)
  let scnWS = new Caver.providers.WebsocketProvider(conf.ws.child);
  const scnCaver = new Caver(scnWS);
  const scnInstance = new scnCaver.klay.Contract(tokenAbi, conf.contract.child.token);
  const scnInstanceBridge = new scnCaver.klay.Contract(bridgeAbi, conf.contract.child.bridge);

  let enWS = new Caver.providers.WebsocketProvider(conf.ws.parent);
  const enCaver = new Caver(enWS);
  const enInstance = new enCaver.klay.Contract(tokenAbi, conf.contract.parent.token);
  const enInstanceBridge = new enCaver.klay.Contract(bridgeAbi, conf.contract.parent.bridge);

  conf.sender.child.address = scnCaver.klay.accounts.wallet.add(conf.sender.child.key).address;
  conf.sender.parent.address = enCaver.klay.accounts.wallet.add(conf.sender.parent.key).address;
  const alice = "0xc40b6909eb7085590e1c26cb3becc25368e249e9";

  try {
    let {reqValueTransferSub, handleValueTransferSub} = watch(enInstanceBridge, scnInstanceBridge);

    let balance = await scnInstance.methods.balanceOf(alice).call();
    console.log("alice balance:", balance);

    // Transfer main chain to service chain
    console.log("requestValueTransfer..")
    await enInstance.methods.requestValueTransfer(100, alice, 0, []).send({from:conf.sender.parent.address, gas: 1000000});
    // Wait event to be trasnferred to child chain and contained into new block
    await sleep(6000);

    // Check alice balance in Service Chain
    balance = await scnInstance.methods.balanceOf(alice).call();
    console.log("alice balance:", balance);

    reqValueTransferSub.unsubscribe();
    handleValueTransferSub.unsubscribe();
    scnCaver.currentProvider.disconnect();
    enCaver.currentProvider.disconnect();
  } catch (e) {
    console.log("Error:", e);
  }
  console.log(`------------------------- ${testcase} END -------------------------`)
})()

function watch(parentBridgeContract, childBridgeContract) {
  const reqValueTransferSub = parentBridgeContract.subscribe('RequestValueTransfer', {}, 
    (error, event) => {
      if (!error) printEvent(event)
    });
  const handleValueTransferSub = childBridgeContract.subscribe('HandleValueTransfer', {}, 
    (error, event) => {
      if (!error) printEvent(event)
    });
  return {reqValueTransferSub, handleValueTransferSub};
}

function printEvent(event) {
  let {from, to, tokenAddress, valueOrTokenId, requestTxHash, fee} = event.returnValues;
  console.log(`event: ${event.event}`);
  console.log(`  block number: ${event.blockNumber}`);
  console.log(`  transaction hash: ${event.transactionHash}`);
  console.log(`  bridge contract address: ${event.address}`);
  console.log(`  token contract address: ${tokenAddress}`);
  console.log(`  from: ${from}`);
  console.log(`  to: ${to}`);
  console.log(`  value: ${valueOrTokenId}`);

  // `HandleValueTransfer` event has the `requestTxHash` field.
  if (requestTxHash !== undefined) console.log(`  request transaction hash: ${requestTxHash}`);
  // `RequestValueTransfer` event has the `fee` field.
  if (fee !== undefined) console.log(`  fee: ${fee}`);
}
