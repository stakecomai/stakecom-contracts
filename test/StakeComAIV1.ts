import { expect } from "chai"
import { MaxUint256, parseEther } from "ethers"
import { deployments, ethers, getNamedAccounts } from "hardhat"
import { getComAddressSignature } from "../scripts/getSignature"
import { BasicERC20, StakeComAIV1 } from "typechain-types"
import { getComAddressSignatureViem } from "../scripts/getSignatureViem"

type Address = `0x${string}`

describe.only("StakeComAIV1", () => {
	const defaultModule = "vali::stakecom"

	const setupFixture = deployments.createFixture(async () => {
		await deployments.fixture()
		const signers = await getNamedAccounts()

		const name = "Mocked wCOMAI"
		const symbol = "wCOMAI"
		const owner = signers.deployer

		const wCOMAIContract = await ethers.deployContract(
			"BasicERC20",
			[name, symbol, owner],
			await ethers.getSigner(signers.deployer)
		)

		const wCOMAIAddress = await wCOMAIContract.getAddress()

		const bridgeContract = await ethers.deployContract(
			"MockBridge",
			[wCOMAIAddress],
			await ethers.getSigner(signers.deployer)
		)

		const bridgeAddress = await bridgeContract.getAddress()

		const stakeContract = await ethers.deployContract(
			"StakeComAIV1",
			[wCOMAIAddress, bridgeAddress, defaultModule],
			await ethers.getSigner(signers.deployer)
		)

		const stakeAddress = await stakeContract.getAddress()

		return {
			stakeContract: stakeContract,
			wCOMAIContract: wCOMAIContract,
			bridgeContract: bridgeContract,
			stakeAddress,
			deployer: signers.deployer,
			user1: signers.user1 as Address,
			accounts: await ethers.getSigners(),
			contractConstructor: {
				wCOMAIAddress,
				bridgeAddress,
				defaultModule,
			},
		}
	})

	const stakeHelper = async ({
		stakerAddress,
		deployer,
		amount,
		module,
		stakeAddress,
		stakeContract,
		wCOMAIContract,
		addressSignature,
	}: {
		stakerAddress: string
		amount: string | bigint
		deployer: string
		stakeAddress: string
		module?: string
		wCOMAIContract: BasicERC20
		stakeContract: StakeComAIV1
		addressSignature?: string
	}) => {
		const user1Signer = await ethers.getSigner(stakerAddress)
		const signer = await ethers.getSigner(deployer)
		const communeAddress = "mockSS58address"

		const signature =
			addressSignature ||
			(await getComAddressSignature({
				signer,
				stakerAddress,
				comAddress: communeAddress,
			}))
		const stakeAmount = typeof amount === "string" ? parseEther(amount) : amount

		// mint tokens for user
		await wCOMAIContract.mint(stakerAddress, stakeAmount * 5n)
		// approve tokens spend
		await wCOMAIContract.connect(user1Signer).approve(stakeAddress, MaxUint256)
		// user stakes tokens
		await stakeContract.connect(user1Signer).stake(stakeAmount, communeAddress, module || "", signature)

		return stakeContract.stakers(stakerAddress)
	}

	it("Should Return Valid Contract Configurations Passed In Constructor", async () => {
		const { contractConstructor, stakeContract, deployer } = await setupFixture()

		expect(await stakeContract.wCOMAIToken()).to.equal(contractConstructor.wCOMAIAddress)
		expect(await stakeContract.comBridge()).to.equal(contractConstructor.bridgeAddress)
		expect(await stakeContract.defaultModule()).to.equal(contractConstructor.defaultModule)
		expect(await stakeContract.owner()).to.equal(deployer)
		expect(await stakeContract.signer()).to.equal(deployer)
	})

	it("Should stake tokens", async () => {
		const { stakeContract, deployer, user1, wCOMAIContract, stakeAddress } = await setupFixture()
		const user1Signer = await ethers.getSigner(user1)
		const communeAddress = "mockSS58address"

		const amount = parseEther("1000")

		await stakeHelper({
			stakerAddress: user1,
			deployer,
			amount: "1000",
			stakeAddress,
			stakeContract,
			wCOMAIContract,
		})
		let userStake = await stakeContract.stakers(user1)

		expect(await stakeContract.totalStaked()).to.equal(amount)
		expect(userStake.module).to.equal(defaultModule)
		expect(userStake.amount).to.equal(amount)
		expect(userStake.communeAddress).to.equal(communeAddress)

		// Stake again for the same user (and omit com Address)

		const amount2 = parseEther("1500")
		await stakeContract.connect(user1Signer).stake(amount2, "", "", "0x00")

		userStake = await stakeContract.stakers(user1)

		expect(await stakeContract.totalStaked()).to.equal(amount + amount2)
		expect(userStake.module).to.equal(defaultModule)
		expect(userStake.amount).to.equal(amount + amount2)
		expect(userStake.communeAddress).to.equal(communeAddress)
	})

	it("Should stake tokens using viem to generate signature", async () => {
		const { stakeContract, deployer, user1, wCOMAIContract, stakeAddress } = await setupFixture()
		const user1Signer = await ethers.getSigner(user1)
		const deployerSigner = await ethers.getSigner(deployer)
		const communeAddress = "mockSS58address"

		const amount = parseEther("1000")

		await stakeHelper({
			stakerAddress: user1,
			deployer,
			amount: "1000",
			stakeAddress,
			stakeContract,
			wCOMAIContract,
			addressSignature: await getComAddressSignatureViem({
				signer: deployerSigner,
				stakerAddress: user1,
				comAddress: communeAddress,
			}),
		})
		let userStake = await stakeContract.stakers(user1)

		expect(await stakeContract.totalStaked()).to.equal(amount)
		expect(userStake.module).to.equal(defaultModule)
		expect(userStake.amount).to.equal(amount)
		expect(userStake.communeAddress).to.equal(communeAddress)

		// Stake again for the same user (and omit com Address)

		const amount2 = parseEther("1500")
		await stakeContract.connect(user1Signer).stake(amount2, "", "", "0x00")

		userStake = await stakeContract.stakers(user1)

		expect(await stakeContract.totalStaked()).to.equal(amount + amount2)
		expect(userStake.module).to.equal(defaultModule)
		expect(userStake.amount).to.equal(amount + amount2)
		expect(userStake.communeAddress).to.equal(communeAddress)
	})

	it("Should not allow staking with different module", async () => {
		const { stakeContract, deployer, user1, wCOMAIContract, stakeAddress } = await setupFixture()

		// 1st stake
		await stakeHelper({
			stakerAddress: user1,
			deployer,
			amount: "100",
			stakeAddress,
			stakeContract,
			wCOMAIContract,
		})

		// 2nd stake with different module
		const stakePromise = stakeHelper({
			stakerAddress: user1,
			deployer,
			amount: "100",
			stakeAddress,
			stakeContract,
			wCOMAIContract,
			module: "vali::miner",
		})

		await expect(stakePromise).to.be.revertedWithCustomError(stakeContract, "InvalidModule")
	})

	it("Should not allow staking if contract is paused", async () => {
		const { stakeContract, deployer, user1, wCOMAIContract, stakeAddress } = await setupFixture()

		await stakeContract.toggleStakingPause()
		expect(await stakeContract.stakingPaused()).to.equal(true)

		const stakePromise = stakeHelper({
			stakerAddress: user1,
			deployer,
			amount: "10",
			stakeAddress,
			stakeContract,
			wCOMAIContract,
		})

		await expect(stakePromise).to.be.revertedWithCustomError(stakeContract, "StakingPaused")
	})

	it("Should not allow to stake amount below minimal deposit amount", async () => {
		const { stakeContract, deployer, user1, wCOMAIContract, stakeAddress } = await setupFixture()

		const stakePromise = stakeHelper({
			stakerAddress: user1,
			deployer,
			amount: "10",
			stakeAddress,
			stakeContract,
			wCOMAIContract,
		})

		await expect(stakePromise).to.be.revertedWithCustomError(stakeContract, "StakeAmountTooLow")
	})

	it("Should respect allowCustomModule flag while staking", async () => {
		const { stakeContract, deployer, user1, wCOMAIContract, stakeAddress } = await setupFixture()

		expect(await stakeContract.allowCustomModule()).to.equal(false)

		const stakePromise = stakeHelper({
			stakerAddress: user1,
			deployer,
			amount: "100",
			stakeAddress,
			stakeContract,
			wCOMAIContract,
			module: "vali::custom",
		})

		await expect(stakePromise).to.be.revertedWithCustomError(stakeContract, "CustomModuleNotAllowed")

		await stakeContract.updateAllowCustomModule(true)

		const amount = parseEther("100")
		await stakeHelper({
			stakerAddress: user1,
			deployer,
			amount,
			stakeAddress,
			stakeContract,
			wCOMAIContract,
			module: "vali::custom",
		})

		const userStake = await stakeContract.stakers(user1)

		expect(await stakeContract.totalStaked()).to.equal(amount)
		expect(userStake.module).to.equal("vali::custom")
		expect(userStake.amount).to.equal(amount)
		expect(userStake.communeAddress).to.equal("mockSS58address")
	})

	it("Should unstake tokens", async () => {
		const { stakeContract, deployer, user1, wCOMAIContract, stakeAddress } = await setupFixture()

		const user1Signer = await ethers.getSigner(user1)
		const amount = parseEther("1000")
		await stakeHelper({
			stakerAddress: user1,
			deployer,
			amount: "1000",
			stakeAddress,
			stakeContract,
			wCOMAIContract,
		})
		const userStake = await stakeContract.stakers(user1)

		expect(await stakeContract.totalStaked()).to.equal(amount)
		expect(userStake.amount).to.equal(amount)

		// unstake partial amount
		await stakeContract.connect(user1Signer).initUnstake(amount / 2n, false)

		expect(await stakeContract.totalStaked()).to.equal(amount / 2n)
		let updatedUserStake = await stakeContract.stakers(user1)
		expect(updatedUserStake.amount).to.equal(amount / 2n)

		// unstake amount bigger than staked should unstake all
		await stakeContract.connect(user1Signer).initUnstake(amount * 2n, false)

		expect(await stakeContract.totalStaked()).to.equal(0n)
		updatedUserStake = await stakeContract.stakers(user1)
		expect(updatedUserStake.amount).to.equal(0n)
		expect(updatedUserStake.module).to.equal("")
	})

	it("Should unstake all tokens", async () => {
		const { stakeContract, deployer, user1, wCOMAIContract, stakeAddress } = await setupFixture()

		const user1Signer = await ethers.getSigner(user1)
		const amount = parseEther("1000")
		await stakeHelper({
			stakerAddress: user1,
			deployer,
			amount: "1000",
			stakeAddress,
			stakeContract,
			wCOMAIContract,
		})
		const userStake = await stakeContract.stakers(user1)

		expect(await stakeContract.totalStaked()).to.equal(amount)
		expect(userStake.amount).to.equal(amount)

		// unstake all tokens, even if partial amount is passed
		await stakeContract.connect(user1Signer).initUnstake(amount / 2n, true)

		expect(await stakeContract.totalStaked()).to.equal(0n)
		const updatedUserStake = await stakeContract.stakers(user1)
		expect(updatedUserStake.amount).to.equal(0n)
		expect(updatedUserStake.module).to.equal("")
	})

	it("Should unstake all tokens", async () => {
		const { stakeContract, deployer, user1, wCOMAIContract, stakeAddress } = await setupFixture()

		const user1Signer = await ethers.getSigner(user1)
		const amount = parseEther("1000")
		await stakeHelper({
			stakerAddress: user1,
			deployer,
			amount: "1000",
			stakeAddress,
			stakeContract,
			wCOMAIContract,
		})
		const userStake = await stakeContract.stakers(user1)

		expect(await stakeContract.totalStaked()).to.equal(amount)
		expect(userStake.amount).to.equal(amount)

		// unstake all tokens, even if partial amount is passed
		await stakeContract.connect(user1Signer).initUnstake(amount / 2n, true)

		expect(await stakeContract.totalStaked()).to.equal(0n)
		const updatedUserStake = await stakeContract.stakers(user1)
		expect(updatedUserStake.amount).to.equal(0n)
		expect(updatedUserStake.module).to.equal("")
	})

	it("Should changed staked module", async () => {
		const { stakeContract, deployer, user1, wCOMAIContract, stakeAddress } = await setupFixture()

		const user1Signer = await ethers.getSigner(user1)
		const amount = parseEther("1000")
		await stakeHelper({
			stakerAddress: user1,
			deployer,
			amount: "1000",
			stakeAddress,
			stakeContract,
			wCOMAIContract,
		})
		const userStake = await stakeContract.stakers(user1)

		await stakeContract.updateAllowCustomModule(true)
		expect(userStake.module).to.equal(defaultModule)

		await stakeContract.connect(user1Signer).changeModule("vali::test")

		const updatedUserStake = await stakeContract.stakers(user1)
		expect(updatedUserStake.amount).to.equal(amount)
		expect(updatedUserStake.module).to.equal("vali::test")
	})
})
