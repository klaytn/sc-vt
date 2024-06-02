const Caver = require('caver-js');
const axios = require('axios');
const fs = require('fs')
const util = require('util');

const conf = JSON.parse(fs.readFileSync('../common/bridge_info.json', 'utf8'));

const bridgeAbi = JSON.parse(fs.readFileSync('../build/Bridge.abi', 'utf8'));
const bridgeCode = fs.readFileSync('../build/Bridge.bin', 'utf8');
const tokenAbi = JSON.parse(fs.readFileSync('../build/ServiceChainToken.abi', 'utf8'));
const tokenCode = fs.readFileSync('../build/ServiceChainToken.bin', 'utf8');

async function deploy(url, sender, info) {
  let ws = new Caver.providers.WebsocketProvider(url);
  const caver = new Caver(ws);
  sender.address = caver.klay.accounts.wallet.add(sender.key).address;

  try {
    // Deploy bridge
    const instanceBridge = new caver.klay.Contract(bridgeAbi);
    info.newInstanceBridge = await instanceBridge.deploy({data: bridgeCode, arguments:[true]})
      .send({ from: sender.address, gas: 100000000, value: 0 });
    info.bridge = info.newInstanceBridge._address;
    console.log(`info.bridge: ${info.bridge}`);

    // Deploy ERC20 token
    const instance = new caver.klay.Contract(tokenAbi);
    info.newInstance = await instance.deploy({data: tokenCode, arguments:[info.newInstanceBridge._address]})
      .send({ from: sender.address, gas: 100000000, value: 0 });
    info.token = info.newInstance._address;
    console.log(`info.token: ${info.token}`);
    return caver;
  } catch (e) {
    console.log("Error:", e);
  }
}

(async function TokenDeploy() {
  const testcase = process.argv[1].substring(process.argv[1].lastIndexOf('/') + 1).replace(/\.[^/.]+$/, "");
  console.log(`------------------------- ${testcase} START -------------------------`)
  conf.contract = {child: {}, parent:{}}
  const scnCaver = await deploy(conf.ws.child, conf.sender.child, conf.contract.child);
  const enCaver = await deploy(conf.ws.parent, conf.sender.parent, conf.contract.parent);

  // add minter
  await conf.contract.child.newInstance.methods.addMinter(conf.contract.child.bridge).send({ from: conf.sender.child.address, to: conf.contract.child.bridge, gas: 100000000, value: 0 });
  await conf.contract.parent.newInstance.methods.addMinter(conf.contract.parent.bridge).send({ from: conf.sender.parent.address, to: conf.contract.parent.bridge, gas: 100000000, value: 0 });

  // register token
  await conf.contract.child.newInstanceBridge.methods.registerToken(conf.contract.child.token, conf.contract.parent.token).send({ from: conf.sender.child.address, gas: 100000000, value: 0 });
  await conf.contract.parent.newInstanceBridge.methods.registerToken(conf.contract.parent.token, conf.contract.child.token).send({ from: conf.sender.parent.address, gas: 100000000, value: 0 });

  for (const bridge of conf.bridges) {
    // register operator
    await conf.contract.child.newInstanceBridge.methods.registerOperator(bridge.child.operator).send({ from: conf.sender.child.address, gas: 100000000, value: 0 });
    await conf.contract.parent.newInstanceBridge.methods.registerOperator(bridge.parent.operator).send({ from: conf.sender.parent.address, gas: 100000000, value: 0 });
  }

  // setOperatorThreshold
  await conf.contract.child.newInstanceBridge.methods.setOperatorThreshold(0, conf.bridges.length).send({ from: conf.sender.child.address, gas: 100000000, value: 0 });
  await conf.contract.parent.newInstanceBridge.methods.setOperatorThreshold(0, conf.bridges.length).send({ from: conf.sender.parent.address, gas: 100000000, value: 0 });

  // transferOwnership
  await conf.contract.child.newInstanceBridge.methods.transferOwnership(conf.bridges[0].child.operator).send({ from: conf.sender.child.address, gas: 100000000, value: 0 });
  await conf.contract.parent.newInstanceBridge.methods.transferOwnership(conf.bridges[0].parent.operator).send({ from: conf.sender.parent.address, gas: 100000000, value: 0 });

  scnCaver.currentProvider.disconnect();
  enCaver.currentProvider.disconnect();

  conf.contract.child.newInstance.currentProvider = undefined;
  conf.contract.child.newInstanceBridge.currentProvider = undefined;
  conf.contract.parent.newInstance.currentProvider = undefined;
  conf.contract.parent.newInstanceBridge.currentProvider = undefined;

  const filename  = "transfer_conf.json"
  fs.writeFile(filename, JSON.stringify(conf), (err) => {
    if (err) {
      console.log("Error:", err);
    }
  })

  // Initialize service chain configuration with three logs via interaction with attached console
  console.log("############################################################################");
  console.log(`Run below 3 commands in the Javascript console of all child bridge nodes (${conf.bridges.length} nodes total)`);
  console.log(`subbridge.registerBridge("${conf.contract.child.bridge}", "${conf.contract.parent.bridge}")`)
  console.log(`subbridge.subscribeBridge("${conf.contract.child.bridge}", "${conf.contract.parent.bridge}")`)
  console.log(`subbridge.registerToken("${conf.contract.child.bridge}", "${conf.contract.parent.bridge}", "${conf.contract.child.token}", "${conf.contract.parent.token}")`)
  console.log("############################################################################");
  console.log(`------------------------- ${testcase} END -------------------------`)
})();
