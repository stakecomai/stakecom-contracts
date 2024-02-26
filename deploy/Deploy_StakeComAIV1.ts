import { DeployFunction } from "hardhat-deploy/types"
import { HardhatRuntimeEnvironment } from "hardhat/types"

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
	const isMainnet = hre.network.name === "mainnet"
	if (!isMainnet) {
		console.log("StakeComAIV1 is only deployed on mainnet")
		return
	}

	// TODO - Deploy wCOMAI and bridge contracts for local / testnet
	const { deployer } = await hre.getNamedAccounts()

	// MAINNET ADDRESSES
	const wCOMAI = "0xc78B628b060258300218740B1A7a5b3c82b3bd9f"
	const bridge = "0xabe8dd90DADB368434b4a7a38Adb1F754a34f3A4"
	const defaultValidator = "vali::stakecom"

	await hre.deployments.deploy("StakeComAIV1", {
		from: deployer,
		args: [wCOMAI, bridge, defaultValidator],
		log: true,
	})
}
export default func
func.tags = ["stakeComAIV1"]
