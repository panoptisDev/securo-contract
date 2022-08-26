const { ethers } = require("hardhat");
const { common } = require("../../parameters/testnet");
const AddressZero = ethers.constants.AddressZero;

module.exports = async ({ deployments }) => {
  const { deploy } = deployments;
  const [deployer] = await ethers.getSigners();

  const BNI = await ethers.getContractFactory("BNI");
  const bniProxy = await ethers.getContract("BNI_Proxy");
  const bni = BNI.attach(bniProxy.address);

  const priceOracleProxy = await ethers.getContract("AvaxPriceOracleTest_Proxy");
  var userAgentProxy;
  try {
    userAgentProxy = await ethers.getContract("BNIUserAgent_Proxy");
  } catch(e) {
    userAgentProxy = AddressZero;
  }

  console.log("Now deploying BNIMinter...");
  const proxy = await deploy("BNIMinterTest", {
    from: deployer.address,
    proxy: {
      proxyContract: "OpenZeppelinTransparentProxy",
      execute: {
        init: {
          methodName: "initialize",
          args: [
            common.admin,
            bni.address,
            priceOracleProxy.address,
          ],
        },
        onUpgrade: {
          methodName: "initialize2",
          args: [
            userAgentProxy.address,
            network_.biconomy,
          ],
        }
      },
    },
  });
  console.log("  BNIMinter_Proxy contract address: ", proxy.address);

  const minter = await bni.minter();
  if (minter === AddressZero) {
    const tx = await bni.setMinter(proxy.address);
    await tx.wait();
  }

  // Verify the implementation contract
  try {
    const implSlot = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc"; // bytes32(uint256(keccak256('eip1967.proxy.implementation')) - 1)

    let implAddress = await ethers.provider.getStorageAt(proxy.address, implSlot);
    implAddress = implAddress.replace("0x000000000000000000000000", "0x");

    await run("verify:verify", {
      address: implAddress,
      contract: "contracts/bni/BNIMinterTest.sol:BNIMinterTest",
    });
  } catch (e) {
  }
};
module.exports.tags = ["avaxTestnet_bni_BNIMinter"];
