import { expect } from "chai"
import { MaxUint256, parseEther } from "ethers"
import { deployments, ethers, getNamedAccounts } from "hardhat"
import { getComAddressSignature } from "../scripts/getSignature"
import { BasicERC20, StakeComAIV1 } from "typechain-types"

describe.only("StakeComAIV1", () => {
	const defaultValidator = "vali::stakecom"

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
			[wCOMAIAddress, bridgeAddress, defaultValidator],
			await ethers.getSigner(signers.deployer)
		)

		const stakeAddress = await stakeContract.getAddress()

		return {
			stakeContract: stakeContract,
			wCOMAIContract: wCOMAIContract,
			bridgeContract: bridgeContract,
			stakeAddress,
			deployer: signers.deployer,
			user1: signers.user1,
			accounts: await ethers.getSigners(),
			contractConstructor: {
				wCOMAIAddress,
				bridgeAddress,
				defaultValidator,
			},
		}
	})

	const stakeHelper = async ({
		stakerAddress,
		deployer,
		amount,
		validator,
		stakeAddress,
		stakeContract,
		wCOMAIContract,
	}: {
		stakerAddress: string
		amount: string
		deployer: string
		stakeAddress: string
		validator?: string
		wCOMAIContract: BasicERC20
		stakeContract: StakeComAIV1
	}) => {
		const user1Signer = await ethers.getSigner(stakerAddress)
		const signer = await ethers.getSigner(deployer)
		const communeAddress = "mockSS58address"

		const signature = await getComAddressSignature({ signer, stakerAddress, comAddress: communeAddress })
		const stakeAmount = parseEther(amount)

		// mint tokens for user
		await wCOMAIContract.mint(stakerAddress, stakeAmount * 5n)
		// approve tokens spend
		await wCOMAIContract.connect(user1Signer).approve(stakeAddress, MaxUint256)
		// user stakes tokens
		await stakeContract.connect(user1Signer).stake(stakeAmount, communeAddress, validator || "", signature)

		return stakeContract.stakers(stakerAddress)
	}

	it("Should Return Valid Contract Configurations Passed In Constructor", async () => {
		const { contractConstructor, stakeContract, deployer } = await setupFixture()

		expect(await stakeContract.wCOMAIToken()).to.equal(contractConstructor.wCOMAIAddress)
		expect(await stakeContract.comBridge()).to.equal(contractConstructor.bridgeAddress)
		expect(await stakeContract.defaultValidator()).to.equal(contractConstructor.defaultValidator)
		expect(await stakeContract.owner()).to.equal(deployer)
		expect(await stakeContract.signer()).to.equal(deployer)
	})

	it("Should stake tokens", async () => {
		const { stakeContract, deployer, user1, wCOMAIContract, stakeAddress } = await setupFixture()
		const user1Signer = await ethers.getSigner(user1)
		const communeAddress = "mockSS58address"

		const amount = parseEther("1000")

		let userStake = await stakeHelper({
			stakerAddress: user1,
			deployer,
			amount: "1000",
			stakeAddress,
			stakeContract,
			wCOMAIContract,
		})

		expect(await stakeContract.totalStaked()).to.equal(amount)
		expect(userStake.validator).to.equal(defaultValidator)
		expect(userStake.amount).to.equal(amount)
		expect(userStake.communeAddress).to.equal(communeAddress)

		// Stake again for the same user (and omit com Address)

		const amount2 = parseEther("1500")
		await stakeContract.connect(user1Signer).stake(amount2, "", "", "0x00")

		userStake = await stakeContract.stakers(user1)

		expect(await stakeContract.totalStaked()).to.equal(amount + amount2)
		expect(userStake.validator).to.equal(defaultValidator)
		expect(userStake.amount).to.equal(amount + amount2)
		expect(userStake.communeAddress).to.equal(communeAddress)
	})

	it("Should not allow staking with different validator", async () => {
		const { stakeContract, deployer, user1, wCOMAIContract, stakeAddress } = await setupFixture()
		const user1Signer = await ethers.getSigner(user1)
		const signer = await ethers.getSigner(deployer)
		const communeAddress = "mockSS58address"

		const signature = await getComAddressSignature({ signer, stakerAddress: user1, comAddress: communeAddress })
		const amount = parseEther("1000")

		// mint tokens for user
		await wCOMAIContract.mint(user1, parseEther("3000"))
		// approve tokens spend
		await wCOMAIContract.connect(user1Signer).approve(stakeAddress, MaxUint256)
		// user stakes tokens
		await stakeContract.connect(user1Signer).stake(amount, communeAddress, "", signature)

		// Stake again for the same user but change validator

		const amount2 = parseEther("1500")

		await expect(
			stakeContract.connect(user1Signer).stake(amount2, "", "vali::miner", "0x00")
		).to.be.revertedWithCustomError(stakeContract, "InvalidValidator")
	})

	it("Should not allow staking if contract is paused", async () => {
		const { stakeContract, deployer, user1, wCOMAIContract, stakeAddress } = await setupFixture()
		const user1Signer = await ethers.getSigner(user1)
		const signer = await ethers.getSigner(deployer)
		const communeAddress = "mockSS58address"

		await stakeContract.toggleStakingPause()
		expect(await stakeContract.stakingPaused()).to.equal(true)

		const signature = await getComAddressSignature({ signer, stakerAddress: user1, comAddress: communeAddress })
		const amount = parseEther("1000")

		// mint tokens for user
		await wCOMAIContract.mint(user1, parseEther("3000"))
		// approve tokens spend
		await wCOMAIContract.connect(user1Signer).approve(stakeAddress, MaxUint256)

		await expect(
			stakeContract.connect(user1Signer).stake(amount, communeAddress, "", signature)
		).to.be.revertedWithCustomError(stakeContract, "StakingPaused")
	})

	it("Should respect allowCustomValidator flag while staking", async () => {
		const { stakeContract, deployer, user1, wCOMAIContract, stakeAddress } = await setupFixture()
		const user1Signer = await ethers.getSigner(user1)
		const signer = await ethers.getSigner(deployer)
		const communeAddress = "mockSS58address"

		expect(await stakeContract.allowCustomValidator()).to.equal(false)

		const signature = await getComAddressSignature({ signer, stakerAddress: user1, comAddress: communeAddress })
		const amount = parseEther("1000")

		// mint tokens for user
		await wCOMAIContract.mint(user1, parseEther("3000"))
		// approve tokens spend
		await wCOMAIContract.connect(user1Signer).approve(stakeAddress, MaxUint256)

		const amount2 = parseEther("1500")

		await expect(
			stakeContract.connect(user1Signer).stake(amount2, communeAddress, "vali::miner", signature)
		).to.be.revertedWithCustomError(stakeContract, "CustomValidatorNotAllowed")

		await stakeContract.updateAllowCustomValidator(true)
		await stakeContract.connect(user1Signer).stake(amount, communeAddress, "vali::custom", signature)

		const userStake = await stakeContract.stakers(user1)

		expect(await stakeContract.totalStaked()).to.equal(amount)
		expect(userStake.validator).to.equal("vali::custom")
		expect(userStake.amount).to.equal(amount)
		expect(userStake.communeAddress).to.equal(communeAddress)
	})

	it("Should unstake tokens", async () => {
		const { stakeContract, deployer, user1, wCOMAIContract, stakeAddress } = await setupFixture()

		const user1Signer = await ethers.getSigner(user1)
		const amount = parseEther("1000")
		const userStake = await stakeHelper({
			stakerAddress: user1,
			deployer,
			amount: "1000",
			stakeAddress,
			stakeContract,
			wCOMAIContract,
		})

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
		expect(updatedUserStake.validator).to.equal("")
	})

	it("Should unstake all tokens", async () => {
		const { stakeContract, deployer, user1, wCOMAIContract, stakeAddress } = await setupFixture()

		const user1Signer = await ethers.getSigner(user1)
		const amount = parseEther("1000")
		const userStake = await stakeHelper({
			stakerAddress: user1,
			deployer,
			amount: "1000",
			stakeAddress,
			stakeContract,
			wCOMAIContract,
		})

		expect(await stakeContract.totalStaked()).to.equal(amount)
		expect(userStake.amount).to.equal(amount)

		// unstake all tokens, even if partial amount is passed
		await stakeContract.connect(user1Signer).initUnstake(amount / 2n, true)

		expect(await stakeContract.totalStaked()).to.equal(0n)
		const updatedUserStake = await stakeContract.stakers(user1)
		expect(updatedUserStake.amount).to.equal(0n)
		expect(updatedUserStake.validator).to.equal("")
	})

	it("Should unstake all tokens", async () => {
		const { stakeContract, deployer, user1, wCOMAIContract, stakeAddress } = await setupFixture()

		const user1Signer = await ethers.getSigner(user1)
		const amount = parseEther("1000")
		const userStake = await stakeHelper({
			stakerAddress: user1,
			deployer,
			amount: "1000",
			stakeAddress,
			stakeContract,
			wCOMAIContract,
		})

		expect(await stakeContract.totalStaked()).to.equal(amount)
		expect(userStake.amount).to.equal(amount)

		// unstake all tokens, even if partial amount is passed
		await stakeContract.connect(user1Signer).initUnstake(amount / 2n, true)

		expect(await stakeContract.totalStaked()).to.equal(0n)
		const updatedUserStake = await stakeContract.stakers(user1)
		expect(updatedUserStake.amount).to.equal(0n)
		expect(updatedUserStake.validator).to.equal("")
	})

	it("Should changed staked validator", async () => {
		const { stakeContract, deployer, user1, wCOMAIContract, stakeAddress } = await setupFixture()

		const user1Signer = await ethers.getSigner(user1)
		const amount = parseEther("1000")
		const userStake = await stakeHelper({
			stakerAddress: user1,
			deployer,
			amount: "1000",
			stakeAddress,
			stakeContract,
			wCOMAIContract,
		})

		await stakeContract.updateAllowCustomValidator(true)
		expect(userStake.validator).to.equal(defaultValidator)

		await stakeContract.connect(user1Signer).changeValidator("vali::test")

		const updatedUserStake = await stakeContract.stakers(user1)
		expect(updatedUserStake.amount).to.equal(amount)
		expect(updatedUserStake.validator).to.equal("vali::test")
	})
})
